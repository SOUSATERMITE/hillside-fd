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

function buildApparatusWithCounts(apparatus, findings) {
  const byUnit = {}
  for (const f of findings) {
    if (!byUnit[f.apparatus_id]) byUnit[f.apparatus_id] = { total: 0, critical_high: 0, findings: [] }
    byUnit[f.apparatus_id].total++
    if (['critical','high'].includes(f.priority)) byUnit[f.apparatus_id].critical_high++
    byUnit[f.apparatus_id].findings.push(f)
  }
  return apparatus.map(a => ({
    ...a,
    open_findings: byUnit[a.id]?.total || 0,
    critical_high: byUnit[a.id]?.critical_high || 0,
    findings: byUnit[a.id]?.findings || []
  }))
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
    const [sickRes, recallRes, vacRes, bulletinRes, eventRes, workOrderRes, contactRes, apparatusRes, findingsRes, attachRes, resolvedRes] = await Promise.all([
      supabase
        .from('sick_log')
        .select('id, marked_sick_date, firefighters(id, name, rank, group_number)')
        .is('cleared_date', null)
        .order('marked_sick_date', { ascending: true }),

      supabase
        .from('recall_log')
        .select('id, shift_date, firefighters!recall_log_firefighter_id_fkey(id, name, rank)')
        .eq('shift_date', todayStr)
        .in('recall_type', ['full_shift', 'short_min', 'substitution'])
        .eq('deleted', false),

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
        .order('name'),

      supabase
        .from('apparatus')
        .select('id, unit_name, unit_type, status, location, last_updated, updated_by')
        .eq('active', true)
        .order('unit_name', { ascending: true }),

      supabase
        .from('apparatus_findings')
        .select('id, apparatus_id, finding_type, item_name, item_category, issue_type, description, priority, reported_by, officer_id, status, created_at, photo_urls')
        .in('status', ['open', 'in_progress'])
        .in('finding_type', ['damage', 'repair_needed', 'inspection', 'manual_report']),

      supabase
        .from('board_attachments')
        .select('id, source_type, source_id, file_name, file_size, uploaded_by, created_at')
        .order('created_at', { ascending: true }),

      supabase
        .from('apparatus_findings')
        .select('id, apparatus_id, item_name, item_category, issue_type, description, priority, reported_by, officer_id, status, created_at, resolution_notes, completed_by, completed_date, photo_urls')
        .eq('finding_type', 'manual_report')
        .in('status', ['completed', 'cancelled'])
        .gte('completed_date', new Date(now - 7 * 86400000).toISOString().split('T')[0])
        .order('completed_date', { ascending: false })
    ])

    const currentGroup  = getGroupForMs(now)
    const shiftStartMs  = getShiftStartMs(now)
    const shiftStart    = new Date(shiftStartMs).toISOString()

    // Build attachment maps keyed by source_id
    const bulletinAtts = {}
    const eventAtts    = {}
    for (const a of (attachRes.data || [])) {
      if (a.source_type === 'bulletin') {
        if (!bulletinAtts[a.source_id]) bulletinAtts[a.source_id] = []
        bulletinAtts[a.source_id].push(a)
      } else {
        if (!eventAtts[a.source_id]) eventAtts[a.source_id] = []
        eventAtts[a.source_id].push(a)
      }
    }

    // Tag each event with its on-duty group and attachments
    const events = (eventRes.data || []).map(e => ({
      ...e,
      on_duty_group: groupForDateStr(e.event_date),
      attachments:   eventAtts[e.id] || []
    }))

    // Build next 14 days schedule
    const schedule = []
    for (let i = 0; i < 14; i++) {
      const d = new Date(now + i * 86400000)
      const ds = d.toISOString().split('T')[0]
      schedule.push({ date: ds, group: groupForDateStr(ds) })
    }

    const allFindings = findingsRes.data || []
    const apparatusFindings = allFindings.filter(f => f.apparatus_id != null && f.finding_type !== 'manual_report')
    const manualIssues      = allFindings.filter(f => f.finding_type === 'manual_report')

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        shift: { currentGroup, shiftStart, todayStr },
        sick:                sickRes.data   || [],
        recalledToday:       recallRes.data || [],
        pendingVacation:     vacRes.data    || [],
        bulletins:           (bulletinRes.data || []).map(b => ({ ...b, attachments: bulletinAtts[b.id] || [] })),
        events,
        workOrders:          workOrderRes.data || [],
        contacts:            contactRes.data   || [],
        apparatus:           buildApparatusWithCounts(apparatusRes.data || [], apparatusFindings),
        manual_issues:       manualIssues,
        recently_resolved:   resolvedRes.data  || [],
        schedule
      })
    }
  } catch (e) {
    console.error('[get-dashboard]', e.message)
    console.error('[get-dashboard] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
