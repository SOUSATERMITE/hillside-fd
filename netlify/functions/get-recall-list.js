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

    // Fetch sick status and recall log in parallel
    const firefighterIds = recallEntries.map(e => e.firefighter_id)
    const safeIds = firefighterIds.length > 0 ? firefighterIds : ['00000000-0000-0000-0000-000000000000']

    const [sickResult, pendingResult, logResult] = await Promise.all([
      // Currently sick (not yet cleared)
      supabase.from('sick_log')
        .select('firefighter_id, marked_sick_date')
        .is('cleared_date', null)
        .in('firefighter_id', safeIds),
      // Cleared but not yet confirmed 24hr shift — ineligible until officer confirms
      supabase.from('sick_log')
        .select('id, firefighter_id, cleared_date')
        .not('cleared_date', 'is', null)
        .eq('confirmed_24hr', false)
        .in('firefighter_id', safeIds),
      supabase.from('recall_log')
        .select('id, shift_date, recall_type, hours_worked, recall_start_time, recall_end_time, recorded_by, created_at, firefighters!recall_log_firefighter_id_fkey(id, name, rank)')
        .in('firefighter_id', safeIds)
        .order('created_at', { ascending: false })
        .limit(50)
    ])

    if (sickResult.error) throw sickResult.error
    if (pendingResult.error) throw pendingResult.error
    if (logResult.error) throw logResult.error

    const sickMap = {}
    for (const s of sickResult.data) {
      sickMap[s.firefighter_id] = { currently_sick: true, marked_sick_date: s.marked_sick_date }
    }
    // Cleared but pending 24hr confirmation — only if not already currently sick
    for (const s of pendingResult.data) {
      if (!sickMap[s.firefighter_id]) {
        sickMap[s.firefighter_id] = { currently_sick: false, awaiting_confirm: true, sick_log_id: s.id }
      }
    }

    const annotated = recallEntries.map(entry => ({
      ...entry,
      sick_status: sickMap[entry.firefighter_id] || null
    }))

    const ff = annotated.filter(e => e.rank_type === 'FF')
    const captains = annotated.filter(e => e.rank_type === 'Captain')
    const logEntries = logResult.data

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ff, captains, log: logEntries || [] })
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
