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

  if (action === 'submit') {
    const { title, description, location, priority } = body
    if (!title?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title required' }) }

    const priorities = ['low', 'medium', 'high', 'urgent']
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

    const updates = {
      status,
      updated_at: new Date().toISOString()
    }
    if (assigned_to !== undefined) updates.assigned_to = assigned_to || null
    if (status === 'completed') updates.completed_date = new Date().toISOString().split('T')[0]

    const { error } = await supabase.from('work_orders').update(updates).eq('id', id)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
