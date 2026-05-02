const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')

// ── Email transport (Zoho SMTP) ────────────────────────────────────────────────
function makeTransport() {
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.SMTP_USER || 'sousa@sousapest.com',
      pass: process.env.SMTP_PASS
    }
  })
}

// ── Federal holiday calculation ────────────────────────────────────────────────
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

function flagSickDate(dateStr) {
  const year = parseInt(dateStr.slice(0, 4))
  const hols = getFederalHolidays(year)
  const d    = new Date(dateStr + 'T12:00:00')
  const dow  = d.getDay()
  const prev = new Date(d); prev.setDate(prev.getDate()-1)
  const next = new Date(d); next.setDate(next.getDate()+1)
  const fmt  = (dt) => dt.toISOString().split('T')[0]
  const weekendAdj = [0, 1, 5, 6].includes(dow)
  const holAdj     = hols.has(dateStr) || hols.has(fmt(prev)) || hols.has(fmt(next))
  return { weekendAdj, holAdj }
}

function dateStrET(iso) {
  const d = new Date(iso)
  const s = d.toLocaleDateString('en-US', {timeZone:'America/New_York', year:'numeric', month:'2-digit', day:'2-digit'})
  const [m, day, y] = s.split('/')
  return `${y}-${String(m).padStart(2,'0')}-${String(day).padStart(2,'0')}`
}

function fmtDate(str) {
  if (!str) return '—'
  const [y, m, d] = str.split('-')
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  return `${months[parseInt(m)-1]} ${parseInt(d)}, ${y}`
}

function fmtDateRange(start, end) {
  return `${fmtDate(start)} – ${fmtDate(end)}`
}

// ── HTML email styles ──────────────────────────────────────────────────────────
const STYLES = `
  body { font-family: Arial, sans-serif; background: #f4f4f4; margin:0; padding:0; }
  .wrap { max-width: 700px; margin: 0 auto; background: #fff; }
  .header { background: #1a2e52; color: #fff; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
  .header p  { margin: 6px 0 0; font-size: 13px; opacity: 0.8; }
  .section { padding: 20px 28px; border-bottom: 1px solid #e5e7eb; }
  .section h2 { margin: 0 0 12px; font-size: 15px; color: #1a2e52; text-transform: uppercase; letter-spacing: 0.5px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #f1f5f9; color: #374151; font-weight: 700; padding: 8px 10px; text-align: left; border-bottom: 2px solid #d1d5db; }
  td { padding: 7px 10px; border-bottom: 1px solid #e5e7eb; color: #374151; }
  tr:last-child td { border-bottom: none; }
  .badge { display: inline-block; padding: 2px 7px; border-radius: 10px; font-size: 11px; font-weight: 700; }
  .badge-orange { background: #fff3cd; color: #b45309; }
  .badge-red    { background: #fee2e2; color: #991b1b; }
  .badge-blue   { background: #dbeafe; color: #1e40af; }
  .badge-green  { background: #dcfce7; color: #166534; }
  .stat-grid { display: flex; gap: 16px; flex-wrap: wrap; }
  .stat-box  { background: #f1f5f9; border-radius: 8px; padding: 12px 16px; min-width: 120px; }
  .stat-num  { font-size: 24px; font-weight: 800; color: #1a2e52; }
  .stat-lbl  { font-size: 11px; color: #6b7280; margin-top: 2px; }
  .none { color: #9ca3af; font-style: italic; font-size: 13px; }
  .footer { background: #f9fafb; padding: 14px 28px; font-size: 11px; color: #9ca3af; text-align: center; }
  .private-banner { background: #7f1d1d; color: #fff; padding: 10px 20px; font-weight: 700; font-size: 13px; text-align: center; letter-spacing: 1px; }
  .pattern-alert { background: #fef2f2; border-left: 4px solid #dc2626; padding: 10px 14px; margin-bottom: 10px; font-size: 13px; }
  .pattern-ok    { background: #f0fdf4; border-left: 4px solid #16a34a; padding: 10px 14px; margin-bottom: 10px; font-size: 13px; }
`

