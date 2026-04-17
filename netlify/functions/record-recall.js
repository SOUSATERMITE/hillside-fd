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
    const { recall_list_id, recall_type, hours_worked, recorded_by, shift_date, refused_recall_list_id } = JSON.parse(event.body || '{}')

    if (!recall_list_id || !recall_type || !recorded_by) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'recall_list_id, recall_type, and recorded_by are required' }) }
    }

    const validTypes = ['full_shift', 'short_min', 'refused', 'vacation_skip', 'substitution']
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

    // 3. Apply rotation logic
    let refused_ff_id = null

    if (recall_type === 'vacation_skip') {
      // No changes to recall_list — just log the event
    } else if (recall_type === 'full_shift' || recall_type === 'refused') {
      // Move to bottom, reset short_min_count, clear any sub_note
      await moveToBottom(supabase, allEntries, recall_list_id, today, 0)
    } else if (recall_type === 'short_min') {
      const newCount = targetEntry.short_min_count + 1
      if (newCount < 2) {
        // Stay in place, increment count
        const { error: updateError } = await supabase
          .from('recall_list')
          .update({ short_min_count: newCount, last_recall_date: today })
          .eq('id', recall_list_id)
        if (updateError) throw updateError
      } else {
        // 2nd short min — move to bottom, reset count, clear sub_note
        await moveToBottom(supabase, allEntries, recall_list_id, today, 0)
      }
    } else if (recall_type === 'substitution') {
      if (!refused_recall_list_id) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'refused_recall_list_id is required for substitution' }) }
      }

      // Fetch refuser's recall_list entry
      const { data: refuserEntry, error: refuserError } = await supabase
        .from('recall_list')
        .select('*, firefighters(id, name)')
        .eq('id', refused_recall_list_id)
        .single()
      if (refuserError) throw refuserError

      // Fetch all entries for refuser's group+rank to move them to bottom
      const { data: refuserGroupEntries, error: rgError } = await supabase
        .from('recall_list')
        .select('*')
        .eq('group_number', refuserEntry.group_number)
        .eq('rank_type', refuserEntry.rank_type)
        .order('list_position', { ascending: true })
      if (rgError) throw rgError

      // Move refuser to bottom
      await moveToBottom(supabase, refuserGroupEntries, refused_recall_list_id, today, 0)

      // Set sub_note on substitute's entry, keep their position
      const refuserName = refuserEntry.firefighters?.name || 'Unknown'
      const { error: subNoteError } = await supabase
        .from('recall_list')
        .update({ sub_note: `Sub for ${refuserName}`, last_recall_date: today })
        .eq('id', recall_list_id)
      if (subNoteError) throw subNoteError

      refused_ff_id = refuserEntry.firefighter_id
    }

    // 4. Insert recall_log row
    const { error: logError } = await supabase
      .from('recall_log')
      .insert({
        firefighter_id,
        shift_date: today,
        recall_type,
        hours_worked: hours_worked || null,
        recorded_by,
        refused_ff_id: refused_ff_id || null
      })

    if (logError) throw logError

    // 5. Re-fetch updated recall list and return same format as get-recall-list
    const { data: updatedList, error: updatedError } = await supabase
      .from('recall_list')
      .select('*, firefighters(id, name, rank, group_number)')
      .eq('group_number', group_number)
      .order('rank_type', { ascending: true })
      .order('list_position', { ascending: true })

    if (updatedError) throw updatedError

    // Get sick statuses — only currently sick (no 96hr hold)
    const firefighterIds = updatedList.map(e => e.firefighter_id)

    const { data: sickEntries, error: sickError } = await supabase
      .from('sick_log')
      .select('firefighter_id, marked_sick_date')
      .is('cleared_date', null)
      .in('firefighter_id', firefighterIds.length > 0 ? firefighterIds : ['00000000-0000-0000-0000-000000000000'])

    if (sickError) throw sickError

    const sickMap = {}
    for (const s of sickEntries) {
      sickMap[s.firefighter_id] = { currently_sick: true, marked_sick_date: s.marked_sick_date }
    }

    const annotated = updatedList.map(entry => ({ ...entry, sick_status: sickMap[entry.firefighter_id] || null }))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ff: annotated.filter(e => e.rank_type === 'FF'),
        captains: annotated.filter(e => e.rank_type === 'Captain')
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

  for (let i = 0; i < newOrder.length; i++) {
    const newPos = i + 1
    if (newOrder[i].list_position !== newPos) {
      const { error } = await supabase
        .from('recall_list')
        .update({ list_position: newPos })
        .eq('id', newOrder[i].id)
      if (error) throw error
    }
  }

  // Update the moved person's fields explicitly, clearing any sub_note
  const { error } = await supabase
    .from('recall_list')
    .update({ list_position: newOrder.length, short_min_count: newShortMinCount, last_recall_date: today, sub_note: null })
    .eq('id', targetId)

  if (error) throw error
}
