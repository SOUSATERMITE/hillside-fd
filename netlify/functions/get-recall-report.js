const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

const SHIFT_ANCHOR = new Date('2026-04-30T11:30:00Z')

function currentShiftDate() {
  const shifts = Math.floor((Date.now() - SHIFT_ANCHOR.getTime()) / 86400000)
  const d = new Date(SHIFT_ANCHOR.getTime() + shifts * 86400000)
  return d.toISOString().split('T')[0]
}

function fmtTime(t) {
  if (!t || t.length < 4) return t || ''
  const h = parseInt(t.slice(0, 2), 10)
  const m = t.slice(2, 4)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${m} ${ampm}`
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const params = event.queryStringParameters || {}
  const group = parseInt(params.group, 10)
  if (!group || group < 1 || group > 4) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'group param must be 1–4' }) }
  }
  const days = Math.min(parseInt(params.days, 10) || 7, 90)

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  try {
    // All firefighters for this group
    const { data: allFFs, error: ffErr } = await supabase
      .from('firefighters')
      .select('id, name, rank, group_number, email, badge_number, phone')
      .eq('group_number', group)
      .eq('active', true)

    if (ffErr) throw ffErr
    const ffIds = allFFs.map(f => f.id)
    const safeIds = ffIds.length > 0 ? ffIds : ['00000000-0000-0000-0000-000000000000']
    const ffById = {}
    for (const f of allFFs) ffById[f.id] = f

    const todayShift = currentShiftDate()
    const historyStart = new Date(Date.now() - days * 86400000).toISOString().split('T')[0]

    const [recallListResult, sickResult, todayLogResult, historyLogResult] = await Promise.all([
      supabase.from('recall_list')
        .select('*, firefighters(id, name, rank, badge_number, phone)')
        .eq('group_number', group)
        .order('rank_type', { ascending: true })
        .order('list_position', { ascending: true }),

      supabase.from('sick_log')
        .select('firefighter_id, marked_sick_date, notes')
        .in('firefighter_id', safeIds)
        .eq('deleted', false)
        .is('cleared_date', null),

      supabase.from('recall_log')
        .select('firefighter_id, recall_type, recall_start_time, refused_ff_id')
        .in('firefighter_id', safeIds)
        .eq('shift_date', todayShift)
        .eq('deleted', false),

      supabase.from('recall_log')
        .select('firefighter_id, shift_date, recall_type, recall_start_time, recall_end_time, tour_worked, recorded_by, refused_ff_id, created_at')
        .in('firefighter_id', safeIds)
        .gte('shift_date', historyStart)
        .eq('deleted', false)
        .order('shift_date', { ascending: false })
        .order('created_at', { ascending: false })
    ])

    if (recallListResult.error) throw recallListResult.error
    if (sickResult.error) throw sickResult.error
    if (todayLogResult.error) throw todayLogResult.error
    if (historyLogResult.error) throw historyLogResult.error

    // Build lookup maps
    const sickMap = {}
    for (const s of sickResult.data) {
      sickMap[s.firefighter_id] = { marked_sick_date: s.marked_sick_date, notes: s.notes }
    }

    const todayRecalledMap = {}
    for (const r of todayLogResult.data) {
      todayRecalledMap[r.firefighter_id] = { recall_type: r.recall_type, start_time: r.recall_start_time }
    }

    // Fetch names for refused_ff_ids in history
    const refusedIds = [...new Set(historyLogResult.data.filter(r => r.refused_ff_id).map(r => r.refused_ff_id))]
    let refusedNames = {}
    if (refusedIds.length > 0) {
      const { data: refData } = await supabase
        .from('firefighters')
        .select('id, name')
        .in('id', refusedIds)
      if (refData) for (const f of refData) refusedNames[f.id] = f.name
    }

    // Section 1 — Recall Order
    const recallEntries = recallListResult.data.map(entry => {
      const ff = entry.firefighters || {}
      const sick = sickMap[entry.firefighter_id] || null
      const recalled = todayRecalledMap[entry.firefighter_id] || null
      return {
        list_position: entry.list_position,
        firefighter_id: entry.firefighter_id,
        name: ff.name || entry.firefighter_id,
        rank: ff.rank || entry.rank_type,
        rank_type: entry.rank_type,
        badge_number: ff.badge_number || null,
        phone: ff.phone || null,
        short_min_count: entry.short_min_count,
        last_recall_date: entry.last_recall_date,
        currently_sick: !!sick,
        sick_since: sick?.marked_sick_date || null,
        recalled_today: !!recalled,
        recalled_today_type: recalled?.recall_type || null,
        recalled_today_time: recalled?.start_time ? fmtTime(recalled.start_time) : null
      }
    })

    const section1 = {
      ff: recallEntries.filter(e => e.rank_type === 'FF'),
      captains: recallEntries.filter(e => e.rank_type === 'Captain')
    }

    // Section 2 — Recall History
    const section2 = historyLogResult.data.map(r => {
      const ff = ffById[r.firefighter_id] || {}
      return {
        shift_date: r.shift_date,
        firefighter_id: r.firefighter_id,
        name: ff.name || 'Unknown',
        rank: ff.rank || '',
        recall_type: r.recall_type,
        covered_name: r.refused_ff_id ? (refusedNames[r.refused_ff_id] || 'Unknown') : null,
        recall_start_time: r.recall_start_time ? fmtTime(r.recall_start_time) : null,
        recall_end_time: r.recall_end_time ? fmtTime(r.recall_end_time) : null,
        tour_worked: r.tour_worked,
        recorded_by: r.recorded_by,
        created_at: r.created_at
      }
    })

    // Section 3 — Current Sick List
    const section3 = sickResult.data.map(s => {
      const ff = ffById[s.firefighter_id] || {}
      const daysOut = Math.floor((Date.now() - new Date(s.marked_sick_date).getTime()) / 86400000)
      return {
        firefighter_id: s.firefighter_id,
        name: ff.name || 'Unknown',
        rank: ff.rank || '',
        group_number: ff.group_number || group,
        marked_sick_date: s.marked_sick_date,
        days_out: daysOut,
        notes: s.notes || null
      }
    }).sort((a, b) => new Date(a.marked_sick_date) - new Date(b.marked_sick_date))

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        group,
        generated_at: new Date().toISOString(),
        shift_date: todayShift,
        history_days: days,
        section1,
        section2,
        section3
      })
    }
  } catch (e) {
    console.error('[get-recall-report] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
