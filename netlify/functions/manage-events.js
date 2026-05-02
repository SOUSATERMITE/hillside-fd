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
  const cats = ['training', 'inspection', 'drill', 'meeting', 'other']

  // Add (no action or action='add')
  if (!action || action === 'add') {
    const { title, description, event_date, event_time, group_number, category } = body
    if (!title?.trim() || !event_date) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title and date required' }) }
    }
    const cat = cats.includes(category) ? category : 'other'
    const grp = group_number ? parseInt(group_number) : null

    const { data, error } = await supabase.from('scheduled_events').insert({
      title:                title.trim().slice(0, 200),
      description:          description?.trim().slice(0, 1000) || null,
      event_date,
      event_time:           event_time || null,
      group_number:         grp,
      category:             cat,
      created_by:           officer.display_name,
      officer_id:           officer.officer_id,
      notify_on_duty_group: true
    }).select().single()

    if (error) {
      console.error('[manage-events]', error.message)
      return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    }
    return { statusCode: 200, headers, body: JSON.stringify(data) }
  }

  if (action === 'edit') {
    const { id, title, description, event_date, event_time, group_number, category } = body
    if (!id || !title?.trim() || !event_date) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'id, title, and date required' }) }
    }
    const { data: existing } = await supabase.from('scheduled_events').select('created_by').eq('id', id).single()
    if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
    if (!isAdmin && existing.created_by !== officer.display_name) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only edit your own events' }) }
    }
    const cat = cats.includes(category) ? category : 'other'
    const grp = group_number ? parseInt(group_number) : null
    const dt  = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const base = (description||'').trim().replace(/\n\n— Edited by .+$/s, '').trim()
    const markedDesc = base ? (base + `\n\n— Edited by ${officer.display_name} on ${dt}`).slice(0, 1000) : null

    const { error } = await supabase.from('scheduled_events').update({
      title:        title.trim().slice(0, 200),
      description:  markedDesc,
      event_date,
      event_time:   event_time || null,
      group_number: grp,
      category:     cat
    }).eq('id', id)

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, description: markedDesc }) }
  }

  if (action === 'delete') {
    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
    const { data: existing } = await supabase.from('scheduled_events').select('created_by').eq('id', id).single()
    if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
    if (!isAdmin && existing.created_by !== officer.display_name) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only delete your own events' }) }
    }
    const { error } = await supabase.from('scheduled_events').delete().eq('id', id)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
