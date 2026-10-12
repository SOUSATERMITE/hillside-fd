const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

const SICK_FIELDS      = new Set(['marked_sick_date', 'cleared_date', 'confirmed_at', 'confirmed_24hr', 'notes'])
const RECALL_FIELDS    = new Set(['shift_date', 'recall_start_time', 'recall_end_time', 'tour_worked', 'recall_type', 'hours_worked', 'notes'])
const APPARATUS_FIELDS = new Set(['description', 'priority', 'finding_type', 'status', 'scheduled_date', 'completed_date', 'completed_by', 'assigned_to', 'resolution_notes', 'photos_notes', 'maintenance_type', 'maintenance_category', 'cost', 'parts_replaced'])
const VACATION_FIELDS  = new Set(['request_date', 'cancelled_dates', 'new_dates', 'status', 'captain_action_date', 'dc_action_date', 'chief_action_date', 'denial_reason', 'staffing_impact', 'impact_explanation'])

const VALID_RECALL_TYPES     = new Set(['full_shift', 'short_min', 'refused', 'refused_no_penalty', 'vacation_skip', 'substitution', 'manual_ot'])
// Recall types that record-recall.js stamps recall_list.last_recall_date for
const LAST_RECALL_TYPES = ['full_shift', 'refused', 'short_min', 'substitution']
const VALID_FINDING_STATUSES = new Set(['open', 'in_progress', 'completed', 'cancelled'])
const VALID_VACATION_STATUSES = new Set(['pending', 'captain_approved', 'dc_approved', 'approved', 'denied'])

const TABLES = {
  sick:      { tableName: 'sick_log',          fields: SICK_FIELDS },
  recall:    { tableName: 'recall_log',        fields: RECALL_FIELDS },
  apparatus: { tableName: 'apparatus_findings', fields: APPARATUS_FIELDS },
  vacation:  { tableName: 'vacation_requests',  fields: VACATION_FIELDS }
}

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
  if (officer.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'DC or Chief access required to edit records' }) }

  try {
    const { table, id, updates } = JSON.parse(event.body || '{}')

    if (!table || !id || !updates || typeof updates !== 'object') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'table, id, and updates are required' }) }
    }
    if (!TABLES[table]) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'table must be sick, recall, apparatus, or vacation' }) }
    }

    const { tableName, fields: allowedSet } = TABLES[table]

    // Whitelist fields
    const safeUpdates = {}
    for (const [k, v] of Object.entries(updates)) {
      if (!allowedSet.has(k)) continue
      if (k === 'recall_type' && !VALID_RECALL_TYPES.has(v)) continue
      if (table === 'recall' && k === 'shift_date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) continue
      if (table === 'apparatus' && k === 'status' && !VALID_FINDING_STATUSES.has(v)) continue
      if (table === 'apparatus' && k === 'maintenance_category' && v && !['routine', 'emergency'].includes(v)) continue
      if (table === 'vacation' && k === 'status' && !VALID_VACATION_STATUSES.has(v)) continue
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

    // Recall entries: drop fields that didn't actually change (the edit forms submit every field),
    // then stamp who/when from the authenticated session. These columns are not in RECALL_FIELDS,
    // so nothing the browser sends can set them.
    let changed = safeUpdates
    if (table === 'recall') {
      changed = {}
      for (const [k, v] of Object.entries(safeUpdates)) {
        const same = k === 'hours_worked'
          ? (v == null ? current[k] == null : Number(v) === Number(current[k]))
          : String(v ?? '') === String(current[k] ?? '')
        if (!same) changed[k] = v
      }
      if (Object.keys(changed).length > 0) {
        changed.edited_by = officer.display_name
        changed.edited_at = new Date().toISOString()
        if (changed.shift_date && changed.shift_date !== current.shift_date) {
          changed.original_shift_date = current.original_shift_date || current.shift_date
        }
      }
    }

    if (Object.keys(changed).length > 0) {
      // Apply update
      const { error: updateError } = await supabase
        .from(tableName)
        .update(changed)
        .eq('id', id)

      if (updateError) throw updateError

      // Write audit entry
      const originalValues = {}
      for (const k of Object.keys(changed)) originalValues[k] = current[k] ?? null

      await supabase.from('edit_log').insert({
        table_name: tableName,
        record_id: id,
        edited_by: officer.display_name,
        officer_id: officer.officer_id,
        original_values: originalValues,
        new_values: changed
      })
    }

    // Keep recall_list.last_recall_date in step with the log. Recomputed from recall_log (not patched),
    // using only the recall types record-recall.js stamps it for. Never touches list_position or any
    // other rotation field. Idempotent, so it also runs when nothing changed (retry after a failure).
    let lastRecallDate
    if (table === 'recall') {
      const { data: latest, error: latestError } = await supabase
        .from('recall_log')
        .select('shift_date')
        .eq('firefighter_id', current.firefighter_id)
        .eq('deleted', false)
        .in('recall_type', LAST_RECALL_TYPES)
        .order('shift_date', { ascending: false })
        .limit(1)
      if (latestError) throw latestError
      lastRecallDate = latest?.[0]?.shift_date || null

      const { error: syncError } = await supabase
        .from('recall_list')
        .update({ last_recall_date: lastRecallDate })
        .eq('firefighter_id', current.firefighter_id)
      if (syncError) throw syncError
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, unchanged: Object.keys(changed).length === 0, last_recall_date: lastRecallDate }) }
  } catch (e) {
    console.error('[edit-record] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
