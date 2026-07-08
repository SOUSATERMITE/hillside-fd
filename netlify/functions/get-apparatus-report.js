const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

const DEFICIENCY_TYPES = ['damage', 'repair_needed', 'inspection', 'manual_report']
const CHECK_TYPES       = ['daily_check', 'weekly_check']
const MAINTENANCE_TYPES = ['scheduled_maintenance', 'repair_completed']

function inRange(iso, start, end) {
  if (!iso) return false
  const d = iso.slice(0, 10)
  return d >= start && d <= end
}

// Reconstruct out-of-service periods from the chronological apparatus_log.
function buildOosPeriods(log) {
  const periods = []
  for (let i = 0; i < log.length; i++) {
    const entry = log[i]
    if (entry.new_status !== 'out_of_service') continue
    const next = log[i + 1]
    periods.push({
      date_out:      entry.created_at,
      reason:        entry.finding || entry.notes || null,
      taken_out_by:  entry.changed_by,
      date_returned: next ? next.created_at : null,
      returned_to:   next ? next.new_status : null,
      returned_by:   next ? next.changed_by : null
    })
  }
  return periods
}

function daysOverlap(period, start, end) {
  const periodStart = new Date(period.date_out).getTime()
  const periodEnd = period.date_returned ? new Date(period.date_returned).getTime() : Date.now()
  const rangeStart = new Date(start + 'T00:00:00').getTime()
  const rangeEnd = new Date(end + 'T23:59:59').getTime()
  const overlapStart = Math.max(periodStart, rangeStart)
  const overlapEnd = Math.min(periodEnd, rangeEnd)
  if (overlapEnd <= overlapStart) return 0
  return (overlapEnd - overlapStart) / 86400000
}

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

  const params = event.queryStringParameters || {}
  const apparatusId = params.id
  if (!apparatusId) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }

  const today = new Date().toISOString().split('T')[0]
  const yearStart = `${new Date().getFullYear()}-01-01`
  const start = params.start || yearStart
  const end = params.end || today

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const [apRes, findingsRes, logRes] = await Promise.all([
      supabase.from('apparatus').select('*').eq('id', apparatusId).single(),
      supabase.from('apparatus_findings').select('*').eq('apparatus_id', apparatusId).order('created_at', { ascending: false }),
      supabase.from('apparatus_log').select('*').eq('apparatus_id', apparatusId).order('created_at', { ascending: true })
    ])

    if (apRes.error || !apRes.data) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Apparatus not found' }) }
    if (findingsRes.error) throw findingsRes.error
    if (logRes.error) throw logRes.error

    const allFindings = findingsRes.data || []
    const allLog = logRes.data || []

    const deficiencies = allFindings.filter(f => DEFICIENCY_TYPES.includes(f.finding_type) && inRange(f.created_at, start, end))
    const checklists    = allFindings.filter(f => CHECK_TYPES.includes(f.finding_type) && inRange(f.created_at, start, end))
    const maintenance   = allFindings.filter(f => MAINTENANCE_TYPES.includes(f.finding_type) && inRange(f.created_at, start, end))
    const outstandingRepairs = allFindings.filter(f => DEFICIENCY_TYPES.includes(f.finding_type) && ['open', 'in_progress'].includes(f.status))

    const allOosPeriods = buildOosPeriods(allLog)
    const oosHistory = allOosPeriods.filter(p => inRange(p.date_out, start, end))
    const daysOosPeriod = allOosPeriods.reduce((sum, p) => sum + daysOverlap(p, start, end), 0)

    const periodDeficiencies = { total: deficiencies.length, open: deficiencies.filter(f => ['open', 'in_progress'].includes(f.status)).length, resolved: deficiencies.filter(f => ['completed', 'cancelled'].includes(f.status)).length }

    const lastInspection = allFindings.filter(f => CHECK_TYPES.includes(f.finding_type)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
    const allMaintenance = allFindings.filter(f => MAINTENANCE_TYPES.includes(f.finding_type))
    const lastMaintenance = allMaintenance
      .slice()
      .sort((a, b) => new Date(b.completed_date || b.created_at) - new Date(a.completed_date || a.created_at))[0]

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        apparatus: apRes.data,
        period: { start, end },
        summary: {
          total_deficiencies_period: periodDeficiencies,
          total_maintenance_period: maintenance.length,
          days_oos_period: Math.round(daysOosPeriod * 10) / 10,
          last_inspection_date: lastInspection ? lastInspection.created_at : null,
          last_maintenance_date: lastMaintenance ? (lastMaintenance.completed_date || lastMaintenance.created_at) : null
        },
        deficiencies,
        checklists,
        maintenance,
        outstanding_repairs: outstandingRepairs,
        oos_history: oosHistory
      })
    }
  } catch (e) {
    console.error('[get-apparatus-report] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
