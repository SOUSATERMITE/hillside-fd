const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')
const { allowOrigin } = require('./_cors')
const crypto = require('crypto')

function sanitize(v) { return (v || '').replace(/[\r\n\t]/g, ' ').trim() }

function makeTransport() {
  return nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 465, secure: true,
    auth: { user: process.env.ZOHO_SMTP_USER, pass: process.env.ZOHO_SMTP_PASS }
  })
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.ZOHO_SMTP_USER || !process.env.ZOHO_SMTP_PASS) {
    console.log(`[SMTP] SKIP — not configured | to: ${to}`)
    return { ok: false, error: 'SMTP not configured' }
  }
  console.log(`[SMTP] Attempting → to: ${to} | subject: ${subject}`)
  try {
    const result = await makeTransport().sendMail({
      from: '"Hillside Fire Department" <sousa@sousapest.com>',
      replyTo: 'noreply@hillsidefire.org',
      to, subject, html, text
    })
    console.log(`[SMTP] OK → to: ${to} | messageId: ${result.messageId}`)
    return { ok: true, messageId: result.messageId }
  } catch (e) {
    console.error(`[SMTP] FAILED → to: ${to} | error: ${e.message}`)
    return { ok: false, error: e.message }
  }
}

function formatDates(arr) {
  if (!arr || !arr.length) return 'None'
  return arr.map(d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })).join(', ')
}

function reviewBtn(url, color) {
  return `<p style="margin:16px 0 0;"><a href="${url}" style="display:inline-block;background:${color};color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">Review Request →</a></p>`
}

// Look up an officer record by name (exact then case-insensitive fallback)
async function findOfficerByName(supabase, name) {
  const { data: exact } = await supabase
    .from('officers')
    .select('id, name, display_name, role')
    .eq('name', name)
    .eq('active', true)
    .maybeSingle()
  if (exact) return exact

  const { data: fuzzy } = await supabase
    .from('officers')
    .select('id, name, display_name, role')
    .ilike('name', name)
    .eq('active', true)
    .maybeSingle()
  return fuzzy || null
}

// Create a one-use magic token valid for 7 days; returns the token string or null
async function mintMagicToken(supabase, officerId, requestId) {
  try {
    const token = crypto.randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    const { error } = await supabase
      .from('magic_tokens')
      .insert({ officer_id: officerId, request_id: requestId, token, expires_at: expiresAt })
    if (error) { console.error('[submit-vacation] mintMagicToken error:', error.message); return null }
    return token
  } catch (e) { console.error('[submit-vacation] mintMagicToken exception:', e.message); return null }
}

