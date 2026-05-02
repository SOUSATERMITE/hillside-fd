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
  const cats = ['officer', 'firefighter', 'staff', 'external', 'vendor', 'emergency', 'utility', 'other']

  if (action === 'add') {
    const { name, title, phone, email, category, notes } = body
    if (!name?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Name required' }) }

    const { data, error } = await supabase.from('contacts').insert({
      name:     name.trim().slice(0, 100),
      title:    title?.trim().slice(0, 100)    || null,
      phone:    phone?.trim().slice(0, 30)     || null,
      email:    email?.trim().slice(0, 150)    || null,
      category: cats.includes(category) ? category : 'other',
      notes:    notes?.trim().slice(0, 500)    || null,
      active:   true
    }).select().single()

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify(data) }
  }

  if (action === 'edit') {
    const { id, name, title, phone, email, category, notes } = body
    if (!id || !name?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id and name required' }) }

    const { error } = await supabase.from('contacts').update({
      name:     name.trim().slice(0, 100),
      title:    title?.trim().slice(0, 100)    || null,
      phone:    phone?.trim().slice(0, 30)     || null,
      email:    email?.trim().slice(0, 150)    || null,
      category: cats.includes(category) ? category : 'other',
      notes:    notes?.trim().slice(0, 500)    || null
    }).eq('id', id)

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  if (action === 'delete') {
    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
    await supabase.from('contacts').update({ active: false }).eq('id', id)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
