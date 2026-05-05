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
  if (officer.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body

  const DAILY_TYPES  = ['fluid','electrical','mechanical','visual','other']
  const WEEKLY_CATS  = ['SCBA','Hose & Nozzles','Hand Tools','Ladders','Medical','Rope & Rescue','Forcible Entry','Extrication','Thermal Imaging','Lighting','PPE','Other']
  const PRIORITIES   = ['high','medium','low']

  try {
    // ── LIST ────────────────────────────────────────────────────────────────────
    if (action === 'list_daily') {
      const { data, error } = await supabase.from('daily_check_items')
        .select('*').order('sort_order').order('created_at')
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data || []) }
    }

    if (action === 'list_weekly') {
      const { data, error } = await supabase.from('weekly_check_items')
        .select('*').order('category').order('sort_order').order('created_at')
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data || []) }
    }

    // ── ADD ─────────────────────────────────────────────────────────────────────
    if (action === 'add_daily') {
      const { name, applies_to, item_type } = body
      if (!name?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'name required' }) }
      const type = DAILY_TYPES.includes(item_type) ? item_type : 'other'
      const apps = Array.isArray(applies_to) && applies_to.length ? applies_to : ['all']

      // Get next sort_order
      const { data: last } = await supabase.from('daily_check_items').select('sort_order').order('sort_order', { ascending: false }).limit(1)
      const nextOrder = (last?.[0]?.sort_order ?? -1) + 1

      const { data, error } = await supabase.from('daily_check_items').insert({
        name: name.trim().slice(0, 200), applies_to: apps, item_type: type, sort_order: nextOrder
      }).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'add_weekly') {
      const { name, category, apparatus_ids, priority_if_failed } = body
      if (!name?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'name required' }) }
      const cat  = (typeof category === 'string' && category.trim()) ? category.trim().slice(0,100) : 'Other'
      const pri  = PRIORITIES.includes(priority_if_failed) ? priority_if_failed : 'medium'
      const apps = Array.isArray(apparatus_ids) ? apparatus_ids : []

      const { data: last } = await supabase.from('weekly_check_items')
        .select('sort_order').eq('category', cat).order('sort_order', { ascending: false }).limit(1)
      const nextOrder = (last?.[0]?.sort_order ?? -1) + 1

      const { data, error } = await supabase.from('weekly_check_items').insert({
        name: name.trim().slice(0, 200), category: cat, apparatus_ids: apps,
        priority_if_failed: pri, sort_order: nextOrder
      }).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── UPDATE ──────────────────────────────────────────────────────────────────
    if (action === 'update_daily') {
      const { id, name, applies_to, item_type, active, sort_order } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const update = {}
      if (name        !== undefined) update.name       = name.trim().slice(0, 200)
      if (applies_to  !== undefined) update.applies_to = Array.isArray(applies_to) ? applies_to : ['all']
      if (item_type   !== undefined) update.item_type  = DAILY_TYPES.includes(item_type) ? item_type : 'other'
      if (active      !== undefined) update.active     = !!active
      if (sort_order  !== undefined) update.sort_order = sort_order
      const { data, error } = await supabase.from('daily_check_items').update(update).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'update_weekly') {
      const { id, name, category, apparatus_ids, priority_if_failed, active, sort_order } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const update = {}
      if (name               !== undefined) update.name               = name.trim().slice(0, 200)
      if (category           !== undefined) update.category           = (typeof category === 'string' && category.trim()) ? category.trim().slice(0,100) : 'Other'
      if (apparatus_ids      !== undefined) update.apparatus_ids      = Array.isArray(apparatus_ids) ? apparatus_ids : []
      if (priority_if_failed !== undefined) update.priority_if_failed = PRIORITIES.includes(priority_if_failed) ? priority_if_failed : 'medium'
      if (active             !== undefined) update.active             = !!active
      if (sort_order         !== undefined) update.sort_order         = sort_order
      const { data, error } = await supabase.from('weekly_check_items').update(update).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── REORDER ─────────────────────────────────────────────────────────────────
    if (action === 'reorder_daily') {
      // ids: array of ids in new order
      const { ids } = body
      if (!Array.isArray(ids)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ids array required' }) }
      for (let i = 0; i < ids.length; i++) {
        await supabase.from('daily_check_items').update({ sort_order: i }).eq('id', ids[i])
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    if (action === 'reorder_weekly') {
      const { ids } = body
      if (!Array.isArray(ids)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'ids array required' }) }
      for (let i = 0; i < ids.length; i++) {
        await supabase.from('weekly_check_items').update({ sort_order: i }).eq('id', ids[i])
      }
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    // ── DELETE ──────────────────────────────────────────────────────────────────
    if (action === 'delete_daily') {
      const { id } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const { data, error } = await supabase.from('daily_check_items').update({ active: false }).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'delete_weekly') {
      const { id } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const { data, error } = await supabase.from('weekly_check_items').update({ active: false }).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (e) {
    console.error('[manage-checklist-items]', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'Internal server error' }) }
  }
}
