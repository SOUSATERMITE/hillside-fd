const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

const MAX_SIZE   = 8 * 1024 * 1024 // 8 MB base64 input (~6 MB actual)
const VALID_MIME = new Set(['image/jpeg','image/jpg','image/png','image/webp','image/gif','image/heic'])

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
    const { file_name, file_type, data: b64 } = JSON.parse(event.body || '{}')
    if (!file_name || !b64) return { statusCode: 400, headers, body: JSON.stringify({ error: 'file_name and data required' }) }

    const mime = (file_type || 'image/jpeg').toLowerCase()
    if (!VALID_MIME.has(mime)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Only image files allowed' }) }
    if (b64.length > MAX_SIZE) return { statusCode: 400, headers, body: JSON.stringify({ error: 'File too large — max 6MB' }) }

    const buf  = Buffer.from(b64, 'base64')
    const safe = file_name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `findings/${Date.now()}_${safe}`

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { error } = await supabase.storage.from('fd-documents').upload(path, buf, {
      contentType: mime, upsert: false
    })
    if (error) throw error

    const url = `${process.env.SUPABASE_URL}/storage/v1/object/public/fd-documents/${path}`
    return { statusCode: 200, headers, body: JSON.stringify({ url }) }
  } catch (e) {
    console.error('[upload-finding-photo]', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'Upload failed' }) }
  }
}
