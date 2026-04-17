const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const { firefighter_id, marked_sick_by } = JSON.parse(event.body || '{}')

    if (!firefighter_id || !marked_sick_by) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'firefighter_id and marked_sick_by are required' }) }
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Check if already sick
    const { data: existing, error: checkError } = await supabase
      .from('sick_log')
      .select('id')
      .eq('firefighter_id', firefighter_id)
      .is('cleared_date', null)
      .maybeSingle()

    if (checkError) throw checkError

    if (existing) {
      return {
        statusCode: 409,
        headers,
        body: JSON.stringify({ error: 'This firefighter is already marked sick.' })
      }
    }

    // Insert new sick_log row
    const { data: inserted, error: insertError } = await supabase
      .from('sick_log')
      .insert({
        firefighter_id,
        marked_sick_by,
        marked_sick_date: new Date().toISOString()
      })
      .select('*, firefighters(id, name, rank, group_number)')
      .single()

    if (insertError) throw insertError

    return { statusCode: 200, headers, body: JSON.stringify(inserted) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
