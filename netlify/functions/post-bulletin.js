const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession, checkAdmin } = require('./_auth')

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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body

  if (action === 'post') {
    const officer = await verifySession(event)
    if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

    const { title, content, category } = body
    if (!title?.trim() || !content?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title and content required' }) }
    }
    const cats = ['general', 'safety', 'equipment', 'training', 'reminder']
    const cat  = cats.includes(category) ? category : 'general'

    const { data, error } = await supabase.from('bulletin_posts').insert({
      title:      title.trim().slice(0, 200),
      content:    content.trim().slice(0, 2000),
      category:   cat,
      posted_by:  officer.display_name,
      officer_id: officer.officer_id,
      pinned:     false,
      active:     true
    }).select().single()

    if (error) throw error
    return { statusCode: 200, headers, body: JSON.stringify(data) }
  }

  if (action === 'pin' || action === 'unpin' || action === 'delete') {
    const admin = await checkAdmin(event)
    if (!admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin required' }) }

    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }

    if (action === 'delete') {
      await supabase.from('bulletin_posts').update({ active: false }).eq('id', id)
    } else {
      await supabase.from('bulletin_posts').update({ pinned: action === 'pin' }).eq('id', id)
    }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
