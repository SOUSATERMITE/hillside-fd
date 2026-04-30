const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

  try {
    const { sick_log_id } = JSON.parse(event.body || '{}')
    if (!sick_log_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'sick_log_id is required' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const { data: updated, error } = await supabase
      .from('sick_log')
      .update({
        cleared_date: new Date().toISOString(),
        cleared_by: officer.display_name
      })
      .eq('id', sick_log_id)
      .is('cleared_date', null)
      .select('*, firefighters(id, name, rank, group_number)')
      .single()

    if (error) throw error
    if (!updated) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Sick log entry not found or already cleared.' }) }

    return { statusCode: 200, headers, body: JSON.stringify(updated) }
  } catch (e) {
    console.error('[clear-sick] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
