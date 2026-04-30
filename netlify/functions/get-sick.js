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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  try {
    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Currently sick: cleared_date IS NULL
    const { data: currentlySick, error: sickError } = await supabase
      .from('sick_log')
      .select('id, marked_sick_date, cleared_date, cleared_by, notes, confirmed_24hr, confirmed_by, confirmed_at, firefighters(id, name, rank, group_number)')
      .eq('deleted', false)
      .is('cleared_date', null)
      .order('marked_sick_date', { ascending: false })

    if (sickError) throw sickError

    // Recently cleared: cleared_date within last 96 hours
    const cutoffISO = new Date(Date.now() - 96 * 3600 * 1000).toISOString()

    const { data: recentlyCleared, error: clearedError } = await supabase
      .from('sick_log')
      .select('id, marked_sick_date, cleared_date, cleared_by, notes, confirmed_24hr, confirmed_by, confirmed_at, firefighters(id, name, rank, group_number)')
      .eq('deleted', false)
      .not('cleared_date', 'is', null)
      .gte('cleared_date', cutoffISO)
      .order('cleared_date', { ascending: false })

    if (clearedError) throw clearedError

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ currently_sick: currentlySick, recently_cleared: recentlyCleared })
    }
  } catch (e) {
    console.error('[get-sick] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