// ── Fetch all data ─────────────────────────────────────────────────────────────
async function fetchWeeklyData(supabase, weekStart, weekEnd) {
  const [sickRes, recallRes, apparatusRes, bulletinRes, vacationRes, eventRes] = await Promise.all([
    supabase.from('sick_log')
      .select('id, firefighter_id, marked_sick_date, cleared_date, notes, firefighters!sick_log_firefighter_id_fkey(name, rank, group_number)')
      .gte('marked_sick_date', weekStart + 'T00:00:00.000Z')
      .lte('marked_sick_date', weekEnd   + 'T23:59:59.999Z')
      .eq('deleted', false)
      .order('marked_sick_date', { ascending: false }),

    supabase.from('recall_log')
      .select('id, firefighter_id, shift_date, recall_type, hours_worked, tour_worked, recorded_by, firefighters!recall_log_firefighter_id_fkey(name, rank)')
      .gte('shift_date', weekStart)
      .lte('shift_date', weekEnd)
      .eq('deleted', false)
      .order('shift_date', { ascending: false }),

    supabase.from('apparatus')
      .select('id, unit_number, unit_type, status, last_updated, notes')
      .neq('status', 'in_service')
      .order('unit_number'),

    supabase.from('bulletins')
      .select('id, title, content, category, posted_by, created_at')
      .gte('created_at', weekStart + 'T00:00:00.000Z')
      .lte('created_at', weekEnd   + 'T23:59:59.999Z')
      .eq('deleted', false)
      .order('created_at', { ascending: false }),

    supabase.from('vacation_requests')
      .select('id, firefighter_id, start_date, end_date, status, firefighters!vacation_requests_firefighter_id_fkey(name, rank)')
      .gte('start_date', weekStart)
      .lte('start_date', weekEnd)
      .order('start_date'),

    supabase.from('events')
      .select('id, title, description, start_date, end_date, event_type, created_by')
      .gte('start_date', weekStart)
      .lte('start_date', weekEnd)
      .eq('deleted', false)
      .order('start_date')
  ])

  return {
    sick:      sickRes.data    || [],
    recall:    recallRes.data  || [],
    apparatus: apparatusRes.data || [],
    bulletins: bulletinRes.data || [],
    vacation:  vacationRes.data || [],
    events:    eventRes.data   || []
  }
}

