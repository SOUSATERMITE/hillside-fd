const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')
const { allowOrigin } = require('./_cors')
const { verifySession, findOfficerInFirefighters } = require('./_auth')

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

function row(label, value, shade) {
  const bg = shade ? 'background:#f3f4f6;' : ''
  return `<tr style="${bg}"><td style="padding:8px 12px;font-weight:600;">${label}</td><td style="padding:8px 12px;">${value}</td></tr>`
}

function buildEmail(title, accentColor, rows, bodyHtml, reqId, reviewUrl) {
  const btnHtml = reviewUrl
    ? `<p style="margin:16px 0 0;"><a href="${reviewUrl}" style="display:inline-block;background:${accentColor};color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">Review Request →</a></p>`
    : ''
  return `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:${accentColor};padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">${title}</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${rows}
    </table>
    ${bodyHtml}
    ${btnHtml}
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Request ID: ${reqId}</p>
  </div>
</div>`
}

async function sendDenialEmail(vacReq, deniedByName, reason, cancelledStr, newStr, reqId) {
  const rows = [
    row('Cancelled Dates', cancelledStr),
    row('New Dates', newStr, true),
    row('Denied By', deniedByName),
    row('Reason', sanitize(reason), true)
  ].join('')

  const html = buildEmail(
    'Denied — Your Vacation Change Request',
    '#6b7280', rows,
    '<p>Your vacation change request has been denied. Contact your officer with any questions.</p>',
    reqId, null
  )

  if (vacReq.ff_email) {
    await sendEmail({
      to: vacReq.ff_email,
      subject: 'Denied — Your Vacation Change Request',
      html,
      text: `Your vacation change request has been denied by ${deniedByName}. Reason: ${sanitize(reason)}`
    })
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

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

  try {
    const { request_id, action, denial_reason, captain_overtime_acknowledged } = JSON.parse(event.body || '{}')

    if (!request_id || !action) return { statusCode: 400, headers, body: JSON.stringify({ error: 'request_id and action are required' }) }
    if (!['approve', 'deny'].includes(action)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'action must be approve or deny' }) }
    if (action === 'deny' && !denial_reason?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'denial_reason is required when denying' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const { data: vacReq, error: reqErr } = await supabase
      .from('vacation_requests')
      .select('*')
      .eq('id', request_id)
      .single()
    if (reqErr || !vacReq) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Request not found' }) }

    const officerFF = await findOfficerInFirefighters(supabase, officer)

    const isAdmin   = officer.role === 'admin'
    const rank      = officerFF?.rank || ''
    const isCaptain = rank === 'Captain' || isAdmin
    const isDC      = rank === 'DC'      || isAdmin
    const isChief   = rank === 'Chief'   || isAdmin

    const now          = new Date().toISOString()
    const cancelledStr = formatDates(vacReq.cancelled_dates)
    const newStr       = formatDates(vacReq.new_dates)
    const reviewUrl    = `https://hillside-fd.netlify.app/vacation?request=${request_id}`

    console.log(`[approve-vacation] officer: ${officer.display_name} (${rank}) | action: ${action} | status: ${vacReq.status} | request: ${request_id}`)

    // ── CAPTAIN LEVEL ────────────────────────────────────────────────────────────
    if (vacReq.status === 'pending') {
      if (!isCaptain) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Captain login required to act on pending requests' }) }
      if (action === 'approve' && !captain_overtime_acknowledged) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'You must acknowledge the overtime check before approving' }) }
      }

      if (action === 'approve') {
        await supabase.from('vacation_requests').update({
          status: 'captain_approved',
          captain_name: officer.display_name,
          captain_overtime_acknowledged: true,
          captain_action_date: now
        }).eq('id', request_id)

        const { data: dcs } = await supabase
          .from('firefighters')
          .select('name, email')
          .eq('group_number', vacReq.ff_group)
          .eq('rank', 'DC')
          .eq('active', true)

        const rows = [
          row('Firefighter', vacReq.ff_name),
          row('Group', `Group ${vacReq.ff_group}`, true),
          row('Cancelled Dates', cancelledStr),
          row('New Dates', newStr, true),
          row('Staffing Impact', vacReq.staffing_impact ? `YES — ${vacReq.impact_explanation}` : 'No'),
          row('Captain Approved By', officer.display_name, true),
          row('Overtime Acknowledged', 'Yes — Captain confirmed no overtime or overtime is authorized')
        ].join('')

        const html = buildEmail(
          `Action Required — ${vacReq.ff_name} Vacation Change — Captain Approved`,
          '#1d4ed8', rows,
          `<p>This request has been approved by Captain ${officer.display_name} and now requires your review as DC.</p>`,
          request_id, reviewUrl
        )

        for (const dc of (dcs || [])) {
          if (dc.email) {
            await sendEmail({
              to: dc.email,
              subject: `Action Required — ${vacReq.ff_name} Vacation Change — Captain Approved, Awaiting DC Review`,
              html,
              text: `Vacation change for ${vacReq.ff_name} (Group ${vacReq.ff_group}) approved by Captain ${officer.display_name}. Cancelled: ${cancelledStr}. New: ${newStr}. Review at: ${reviewUrl}`
            })
          } else {
            console.warn(`[approve-vacation] DC ${dc.name} has no email`)
          }
        }

      } else {
        await supabase.from('vacation_requests').update({
          status: 'denied',
          denial_reason: sanitize(denial_reason),
          denied_by_name: officer.display_name,
          captain_action_date: now
        }).eq('id', request_id)
        await sendDenialEmail(vacReq, officer.display_name, denial_reason, cancelledStr, newStr, request_id)
      }
    }

    // ── DC LEVEL ─────────────────────────────────────────────────────────────────
    else if (vacReq.status === 'captain_approved') {
      if (!isDC) return { statusCode: 403, headers, body: JSON.stringify({ error: 'DC login required to act on captain-approved requests' }) }

      if (action === 'approve') {
        await supabase.from('vacation_requests').update({
          status: 'dc_approved',
          dc_name: officer.display_name,
          dc_action: 'approved',
          dc_action_date: now
        }).eq('id', request_id)

        const { data: chiefs } = await supabase
          .from('firefighters')
          .select('name, email')
          .eq('rank', 'Chief')
          .eq('active', true)

        const rows = [
          row('Firefighter', vacReq.ff_name),
          row('Group', `Group ${vacReq.ff_group}`, true),
          row('Cancelled Dates', cancelledStr),
          row('New Dates', newStr, true),
          row('Captain Approved By', vacReq.captain_name),
          row('DC Approved By', officer.display_name, true)
        ].join('')

        const html = buildEmail(
          `Action Required — ${vacReq.ff_name} Vacation Change — Awaiting Chief Approval`,
          '#7c3aed', rows,
          `<p>This request has been approved by the Captain and DC. Your approval as Chief is the final step.</p>`,
          request_id, reviewUrl
        )

        for (const chief of (chiefs || [])) {
          if (chief.email) {
            await sendEmail({
              to: chief.email,
              subject: `Action Required — ${vacReq.ff_name} Vacation Change — Awaiting Chief Approval`,
              html,
              text: `Vacation change for ${vacReq.ff_name} (Group ${vacReq.ff_group}) approved by Captain ${vacReq.captain_name} and DC ${officer.display_name}. Your final approval is needed. Review at: ${reviewUrl}`
            })
          } else {
            console.warn(`[approve-vacation] Chief ${chief.name} has no email`)
          }
        }

      } else {
        await supabase.from('vacation_requests').update({
          status: 'denied',
          denial_reason: sanitize(denial_reason),
          denied_by_name: officer.display_name,
          dc_name: officer.display_name,
          dc_action: 'denied',
          dc_action_date: now
        }).eq('id', request_id)
        await sendDenialEmail(vacReq, officer.display_name, denial_reason, cancelledStr, newStr, request_id)
      }
    }

    // ── CHIEF LEVEL ──────────────────────────────────────────────────────────────
    else if (vacReq.status === 'dc_approved') {
      if (!isChief) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Chief login required to act on DC-approved requests' }) }

      if (action === 'approve') {
        await supabase.from('vacation_requests').update({
          status: 'approved',
          chief_name: officer.display_name,
          chief_action: 'approved',
          chief_action_date: now
        }).eq('id', request_id)

        // Email FF — final approval
        const ffRows = [
          row('Request', `Vacation change for ${vacReq.ff_name}`),
          row('Cancelled Dates', cancelledStr, true),
          row('New Dates', newStr),
          row('Captain Approved By', vacReq.captain_name, true),
          row('DC Approved By', vacReq.dc_name),
          row('Chief Approved By', officer.display_name, true)
        ].join('')

        const ffHtml = buildEmail(
          'Fully Approved — Your Vacation Change Request',
          '#15803d', ffRows,
          '<p style="color:#15803d;font-weight:600;">Your vacation change request has been fully approved by your Captain, DC, and Chief.</p>',
          request_id, null
        )

        if (vacReq.ff_email) {
          await sendEmail({
            to: vacReq.ff_email,
            subject: 'Approved — Your Vacation Change Request',
            html: ffHtml,
            text: `Your vacation change request has been fully approved. Cancelled: ${cancelledStr}. New Dates: ${newStr}. Approved by Captain ${vacReq.captain_name}, DC ${vacReq.dc_name}, and Chief ${officer.display_name}.`
          })
        }

        // FYI to all tour officers (Captains + DC)
        const { data: tourOfficers } = await supabase
          .from('firefighters')
          .select('name, email')
          .eq('group_number', vacReq.ff_group)
          .in('rank', ['Captain', 'DC'])
          .eq('active', true)

        const fiyRows = [
          row('Firefighter', vacReq.ff_name),
          row('Group', `Group ${vacReq.ff_group}`, true),
          row('Cancelled Dates', cancelledStr),
          row('New Dates', newStr, true),
          row('Captain Approved By', vacReq.captain_name),
          row('DC Approved By', vacReq.dc_name, true),
          row('Chief Approved By', officer.display_name)
        ].join('')

        const fiyHtml = buildEmail(
          `FYI — Vacation Change Fully Approved: ${vacReq.ff_name}`,
          '#6b7280', fiyRows,
          '<p style="color:#6b7280;">This vacation change has been fully approved. No action required.</p>',
          request_id, null
        )

        for (const o of (tourOfficers || [])) {
          if (o.email) {
            await sendEmail({
              to: o.email,
              subject: `FYI — ${vacReq.ff_name} Vacation Change Approved`,
              html: fiyHtml,
              text: `FYI: Vacation change for ${vacReq.ff_name} (Group ${vacReq.ff_group}) fully approved. Cancelled: ${cancelledStr}. New: ${newStr}. No action required.`
            })
          }
        }

      } else {
        // Chief denies
        await supabase.from('vacation_requests').update({
          status: 'denied',
          denial_reason: sanitize(denial_reason),
          denied_by_name: officer.display_name,
          chief_name: officer.display_name,
          chief_action: 'denied',
          chief_action_date: now
        }).eq('id', request_id)

        // Email FF
        await sendDenialEmail(vacReq, officer.display_name, denial_reason, cancelledStr, newStr, request_id)

        // Email DC — inform their approval was overridden
        const { data: dcs } = await supabase
          .from('firefighters')
          .select('name, email')
          .eq('group_number', vacReq.ff_group)
          .eq('rank', 'DC')
          .eq('active', true)

        const dcRows = [
          row('Firefighter', vacReq.ff_name),
          row('Cancelled Dates', cancelledStr, true),
          row('New Dates', newStr),
          row('Denied By', officer.display_name, true),
          row('Reason', sanitize(denial_reason))
        ].join('')

        const dcHtml = buildEmail(
          `Denied by Chief — ${vacReq.ff_name} Vacation Change`,
          '#6b7280', dcRows,
          `<p>This vacation change was denied by Chief ${officer.display_name} after your DC approval.</p>`,
          request_id, null
        )

        for (const dc of (dcs || [])) {
          if (dc.email) {
            await sendEmail({
              to: dc.email,
              subject: `FYI — ${vacReq.ff_name} Vacation Change Denied by Chief`,
              html: dcHtml,
              text: `FYI: Vacation change for ${vacReq.ff_name} denied by Chief ${officer.display_name}. Reason: ${sanitize(denial_reason)}`
            })
          }
        }
      }
    }

    // ── ADMIN/DIRECT CHIEF LEVEL (chief_review) ──────────────────────────────────
    else if (vacReq.status === 'chief_review') {
      if (!isChief) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Chief login required to act on administrative staff requests' }) }

      if (action === 'approve') {
        await supabase.from('vacation_requests').update({
          status: 'approved',
          chief_name: officer.display_name,
          chief_action: 'approved',
          chief_action_date: now
        }).eq('id', request_id)

        const ffRows = [
          row('Request', `Vacation change for ${vacReq.ff_name}`),
          row('Assignment', 'Administrative (no tour)', true),
          row('Cancelled Dates', cancelledStr),
          row('New Dates', newStr, true),
          row('Chief Approved By', officer.display_name)
        ].join('')

        const ffHtml = buildEmail(
          'Approved — Your Vacation Change Request',
          '#15803d', ffRows,
          '<p style="color:#15803d;font-weight:600;">Your vacation change request has been approved by the Chief.</p>',
          request_id, null
        )

        if (vacReq.ff_email) {
          await sendEmail({
            to: vacReq.ff_email,
            subject: 'Approved — Your Vacation Change Request',
            html: ffHtml,
            text: `Your vacation change request has been approved by Chief ${officer.display_name}. Cancelled: ${cancelledStr}. New Dates: ${newStr}.`
          })
        }

      } else {
        await supabase.from('vacation_requests').update({
          status: 'denied',
          denial_reason: sanitize(denial_reason),
          denied_by_name: officer.display_name,
          chief_name: officer.display_name,
          chief_action: 'denied',
          chief_action_date: now
        }).eq('id', request_id)

        await sendDenialEmail(vacReq, officer.display_name, denial_reason, cancelledStr, newStr, request_id)
      }
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Cannot act on a request with status: ${vacReq.status}` }) }
    }

    console.log(`[approve-vacation] Complete. officer: ${officer.display_name} | action: ${action} | request: ${request_id}`)
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (e) {
    console.error('[approve-vacation] Error:', e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
