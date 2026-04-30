const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

// Group 3 started April 30 2026 at 0730 ET (1130 UTC)
const SHIFT_ANCHOR_MS = new Date('2026-04-30T11:30:00Z').getTime()
const ROTATION = [3, 4, 1, 2]

function getGroupForMs(ms) {
  const shifts = Math.floor((ms - SHIFT_ANCHOR_MS) / 86400000)
  return ROTATION[((shifts % 4) + 4) % 4]
}

function getShiftStartMs(ms) {
  const shifts = Math.floor((ms - SHIFT_ANCHOR_MS) / 86400000)
  return SHIFT_ANCHOR_MS + shifts * 86400000
}

function groupForDateStr(dateStr) {
  // Use 0730 ET = 1130 UTC for that date
  return getGroupForMs(new Date(dateStr + 'T11:30:00Z').getTime())
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

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const now = Date.now()

  // Today in ET
  const etStr = new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })
  const etDate = new Date(etStr)
  const todayStr = `${etDate.getFullYear()}-${String(etDate.getMonth()+1).padStart(2,'0')}-${String(etDate.getDate()).padStart(2,'0')}`
  const in14days = new Date(now + 14 * 86400000).toISOString().split('T')[0]

  try {
    const [sickRes, recallRes, vacRes, bulletinRes, eventRes, workOrderRes, contactRes] = await Promise.all([
      supabase
        .from('sick_log')
        .select('id, marked_sick_date, firefighters(id, name, rank, group_number)')
        .is('cleared_date', null)
        .order('marked_sick_date', { ascending: true }),

      supabase
        .from('recall_log')
        .select('id, shift_date, firefighters!recall_log_firefighter_id_fkey(id, name, rank)')
        .eq('shift_date', todayStr),

      supabase
        .from('vacation_requests')
        .select('id, status')
        .in('status', ['pending', 'captain_approved', 'dc_approved']),

      supabase
        .from('bulletin_posts')
        .select('id, title, content, category, pinned, posted_by, created_at')
        .eq('active', true)
        .order('pinned', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(25),

      supabase
        .from('scheduled_events')
        .select('id, title, description, event_date, event_time, group_number, category, created_by')
        .gte('event_date', todayStr)
        .lte('event_date', in14days)
        .order('event_date', { ascending: true })
        .order('event_time', { ascending: true, nullsFirst: true }),

      supabase
        .from('work_orders')
        .select('id, title, description, location, priority, status, submitted_by, assigned_to, created_at, updated_at')
        .not('status', 'in', '("completed","cancelled")')
        .order('created_at', { ascending: false }),

      supabase
        .from('contacts')
        .select('id, name, title, phone, email, category, notes')
        .eq('active', true)
        .order('category')
        .order('name')
    ])

    const currentGroup  = getGroupForMs(now)
    const shiftStartMs  = getShiftStartMs(now)
    const shiftStart    = new Date(shiftStartMs).toISOString()

    // Tag each event with its on-duty group
    const events = (eventRes.data || []).map(e => ({
      ...e,
      on_duty_group: groupForDateStr(e.event_date)
    }))

    // Build next 14 days schedule
    const schedule = []
    for (let i = 0; i < 14; i++) {
      const d = new Date(now + i * 86400000)
      const ds = d.toISOString().split('T')[0]
      schedule.push({ date: ds, group: groupForDateStr(ds) })
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        shift: { currentGroup, shiftStart, todayStr },
        sick:                sickRes.data   || [],
        recalledToday:       recallRes.data || [],
        pendingVacation:     vacRes.data    || [],
        bulletins:           bulletinRes.data || [],
        events,
        workOrders:          workOrderRes.data || [],
        contacts:            contactRes.data   || [],
        schedule
      })
    }
  } catch (e) {
    console.error('[get-dashboard]', e.message)
    console.error('[get-dashboard] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
