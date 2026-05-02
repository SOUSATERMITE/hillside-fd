const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

// ── Federal holiday calculation ───────────────────────────────────────────────
function getFederalHolidays(year) {
  const s = new Set()
  const add = (m, d) => s.add(`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`)
  function nthWeekday(y, m, dow, n) {
    let d = new Date(y, m-1, 1), cnt = 0
    while (d.getDay() !== dow) d.setDate(d.getDate()+1)
    while (cnt < n-1) { d.setDate(d.getDate()+7); cnt++ }
    return d.getDate()
  }
  function lastWeekday(y, m, dow) {
    let d = new Date(y, m, 0)
    while (d.getDay() !== dow) d.setDate(d.getDate()-1)
    return d.getDate()
  }
  add(year, 1, 1)
  add(year, 1, nthWeekday(year, 1, 1, 3))
  add(year, 2, nthWeekday(year, 2, 1, 3))
  add(year, 5, lastWeekday(year, 5, 1))
  add(year, 6, 19)
  add(year, 7, 4)
  add(year, 9,  nthWeekday(year, 9,  1, 1))
  add(year, 10, nthWeekday(year, 10, 1, 2))
  add(year, 11, 11)
  add(year, 11, nthWeekday(year, 11, 4, 4))
  add(year, 12, 25)
  return s
}

function dateStrET(iso) {
  const d = new Date(iso)
  const s = d.toLocaleDateString('en-US', {timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit'})
  const [m, day, y] = s.split('/')
  return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

function flagSickDate(dateStr) {
  const year = parseInt(dateStr.slice(0, 4))
  const hols = getFederalHolidays(year)
  const d    = new Date(dateStr + 'T12:00:00')
  const dow  = d.getDay()
  const prev = new Date(d); prev.setDate(prev.getDate()-1)
  const next = new Date(d); next.setDate(next.getDate()+1)
  const fmt  = (dt) => dt.toISOString().split('T')[0]
  const weekendAdj = [0, 1, 5, 6].includes(dow)                      // Sun/Mon/Fri/Sat
  const holAdj     = hols.has(dateStr) || hols.has(fmt(prev)) || hols.has(fmt(next))
  return { weekendAdj, holAdj }
}

// ── Handler ───────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }
  if (officer.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'DC or admin access required' }) }

  const firefighter_id = event.queryStringParameters?.id
  if (!firefighter_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const yearStart = `${new Date().getFullYear()}-01-01`

  const [ffRes, sickRes, recallRes, docsRes, notesRes] = await Promise.all([
    supabase.from('firefighters').select('id, name, rank, badge_number, group_number, email').eq('id', firefighter_id).single(),

    supabase.from('sick_log')
      .select('id, marked_sick_date, marked_sick_by, cleared_date, cleared_by, notes')
      .eq('firefighter_id', firefighter_id)
      .eq('deleted', false)
      .order('marked_sick_date', { ascending: false }),

    supabase.from('recall_log')
      .select('id, shift_date, recall_type, hours_worked, recall_start_time, recall_end_time, tour_worked, recorded_by')
      .eq('firefighter_id', firefighter_id)
      .eq('deleted', false)
      .order('shift_date', { ascending: false }),

    supabase.from('personnel_documents')
      .select('id, document_name, document_type, file_path, file_name, uploaded_by, notes, created_at')
      .eq('firefighter_id', firefighter_id)
      .order('created_at', { ascending: false })
      .limit(200),

    supabase.from('personnel_notes')
      .select('id, note, added_by, created_at')
      .eq('firefighter_id', firefighter_id)
      .order('created_at', { ascending: false })
  ])

  if (ffRes.error) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Firefighter not found' }) }

  const today = new Date()
  const thisYear = today.getFullYear()

  // Annotate sick history with date strings and flags
  const sickHistory = (sickRes.data || []).map(s => {
    const outStr  = dateStrET(s.marked_sick_date)
    const backStr = s.cleared_date ? dateStrET(s.cleared_date) : null
    const outD    = new Date(outStr + 'T12:00:00')
    const backD   = backStr ? new Date(backStr + 'T12:00:00') : today
    const days    = Math.max(1, Math.ceil((backD - outD) / 86400000))
    const { weekendAdj, holAdj } = flagSickDate(outStr)
    return { ...s, out_date: outStr, back_date: backStr, days_out: days, weekendAdj, holAdj }
  })

  // YTD stats
  const sickYTD   = sickHistory.filter(s => s.out_date >= yearStart)
  const ytdSickDays = sickYTD.reduce((n, s) => n + s.days_out, 0)
  const recallYTD = (recallRes.data || []).filter(r => r.shift_date >= yearStart && ['full_shift','short_min','substitution'].includes(r.recall_type))
  const ytdOTHours = recallYTD.reduce((n, r) => n + (r.hours_worked || 0), 0)
  const lastSick   = sickHistory[0]?.out_date || null
  const lastRecall = (recallRes.data || []).filter(r => r.recall_type !== 'refused')[0]?.shift_date || null

  // Handle tables that might not exist yet (before migration is run)
  const docs  = docsRes.error  ? [] : (docsRes.data  || [])
  const notes = notesRes.error ? [] : (notesRes.data || [])

  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      firefighter:  ffRes.data,
      sickHistory,
      recallHistory: recallRes.data || [],
      documents: docs,
      notes,
      stats: {
        ytd_sick_calls:  sickYTD.length,
        ytd_sick_days:   ytdSickDays,
        ytd_recalls:     recallYTD.length,
        ytd_ot_hours:    ytdOTHours,
        last_sick_date:  lastSick,
        last_recall_date: lastRecall
      }
    })
  }
}
