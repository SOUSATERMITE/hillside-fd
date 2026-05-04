const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const [apparatusRes, logRes, findingsRes] = await Promise.all([
      supabase
        .from('apparatus')
        .select('id, unit_name, unit_type, status, location, notes, last_updated, updated_by, created_at, primary_officer_name, secondary_officer_name')
        .eq('active', true)
        .order('unit_name', { ascending: true }),

      supabase
        .from('apparatus_log')
        .select('id, apparatus_id, previous_status, new_status, location, notes, finding, changed_by, created_at')
        .order('created_at', { ascending: false })
        .limit(500),

      supabase
        .from('apparatus_findings')
        .select('id, apparatus_id, finding_type, description, priority, reported_by, assigned_to, scheduled_date, completed_date, completed_by, status, photos_notes, findings_data, created_at')
        .order('created_at', { ascending: false })
        .limit(1000)
    ])

    const apparatus = apparatusRes.data || []
    const logs      = logRes.data     || []
    const findings  = findingsRes.data || []

    // Group by apparatus_id
    const logsByUnit      = {}
    const findingsByUnit  = {}
    for (const entry of logs) {
      if (!logsByUnit[entry.apparatus_id]) logsByUnit[entry.apparatus_id] = []
      logsByUnit[entry.apparatus_id].push(entry)
    }
    for (const f of findings) {
      if (!findingsByUnit[f.apparatus_id]) findingsByUnit[f.apparatus_id] = []
      findingsByUnit[f.apparatus_id].push(f)
    }

    const PRI_ORDER = { critical: 0, high: 1, medium: 2, low: 3 }

    const result = apparatus.map(a => {
      const unitFindings = findingsByUnit[a.id] || []

      // Sort findings: open/in_progress first by priority, then completed
      unitFindings.sort((a, b) => {
        const aOpen = ['open','in_progress'].includes(a.status)
        const bOpen = ['open','in_progress'].includes(b.status)
        if (aOpen !== bOpen) return aOpen ? -1 : 1
        return (PRI_ORDER[a.priority] ?? 2) - (PRI_ORDER[b.priority] ?? 2)
      })

      const openFindings     = unitFindings.filter(f => ['open','in_progress'].includes(f.status) && ['damage','repair_needed','inspection'].includes(f.finding_type))
      const criticalHighCount = openFindings.filter(f => ['critical','high'].includes(f.priority)).length

      return {
        ...a,
        log:              logsByUnit[a.id] || [],
        findings:         unitFindings,
        open_findings:    openFindings.length,
        critical_high:    criticalHighCount
      }
    })

    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (e) {
    console.error('[get-apparatus] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
