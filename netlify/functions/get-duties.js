const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

const SHIFT_ANCHOR_MS = new Date('2026-04-30T11:30:00Z').getTime()
const ROTATION = [3, 4, 1, 2]

function getGroupForMs(ms) {
  const shifts = Math.floor((ms - SHIFT_ANCHOR_MS) / 86400000)
  return ROTATION[((shifts % 4) + 4) % 4]
}

function groupForDateStr(dateStr) {
  return getGroupForMs(new Date(dateStr + 'T11:30:00Z').getTime())
}

function etDateStr(ms) {
  const d = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function isDutyApplicable(duty, dateStr, dayOfWeek, group) {
  if (duty.tour_specific !== null && duty.tour_specific !== undefined && duty.tour_specific !== group) return false
  switch (duty.recurrence) {
    case 'one_time':    return duty.specific_date === dateStr
    case 'daily':       return true
    case 'weekly':
    case 'specific_day': return duty.recurrence_day === dayOfWeek
    case 'monthly':     return true
    default:            return false
  }
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

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const now = Date.now()

    const todayStr     = etDateStr(now)
    const yesterdayStr = etDateStr(now - 86400000)

    const etNow  = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const etYest = new Date(new Date(now - 86400000).toLocaleString('en-US', { timeZone: 'America/New_York' }))
    const todayDow     = etNow.getDay()
    const yesterdayDow = etYest.getDay()

    const currentGroup   = groupForDateStr(todayStr)
    const yesterdayGroup = groupForDateStr(yesterdayStr)

    const [dutiesRes, completionsRes, eventsRes] = await Promise.all([
      supabase.from('daily_duties').select('*').eq('active', true).order('created_at', { ascending: true }),
      supabase.from('duty_completions').select('*').in('completed_date', [todayStr, yesterdayStr]),
      supabase.from('scheduled_events')
        .select('id, title, description, event_date, event_time, group_number, category')
        .eq('event_date', todayStr)
        .order('event_time', { ascending: true, nullsFirst: true })
    ])

    const allDuties = dutiesRes.data || []
    const completions = completionsRes.data || []
    const todayCompMap     = {}
    const yesterdayCompMap = {}
    for (const c of completions) {
      if (c.completed_date === todayStr)     todayCompMap[c.duty_id] = c
      else                                   yesterdayCompMap[c.duty_id] = c
    }

    const duties_today = allDuties
      .filter(d => isDutyApplicable(d, todayStr, todayDow, currentGroup))
      .map(d => ({ ...d, completion: todayCompMap[d.id] || null }))

    const duties_yesterday_incomplete = allDuties
      .filter(d => isDutyApplicable(d, yesterdayStr, yesterdayDow, yesterdayGroup) && !yesterdayCompMap[d.id])
      .map(d => ({ ...d, completion: null, incomplete_date: yesterdayStr, incomplete_group: yesterdayGroup }))

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        date: { today: todayStr, yesterday: yesterdayStr, dayOfWeek: todayDow, currentGroup, yesterdayGroup },
        events: eventsRes.data || [],
        duties_today,
        duties_yesterday_incomplete
      })
    }
  } catch (e) {
    console.error('[get-duties] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
