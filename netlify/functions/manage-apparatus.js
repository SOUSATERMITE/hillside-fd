const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession, checkAdmin } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-admin-password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ── UPDATE STATUS (any officer) ───────────────────────────────────────────
    if (action === 'update_status') {
      const { id, status, location, notes, finding } = body
      if (!id || !status) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id and status required' }) }

      const VALID_STATUSES = ['in_service', 'out_of_service', 'maintenance', 'reserve']
      if (!VALID_STATUSES.includes(status)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid status' }) }
      }

      // Fetch current unit
      const { data: current, error: fetchErr } = await supabase
        .from('apparatus')
        .select('status, location')
        .eq('id', id)
        .eq('active', true)
        .maybeSingle()

      if (fetchErr || !current) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Unit not found' }) }

      const now = new Date().toISOString()

      // Update apparatus
      const updateFields = {
        status,
        last_updated: now,
        updated_by: officer.display_name
      }
      if (location !== undefined) updateFields.location = location || current.location
      if (notes !== undefined)    updateFields.notes = notes || null

      await supabase.from('apparatus').update(updateFields).eq('id', id)

      // Log the change
      await supabase.from('apparatus_log').insert({
        apparatus_id:    id,
        previous_status: current.status,
        new_status:      status,
        location:        location || current.location || null,
        notes:           notes || null,
        finding:         finding || null,
        changed_by:      officer.display_name,
        officer_id:      officer.officer_id,
        created_at:      now
      })

      // Return the updated unit
      const { data: updated } = await supabase
        .from('apparatus')
        .select('id, unit_name, unit_type, status, location, notes, last_updated, updated_by')
        .eq('id', id)
        .single()

      return { statusCode: 200, headers, body: JSON.stringify(updated) }
    }

    // ── ADMIN ACTIONS ─────────────────────────────────────────────────────────
    const admin = await checkAdmin(event)
    if (!admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin required' }) }

    if (action === 'add') {
      const { unit_name, unit_type, status, location, notes,
              primary_officer_id, primary_officer_name, secondary_officer_id, secondary_officer_name } = body
      if (!unit_name || !unit_type) return { statusCode: 400, headers, body: JSON.stringify({ error: 'unit_name and unit_type required' }) }

      const { data, error } = await supabase.from('apparatus').insert({
        unit_name: unit_name.trim().toUpperCase(),
        unit_type: unit_type.trim(),
        status:    status || 'in_service',
        location:  location || 'Station 1',
        notes:     notes || null,
        primary_officer_id:     primary_officer_id   || null,
        primary_officer_name:   primary_officer_name?.trim() || null,
        secondary_officer_id:   secondary_officer_id   || null,
        secondary_officer_name: secondary_officer_name?.trim() || null,
        last_updated: new Date().toISOString(),
        updated_by:   officer.display_name,
        active:    true
      }).select().single()

      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'edit') {
      const { id, unit_name, unit_type, status, location, notes,
              primary_officer_id, primary_officer_name, secondary_officer_id, secondary_officer_name } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const update = {}
      if (unit_name              !== undefined) update.unit_name              = unit_name.trim().toUpperCase()
      if (unit_type              !== undefined) update.unit_type              = unit_type.trim()
      if (status                 !== undefined) update.status                 = status
      if (location               !== undefined) update.location               = location || null
      if (notes                  !== undefined) update.notes                  = notes || null
      if (primary_officer_id     !== undefined) update.primary_officer_id     = primary_officer_id || null
      if (primary_officer_name   !== undefined) update.primary_officer_name   = primary_officer_name?.trim() || null
      if (secondary_officer_id   !== undefined) update.secondary_officer_id   = secondary_officer_id || null
      if (secondary_officer_name !== undefined) update.secondary_officer_name = secondary_officer_name?.trim() || null
      const { data, error } = await supabase.from('apparatus').update(update).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'deactivate') {
      const { id } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      await supabase.from('apparatus').update({ active: false }).eq('id', id)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (e) {
    console.error('[manage-apparatus] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
