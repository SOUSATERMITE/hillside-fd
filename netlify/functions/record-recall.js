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

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

  try {
    const { recall_list_id, recall_type, shift_date, sub_recall_list_id, recall_start_time, recall_end_time, hours_worked, tour_worked } = JSON.parse(event.body || '{}')

    if (!recall_list_id || !recall_type) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'recall_list_id and recall_type are required' }) }
    }

    const validTypes = ['full_shift', 'short_min', 'refused', 'vacation_skip', 'refused_no_penalty']
    if (!validTypes.includes(recall_type)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid recall_type' }) }
    }

    const supabase = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )

    // 1. Fetch the specific recall_list entry
    const { data: targetEntry, error: targetError } = await supabase
      .from('recall_list')
      .select('*')
      .eq('id', recall_list_id)
      .single()

    if (targetError) throw targetError
    if (!targetEntry) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Recall list entry not found' }) }

    const { group_number, rank_type, firefighter_id } = targetEntry

    // 2. Fetch ALL entries for same group + rank, ordered by list_position
    const { data: allEntries, error: allError } = await supabase
      .from('recall_list')
      .select('*')
      .eq('group_number', group_number)
      .eq('rank_type', rank_type)
      .order('list_position', { ascending: true })

    if (allError) throw allError

    const today = shift_date || new Date().toISOString().split('T')[0]

    // Auto-calculate hours from start/end times if not provided
    function calcHours(start, end) {
      if (!start || !end || start.length < 4 || end.length < 4) return null
      const sh = parseInt(start.slice(0, 2), 10), sm = parseInt(start.slice(2, 4), 10)
      const eh = parseInt(end.slice(0, 2), 10), em = parseInt(end.slice(2, 4), 10)
      if (isNaN(sh) || isNaN(sm) || isNaN(eh) || isNaN(em)) return null
      let mins = (eh * 60 + em) - (sh * 60 + sm)
      if (mins < 0) mins += 24 * 60
      return Math.round(mins / 60 * 10) / 10
    }
    const computed_hours = hours_worked != null ? hours_worked : calcHours(recall_start_time, recall_end_time)

    // 3. Apply rotation logic
    if (recall_type === 'vacation_skip' || recall_type === 'refused_no_penalty') {
      // No changes to recall_list — just log the event

    } else if (recall_type === 'full_shift') {
      await moveToBottom(supabase, allEntries, recall_list_id, today, 0)

    } else if (recall_type === 'refused') {
      // Move refuser to bottom
      await moveToBottom(supabase, allEntries, recall_list_id, today, 0)

      // If someone else took the shift, mark them without moving their position
      if (sub_recall_list_id && sub_recall_list_id !== recall_list_id) {
        // Fetch sub entry and refuser name in parallel
        const [subResult, refuserResult] = await Promise.all([
          supabase.from('recall_list').select('*, firefighters(id, name)').eq('id', sub_recall_list_id).single(),
          supabase.from('firefighters').select('name').eq('id', firefighter_id).single()
        ])
        if (subResult.error) throw subResult.error
        const subEntry = subResult.data
        const refuserName = refuserResult.data?.name || 'Unknown'

        // Build sub_note with time/tour info
        const dateLabel = new Date(today + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        const noteParts = [`${refuserName} recall on ${dateLabel}`]
        if (recall_start_time && recall_end_time) noteParts.push(`${recall_start_time}-${recall_end_time}`)
        if (tour_worked) noteParts.push(`Tour ${tour_worked}`)
        noteParts.push('— does not move')
        const subNoteText = 'Took ' + noteParts.join(' ')

        // Set sub_note on sub's entry (position unchanged) and log sub entry in parallel
        await Promise.all([
          supabase.from('recall_list')
            .update({ sub_note: subNoteText, last_recall_date: today })
            .eq('id', sub_recall_list_id),
          supabase.from('recall_log').insert({
            firefighter_id: subEntry.firefighter_id,
            shift_date: today,
            recall_type: 'substitution',
            hours_worked: computed_hours,
            recorded_by: officer.display_name,
            officer_id: officer.officer_id,
            recall_start_time: recall_start_time || null,
            recall_end_time: recall_end_time || null,
            tour_worked: tour_worked || null,
            refused_ff_id: firefighter_id
          })
        ])
      }

    } else if (recall_type === 'short_min') {
      const newCount = targetEntry.short_min_count + 1
      if (newCount < 2) {
        const { error: updateError } = await supabase
          .from('recall_list')
          .update({ short_min_count: newCount, last_recall_date: today })
          .eq('id', recall_list_id)
        if (updateError) throw updateError
      } else {
        await moveToBottom(supabase, allEntries, recall_list_id, today, 0)
      }
    }

    // 4. Log the primary person + re-fetch list/sick/log all in parallel
    const groupFFIds = allEntries.map(e => e.firefighter_id)
    const safeIds = groupFFIds.length > 0 ? groupFFIds : ['00000000-0000-0000-0000-000000000000']

    const [logInsert, listResult, sickResult, logResult] = await Promise.all([
      supabase.from('recall_log').insert({
        firefighter_id,
        shift_date: today,
        recall_type,
        hours_worked: recall_type === 'refused' ? null : computed_hours,
        recorded_by: officer.display_name,
        officer_id: officer.officer_id,
        refused_ff_id: null,
        recall_start_time: recall_start_time || null,
        recall_end_time: recall_end_time || null,
        tour_worked: tour_worked || null
      }),
      supabase.from('recall_list')
        .select('*, firefighters(id, name, rank, group_number)')
        .eq('group_number', group_number)
        .order('rank_type', { ascending: true })
        .order('list_position', { ascending: true }),
      supabase.from('sick_log')
        .select('firefighter_id, marked_sick_date')
        .is('cleared_date', null)
        .in('firefighter_id', safeIds),
      supabase.from('recall_log')
        .select('id, shift_date, recall_type, hours_worked, recall_start_time, recall_end_time, tour_worked, recorded_by, created_at, firefighters!recall_log_firefighter_id_fkey(id, name, rank)')
        .eq('deleted', false)
        .in('firefighter_id', safeIds)
        .order('created_at', { ascending: false })
        .limit(50)
    ])

    if (logInsert.error) throw logInsert.error
    if (listResult.error) throw listResult.error
    if (sickResult.error) throw sickResult.error
    if (logResult.error) throw logResult.error

    const sickMap = {}
    for (const s of sickResult.data) {
      sickMap[s.firefighter_id] = { currently_sick: true, marked_sick_date: s.marked_sick_date }
    }

    const annotated = listResult.data.map(entry => ({
      ...entry,
      sick_status: sickMap[entry.firefighter_id] || null
    }))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ff: annotated.filter(e => e.rank_type === 'FF'),
        captains: annotated.filter(e => e.rank_type === 'Captain'),
        log: logResult.data || []
      })
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}

async function moveToBottom(supabase, entries, targetId, today, newShortMinCount) {
  const others = entries.filter(e => e.id !== targetId)
  const target = entries.find(e => e.id === targetId)
  const newOrder = [...others, target]

  // Update all positions in parallel
  const posUpdates = newOrder
    .map((entry, i) => {
      const newPos = i + 1
      if (entry.list_position !== newPos) {
        return supabase.from('recall_list').update({ list_position: newPos }).eq('id', entry.id)
      }
    })
    .filter(Boolean)

  if (posUpdates.length > 0) {
    const results = await Promise.all(posUpdates)
    for (const r of results) {
      if (r.error) throw r.error
    }
  }

  // Update the moved person's extra fields
  const { error } = await supabase
    .from('recall_list')
    .update({ list_position: newOrder.length, short_min_count: newShortMinCount, last_recall_date: today, sub_note: null })
    .eq('id', targetId)

  if (error) throw error
}
