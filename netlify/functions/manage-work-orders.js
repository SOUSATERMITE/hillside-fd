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
  const priorities = ['low', 'medium', 'high', 'urgent']

  if (action === 'submit') {
    const { title, description, location, priority } = body
    if (!title?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title required' }) }

    const pri = priorities.includes(priority) ? priority : 'medium'

    const { data, error } = await supabase.from('work_orders').insert({
      title:        title.trim().slice(0, 200),
      description:  description?.trim().slice(0, 1000) || null,
      location:     location?.trim().slice(0, 200)     || null,
      priority:     pri,
      status:       'submitted',
      submitted_by: officer.display_name,
      officer_id:   officer.officer_id,
      updated_at:   new Date().toISOString()
    }).select().single()

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify(data) }
  }

  if (action === 'update') {
    const { id, status, assigned_to } = body
    if (!id || !status) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id and status required' }) }

    const statuses = ['submitted', 'in_progress', 'completed', 'cancelled']
    if (!statuses.includes(status)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid status' }) }

    const updates = { status, updated_at: new Date().toISOString() }
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null
    if (status === 'completed') updates.completed_date = new Date().toISOString().split('T')[0]

    const { error } = await supabase.from('work_orders').update(updates).eq('id', id)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  if (action === 'edit') {
    const { id, title, description, location, priority } = body
    if (!id || !title?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id and title required' }) }

    const { data: existing } = await supabase.from('work_orders').select('officer_id').eq('id', id).single()
    if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
    if (!isAdmin && existing.officer_id !== officer.officer_id) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only edit your own work orders' }) }
    }
    const pri = priorities.includes(priority) ? priority : 'medium'
    const dt  = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    const base = (description||'').trim().replace(/\n\n— Edited by .+$/s, '').trim()
    const markedDesc = base ? (base + `\n\n— Edited by ${officer.display_name} on ${dt}`).slice(0, 1000) : null

    const { error } = await supabase.from('work_orders').update({
      title:       title.trim().slice(0, 200),
      description: markedDesc,
      location:    location?.trim().slice(0, 200) || null,
      priority:    pri,
      updated_at:  new Date().toISOString()
    }).eq('id', id)

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, description: markedDesc }) }
  }

  if (action === 'delete') {
    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }

    const { data: existing } = await supabase.from('work_orders').select('officer_id').eq('id', id).single()
    if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
    if (!isAdmin && existing.officer_id !== officer.officer_id) {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only delete your own work orders' }) }
    }
    const { error } = await supabase.from('work_orders').delete().eq('id', id)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
