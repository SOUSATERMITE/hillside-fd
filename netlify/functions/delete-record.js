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
    const { type, id, reason } = JSON.parse(event.body || '{}')
    if (!type || !id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'type and id are required' }) }
    if (!reason || !reason.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'A reason is required to delete a record' }) }
    if (!['sick', 'recall'].includes(type)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'type must be sick or recall' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const table = type === 'sick' ? 'sick_log' : 'recall_log'

    // Log the deletion as an edit before soft-deleting
    const { data: current } = await supabase.from(table).select('*').eq('id', id).single()

    const { error } = await supabase.from(table).update({
      deleted: true,
      deleted_at: new Date().toISOString(),
      deleted_by: admin.display_name,
      deleted_reason: reason.trim()
    }).eq('id', id)

    if (error) throw error

    if (current) {
      await supabase.from('edit_log').insert({
        table_name: table,
        record_id: id,
        edited_by: admin.display_name,
        officer_id: admin.officer_id || null,
        original_values: current,
        new_values: { deleted: true, deleted_reason: reason.trim() }
      })
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (e) {
    console.error('[delete-record] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
