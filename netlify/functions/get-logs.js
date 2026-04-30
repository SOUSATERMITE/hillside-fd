const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { checkAdmin } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password, x-session-token',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const admin = await checkAdmin(event)
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }

  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const params = event.queryStringParameters || {}
    const type = params.type || 'sick'
    const limit = parseInt(params.limit, 10) || 200

    if (type === 'sick') {
      const { data, error } = await supabase
        .from('sick_log')
        .select('*, firefighters(id, name, rank, group_number)')
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (type === 'recall') {
      const { data, error } = await supabase
        .from('recall_log')
        .select('id, shift_date, recall_type, hours_worked, recall_start_time, recall_end_time, tour_worked, notes, recorded_by, created_at, firefighters!recall_log_firefighter_id_fkey(id, name, rank, group_number)')
        .eq('deleted', false)
        .order('created_at', { ascending: false })
        .limit(limit)
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'type must be sick or recall' }) }
  } catch (e) {
    console.error('[get-logs] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
