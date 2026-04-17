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
    const group = parseInt((event.queryStringParameters || {}).group, 10)
    if (!group || group < 1 || group > 4) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'group param must be 1–4' }) }
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // Fetch recall list for this group
    const { data: recallEntries, error: recallError } = await supabase
      .from('recall_list')
      .select('*, firefighters(id, name, rank, group_number)')
      .eq('group_number', group)
      .order('rank_type', { ascending: true })
      .order('list_position', { ascending: true })

    if (recallError) throw recallError

    // Get firefighter IDs from recall list
    const firefighterIds = recallEntries.map(e => e.firefighter_id)

    // Fetch current sick status for all those firefighters
    const cutoffISO = new Date(Date.now() - 96 * 3600 * 1000).toISOString()

    const { data: sickEntries, error: sickError } = await supabase
      .from('sick_log')
      .select('firefighter_id, cleared_date, marked_sick_date')
      .in('firefighter_id', firefighterIds.length > 0 ? firefighterIds : ['00000000-0000-0000-0000-000000000000'])

    if (sickError) throw sickError

    // Build a sick status map per firefighter (latest entry wins)
    const sickMap = {}
    for (const s of sickEntries) {
      // Currently sick
      if (s.cleared_date === null) {
        sickMap[s.firefighter_id] = {
          currently_sick: true,
          cleared_date: null,
          marked_sick_date: s.marked_sick_date
        }
      }
      // Cleared but within 96hr window
      else if (new Date(s.cleared_date) >= new Date(cutoffISO)) {
        // Only set 96hr status if not already marked currently sick
        if (!sickMap[s.firefighter_id] || !sickMap[s.firefighter_id].currently_sick) {
          sickMap[s.firefighter_id] = {
            currently_sick: false,
            cleared_date: s.cleared_date,
            marked_sick_date: s.marked_sick_date
          }
        }
      }
    }

    // Annotate entries with sick_status
    const annotated = recallEntries.map(entry => ({
      ...entry,
      sick_status: sickMap[entry.firefighter_id] || null
    }))

    const ff = annotated.filter(e => e.rank_type === 'FF')
    const captains = annotated.filter(e => e.rank_type === 'Captain')

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ff, captains })
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
