const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

const BUCKET = 'personnel-documents'
const DOC_TYPES = ['certification','medical','disciplinary','commendation','training','other']

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
  if (officer.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'DC or admin access required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body
  const isAdmin = officer.role === 'admin' // all admins here

  // ── Upload URL (step 1) ───────────────────────────────────────────────────
  if (action === 'upload_url') {
    const { firefighter_id, file_name, document_type, document_name, notes } = body
    if (!firefighter_id || !file_name || !document_name) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'firefighter_id, file_name, document_name required' }) }
    }
    const ext       = file_name.split('.').pop().toLowerCase()
    const safe      = file_name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const timestamp = Date.now()
    const path      = `${firefighter_id}/${timestamp}_${safe}`

    const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }

    return { statusCode: 200, headers, body: JSON.stringify({
      upload_url: data.signedUrl,
      token:      data.token,
      path,
      metadata: { firefighter_id, file_name, document_name, document_type, notes }
    })}
  }

  // ── Confirm upload (step 2: save metadata) ────────────────────────────────
  if (action === 'upload_confirm') {
    const { firefighter_id, file_name, document_name, document_type, notes, path } = body
    if (!firefighter_id || !path || !document_name) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields' }) }
    }
    const dtype = DOC_TYPES.includes(document_type) ? document_type : 'other'
    const { data, error } = await supabase.from('personnel_documents').insert({
      firefighter_id,
      document_name: document_name.trim().slice(0, 200),
      document_type: dtype,
      file_path:     path,
      file_name:     file_name.slice(0, 200),
      uploaded_by:   officer.display_name,
      officer_id:    officer.officer_id,
      notes:         notes?.trim().slice(0, 500) || null
    }).select().single()

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify(data) }
  }

  // ── Download URL ──────────────────────────────────────────────────────────
  if (action === 'download_url') {
    const { doc_id } = body
    if (!doc_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'doc_id required' }) }

    const { data: doc } = await supabase.from('personnel_documents').select('file_path, file_name').eq('id', doc_id).single()
    if (!doc) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Document not found' }) }

    const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(doc.file_path, 60)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }

    return { statusCode: 200, headers, body: JSON.stringify({ url: data.signedUrl, file_name: doc.file_name }) }
  }

  // ── Delete document ───────────────────────────────────────────────────────
  if (action === 'delete_doc') {
    const { doc_id } = body
    if (!doc_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'doc_id required' }) }

    const { data: doc } = await supabase.from('personnel_documents').select('file_path').eq('id', doc_id).single()
    if (!doc) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }

    // Delete from storage + DB in parallel
    await Promise.all([
      supabase.storage.from(BUCKET).remove([doc.file_path]),
      supabase.from('personnel_documents').delete().eq('id', doc_id)
    ])
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  // ── Add note ──────────────────────────────────────────────────────────────
  if (action === 'add_note') {
    const { firefighter_id, note } = body
    if (!firefighter_id || !note?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'firefighter_id and note required' }) }
    }
    const { data, error } = await supabase.from('personnel_notes').insert({
      firefighter_id,
      note:       note.trim().slice(0, 2000),
      added_by:   officer.display_name,
      officer_id: officer.officer_id
    }).select().single()

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify(data) }
  }

  // ── Delete note ───────────────────────────────────────────────────────────
  if (action === 'delete_note') {
    const { note_id } = body
    if (!note_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'note_id required' }) }
    await supabase.from('personnel_notes').delete().eq('id', note_id)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
