const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')
const { allowOrigin } = require('./_cors')
const { verifySession, checkAdmin } = require('./_auth')

function sanitize(v) { return (v || '').replace(/[\r\n\t]/g, ' ').trim() }

function makeTransport() {
  return nodemailer.createTransport({
    host: 'smtp.zoho.com', port: 465, secure: true,
    auth: { user: process.env.ZOHO_SMTP_USER, pass: process.env.ZOHO_SMTP_PASS }
  })
}

async function sendEmail({ to, subject, html, text }) {
  if (!process.env.ZOHO_SMTP_USER || !process.env.ZOHO_SMTP_PASS) return
  try {
    await makeTransport().sendMail({
      from: '"Hillside Fire Department" <sousa@sousapest.com>',
      to, subject, html, text
    })
  } catch (e) { console.error('Email error:', e.message) }
}

function formatDates(arr) {
  if (!arr || !arr.length) return 'None'
  return arr.map(d => new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })).join(', ')
}

function baseEmail(title, accentColor, rows, bodyHtml, reqId) {
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
    <p style="margin:20px 0 0;font-size:12px;color:#9ca3af;">Request ID: ${reqId}</p>
  </div>
</div>`
}

function row(label, value, shade) {
  const bg = shade ? 'background:#f3f4f6;' : ''
  return `<tr style="${bg}"><td style="padding:8px 12px;font-weight:600;">${label}</td><td style="padding:8px 12px;">${value}</td></tr>`
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

    // Load the request
    const { data: vacReq, error: reqErr } = await supabase
      .from('vacation_requests')
      .select('*')
      .eq('id', request_id)
      .single()
    if (reqErr || !vacReq) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Request not found' }) }

    // Look up officer's FF record to determine rank
    const { data: officerFF } = await supabase
      .from('firefighters')
      .select('rank, group_number')
      .eq('name', officer.name)
      .eq('active', true)
      .maybeSingle()

    const isAdmin   = officer.role === 'admin'
    const rank      = officerFF?.rank || ''
    const isCaptain = rank === 'Captain' || isAdmin
    const isDC      = rank === 'DC' || isAdmin

    const now = new Date().toISOString()
    const cancelledStr = formatDates(vacReq.cancelled_dates)
    const newStr       = formatDates(vacReq.new_dates)

    // ── CAPTAIN LEVEL ────────────────────────────────────────────────────────
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

        // Email DC(s) of this tour
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

        const html = baseEmail(
          `Action Required — ${vacReq.ff_name} Vacation Change — Captain Approved`,
          '#1d4ed8', rows,
          `<p>This request has been approved by Captain ${officer.display_name} and now requires your review.</p>
           <a href="https://hillside-fd.netlify.app/vacation" style="display:inline-block;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">Review Request →</a>`,
          request_id
        )

        for (const dc of (dcs || [])) {
          if (dc.email) {
            await sendEmail({
              to: dc.email,
              subject: `Action Required — ${vacReq.ff_name} Vacation Change — Captain Approved, Awaiting DC Review`,
              html,
              text: `Vacation change for ${vacReq.ff_name} (Group ${vacReq.ff_group}) approved by Captain ${officer.display_name}. Cancelled: ${cancelledStr}. New: ${newStr}. Review at: https://hillside-fd.netlify.app/vacation`
            })
          }
        }

      } else {
        // Captain denies
        await supabase.from('vacation_requests').update({
          status: 'denied',
          denial_reason: sanitize(denial_reason),
          denied_by_name: officer.display_name,
          captain_action_date: now
        }).eq('id', request_id)

        await sendDenialEmail(vacReq, officer.display_name, denial_reason, cancelledStr, newStr, request_id)
      }
    }

    // ── DC LEVEL ─────────────────────────────────────────────────────────────
    else if (vacReq.status === 'captain_approved') {
      if (!isDC) return { statusCode: 403, headers, body: JSON.stringify({ error: 'DC login required to act on captain-approved requests' }) }

      if (action === 'approve') {
        await supabase.from('vacation_requests').update({
          status: 'approved',
          dc_name: officer.display_name,
          dc_action: 'approved',
          dc_action_date: now
        }).eq('id', request_id)

        // Email FF
        const rows = [
          row('Request', `Vacation change for ${vacReq.ff_name}`),
          row('Cancelled Dates', cancelledStr, true),
          row('New Dates', newStr),
          row('Captain Approved By', vacReq.captain_name, true),
          row('DC Approved By', officer.display_name)
        ].join('')

        const html = baseEmail(
          'Approved — Your Vacation Change Request',
          '#15803d', rows,
          `<p style="color:#15803d;font-weight:600;">Your vacation change request has been fully approved.</p>`,
          request_id
        )

        if (vacReq.ff_email) {
          await sendEmail({
            to: vacReq.ff_email,
            subject: 'Approved — Your Vacation Change Request',
            html,
            text: `Your vacation change request has been approved. Cancelled: ${cancelledStr}. New Dates: ${newStr}. Approved by DC ${officer.display_name}.`
          })
        }

        // FYI email to Chief(s)
        const { data: chiefs } = await supabase
          .from('firefighters')
          .select('name, email')
          .eq('rank', 'Chief')
          .eq('active', true)

        const chiefRows = [
          row('Firefighter', vacReq.ff_name),
          row('Group', `Group ${vacReq.ff_group}`, true),
          row('Cancelled Dates', cancelledStr),
          row('New Dates', newStr, true),
          row('Captain Approved By', vacReq.captain_name),
          row('DC Approved By', officer.display_name, true)
        ].join('')

        const chiefHtml = baseEmail(
          `FYI — Vacation Change Approved: ${vacReq.ff_name}`,
          '#6b7280', chiefRows,
          `<p style="color:#6b7280;">This vacation change request has been fully approved. No action required from you.</p>`,
          request_id
        )

        for (const chief of (chiefs || [])) {
          if (chief.email) {
            await sendEmail({
              to: chief.email,
              subject: `FYI — Vacation Change Approved: ${vacReq.ff_name}`,
              html: chiefHtml,
              text: `FYI: Vacation change for ${vacReq.ff_name} (Group ${vacReq.ff_group}) has been fully approved. Cancelled: ${cancelledStr}. New: ${newStr}. Captain: ${vacReq.captain_name}. DC: ${officer.display_name}. No action required.`
            })
          }
        }

      } else {
        // DC denies
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
    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Cannot act on a request with status: ${vacReq.status}` }) }
    }

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
  } catch (e) {
    console.error(e)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}

async function sendDenialEmail(vacReq, deniedByName, reason, cancelledStr, newStr, reqId) {
  const rows = [
    row('Cancelled Dates', cancelledStr),
    row('New Dates', newStr, true),
    row('Denied By', deniedByName),
    row('Reason', sanitize(reason), true)
  ].join('')

  const html = baseEmail(
    'Denied — Your Vacation Change Request',
    '#6b7280', rows,
    `<p>Your vacation change request has been denied. Contact your officer with any questions.</p>`,
    reqId
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
