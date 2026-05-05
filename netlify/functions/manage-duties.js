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
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body
  const isAdmin = officer.role === 'admin'

  const VALID_DUTY_TYPES = ['administrative','training','maintenance','inspection','other']
  const VALID_REC_TYPES  = ['one_time','daily','weekly','biweekly','monthly_date','monthly_dow','yearly']

  // Build recurrence_config from body — accepts new recurrence_config object
  // or falls back to legacy recurrence/recurrence_day/specific_date fields
  function buildConfig(b) {
    if (b.recurrence_config && b.recurrence_config.type) return b.recurrence_config
    switch (b.recurrence) {
      case 'one_time':     return { type: 'one_time',    date: b.specific_date || null }
      case 'daily':        return { type: 'daily' }
      case 'weekly':       return { type: 'weekly',      day: b.recurrence_day ?? 0 }
      case 'specific_day': return { type: 'weekly',      day: b.recurrence_day ?? 0 }
      case 'monthly':      return { type: 'monthly_date', date: 1 }
      default:             return { type: 'one_time',    date: b.specific_date || null }
    }
  }

  try {
    // ── CREATE DUTY ────────────────────────────────────────────────────────────
    if (action === 'create') {
      const { title, description, duty_type, tour_specific, requires_report } = body
      if (!title?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'title required' }) }
      if (!VALID_DUTY_TYPES.includes(duty_type)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid duty_type' }) }

      const cfg = buildConfig(body)
      if (!VALID_REC_TYPES.includes(cfg.type)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid recurrence type' }) }

      const { data, error } = await supabase.from('daily_duties').insert({
        title:             title.trim().slice(0, 200),
        description:       description?.trim().slice(0, 1000) || null,
        duty_type,
        recurrence:        cfg.type,
        recurrence_day:    cfg.day ?? null,
        specific_date:     cfg.type === 'one_time' ? (cfg.date || null) : null,
        recurrence_config: cfg,
        tour_specific:     tour_specific || null,
        requires_report:   requires_report === true,
        created_by:        officer.display_name,
        officer_id:        officer.officer_id
      }).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── UPDATE DUTY ────────────────────────────────────────────────────────────
    if (action === 'update') {
      const { id, title, description, duty_type, tour_specific, requires_report, active } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }

      const { data: existing } = await supabase.from('daily_duties').select('officer_id').eq('id', id).single()
      if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
      if (!isAdmin && existing.officer_id !== officer.officer_id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only edit your own duties' }) }
      }

      const update = {}
      if (title       !== undefined) update.title       = title.trim().slice(0, 200)
      if (description !== undefined) update.description = description?.trim().slice(0, 1000) || null
      if (duty_type   !== undefined) update.duty_type   = duty_type
      if (body.recurrence !== undefined || body.recurrence_config !== undefined) {
        const cfg = buildConfig(body)
        update.recurrence        = cfg.type
        update.recurrence_day    = cfg.day ?? null
        update.specific_date     = cfg.type === 'one_time' ? (cfg.date || null) : null
        update.recurrence_config = cfg
      }
      if (tour_specific    !== undefined) update.tour_specific    = tour_specific || null
      if (requires_report  !== undefined) update.requires_report  = requires_report === true
      if (active           !== undefined) update.active           = active

      const { data, error } = await supabase.from('daily_duties').update(update).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── DELETE DUTY (soft) ─────────────────────────────────────────────────────
    if (action === 'delete') {
      const { id } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }

      const { data: existing } = await supabase.from('daily_duties').select('officer_id').eq('id', id).single()
      if (!existing) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) }
      if (!isAdmin && existing.officer_id !== officer.officer_id) {
        return { statusCode: 403, headers, body: JSON.stringify({ error: 'Can only delete your own duties' }) }
      }

      const { error } = await supabase.from('daily_duties').update({ active: false }).eq('id', id)
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    // ── MARK COMPLETE ──────────────────────────────────────────────────────────
    if (action === 'mark_complete') {
      const { duty_id, completed_date, notes } = body
      if (!duty_id || !completed_date) return { statusCode: 400, headers, body: JSON.stringify({ error: 'duty_id and completed_date required' }) }

      const { data: existing } = await supabase
        .from('duty_completions')
        .select('id')
        .eq('duty_id', duty_id)
        .eq('completed_date', completed_date)
        .maybeSingle()

      let data, dbError
      if (existing) {
        ;({ data, error: dbError } = await supabase
          .from('duty_completions')
          .update({ completed_by: officer.display_name, officer_id: officer.officer_id, notes: notes?.trim() || null })
          .eq('id', existing.id)
          .select().single())
      } else {
        ;({ data, error: dbError } = await supabase
          .from('duty_completions')
          .insert({ duty_id, completed_date, completed_by: officer.display_name, officer_id: officer.officer_id, notes: notes?.trim() || null })
          .select().single())
      }
      if (dbError) throw dbError

      // Log to duty_log
      const { data: existingLog } = await supabase
        .from('duty_log')
        .select('id')
        .eq('duty_id', duty_id)
        .eq('shift_date', completed_date)
        .maybeSingle()

      const logPayload = {
        duty_id,
        shift_date:    completed_date,
        group_on_duty: null,
        status:        'completed',
        completed_by:  officer.display_name,
        officer_id:    officer.officer_id,
        notes:         notes?.trim() || null
      }
      if (existingLog) {
        await supabase.from('duty_log').update(logPayload).eq('id', existingLog.id).catch(() => {})
      } else {
        await supabase.from('duty_log').insert(logPayload).catch(() => {})
      }

      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── LIST ALL (for admin panel) ─────────────────────────────────────────────
    if (action === 'list_all') {
      if (!isAdmin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin only' }) }
      const { data, error } = await supabase.from('daily_duties').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data || []) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (e) {
    console.error('[manage-duties] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'Internal server error' }) }
  }
}
