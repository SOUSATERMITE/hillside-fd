const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

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
      replyTo: 'noreply@hillsidefire.org',
      to, subject, html, text
    })
    console.log(`[manage-findings] Email sent → ${to}`)
  } catch (e) {
    console.error(`[manage-findings] Email failed → ${to}: ${e.message}`)
  }
}

async function notifyCritical(supabase, unitName, officerName, description, apparatusId) {
  const { data: recipients } = await supabase
    .from('firefighters')
    .select('name, email')
    .in('rank', ['Chief', 'DC', 'D/C', 'D/C 1', 'D/C 2', 'D/C 3', 'D/C 4'])
    .eq('active', true)

  const emails = (recipients || []).filter(r => r.email).map(r => r.email)
  if (!emails.length) return

  const appUrl = `https://hillside-fd.netlify.app/apparatus`
  const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#dc2626;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">⚠ CRITICAL Finding Reported — ${unitName}</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;">Unit</td><td style="padding:8px 12px;font-weight:700;color:#dc2626;">${unitName}</td></tr>
      <tr style="background:#fee2e2;"><td style="padding:8px 12px;font-weight:600;">Reported By</td><td style="padding:8px 12px;">${officerName}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Finding</td><td style="padding:8px 12px;">${description}</td></tr>
    </table>
    <p style="margin:0 0 16px;font-weight:600;color:#dc2626;">Immediate attention required. Review and assign corrective action.</p>
    <p style="margin:16px 0 0;"><a href="${appUrl}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">View Apparatus →</a></p>
    <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">Log in at hillside-fd.netlify.app/apparatus with your PIN to review.</p>
  </div>
</div>`

  await sendEmail({
    to: emails.join(', '),
    subject: `CRITICAL Finding — ${unitName} — reported by ${officerName}`,
    html,
    text: `CRITICAL finding reported on ${unitName} by ${officerName}. Finding: ${description}. Review at: ${appUrl}`
  })
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const body = JSON.parse(event.body || '{}')
    const { action } = body

    // ── REPORT FINDING (damage/repair_needed/inspection/scheduled_maintenance) ─
    if (action === 'report') {
      const { apparatus_id, finding_type, description, priority, assigned_to, scheduled_date, photos_notes } = body
      if (!apparatus_id || !finding_type || !description?.trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'apparatus_id, finding_type, and description required' }) }
      }

      const VALID_TYPES = ['damage', 'repair_needed', 'inspection', 'scheduled_maintenance']
      const VALID_PRIS  = ['low', 'medium', 'high', 'critical']
      if (!VALID_TYPES.includes(finding_type)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid finding_type' }) }

      const pri = VALID_PRIS.includes(priority) ? priority : 'medium'

      // Fetch apparatus name for notification
      const { data: unit } = await supabase
        .from('apparatus')
        .select('unit_name')
        .eq('id', apparatus_id)
        .single()

      const { data, error } = await supabase
        .from('apparatus_findings')
        .insert({
          apparatus_id,
          finding_type,
          description:   description.trim().slice(0, 2000),
          priority:      pri,
          reported_by:   officer.display_name,
          officer_id:    officer.officer_id,
          assigned_to:   assigned_to?.trim() || null,
          scheduled_date: scheduled_date || null,
          photos_notes:  photos_notes?.trim().slice(0, 2000) || null,
          status:        finding_type === 'repair_completed' ? 'completed' : 'open'
        })
        .select()
        .single()

      if (error) throw error

      // Send critical notification
      if (pri === 'critical' && unit) {
        await notifyCritical(supabase, unit.unit_name, officer.display_name, description.trim(), apparatus_id)
      }

      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── LOG REPAIR COMPLETED ──────────────────────────────────────────────────
    if (action === 'log_repair') {
      const { apparatus_id, description, completed_by, completed_date, photos_notes } = body
      if (!apparatus_id || !description?.trim()) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'apparatus_id and description required' }) }
      }

      const { data, error } = await supabase
        .from('apparatus_findings')
        .insert({
          apparatus_id,
          finding_type:   'repair_completed',
          description:    description.trim().slice(0, 2000),
          priority:       'low',
          reported_by:    officer.display_name,
          officer_id:     officer.officer_id,
          completed_by:   completed_by?.trim() || officer.display_name,
          completed_date: completed_date || new Date().toISOString().split('T')[0],
          photos_notes:   photos_notes?.trim().slice(0, 2000) || null,
          status:         'completed'
        })
        .select()
        .single()

      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── UPDATE FINDING STATUS ────────────────────────────────────────────────
    if (action === 'update') {
      const { id, status, assigned_to, completed_by, completed_date } = body
      if (!id || !status) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id and status required' }) }

      const VALID_STATUSES = ['open', 'in_progress', 'completed', 'cancelled']
      if (!VALID_STATUSES.includes(status)) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid status' }) }

      const update = { status }
      if (assigned_to  !== undefined) update.assigned_to   = assigned_to || null
      if (completed_by !== undefined) update.completed_by  = completed_by || null
      if (completed_date !== undefined) update.completed_date = completed_date || null

      const { data, error } = await supabase
        .from('apparatus_findings')
        .update(update)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (e) {
    console.error('[manage-findings] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
