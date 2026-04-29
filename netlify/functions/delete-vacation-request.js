const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

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

  const officer = await verifySession(event)
  if (!officer || officer.role !== 'admin') {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Admin login required' }) }
  }

  const { id } = JSON.parse(event.body || '{}')
  if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { error } = await supabase.from('vacation_requests').delete().eq('id', id)
  if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }

  console.log(`[delete-vacation-request] Deleted request ${id} by admin ${officer.display_name}`)
  return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
}
