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
    const { officer_id } = JSON.parse(event.body || '{}')
    if (!officer_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'officer_id is required' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Verify it's an active temp officer
    const { data: officer, error: ofError } = await supabase
      .from('officers')
      .select('id, name, display_name, is_temporary, active')
      .eq('id', officer_id)
      .single()

    if (ofError || !officer) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Officer not found' }) }
    if (!officer.is_temporary) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Can only revoke acting captains' }) }
    if (!officer.active) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Acting access already removed' }) }

    // Deactivate officer, remove from acting_captains, expire sessions — all in parallel
    await Promise.all([
      supabase.from('officers').update({ active: false }).eq('id', officer_id),
      supabase.from('acting_captains').delete().eq('officer_id', officer_id),
      supabase.from('sessions').delete().eq('officer_id', officer_id)
    ])

    // Log the removal to edit_log
    await supabase.from('edit_log').insert({
      table_name: 'officers',
      record_id: officer_id,
      edited_by: admin.display_name,
      officer_id: admin.officer_id || null,
      original_values: { active: true, display_name: officer.display_name },
      new_values: { active: false, revoked_by: admin.display_name, revoked_at: new Date().toISOString() }
    })

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, name: officer.name }) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
