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

    const [apparatusRes, logRes] = await Promise.all([
      supabase
        .from('apparatus')
        .select('id, unit_name, unit_type, status, location, notes, last_updated, updated_by, created_at')
        .eq('active', true)
        .order('unit_name', { ascending: true }),

      supabase
        .from('apparatus_log')
        .select('id, apparatus_id, previous_status, new_status, location, notes, finding, changed_by, created_at')
        .order('created_at', { ascending: false })
        .limit(500)
    ])

    const apparatus = apparatusRes.data || []
    const logs      = logRes.data || []

    // Group logs by apparatus_id
    const logsByUnit = {}
    for (const entry of logs) {
      if (!logsByUnit[entry.apparatus_id]) logsByUnit[entry.apparatus_id] = []
      logsByUnit[entry.apparatus_id].push(entry)
    }

    const result = apparatus.map(a => ({
      ...a,
      log: logsByUnit[a.id] || []
    }))

    return { statusCode: 200, headers, body: JSON.stringify(result) }
  } catch (e) {
    console.error('[get-apparatus] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
