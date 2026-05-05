// Runs daily at 11:30 UTC (07:30 ET) — logs incomplete duties and emails DCs/Chief
// netlify.toml: [functions."duty-cron"] schedule = "30 11 * * *"

const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')

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

function isApplicableByConfig(cfg, dateStr, dayOfWeek) {
  const d = new Date(dateStr + 'T12:00:00Z')
  switch (cfg.type) {
    case 'one_time':
      return cfg.date === dateStr
    case 'daily':
      return true
    case 'weekly':
      return dayOfWeek === cfg.day
    case 'biweekly': {
      if (dayOfWeek !== cfg.day || !cfg.anchor) return false
      const anchor = new Date(cfg.anchor + 'T12:00:00Z')
      const diffDays = Math.round((d - anchor) / 86400000)
      return diffDays >= 0 && diffDays % 14 === 0
    }
    case 'monthly_date': {
      const dom = d.getUTCDate()
      if (dom === cfg.date) return true
      if (cfg.date > 28) {
        const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
        if (dom === lastDay && cfg.date > lastDay) return true
      }
      return false
    }
    case 'monthly_dow': {
      if (dayOfWeek !== cfg.day) return false
      const dom = d.getUTCDate()
      return Math.floor((dom - 1) / 7) + 1 === cfg.week
    }
    case 'yearly':
      return d.getUTCMonth() + 1 === cfg.month && d.getUTCDate() === cfg.date
    default:
      return false
  }
}

function isDutyApplicable(duty, dateStr, dayOfWeek, group) {
  if (duty.tour_specific !== null && duty.tour_specific !== undefined && duty.tour_specific !== group) return false
  const cfg = duty.recurrence_config
  if (cfg && cfg.type) return isApplicableByConfig(cfg, dateStr, dayOfWeek)
  // Legacy fallback
  switch (duty.recurrence) {
    case 'one_time':    return duty.specific_date === dateStr
    case 'daily':       return true
    case 'weekly':
    case 'specific_day': return duty.recurrence_day === dayOfWeek
    case 'monthly':     return true
    default:            return false
  }
}

function makeTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: process.env.ZOHO_SMTP_USER, pass: process.env.ZOHO_SMTP_PASS }
  })
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.ZOHO_SMTP_USER || !process.env.ZOHO_SMTP_PASS) return
  try {
    await makeTransport().sendMail({
      from: '"Hillside Fire Department" <hillsidefireapp@gmail.com>',
      replyTo: 'noreply@hillsidefire.org',
      to, subject, html, text
    })
  } catch (e) {
    console.error('[duty-cron] Email failed:', e.message)
  }
}

exports.handler = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const now = Date.now()
  // Cron runs at 11:30 UTC = 07:30 ET which is after shift changeover
  // We want to log YESTERDAY's shift duties
  const yesterdayStr = etDateStr(now - 86400000)
  const etYest = new Date(new Date(now - 86400000).toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const yesterdayDow   = etYest.getDay()
  const yesterdayGroup = groupForDateStr(yesterdayStr)

  console.log(`[duty-cron] Checking duties for ${yesterdayStr}, Group ${yesterdayGroup}`)

  const [dutiesRes, completionsRes] = await Promise.all([
    supabase.from('daily_duties').select('*').eq('active', true),
    supabase.from('duty_completions').select('duty_id').eq('completed_date', yesterdayStr)
  ])

  const allDuties   = dutiesRes.data || []
  const completedIds = new Set((completionsRes.data || []).map(c => c.duty_id))

  const applicable = allDuties.filter(d => isDutyApplicable(d, yesterdayStr, yesterdayDow, yesterdayGroup))
  const incomplete = applicable.filter(d => !completedIds.has(d.id))
  const complete   = applicable.filter(d =>  completedIds.has(d.id))

  // Log all to duty_log
  const logEntries = [
    ...complete.map(d => ({
      duty_id: d.id, shift_date: yesterdayStr, group_on_duty: yesterdayGroup, status: 'completed'
    })),
    ...incomplete.map(d => ({
      duty_id: d.id, shift_date: yesterdayStr, group_on_duty: yesterdayGroup, status: 'incomplete'
    }))
  ]

  if (logEntries.length > 0) {
    await supabase.from('duty_log').upsert(logEntries, { onConflict: 'duty_id,shift_date' }).catch(e => {
      console.error('[duty-cron] duty_log upsert failed:', e.message)
    })
  }

  // Email DCs + Chief for incomplete requires_report duties
  const reportDuties = incomplete.filter(d => d.requires_report)
  if (reportDuties.length > 0) {
    const { data: recipients } = await supabase
      .from('firefighters')
      .select('name, email')
      .in('rank', ['DC', 'D/C', 'D/C 1', 'D/C 2', 'D/C 3', 'D/C 4', 'Chief'])
      .eq('active', true)

    const emails = (recipients || []).filter(r => r.email).map(r => r.email)
    if (emails.length) {
      for (const duty of reportDuties) {
        const typeLabel  = duty.duty_type.charAt(0).toUpperCase() + duty.duty_type.slice(1)
        const subject    = `⚠️ INCOMPLETE DUTY — ${duty.title} — ${yesterdayStr} — Tour ${yesterdayGroup}`
        const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#dc2626;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">⚠️ INCOMPLETE DUTY — ${duty.title}</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;width:140px;">Duty</td><td style="padding:8px 12px;">${duty.title}</td></tr>
      <tr style="background:#fee2e2;"><td style="padding:8px 12px;font-weight:600;">Type</td><td style="padding:8px 12px;">${typeLabel}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Date</td><td style="padding:8px 12px;">${yesterdayStr}</td></tr>
      <tr style="background:#fee2e2;"><td style="padding:8px 12px;font-weight:600;">Tour Responsible</td><td style="padding:8px 12px;font-weight:700;color:#dc2626;">Tour ${yesterdayGroup}</td></tr>
      ${duty.description ? `<tr><td style="padding:8px 12px;font-weight:600;">Description</td><td style="padding:8px 12px;">${duty.description}</td></tr>` : ''}
    </table>
    <p style="margin:0;color:#dc2626;font-weight:600;">This duty was not marked complete before shift changeover. Immediate follow-up required.</p>
  </div>
</div>`
        await sendEmail({ to: emails.join(', '), subject, html, text: `INCOMPLETE DUTY: ${duty.title}\nDate: ${yesterdayStr}\nTour: ${yesterdayGroup}\n${duty.description || ''}` })
      }
    }
  }

  console.log(`[duty-cron] Done. applicable=${applicable.length} incomplete=${incomplete.length} emailed=${reportDuties.length}`)
  return {
    statusCode: 200,
    body: JSON.stringify({ date: yesterdayStr, group: yesterdayGroup, applicable: applicable.length, incomplete: incomplete.length, reported: reportDuties.length })
  }
}
