// Scheduled: Monday 6am ET (10:00 UTC)
// Sends weekly recall report for each tour to that tour's DC and Captains.
const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')

const SHIFT_ANCHOR = new Date('2026-04-30T11:30:00Z')

function currentShiftDate() {
  const shifts = Math.floor((Date.now() - SHIFT_ANCHOR.getTime()) / 86400000)
  const d = new Date(SHIFT_ANCHOR.getTime() + shifts * 86400000)
  return d.toISOString().split('T')[0]
}

function makeTransport() {
  if (process.env.GMAIL_APP_PASSWORD) {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: { user: 'hillsidefireapp@gmail.com', pass: process.env.GMAIL_APP_PASSWORD }
    })
  }
  // Fallback to Zoho if Gmail not configured
  return nodemailer.createTransport({
    host: 'smtp.zoho.com',
    port: 465,
    secure: true,
    auth: { user: process.env.ZOHO_SMTP_USER, pass: process.env.ZOHO_SMTP_PASS }
  })
}

function fmtDateShort(iso) {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(t) {
  if (!t || t.length < 4) return t || ''
  const h = parseInt(t.slice(0, 2), 10)
  const m = t.slice(2, 4)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${m} ${ampm}`
}

function recallTypeLabel(t) {
  return { full_shift:'Full Shift', short_min:'Short Min', refused:'Refused', vacation_skip:'Vac. Skip', substitution:'Substitution', refused_no_penalty:'Refused (no penalty)' }[t] || t
}

// Fetch all data for one group and build email HTML
async function buildGroupReport(supabase, group, todayShift, historyStart) {
  const ffRes = await supabase.from('firefighters')
    .select('id, name, rank, group_number, email, badge_number, phone')
    .eq('group_number', group).eq('active', true)
  if (ffRes.error) throw ffRes.error
  const allFFs = ffRes.data
  const ffIds = allFFs.map(f => f.id)
  const safeIds = ffIds.length ? ffIds : ['00000000-0000-0000-0000-000000000000']
  const ffById = {}
  for (const f of allFFs) ffById[f.id] = f

  const [rlRes, sickRes, todayRes, histRes] = await Promise.all([
    supabase.from('recall_list')
      .select('*, firefighters(id, name, rank, badge_number, phone)')
      .eq('group_number', group)
      .order('rank_type', { ascending: true })
      .order('list_position', { ascending: true }),
    supabase.from('sick_log').select('firefighter_id, marked_sick_date, notes')
      .in('firefighter_id', safeIds).eq('deleted', false).is('cleared_date', null),
    supabase.from('recall_log')
      .select('firefighter_id, recall_type, recall_start_time')
      .in('firefighter_id', safeIds).eq('shift_date', todayShift).eq('deleted', false),
    supabase.from('recall_log')
      .select('firefighter_id, shift_date, recall_type, recall_start_time, recorded_by, refused_ff_id')
      .in('firefighter_id', safeIds).gte('shift_date', historyStart).eq('deleted', false)
      .order('shift_date', { ascending: false })
  ])
  if (rlRes.error) throw rlRes.error
  if (sickRes.error) throw sickRes.error
  if (todayRes.error) throw todayRes.error
  if (histRes.error) throw histRes.error

  const sickMap = {}
  for (const s of sickRes.data) sickMap[s.firefighter_id] = s
  const todayMap = {}
  for (const r of todayRes.data) todayMap[r.firefighter_id] = r

  const refIds = [...new Set(histRes.data.filter(r => r.refused_ff_id).map(r => r.refused_ff_id))]
  const refNames = {}
  if (refIds.length) {
    const { data: rd } = await supabase.from('firefighters').select('id, name').in('id', refIds)
    if (rd) for (const f of rd) refNames[f.id] = f.name
  }

  // Officer emails for this tour (DC and Captain ranks)
  const tourOfficers = allFFs.filter(f => ['DC', 'Captain'].includes(f.rank) && f.email)
  const recipients = tourOfficers.map(f => f.email)

  return { rlData: rlRes.data, sickMap, todayMap, histData: histRes.data, ffById, refNames, sickData: sickRes.data, recipients }
}

function buildEmailHtml(group, todayShift, historyDays, { rlData, sickMap, todayMap, histData, ffById, refNames, sickData }) {
  const monday = new Date()
  const weekOf = monday.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })

  const S = `
    <style>
      body { font-family: Arial, sans-serif; font-size: 13px; color: #000; background: #fff; }
      h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 14px; margin: 0 0 3px; font-weight: normal; }
      .hdr { text-align: center; border-bottom: 2px solid #000; padding-bottom: 12px; margin-bottom: 18px; }
      h3 { font-size: 14px; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 3px; margin: 0 0 8px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
      th { text-align: left; font-weight: bold; border-bottom: 2px solid #000; padding: 4px 6px; font-size: 12px; }
      td { border-bottom: 1px solid #ddd; padding: 3px 6px; }
      .section { margin-bottom: 22px; }
      .sick { font-weight: bold; background: #fff3cd; }
      .recalled { background: #d4edda; }
      .footer { font-size: 11px; color: #666; margin-top: 20px; text-align: center; }
    </style>`

  let html = `<html><head>${S}</head><body>
    <div class="hdr">
      <h1>HILLSIDE FIRE DEPARTMENT</h1>
      <h2>Weekly Recall Report &mdash; Tour ${group}</h2>
      <p style="font-size:12px;margin:0;">Week of ${weekOf}</p>
    </div>`

  // Section 1
  html += `<div class="section"><h3>SECTION 1 &mdash; CURRENT RECALL ORDER</h3>`
  const captains = rlData.filter(e => e.rank_type === 'Captain')
  const ffs      = rlData.filter(e => e.rank_type === 'FF')

  for (const [label, rows] of [['Captains', captains], ['Firefighters', ffs]]) {
    if (!rows.length) continue
    html += `<p style="font-weight:bold;margin:8px 0 3px;font-size:12px;">${label}</p>
    <table><thead><tr><th>#</th><th>Name</th><th>Rank</th><th>Badge</th><th>Phone</th><th>Status</th></tr></thead><tbody>`
    for (const r of rows) {
      const ff = r.firefighters || {}
      const sick = sickMap[r.firefighter_id]
      const recalled = todayMap[r.firefighter_id]
      const cls = sick ? 'sick' : (recalled ? 'recalled' : '')
      let status = []
      if (sick) status.push(`SICK (since ${fmtDateShort(sick.marked_sick_date?.split('T')[0])})`)
      if (recalled) status.push(`Recalled (${recallTypeLabel(recalled.recall_type)})`)
      html += `<tr class="${cls}">
        <td>${r.list_position}</td>
        <td>${ff.name || ''}</td>
        <td>${ff.rank || r.rank_type}</td>
        <td>${ff.badge_number || '—'}</td>
        <td>${ff.phone || '—'}</td>
        <td>${status.join(' / ') || '—'}</td>
      </tr>`
    }
    html += `</tbody></table>`
  }
  html += `<p style="font-size:11px;color:#555;"><b>★ SICK</b> = currently out sick | <b>Recalled</b> = recalled on shift ${fmtDateShort(todayShift)}</p></div>`

  // Section 2
  html += `<div class="section"><h3>SECTION 2 &mdash; RECALL HISTORY (Last ${historyDays} Days)</h3>`
  if (!histData.length) {
    html += `<p style="color:#888;font-style:italic;">No recalls recorded in this period.</p>`
  } else {
    html += `<table><thead><tr><th>Date</th><th>Member</th><th>Type</th><th>Covered For</th><th>Notified</th><th>Officer</th></tr></thead><tbody>`
    for (const r of histData) {
      const ff = ffById[r.firefighter_id] || {}
      html += `<tr>
        <td>${fmtDateShort(r.shift_date)}</td>
        <td>${ff.name || ''} (${ff.rank || ''})</td>
        <td>${recallTypeLabel(r.recall_type)}</td>
        <td>${r.refused_ff_id ? (refNames[r.refused_ff_id] || 'Unknown') : '—'}</td>
        <td>${r.recall_start_time ? fmtTime(r.recall_start_time) : '—'}</td>
        <td>${r.recorded_by || '—'}</td>
      </tr>`
    }
    html += `</tbody></table>`
  }
  html += `</div>`

  // Section 3
  html += `<div class="section"><h3>SECTION 3 &mdash; CURRENT SICK LIST</h3>`
  if (!sickData.length) {
    html += `<p style="color:#888;font-style:italic;">No members currently on sick leave.</p>`
  } else {
    html += `<table><thead><tr><th>Name</th><th>Rank</th><th>Date Started</th><th>Days Out</th><th>Notes</th></tr></thead><tbody>`
    for (const s of sickData) {
      const ff = ffById[s.firefighter_id] || {}
      const daysOut = Math.floor((Date.now() - new Date(s.marked_sick_date).getTime()) / 86400000)
      html += `<tr>
        <td><b>${ff.name || ''}</b></td>
        <td>${ff.rank || ''}</td>
        <td>${fmtDateShort(s.marked_sick_date?.split('T')[0])}</td>
        <td>${daysOut} day${daysOut === 1 ? '' : 's'}</td>
        <td>${s.notes || '—'}</td>
      </tr>`
    }
    html += `</tbody></table>`
  }
  html += `</div>`

  html += `<p class="footer">Auto-generated by Hillside FD system — ${new Date().toLocaleString('en-US',{timeZone:'America/New_York'})} ET</p>`
  html += `</body></html>`
  return html
}

exports.handler = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const transport = makeTransport()
  const fromAddr = process.env.GMAIL_APP_PASSWORD
    ? '"Hillside FD" <hillsidefireapp@gmail.com>'
    : `"Hillside FD" <${process.env.ZOHO_SMTP_USER}>`

  const todayShift = currentShiftDate()
  const historyDays = 7
  const historyStart = new Date(Date.now() - historyDays * 86400000).toISOString().split('T')[0]

  const monday = new Date()
  const weekOf = monday.toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })

  const results = []

  for (let group = 1; group <= 4; group++) {
    try {
      const reportData = await buildGroupReport(supabase, group, todayShift, historyStart)

      if (!reportData.recipients.length) {
        console.log(`[recall-report] Tour ${group}: no officer emails found, skipping`)
        results.push({ group, skipped: true, reason: 'no officer emails' })
        continue
      }

      const html = buildEmailHtml(group, todayShift, historyDays, reportData)

      await transport.sendMail({
        from: fromAddr,
        to: reportData.recipients.join(', '),
        subject: `Weekly Recall Report - Tour ${group} - Week of ${weekOf}`,
        html
      })

      console.log(`[recall-report] Tour ${group}: sent to ${reportData.recipients.join(', ')}`)
      results.push({ group, sent: true, recipients: reportData.recipients })
    } catch (e) {
      console.error(`[recall-report] Tour ${group} error:`, e.message)
      results.push({ group, error: e.message })
    }
  }

  console.log('[recall-report] Done:', JSON.stringify(results))
  return { statusCode: 200, body: JSON.stringify({ results }) }
}
