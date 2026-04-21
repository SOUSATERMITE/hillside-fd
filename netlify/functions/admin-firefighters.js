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
      const { name, rank, group_number } = JSON.parse(event.body || '{}')
      if (!name || !rank || !group_number) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'name, rank, and group_number are required' }) }
      }

      const { data: newFF, error: insertError } = await supabase
        .from('firefighters')
        .insert({ name, rank, group_number })
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
      const { id, name, rank, group_number, active } = JSON.parse(event.body || '{}')
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }
      const updates = {}
      if (name !== undefined) updates.name = name
      if (rank !== undefined) updates.rank = rank
      if (group_number !== undefined) updates.group_number = group_number
      if (active !== undefined) updates.active = active
      const { data: updated, error } = await supabase.from('firefighters').update(updates).eq('id', id).select().single()
      if (error) throw error
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
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
