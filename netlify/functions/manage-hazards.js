const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')
const { allowOrigin } = require('./_cors')
const { verifySession, checkAdmin } = require('./_auth')

// Shift anchor: Group 3 on April 30 2026 at 0730 ET (1130 UTC)
const SHIFT_ANCHOR_MS = new Date('2026-04-30T11:30:00Z').getTime()
const ROTATION = [3, 4, 1, 2]

function currentTour() {
  const shifts = Math.floor((Date.now() - SHIFT_ANCHOR_MS) / 86400000)
  return ROTATION[((shifts % 4) + 4) % 4]
}

function sanitize(v) { return (v || '').replace(/[\r\n\t]/g, ' ').trim() }

function makeTransport() {
  return nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: process.env.ZOHO_SMTP_USER, pass: process.env.ZOHO_SMTP_PASS }
  })
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.ZOHO_SMTP_USER || !process.env.ZOHO_SMTP_PASS) {
    console.log(`[SMTP] SKIP — not configured | to: ${to}`)
    return
  }
  try {
    await makeTransport().sendMail({
      from: '"Hillside Fire Department" <hillsidefireapp@gmail.com>',
      replyTo: 'noreply@hillsidefire.org',
      to, subject, html, text
    })
    console.log(`[SMTP] OK → ${to}`)
  } catch (e) {
    console.error(`[SMTP] FAILED → ${to} | ${e.message}`)
  }
}

async function sendHazardNotifications(supabase, hazard) {
  const { severity, address, cross_street, hazard_type, description, reported_by, reported_tour, id } = hazard
  if (severity !== 'critical' && severity !== 'warning') return

  const tour = reported_tour || currentTour()
  const dashUrl = 'https://hillside-fd.netlify.app/'

  // Gather recipients: DCs, Chief (critical only), on-duty captains
  const [dcRes, chiefRes, captainRes] = await Promise.all([
    supabase.from('firefighters').select('name, email').eq('rank', 'DC').eq('active', true),
    severity === 'critical'
      ? supabase.from('firefighters').select('name, email').eq('rank', 'Chief').eq('active', true)
      : Promise.resolve({ data: [] }),
    supabase.from('firefighters').select('name, email').eq('rank', 'Captain').eq('group_number', tour).eq('active', true)
  ])

  const recipients = new Map()
  for (const ff of [...(dcRes.data || []), ...(chiefRes.data || []), ...(captainRes.data || [])]) {
    if (ff.email) recipients.set(ff.email, ff.name)
  }
  if (!recipients.size) return

  const SEV_COLORS = { critical: '#b91c1c', warning: '#d97706' }
  const color = SEV_COLORS[severity] || '#374151'
  const sevLabel = severity.toUpperCase()

  const crossLine = cross_street ? `<tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Cross Street</td><td style="padding:8px 12px;">${sanitize(cross_street)}</td></tr>` : ''

  const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:${color};padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">${severity === 'critical' ? '🚨' : '⚠️'} ${sevLabel} FIELD HAZARD — ${sanitize(address)}</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;">Address</td><td style="padding:8px 12px;font-weight:700;font-size:15px;">${sanitize(address)}</td></tr>
      ${crossLine}
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Hazard Type</td><td style="padding:8px 12px;">${sanitize(hazard_type)}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Severity</td><td style="padding:8px 12px;font-weight:700;color:${color};">${sevLabel}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Description</td><td style="padding:8px 12px;">${sanitize(description)}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Reported By</td><td style="padding:8px 12px;">Tour ${tour} — ${sanitize(reported_by)}</td></tr>
    </table>
    <p style="margin:0 0 16px;color:#374151;">Know before you go. View the full hazard report on the dashboard.</p>
    <p style="margin:16px 0 0;"><a href="${dashUrl}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">View Dashboard →</a></p>
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Report ID: ${id}</p>
  </div>
</div>`

  const text = `${sevLabel} FIELD HAZARD — ${address}${cross_street ? ' @ ' + cross_street : ''}
Hazard Type: ${hazard_type}
Description: ${description}
Reported by Tour ${tour} — ${reported_by}
View dashboard: ${dashUrl}`

  const subjectPrefix = severity === 'critical' ? '🚨 CRITICAL FIELD HAZARD' : '⚠️ WARNING — Field Hazard'
  const subject = `${subjectPrefix} — ${address} — Reported by ${reported_by}`

  for (const [email] of recipients) {
    await sendEmail({ to: email, subject, html, text })
  }
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-admin-password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body

  // ── SUBMIT ────────────────────────────────────────────────────────────────────
  if (action === 'submit') {
    const officer = await verifySession(event)

    const { address, cross_street, district, hazard_type, severity, description, observed_date, reported_by: bodyReporter } = body
    if (!address?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Address is required' }) }
    if (!hazard_type?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Hazard type is required' }) }

    const VALID_SEVERITIES = ['critical', 'warning', 'caution', 'informational']
    if (!VALID_SEVERITIES.includes(severity)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid severity' }) }
    if (!description?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Description is required' }) }

    const reported_by = officer ? officer.display_name : (bodyReporter?.trim() || '')
    if (!reported_by) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Reporter name is required' }) }

    // Determine tour from session or current on-duty
    const reported_tour = currentTour()

    const { data, error } = await supabase.from('field_hazard_reports').insert({
      address:        address.trim().slice(0, 300),
      cross_street:   cross_street?.trim().slice(0, 200) || null,
      district:       district?.trim().slice(0, 200) || null,
      hazard_type:    hazard_type.trim().slice(0, 100),
      severity,
      description:    description.trim().slice(0, 2000),
      observed_date:  observed_date || new Date().toISOString().split('T')[0],
      reported_by:    reported_by.slice(0, 200),
      reported_tour,
      officer_id:     officer?.officer_id || null
    }).select().single()

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }

    // Send notifications in background (don't await — don't slow down the response)
    sendHazardNotifications(supabase, data).catch(e => console.error('[notify]', e.message))

    return { statusCode: 200, headers, body: JSON.stringify(data) }
  }

  // ── RESOLVE ───────────────────────────────────────────────────────────────────
  if (action === 'resolve') {
    const officer = await verifySession(event)
    if (!officer || (officer.role !== 'officer' && officer.role !== 'admin')) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Officer login required' }) }
    }

    const { id, resolution_note } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
    if (!resolution_note?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Resolution note required' }) }

    const { error } = await supabase.from('field_hazard_reports').update({
      status:          'resolved',
      resolution_note: resolution_note.trim().slice(0, 1000),
      resolved_by:     officer.display_name,
      resolved_at:     new Date().toISOString()
    }).eq('id', id)

    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  // ── DELETE ────────────────────────────────────────────────────────────────────
  if (action === 'delete') {
    const admin = await checkAdmin(event)
    if (!admin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin required' }) }

    const { id } = body
    if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }

    const { error } = await supabase.from('field_hazard_reports').delete().eq('id', id)
    if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
}
