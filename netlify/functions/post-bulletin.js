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
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }
  if (officer.role === 'firefighter') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Officers only' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body
  const isAdmin = officer.role === 'admin'
  const cats = ['general', 'safety', 'equipment', 'training', 'reminder']

  if (action === 'post') {
    const { title, content, category } = body
    if (!title?.trim() || !content?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title and content required' }) }
    }
    const cat = cats.includes(category) ? category : 'general'

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

  if (action === 'edit') {
    const { id, title, content, category } = body
    if (!id || !title?.trim() || !content?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'id, title, and content required' }) }
    }
    const { data: existing } = await supabase.from('bulletin_posts').select('posted_by').eq('id', id).single()
    if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
    if (!isAdmin && existing.posted_by !== officer.display_name) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only edit your own bulletins' }) }
    }
    const cat = cats.includes(category) ? category : 'general'
    const dt = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const base = content.trim().replace(/\n\n— Edited by .+$/s, '').trim()
    const markedContent = (base + `\n\n— Edited by ${officer.display_name} on ${dt}`).slice(0, 2000)

    const { error } = await supabase.from('bulletin_posts').update({
      title:    title.trim().slice(0, 200),
      content:  markedContent,
      category: cat
    }).eq('id', id)

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, content: markedContent }) }
  }

  if (action === 'pin' || action === 'unpin') {
    if (!isAdmin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin required' }) }
    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
    await supabase.from('bulletin_posts').update({ pinned: action === 'pin' }).eq('id', id)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  if (action === 'delete') {
    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
    const { data: existing } = await supabase.from('bulletin_posts').select('posted_by').eq('id', id).single()
    if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
    if (!isAdmin && existing.posted_by !== officer.display_name) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only delete your own bulletins' }) }
    }
    await supabase.from('bulletin_posts').update({ active: false }).eq('id', id)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
