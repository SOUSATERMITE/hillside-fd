const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const params = event.queryStringParameters || {}
    const category = params.category || null

    // Include content_text so /search can do client-side full-text matching
    let query = supabase
      .from('fd_documents')
      .select('id, title, category, description, content_text, file_name, file_path, file_size, uploaded_by, created_at')
      .eq('active', true)
      .order('created_at', { ascending: false })

    if (category) query = query.eq('category', category)

    const { data, error } = await query
    if (error) throw error

    // Attach public download URL
    const base = `${process.env.SUPABASE_URL}/storage/v1/object/public/fd-documents`
    const docs = (data || []).map(d => ({ ...d, download_url: `${base}/${d.file_path}` }))

    return { statusCode: 200, headers, body: JSON.stringify(docs) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
