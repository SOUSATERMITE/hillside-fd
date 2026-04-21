const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { checkAdmin } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-admin-password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const admin = await checkAdmin(event)
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Admin login required' }) }

  try {
    const { type, id } = JSON.parse(event.body || '{}')
    if (!type || !id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'type and id are required' }) }
    if (!['sick', 'recall'].includes(type)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'type must be sick or recall' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const table = type === 'sick' ? 'sick_log' : 'recall_log'

    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
