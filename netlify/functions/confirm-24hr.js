const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { sick_log_id, confirmed_by } = JSON.parse(event.body || '{}')

    if (!sick_log_id || !confirmed_by) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'sick_log_id and confirmed_by are required' }) }
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    const { error } = await supabase
      .from('sick_log')
      .update({
        confirmed_24hr: true,
        confirmed_by,
        confirmed_at: new Date().toISOString()
      })
      .eq('id', sick_log_id)

    if (error) throw error

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
