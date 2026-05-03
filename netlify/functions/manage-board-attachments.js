// Manage file attachments for bulletin posts and events
// Actions: upload_url, confirm, download_url, delete

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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body
  const isAdmin = officer.role === 'admin'

  // ── Get signed URL for client-side upload ──────────────────────────────────
  if (action === 'upload_url') {
    const { source_type, source_id, file_name } = body
    if (!source_type || !source_id || !file_name) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'source_type, source_id, and file_name required' }) }
    }
    if (!['bulletin', 'event'].includes(source_type)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid source_type' }) }
    }
    const safe = file_name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100)
    const path = `${source_type}s/${source_id}/${Date.now()}_${safe}`
    const { data, error } = await supabase.storage.from('board-attachments').createSignedUploadUrl(path)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ signedUrl: data.signedUrl, path }) }
  }

  // ── Confirm upload and save metadata ──────────────────────────────────────
  if (action === 'confirm') {
    const { source_type, source_id, file_name, file_path, file_size } = body
    if (!source_type || !source_id || !file_name || !file_path) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'source_type, source_id, file_name, file_path required' }) }
    }
    const { data, error } = await supabase.from('board_attachments').insert({
      source_type,
      source_id,
      file_name: file_name.slice(0, 255),
      file_path,
      file_size: file_size || null,
      uploaded_by: officer.display_name,
      officer_id:  officer.officer_id
    }).select().single()
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify(data) }
  }

  // ── Get signed download URL ────────────────────────────────────────────────
  if (action === 'download_url') {
    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
    const { data: rec } = await supabase.from('board_attachments').select('file_path').eq('id', id).single()
    if (!rec) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
    const { data, error } = await supabase.storage.from('board-attachments').createSignedUrl(rec.file_path, 3600)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ url: data.signedUrl }) }
  }

  // ── Delete attachment ──────────────────────────────────────────────────────
  if (action === 'delete') {
    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
    const { data: rec } = await supabase.from('board_attachments').select('file_path, uploaded_by').eq('id', id).single()
    if (!rec) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
    if (!isAdmin && rec.uploaded_by !== officer.display_name) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only delete your own attachments' }) }
    }
    await supabase.storage.from('board-attachments').remove([rec.file_path])
    const { error } = await supabase.from('board_attachments').delete().eq('id', id)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
