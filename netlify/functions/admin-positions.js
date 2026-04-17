const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

function checkAuth(event) {
  const provided = (event.headers && event.headers['x-admin-password']) || ''
  const expected = process.env.ADMIN_PASSWORD || ''
  return provided === expected && expected !== ''
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (!checkAuth(event)) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  try {
    if (event.httpMethod === 'GET') {
      const group = parseInt((event.queryStringParameters || {}).group, 10)
      if (!group || group < 1 || group > 4) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'group param must be 1–4' }) }
      }

      const { data, error } = await supabase
        .from('recall_list')
        .select('*, firefighters(id, name, rank, group_number)')
        .eq('group_number', group)
        .order('rank_type', { ascending: true })
        .order('list_position', { ascending: true })

      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (event.httpMethod === 'POST') {
      const { positions } = JSON.parse(event.body || '{}')
      if (!Array.isArray(positions) || positions.length === 0) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'positions array is required' }) }
      }

      // Update each position
      for (const p of positions) {
        if (!p.id || p.list_position === undefined) continue
        const { error } = await supabase
          .from('recall_list')
          .update({ list_position: p.list_position })
          .eq('id', p.id)
        if (error) throw error
      }

      // Return updated list — infer group from first entry
      const firstId = positions[0].id
      const { data: firstEntry, error: lookupError } = await supabase
        .from('recall_list')
        .select('group_number')
        .eq('id', firstId)
        .single()

      if (lookupError) throw lookupError

      const { data: updated, error: fetchError } = await supabase
        .from('recall_list')
        .select('*, firefighters(id, name, rank, group_number)')
        .eq('group_number', firstEntry.group_number)
        .order('rank_type', { ascending: true })
        .order('list_position', { ascending: true })

      if (fetchError) throw fetchError
      return { statusCode: 200, headers, body: JSON.stringify(updated) }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
