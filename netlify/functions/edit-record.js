const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

const SICK_FIELDS   = new Set(['marked_sick_date', 'cleared_date', 'confirmed_at', 'confirmed_24hr', 'notes'])
const RECALL_FIELDS = new Set(['recall_start_time', 'recall_end_time', 'tour_worked', 'recall_type', 'hours_worked', 'notes'])
const VALID_RECALL_TYPES = new Set(['full_shift', 'short_min', 'refused', 'refused_no_penalty', 'vacation_skip', 'substitution'])

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
    const { table, id, updates } = JSON.parse(event.body || '{}')

    if (!table || !id || !updates || typeof updates !== 'object') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'table, id, and updates are required' }) }
    }
    if (!['sick', 'recall'].includes(table)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'table must be sick or recall' }) }
    }

    const tableName  = table === 'sick' ? 'sick_log' : 'recall_log'
    const allowedSet = table === 'sick' ? SICK_FIELDS : RECALL_FIELDS

    // Whitelist fields
    const safeUpdates = {}
    for (const [k, v] of Object.entries(updates)) {
      if (!allowedSet.has(k)) continue
      if (k === 'recall_type' && !VALID_RECALL_TYPES.has(v)) continue
      safeUpdates[k] = v === '' ? null : v
    }

    if (Object.keys(safeUpdates).length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No valid fields to update' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Fetch current values for audit
    const { data: current, error: fetchError } = await supabase
      .from(tableName)
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError || !current) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Record not found' }) }

    // Apply update
    const { error: updateError } = await supabase
      .from(tableName)
      .update(safeUpdates)
      .eq('id', id)

    if (updateError) throw updateError

    // Write audit entry
    const originalValues = {}
    for (const k of Object.keys(safeUpdates)) originalValues[k] = current[k] ?? null

    await supabase.from('edit_log').insert({
      table_name: tableName,
      record_id: id,
      edited_by: officer.display_name,
      officer_id: officer.officer_id,
      original_values: originalValues,
      new_values: safeUpdates
    })

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
  } catch (e) {
    console.error('[edit-record] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
