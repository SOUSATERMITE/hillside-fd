const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { checkAdmin } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password, x-session-token',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const admin = await checkAdmin(event)
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  try {
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('firefighters')
        .select('*')
        .order('group_number', { ascending: true })
        .order('rank', { ascending: true })
        .order('name', { ascending: true })
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (event.httpMethod === 'POST') {
      const { name, rank, group_number, email } = JSON.parse(event.body || '{}')
      if (!name || !rank) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'name and rank are required' }) }
      }

      const { data: newFF, error: insertError } = await supabase
        .from('firefighters')
        .insert({ name, rank, group_number: group_number || null, email: email || null })
        .select()
        .single()
      if (insertError) throw insertError

      if (rank === 'FF' || rank === 'Captain') {
        const rankType = rank === 'Captain' ? 'Captain' : 'FF'
        const { data: existing, error: maxError } = await supabase
          .from('recall_list')
          .select('list_position')
          .eq('group_number', group_number)
          .eq('rank_type', rankType)
          .order('list_position', { ascending: false })
          .limit(1)
        if (maxError) throw maxError
        const maxPos = existing && existing.length > 0 ? existing[0].list_position : 0
        const { error: recallInsertError } = await supabase
          .from('recall_list')
          .insert({ firefighter_id: newFF.id, group_number, rank_type: rankType, list_position: maxPos + 1, short_min_count: 0 })
        if (recallInsertError) throw recallInsertError
      }

      return { statusCode: 200, headers, body: JSON.stringify(newFF) }
    }

    if (event.httpMethod === 'PUT') {
      const { id, name, rank, group_number, active, email } = JSON.parse(event.body || '{}')
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }

      // Fetch current state before update so we can detect changes
      const { data: current, error: fetchErr } = await supabase
        .from('firefighters').select('name, rank, group_number').eq('id', id).single()
      if (fetchErr) throw fetchErr

      const updates = {}
      if (name         !== undefined) updates.name         = name
      if (rank         !== undefined) updates.rank         = rank
      if (group_number !== undefined) updates.group_number = group_number
      if (active       !== undefined) updates.active       = active
      if (email        !== undefined) updates.email        = email || null

      const { data: updated, error } = await supabase
        .from('firefighters').update(updates).eq('id', id).select().single()
      if (error) throw error

      // ── Sync recall_list if group or rank changed ──────────────────────────
      const RECALL_RANKS = ['FF', 'Captain']
      const oldRank  = current.rank
      const newRank  = updated.rank
      const oldGroup = current.group_number
      const newGroup = updated.group_number

      const wasOnRecall = RECALL_RANKS.includes(oldRank)
      const isOnRecall  = RECALL_RANKS.includes(newRank)
      const groupChanged = group_number !== undefined && newGroup !== oldGroup
      const rankChanged  = rank !== undefined && newRank !== oldRank

      const getBottomPos = async (grp, rankType, excludeId) => {
        const q = supabase.from('recall_list').select('list_position')
          .eq('group_number', grp).eq('rank_type', rankType)
          .order('list_position', { ascending: false }).limit(1)
        if (excludeId) q.neq('firefighter_id', excludeId)
        const { data } = await q
        return (data?.[0]?.list_position || 0) + 1
      }

      if (wasOnRecall && !isOnRecall) {
        // Promoted to DC/Chief — remove from recall list
        await supabase.from('recall_list').delete().eq('firefighter_id', id)
        console.log(`[recall-sync] ${updated.name} promoted to ${newRank} — removed from recall list by ${admin.display_name}`)
      } else if (!wasOnRecall && isOnRecall) {
        // Moved from non-recall rank (DC/Chief) to recall rank — insert new record
        const newRankType = newRank === 'Captain' ? 'Captain' : 'FF'
        const pos = await getBottomPos(newGroup, newRankType, null)
        await supabase.from('recall_list').insert({
          firefighter_id: id, group_number: newGroup, rank_type: newRankType,
          list_position: pos, short_min_count: 0
        })
        console.log(`[recall-sync] ${updated.name} added to recall list: Group ${newGroup} ${newRankType} pos ${pos} by ${admin.display_name}`)
      } else if (wasOnRecall && isOnRecall && (groupChanged || rankChanged)) {
        // Still on recall but group and/or rank changed — move to bottom of new slot
        const newRankType = newRank === 'Captain' ? 'Captain' : 'FF'
        const targetGroup = newGroup
        const pos = await getBottomPos(targetGroup, newRankType, id)
        await supabase.from('recall_list').update({
          group_number: targetGroup, rank_type: newRankType,
          list_position: pos, short_min_count: 0
        }).eq('firefighter_id', id)
        const changes = []
        if (groupChanged) changes.push(`Group ${oldGroup} → ${newGroup}`)
        if (rankChanged)  changes.push(`${oldRank} → ${newRank}`)
        console.log(`[recall-sync] ${updated.name}: ${changes.join(', ')} → pos ${pos} in Group ${targetGroup} ${newRankType} list by ${admin.display_name}`)
      }

      return { statusCode: 200, headers, body: JSON.stringify(updated) }
    }

    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}')
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }
      const { data: updated, error } = await supabase.from('firefighters').update({ active: false }).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(updated) }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (e) {
    console.error('[admin-firefighters] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
