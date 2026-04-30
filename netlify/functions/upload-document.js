const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

const VALID_CATEGORIES = new Set(['Labor Contract', 'SOPs', 'Recall Policy', 'Memos', 'Rules & Regs', 'Other'])
const MAX_SIZE = 5 * 1024 * 1024 // 5MB

async function extractPdfText(buffer) {
  try {
    const pdfParse = require('pdf-parse')
    const result = await pdfParse(buffer)
    return (result.text || '').trim()
  } catch (e) {
    console.error('pdf-parse error:', e.message)
    return null
  }
}

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
    const { title, category, description, content_text, file_name, file_type, file_size, data: b64 } =
      JSON.parse(event.body || '{}')

    if (!title || !category || !file_name || !b64) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'title, category, file_name, and file data are required' }) }
    }
    if (!VALID_CATEGORIES.has(category)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid category' }) }
    }
    if (file_size && file_size > MAX_SIZE) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'File too large — maximum 5MB' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Decode base64
    const fileBuffer = Buffer.from(b64, 'base64')

    // Auto-extract text from PDFs; fall back to manually entered content_text
    let storedText = (content_text || '').trim() || null
    const isPdf = (file_type === 'application/pdf') || file_name.toLowerCase().endsWith('.pdf')
    if (isPdf) {
      const extracted = await extractPdfText(fileBuffer)
      if (extracted) storedText = extracted
    }

    // Build a unique storage path
    const ts     = Date.now()
    const safe   = file_name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const folder = category.replace(/[^a-zA-Z0-9]/g, '_')
    const filePath = `${folder}/${ts}_${safe}`

    // Upload to Supabase Storage
    const { error: uploadError } = await supabase.storage
      .from('fd-documents')
      .upload(filePath, fileBuffer, { contentType: file_type || 'application/octet-stream', upsert: false })

    if (uploadError) throw uploadError

    // Insert DB record
    const { data: doc, error: dbError } = await supabase
      .from('fd_documents')
      .insert({
        title: title.trim(),
        category,
        description: (description || '').trim() || null,
        content_text: storedText,
        file_path: filePath,
        file_name: file_name,
        file_size: file_size || fileBuffer.length,
        uploaded_by: officer.display_name
      })
      .select()
      .single()

    if (dbError) throw dbError

    const download_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/fd-documents/${filePath}`
    return { statusCode: 200, headers, body: JSON.stringify({ ...doc, download_url }) }
  } catch (e) {
    console.error('[upload-document] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