// ── Build main report HTML ─────────────────────────────────────────────────────
function buildReportHtml(data, weekStart, weekEnd) {
  const { sick, recall, apparatus, bulletins, vacation, events } = data

  const totalSickCalls = sick.length
  const worked = recall.filter(r => ['full_shift','short_min','substitution'].includes(r.recall_type))
  const refused = recall.filter(r => r.recall_type === 'refused')
  const totalOTHours = worked.reduce((n, r) => n + (r.hours_worked || 0), 0)

  // ── Sick section ──
  let sickRows = ''
  if (sick.length === 0) {
    sickRows = '<tr><td colspan="4" class="none">No sick calls this week</td></tr>'
  } else {
    for (const s of sick) {
      const outDate = dateStrET(s.marked_sick_date)
      const backDate = s.cleared_date ? dateStrET(s.cleared_date) : null
      const { weekendAdj, holAdj } = flagSickDate(outDate)
      const flags = [
        weekendAdj ? '<span class="badge badge-orange">Weekend Adj</span>' : '',
        holAdj     ? '<span class="badge badge-orange">Holiday Adj</span>' : ''
      ].filter(Boolean).join(' ')
      const ff = s.firefighters
      sickRows += `<tr>
        <td>${ff?.name || '—'}</td>
        <td>${ff?.rank || '—'} · Group ${ff?.group_number || '?'}</td>
        <td>${fmtDate(outDate)}${backDate ? ' → ' + fmtDate(backDate) : ' (still out)'}</td>
        <td>${flags || '<span class="badge badge-blue">Normal</span>'}</td>
      </tr>`
    }
  }

  // ── Recall section ──
  let recallRows = ''
  if (recall.length === 0) {
    recallRows = '<tr><td colspan="4" class="none">No recall activity this week</td></tr>'
  } else {
    for (const r of recall) {
      const typeLabel = { full_shift:'Full Shift', short_min:'Short Min', substitution:'Substitution', refused:'Refused' }[r.recall_type] || r.recall_type
      const typeBadge = r.recall_type === 'refused'
        ? `<span class="badge badge-red">Refused</span>`
        : `<span class="badge badge-green">${typeLabel}</span>`
      const ff = r.firefighters
      recallRows += `<tr>
        <td>${ff?.name || '—'}</td>
        <td>${ff?.rank || '—'}</td>
        <td>${fmtDate(r.shift_date)}</td>
        <td>${typeBadge}${r.hours_worked ? ' · ' + r.hours_worked + 'h' : ''}</td>
      </tr>`
    }
  }

  // ── Apparatus section ──
  let apparatusRows = ''
  if (apparatus.length === 0) {
    apparatusRows = '<tr><td colspan="3" class="none">All units in service</td></tr>'
  } else {
    for (const a of apparatus) {
      const statusBadge = a.status === 'out_of_service'
        ? '<span class="badge badge-red">Out of Service</span>'
        : `<span class="badge badge-orange">${a.status?.replace(/_/g,' ') || a.status}</span>`
      apparatusRows += `<tr>
        <td>${a.unit_number} – ${a.unit_type}</td>
        <td>${statusBadge}</td>
        <td>${a.notes || '—'}</td>
      </tr>`
    }
  }

  // ── Bulletins section ──
  let bulletinRows = ''
  if (bulletins.length === 0) {
    bulletinRows = '<p class="none">No bulletins posted this week</p>'
  } else {
    for (const b of bulletins) {
      const dateStr = dateStrET(b.created_at)
      bulletinRows += `<div style="margin-bottom:10px;padding:10px 12px;background:#f8fafc;border-radius:6px;border-left:3px solid #1a5c2a;">
        <div style="font-weight:700;font-size:13px;color:#1a5c2a;">${b.title}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">${fmtDate(dateStr)} · ${b.posted_by} · ${b.category || 'general'}</div>
      </div>`
    }
  }

  // ── Events section ──
  let eventRows = ''
  if (events.length === 0) {
    eventRows = '<p class="none">No events this week</p>'
  } else {
    for (const e of events) {
      eventRows += `<div style="margin-bottom:10px;padding:10px 12px;background:#f8fafc;border-radius:6px;border-left:3px solid #1e3a5f;">
        <div style="font-weight:700;font-size:13px;color:#1e3a5f;">${e.title}</div>
        <div style="font-size:11px;color:#6b7280;margin-top:2px;">${fmtDate(e.start_date)}${e.end_date && e.end_date !== e.start_date ? ' – ' + fmtDate(e.end_date) : ''} · ${e.event_type || ''}</div>
        ${e.description ? `<div style="font-size:12px;color:#374151;margin-top:4px;">${e.description.slice(0,200)}</div>` : ''}
      </div>`
    }
  }

  // ── Vacation section ──
  let vacRows = ''
  if (vacation.length === 0) {
    vacRows = '<tr><td colspan="3" class="none">No vacation requests starting this week</td></tr>'
  } else {
    for (const v of vacation) {
      const statusBadge = v.status === 'approved'
        ? '<span class="badge badge-green">Approved</span>'
        : v.status === 'denied'
          ? '<span class="badge badge-red">Denied</span>'
          : '<span class="badge badge-blue">Pending</span>'
      const ff = v.firefighters
      vacRows += `<tr>
        <td>${ff?.name || '—'}</td>
        <td>${fmtDate(v.start_date)}${v.end_date ? ' – ' + fmtDate(v.end_date) : ''}</td>
        <td>${statusBadge}</td>
      </tr>`
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLES}</style></head><body>
<div class="wrap">
  <div class="header">
    <h1>Hillside Fire Department</h1>
    <p>Weekly Operations Report · ${fmtDateRange(weekStart, weekEnd)}</p>
  </div>

  <div class="section">
    <div class="stat-grid">
      <div class="stat-box"><div class="stat-num">${totalSickCalls}</div><div class="stat-lbl">Sick Calls</div></div>
      <div class="stat-box"><div class="stat-num">${worked.length}</div><div class="stat-lbl">Recalls Worked</div></div>
      <div class="stat-box"><div class="stat-num">${totalOTHours}</div><div class="stat-lbl">OT Hours</div></div>
      <div class="stat-box"><div class="stat-num">${refused.length}</div><div class="stat-lbl">Recalls Refused</div></div>
      <div class="stat-box"><div class="stat-num">${apparatus.length}</div><div class="stat-lbl">Units Not In Service</div></div>
    </div>
  </div>

  <div class="section">
    <h2>Sick Calls (${totalSickCalls})</h2>
    <table><thead><tr><th>Member</th><th>Rank / Group</th><th>Out / Back</th><th>Flags</th></tr></thead>
    <tbody>${sickRows}</tbody></table>
  </div>

  <div class="section">
    <h2>Recall Activity (${recall.length})</h2>
    <table><thead><tr><th>Member</th><th>Rank</th><th>Date</th><th>Type / Hours</th></tr></thead>
    <tbody>${recallRows}</tbody></table>
  </div>

  <div class="section">
    <h2>Apparatus Status</h2>
    <table><thead><tr><th>Unit</th><th>Status</th><th>Notes</th></tr></thead>
    <tbody>${apparatusRows}</tbody></table>
  </div>

  <div class="section">
    <h2>Bulletins Posted (${bulletins.length})</h2>
    ${bulletinRows}
  </div>

  <div class="section">
    <h2>Events This Week (${events.length})</h2>
    ${eventRows}
  </div>

  <div class="section">
    <h2>Vacation Requests (${vacation.length})</h2>
    <table><thead><tr><th>Member</th><th>Dates</th><th>Status</th></tr></thead>
    <tbody>${vacRows}</tbody></table>
  </div>

  <div class="footer">
    Hillside Fire Department · Generated ${new Date().toLocaleDateString('en-US',{timeZone:'America/New_York'})} · This report is confidential
  </div>
</div></body></html>`
}

// ── Build pattern analysis (private) ──────────────────────────────────────────
async function buildPatternHtml(supabase, weekStart, weekEnd) {
  // Get all sick history for this year to compute pattern scores
  const yearStart = `${new Date().getFullYear()}-01-01`
  const { data: ytdSick } = await supabase
    .from('sick_log')
    .select('firefighter_id, marked_sick_date, cleared_date, firefighters!sick_log_firefighter_id_fkey(name, rank, group_number)')
    .gte('marked_sick_date', yearStart + 'T00:00:00.000Z')
    .eq('deleted', false)
    .order('marked_sick_date', { ascending: false })

  const { data: weekRefused } = await supabase
    .from('recall_log')
    .select('firefighter_id, shift_date, firefighters!recall_log_firefighter_id_fkey(name, rank)')
    .gte('shift_date', weekStart)
    .lte('shift_date', weekEnd)
    .eq('recall_type', 'refused')
    .eq('deleted', false)

  // Group sick by firefighter and compute pattern scores
  const ffMap = {}
  for (const s of (ytdSick || [])) {
    const ffId = s.firefighter_id
    if (!ffMap[ffId]) {
      ffMap[ffId] = {
        name: s.firefighters?.name || '—',
        rank: s.firefighters?.rank || '—',
        group: s.firefighters?.group_number || '?',
        calls: [],
        score: 0
      }
    }
    const outDate = dateStrET(s.marked_sick_date)
    const { weekendAdj, holAdj } = flagSickDate(outDate)
    ffMap[ffId].calls.push({ date: outDate, weekendAdj, holAdj })
    if (weekendAdj) ffMap[ffId].score += 1
    if (holAdj)     ffMap[ffId].score += 1
  }

  // Only include members with 1+ sick call this year
  const sorted = Object.values(ffMap)
    .filter(f => f.calls.length > 0)
    .sort((a, b) => b.score - a.score || b.calls.length - a.calls.length)

  let rows = ''
  for (const f of sorted) {
    const hasPattern = f.score >= 3
    const adjCount   = f.calls.filter(c => c.weekendAdj || c.holAdj).length
    const recentDates = f.calls.slice(0,5).map(c => {
      const flags = [c.weekendAdj ? 'W' : '', c.holAdj ? 'H' : ''].filter(Boolean).join('')
      return `${c.date}${flags ? ' ['+flags+']' : ''}`
    }).join('<br>')

    rows += `<tr style="${hasPattern ? 'background:#fff5f5;' : ''}">
      <td><strong>${f.name}</strong></td>
      <td>${f.rank} · Grp ${f.group}</td>
      <td>${f.calls.length}</td>
      <td>${adjCount} of ${f.calls.length}</td>
      <td><strong style="color:${f.score >= 3 ? '#dc2626' : '#374151'}">${f.score}</strong></td>
      <td>${hasPattern ? '<span class="badge badge-red">Pattern Detected</span>' : '<span class="badge badge-green">Normal</span>'}</td>
      <td style="font-size:11px;">${recentDates}</td>
    </tr>`
  }

  const patternsFound = sorted.filter(f => f.score >= 3)

  let refusedRows = ''
  if (!weekRefused || weekRefused.length === 0) {
    refusedRows = '<tr><td colspan="3" class="none">None this week</td></tr>'
  } else {
    for (const r of weekRefused) {
      refusedRows += `<tr><td>${r.firefighters?.name || '—'}</td><td>${r.firefighters?.rank || '—'}</td><td>${fmtDate(r.shift_date)}</td></tr>`
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${STYLES}</style></head><body>
<div class="wrap">
  <div class="private-banner">⚠ PRIVATE — FOR DC SOUSA ONLY — DO NOT FORWARD</div>
  <div class="header">
    <h1>Hillside Fire Department — Pattern Analysis</h1>
    <p>Week of ${fmtDateRange(weekStart, weekEnd)}</p>
  </div>

  <div class="section">
    ${patternsFound.length > 0
      ? `<div class="pattern-alert">⚠ <strong>${patternsFound.length} member${patternsFound.length > 1 ? 's' : ''} flagged with Pattern Detected</strong> (score ≥ 3 based on weekend/holiday-adjacent sick calls YTD).<br>Members: ${patternsFound.map(f=>f.name).join(', ')}</div>`
      : `<div class="pattern-ok">✓ No patterns detected this week. All members within normal parameters.</div>`
    }
    <p style="font-size:12px;color:#6b7280;margin-top:0;">Score = number of sick calls that were weekend or holiday adjacent YTD. Score ≥ 3 = Pattern Detected. [W] = weekend adjacent, [H] = holiday adjacent.</p>
  </div>

  <div class="section">
    <h2>YTD Sick Pattern Analysis</h2>
    <table><thead><tr>
      <th>Member</th><th>Rank / Group</th><th>YTD Calls</th><th>Adj Calls</th><th>Score</th><th>Status</th><th>Recent Dates</th>
    </tr></thead>
    <tbody>${rows || '<tr><td colspan="7" class="none">No sick calls YTD</td></tr>'}</tbody></table>
  </div>

  <div class="section">
    <h2>Refused Recalls This Week</h2>
    <table><thead><tr><th>Member</th><th>Rank</th><th>Date</th></tr></thead>
    <tbody>${refusedRows}</tbody></table>
  </div>

  <div class="footer">
    PRIVATE · Hillside Fire Department · ${new Date().toLocaleDateString('en-US',{timeZone:'America/New_York'})} · Do not distribute
  </div>
</div></body></html>`
}

// ── Handler ────────────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json' }

  // Allow GET trigger (manual or cron)
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  // Compute week range (Mon–Sun of the just-completed week)
  const nowET = new Date(new Date().toLocaleString('en-US', {timeZone:'America/New_York'}))
  const dayOfWeek = nowET.getDay() // 0=Sun, 1=Mon...
  // End = yesterday (Saturday when run Sunday morning)
  const end = new Date(nowET)
  end.setDate(end.getDate() - 1)
  // Start = 6 days before end (previous Sunday)
  const start = new Date(end)
  start.setDate(start.getDate() - 6)

  const weekStart = start.toISOString().split('T')[0]
  const weekEnd   = end.toISOString().split('T')[0]

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  let fetchError = null
  let data = null
  try {
    data = await fetchWeeklyData(supabase, weekStart, weekEnd)
  } catch (e) {
    fetchError = e.message
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Data fetch failed: ' + fetchError }) }
  }

  const reportHtml  = buildReportHtml(data, weekStart, weekEnd)
  const patternHtml = await buildPatternHtml(supabase, weekStart, weekEnd)

  const subject = `Hillside Fire Department - Weekly Operations Report ${fmtDate(weekStart)} – ${fmtDate(weekEnd)}`
  const patternSubject = `PRIVATE - Pattern Analysis Week of ${fmtDate(weekStart)}`

  const RECIPIENTS = [
    'rcarey@hillsidefire.org',
    'fsousa@hillsidefire.org',
    'daferrigno@hillsidefire.org',
    'jpienciak@hillsidefire.org',
    'iabreau@hillsidefire.org',
    'mfigueroa@hillsidefire.org'
  ]

  let sent = false
  let smtpError = null
  try {
    const transport = makeTransport()
    await transport.sendMail({
      from: '"Hillside Fire Department" <sousa@sousapest.com>',
      to:   RECIPIENTS.join(', '),
      subject,
      html: reportHtml
    })
    await transport.sendMail({
      from: '"Hillside Fire Department" <sousa@sousapest.com>',
      to:   'fsousa@hillsidefire.org',
      subject: patternSubject,
      html: patternHtml
    })
    sent = true
  } catch (e) {
    smtpError = e.message
  }

  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      ok: true,
      week: { start: weekStart, end: weekEnd },
      counts: {
        sick: data.sick.length,
        recall: data.recall.length,
        apparatus_issues: data.apparatus.length,
        bulletins: data.bulletins.length,
        events: data.events.length,
        vacation: data.vacation.length
      },
      email_sent: sent,
      smtp_error: smtpError || null
    })
  }
}