// Build the review URL — with magic token if officer has a login, plain if not
async function buildReviewUrl(supabase, officerName, requestId) {
  const BASE = `https://hillside-fd.netlify.app/vacation?request=${requestId}`
  const officer = await findOfficerByName(supabase, officerName)
  if (!officer) return BASE  // No officer login — URL works but needs manual PIN
  const token = await mintMagicToken(supabase, officer.id, requestId)
  return token ? `${BASE}&token=${token}` : BASE
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const {
      firefighter_id, ff_signature,
      cancelled_dates, new_dates,
      staffing_impact, impact_explanation
    } = JSON.parse(event.body || '{}')

    if (!firefighter_id || !ff_signature?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'firefighter_id and signature are required' }) }
    }
    if (!cancelled_dates?.length || !new_dates?.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Cancelled dates and new dates are required' }) }
    }
    if (staffing_impact && !impact_explanation?.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Explanation required when staffing is affected' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const { data: ff, error: ffErr } = await supabase
      .from('firefighters')
      .select('id, name, rank, group_number, email')
      .eq('id', firefighter_id)
      .eq('active', true)
      .single()
    if (ffErr || !ff) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Firefighter not found' }) }

    const cancelledStr = formatDates(cancelled_dates)
    const newStr       = formatDates(new_dates)
    const isAdminFF    = !ff.group_number  // NULL = not assigned to a tour

    // ── ADMIN FF PATH: goes directly to Chief ───────────────────────────────────
    if (isAdminFF) {
      const { data: req, error: insertErr } = await supabase
        .from('vacation_requests')
        .insert({
          firefighter_id: ff.id,
          ff_name: ff.name,
          ff_email: ff.email || '',
          ff_group: null,
          request_date: new Date().toISOString().slice(0, 10),
          cancelled_dates,
          new_dates,
          staffing_impact: !!staffing_impact,
          impact_explanation: impact_explanation?.trim() || null,
          ff_signature: sanitize(ff_signature),
          status: 'chief_review',
          notified_captains: []
        })
        .select()
        .single()
      if (insertErr) throw insertErr

      const { data: chiefs } = await supabase
        .from('firefighters')
        .select('name, email')
        .eq('rank', 'Chief')
        .eq('active', true)

      const impactLine = staffing_impact
        ? `<tr><td style="padding:8px 12px;font-weight:600;color:#b91c1c;">Staffing Impact</td><td style="padding:8px 12px;color:#b91c1c;font-weight:600;">YES — ${sanitize(impact_explanation)}</td></tr>`
        : `<tr><td style="padding:8px 12px;font-weight:600;">Staffing Impact</td><td style="padding:8px 12px;">No</td></tr>`

      const buildChiefHtml = (reviewUrl) => `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#7c3aed;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">Action Required — Administrative Staff Vacation Change</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <p style="margin:0 0 16px;">An administrative staff member has submitted a vacation change request. As Chief, your approval is required.</p>
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;">Firefighter</td><td style="padding:8px 12px;">${ff.name}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Assignment</td><td style="padding:8px 12px;">Administrative (no tour)</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Cancelled Dates</td><td style="padding:8px 12px;">${cancelledStr}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">New Dates</td><td style="padding:8px 12px;">${newStr}</td></tr>
      ${impactLine}
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Signature</td><td style="padding:8px 12px;">${sanitize(ff_signature)}</td></tr>
    </table>
    ${reviewBtn(reviewUrl, '#7c3aed')}
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Request ID: ${req.id}</p>
  </div>
</div>`

      let chiefsNotified = 0
      for (const chief of (chiefs || [])) {
        if (chief.email) {
          const reviewUrl = await buildReviewUrl(supabase, chief.name, req.id)
          await sendEmail({
            to: chief.email,
            subject: `Action Required — Administrative Staff Vacation Change Request from ${ff.name}`,
            html: buildChiefHtml(reviewUrl),
            text: `Administrative staff vacation change from ${ff.name}. Cancelled: ${cancelledStr}. New Dates: ${newStr}. Your approval is required. Review at: ${reviewUrl}`
          })
          chiefsNotified++
        }
      }

      console.log(`[submit-vacation] Admin request ${req.id} created for ${ff.name}. Chiefs notified: ${chiefsNotified}`)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: req.id }) }
    }

    // ── TOUR FF PATH: normal Captain → DC → Chief chain ────────────────────────
    const { data: captains } = await supabase
      .from('firefighters')
      .select('id, name, email')
      .eq('group_number', ff.group_number)
      .eq('rank', 'Captain')
      .eq('active', true)

    const captainNames = (captains || []).map(c => c.name)

    const { data: req, error: insertErr } = await supabase
      .from('vacation_requests')
      .insert({
        firefighter_id: ff.id,
        ff_name: ff.name,
        ff_email: ff.email || '',
        ff_group: ff.group_number,
        request_date: new Date().toISOString().slice(0, 10),
        cancelled_dates,
        new_dates,
        staffing_impact: !!staffing_impact,
        impact_explanation: impact_explanation?.trim() || null,
        ff_signature: sanitize(ff_signature),
        status: 'pending',
        notified_captains: captainNames
      })
      .select()
      .single()
    if (insertErr) throw insertErr

    const impactLine = staffing_impact
      ? `<tr><td style="padding:8px 12px;font-weight:600;color:#b91c1c;">Staffing Impact</td><td style="padding:8px 12px;color:#b91c1c;font-weight:600;">YES — ${sanitize(impact_explanation)}</td></tr>`
      : `<tr><td style="padding:8px 12px;font-weight:600;">Staffing Impact</td><td style="padding:8px 12px;">No</td></tr>`

    const buildCaptainHtml = (reviewUrl) => `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#b91c1c;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">Action Required — Vacation Change Request</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <p style="margin:0 0 16px;">A vacation change request requires your approval. Either captain may approve — first response is final.</p>
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;">Firefighter</td><td style="padding:8px 12px;">${ff.name}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Tour / Group</td><td style="padding:8px 12px;">Group ${ff.group_number}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Cancelled Dates</td><td style="padding:8px 12px;">${cancelledStr}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">New Dates</td><td style="padding:8px 12px;">${newStr}</td></tr>
      ${impactLine}
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Signature</td><td style="padding:8px 12px;">${sanitize(ff_signature)}</td></tr>
    </table>
    ${reviewBtn(reviewUrl, '#b91c1c')}
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Request ID: ${req.id}</p>
  </div>
</div>`

    let captainsNotified = 0
    for (const cap of (captains || [])) {
      if (cap.email) {
        const reviewUrl = await buildReviewUrl(supabase, cap.name, req.id)
        await sendEmail({
          to: cap.email,
          subject: `Action Required — Vacation Change Request from ${ff.name}`,
          html: buildCaptainHtml(reviewUrl),
          text: `Vacation change request from ${ff.name} (Group ${ff.group_number}). Either captain may approve — first response is final.\nCancelled: ${cancelledStr}\nNew Dates: ${newStr}\nStaffing Impact: ${staffing_impact ? 'YES' : 'No'}\nReview at: ${reviewUrl}`
        })
        captainsNotified++
      } else {
        const fallbackUrl = `https://hillside-fd.netlify.app/vacation?request=${req.id}`
        console.warn(`[submit-vacation] Captain ${cap.name} has no email — sending fallback alert`)
        await sendEmail({
          to: 'fsousa@hillsidefire.org, sousa@sousapest.com',
          subject: `ALERT — Captain ${cap.name} has no email: vacation request from ${ff.name} not delivered`,
          html: `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;">
            <div style="background:#dc2626;padding:16px 24px;border-radius:10px 10px 0 0;"><h2 style="color:#fff;margin:0;">⚠ Missing Email Alert</h2></div>
            <div style="background:#fff;padding:20px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
              <p><strong>Captain ${cap.name}</strong> (Group ${ff.group_number}) has no email and was not notified.</p>
              <p><strong>Submitted by:</strong> ${ff.name}<br><strong>Cancelled:</strong> ${cancelledStr}<br><strong>New Dates:</strong> ${newStr}</p>
              <p>Update ${cap.name}'s email in the Admin panel and manually notify them.</p>
              <a href="${fallbackUrl}" style="display:inline-block;background:#b91c1c;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;">View Request →</a>
            </div>
          </div>`,
          text: `ALERT: Captain ${cap.name} has no email. FF ${ff.name} submitted a vacation request not delivered to them. Review: ${fallbackUrl}`
        })
      }
    }

    console.log(`[submit-vacation] Tour request ${req.id} created for ${ff.name} (Group ${ff.group_number}). Captains notified: ${captainsNotified}/${(captains || []).length}`)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, id: req.id }) }
  } catch (e) {
    console.error('[submit-vacation] Error:', e)
    console.error('[submit-vacation] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
