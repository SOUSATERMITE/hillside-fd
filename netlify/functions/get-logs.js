const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

function checkAuth(event) {
  const provided = (event.headers && event.headers['x-admin-password']) || ''
  const expected = process.env.ADMIN_PASSWORD || ''
  return provided === expected && expected !== ''
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (!checkAuth(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const params = event.queryStringParameters || {}
    const type = params.type || 'sick'
    const limit = parseInt(params.limit, 10) || 200

    if (type === 'sick') {
      const { data, error } = await supabase
        .from('sick_log')
        .select('*, firefighters(id, name, rank, group_number)')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (type === 'recall') {
      const { data, error } = await supabase
        .from('recall_log')
        .select('*, firefighters(id, name, rank, group_number)')
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'type must be sick or recall' }) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
