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

  try {
    const { firefighter_id } = JSON.parse(event.body || '{}')
    if (!firefighter_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'firefighter_id is required' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const { data: existing, error: checkError } = await supabase
      .from('sick_log')
      .select('id')
      .eq('firefighter_id', firefighter_id)
      .is('cleared_date', null)
      .maybeSingle()

    if (checkError) throw checkError
    if (existing) return { statusCode: 409, headers, body: JSON.stringify({ error: 'This firefighter is already marked sick.' }) }

    const { data: inserted, error: insertError } = await supabase
      .from('sick_log')
      .insert({
        firefighter_id,
        marked_sick_by: officer.display_name,
        officer_id: officer.officer_id,
        marked_sick_date: new Date().toISOString()
      })
      .select('*, firefighters(id, name, rank, group_number)')
      .single()

    if (insertError) throw insertError

    return { statusCode: 200, headers, body: JSON.stringify(inserted) }
  } catch (e) {
    console.error('[mark-sick] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
