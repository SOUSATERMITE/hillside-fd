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
  const { title, description, event_date, event_time, group_number, category } = JSON.parse(event.body || '{}')

  if (!title?.trim() || !event_date) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Title and date required' }) }
  }
  const cats = ['training', 'inspection', 'drill', 'meeting', 'other']
  const cat  = cats.includes(category) ? category : 'other'
  const grp  = group_number ? parseInt(group_number) : null

  const { data, error } = await supabase.from('scheduled_events').insert({
    title:       title.trim().slice(0, 200),
    description: description?.trim().slice(0, 1000) || null,
    event_date,
    event_time:  event_time || null,
    group_number: grp,
    category:    cat,
    created_by:  officer.display_name,
    officer_id:  officer.officer_id,
    notify_on_duty_group: true
  }).select().single()

  if (error) {
    console.error('[manage-events]', error.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
  }
  return { statusCode: 200, headers, body: JSON.stringify(data) }
}
