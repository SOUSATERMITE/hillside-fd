const { createClient } = require('@supabase/supabase-js')
const nodemailer = require('nodemailer')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

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
    console.log(`[manage-findings] Email sent → ${to}`)
  } catch (e) {
    console.error(`[manage-findings] Email failed → ${to}: ${e.message}`)
  }
}

// Email all DCs (and optionally Chief) about a finding
async function notifyFinding(supabase, { unitName, findingType, description, priority, officerName, timestamp }, includingChief = false) {
  const rankFilter = ['DC', 'D/C', 'D/C 1', 'D/C 2', 'D/C 3', 'D/C 4']
  if (includingChief) rankFilter.push('Chief')

  const { data: recipients } = await supabase
    .from('firefighters')
    .select('name, email')
    .in('rank', rankFilter)
    .eq('active', true)

  const emails = (recipients || []).filter(r => r.email).map(r => r.email)
  if (!emails.length) return

  const priColor = priority === 'critical' ? '#dc2626' : priority === 'high' ? '#d97706' : priority === 'medium' ? '#2563eb' : '#6b7280'
  const priLabel = priority.charAt(0).toUpperCase() + priority.slice(1)
  const typeLabel = findingType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const appUrl = 'https://hillside-fd.netlify.app/apparatus'

  const subject = `${typeLabel} — ${unitName} reported by ${officerName}`
  const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#1a2e52;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">${typeLabel} — ${unitName}</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;width:120px;">Unit</td><td style="padding:8px 12px;font-weight:700;">${unitName}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Finding Type</td><td style="padding:8px 12px;">${typeLabel}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Priority</td><td style="padding:8px 12px;font-weight:700;color:${priColor};">${priLabel}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Description</td><td style="padding:8px 12px;">${description}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Reported By</td><td style="padding:8px 12px;">${officerName}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Timestamp</td><td style="padding:8px 12px;">${new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td></tr>
    </table>
    <p style="margin:16px 0 0;"><a href="${appUrl}" style="display:inline-block;background:#1a2e52;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">View Apparatus →</a></p>
  </div>
</div>`

  await sendEmail({
    to: emails.join(', '),
    subject,
    html,
    text: `${typeLabel} on ${unitName} reported by ${officerName}.\nPriority: ${priLabel}\nDescription: ${description}\nTimestamp: ${timestamp}\nReview at: ${appUrl}`
  })
}

// Email DCs when a daily or weekly check has failed items
async function notifyFailedCheck(supabase, { unitName, officerName, tour, checkType, failedItems, timestamp }) {
  const { data: recipients } = await supabase
    .from('firefighters')
    .select('name, email')
    .in('rank', ['DC', 'D/C', 'D/C 1', 'D/C 2', 'D/C 3', 'D/C 4'])
    .eq('active', true)

  const emails = (recipients || []).filter(r => r.email).map(r => r.email)
  if (!emails.length) return

  const checkLabel = checkType === 'weekly_check' ? 'Weekly' : 'Daily'
  const appUrl = 'https://hillside-fd.netlify.app/apparatus'
  const subject = `FAILED CHECK — ${unitName} ${checkLabel} Check — ${officerName} Tour ${tour}`

  const itemRows = failedItems.map(item =>
    `<tr><td style="padding:6px 10px;border-bottom:1px solid #fecaca;font-weight:600;color:#dc2626;">✗ ${item.label}</td><td style="padding:6px 10px;border-bottom:1px solid #fecaca;">${item.value || 'Issue reported'}</td></tr>`
  ).join('')

  const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#dc2626;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">FAILED CHECK — ${unitName} ${checkLabel} Check</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#f9fafb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;width:120px;">Unit</td><td style="padding:8px 12px;font-weight:700;">${unitName}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Check Type</td><td style="padding:8px 12px;">${checkLabel} Check</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Officer</td><td style="padding:8px 12px;">${officerName}</td></tr>
      <tr style="background:#f3f4f6;"><td style="padding:8px 12px;font-weight:600;">Tour</td><td style="padding:8px 12px;">${tour}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Timestamp</td><td style="padding:8px 12px;">${new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td></tr>
    </table>
    <p style="margin:0 0 12px;font-weight:700;color:#dc2626;">Failed Items (${failedItems.length}):</p>
    <table style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      ${itemRows}
    </table>
    <p style="margin:16px 0 0;"><a href="${appUrl}" style="display:inline-block;background:#dc2626;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">View Apparatus →</a></p>
  </div>
</div>`

  await sendEmail({
    to: emails.join(', '),
    subject,
    html,
    text: `FAILED CHECK — ${unitName} ${checkLabel} Check — ${officerName} Tour ${tour}\nFailed items:\n${failedItems.map(i => `- ${i.label}: ${i.value || 'Issue'}`).join('\n')}\nReview at: ${appUrl}`
  })
}

// Email DCs + Chief about an auto-generated equipment check finding
async function notifyCheckIssue(supabase, { unitName, itemLabel, itemNotes, officerName, priority, timestamp }) {
  const { data: recipients } = await supabase
    .from('firefighters')
    .select('name, email')
    .in('rank', ['DC', 'D/C', 'D/C 1', 'D/C 2', 'D/C 3', 'D/C 4', 'Chief'])
    .eq('active', true)

  const emails = (recipients || []).filter(r => r.email).map(r => r.email)
  if (!emails.length) return

  const priColor = priority === 'high' ? '#d97706' : '#2563eb'
  const priLabel = priority.charAt(0).toUpperCase() + priority.slice(1)
  const appUrl = 'https://hillside-fd.netlify.app/apparatus'
  const subject = `Equipment Check Issue Found — ${unitName} — ${itemLabel} — ${officerName}`

  const html = `
<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;color:#1a1a1a;">
  <div style="background:#92400e;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;font-size:18px;">Equipment Check Issue Found</h2>
    <p style="color:#fde68a;margin:4px 0 0;font-size:14px;">${unitName} — Weekly Equipment Check</p>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#fffbeb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;width:120px;">Unit</td><td style="padding:8px 12px;font-weight:700;">${unitName}</td></tr>
      <tr style="background:#fef3c7;"><td style="padding:8px 12px;font-weight:600;">Item</td><td style="padding:8px 12px;font-weight:700;">${itemLabel}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Priority</td><td style="padding:8px 12px;font-weight:700;color:${priColor};">${priLabel}</td></tr>
      ${itemNotes ? `<tr style="background:#fef3c7;"><td style="padding:8px 12px;font-weight:600;">Issue Notes</td><td style="padding:8px 12px;">${itemNotes}</td></tr>` : ''}
      <tr style="background:#fef3c7;"><td style="padding:8px 12px;font-weight:600;">Reported By</td><td style="padding:8px 12px;">${officerName}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Time</td><td style="padding:8px 12px;">${new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/New_York' })}</td></tr>
    </table>
    <p style="margin:0 0 16px;color:#92400e;font-size:14px;">A finding has been created and must be marked Repair Completed before the weekly check is considered resolved.</p>
    <p style="margin:0;"><a href="${appUrl}" style="display:inline-block;background:#92400e;color:#fff;text-decoration:none;font-weight:600;padding:12px 24px;border-radius:8px;font-size:14px;">View Apparatus →</a></p>
  </div>
</div>`

  await sendEmail({
    to: emails.join(', '),
    subject,
    html,
    text: `Equipment Check Issue Found\nUnit: ${unitName}\nItem: ${itemLabel}\nPriority: ${priLabel}\n${itemNotes ? `Notes: ${itemNotes}\n` : ''}Reported by: ${officerName}\nTime: ${timestamp}\nView at: ${appUrl}`
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

    // ── SUBMIT CHECK (daily_check / weekly_check) ─────────────────────────────
    if (action === 'submit_check') {
      const { apparatus_id, check_type, items, notes, has_issues, tour } = body
      if (!apparatus_id || !check_type || !Array.isArray(items)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'apparatus_id, check_type, and items required' }) }
      }

      const VALID_CHECK_TYPES = ['daily_check', 'weekly_check']
      if (!VALID_CHECK_TYPES.includes(check_type)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid check_type' }) }
      }

      const failedItems = items.filter(i => i.pass === false)
      const hasIssues = has_issues || failedItems.length > 0
      const timestamp = new Date().toISOString()

      // Fetch apparatus name
      const { data: unit } = await supabase
        .from('apparatus')
        .select('unit_name, unit_type')
        .eq('id', apparatus_id)
        .single()

      const findingsData = {
        check_type,
        items,
        notes: notes?.trim() || null,
        has_issues: hasIssues,
        failed_items: failedItems,
        tour,
        submitted_by: officer.display_name,
        submitted_at: timestamp
      }

      const descParts = []
      if (hasIssues && failedItems.length > 0) {
        descParts.push(`Failed: ${failedItems.map(i => i.label).join(', ')}`)
      }
      if (notes?.trim()) descParts.push(notes.trim())

      // Weekly check with issues stays 'open' until all generated findings are resolved
      const checkStatus = (check_type === 'weekly_check' && hasIssues) ? 'open' : 'completed'

      const { data: checkRecord, error } = await supabase
        .from('apparatus_findings')
        .insert({
          apparatus_id,
          finding_type:   check_type,
          description:    descParts.length ? descParts.join(' | ').slice(0, 2000) : (check_type === 'daily_check' ? 'Daily check completed — all items OK' : 'Weekly check completed — all items OK'),
          priority:       hasIssues ? 'high' : 'low',
          reported_by:    officer.display_name,
          officer_id:     officer.officer_id,
          status:         checkStatus,
          findings_data:  findingsData
        })
        .select()
        .single()

      if (error) throw error

      // Notify DCs if any items failed
      if (hasIssues && failedItems.length > 0 && unit) {
        await notifyFailedCheck(supabase, {
          unitName: unit.unit_name,
          officerName: officer.display_name,
          tour: tour || '?',
          checkType: check_type,
          failedItems,
          timestamp
        })
      }

      // For weekly checks: auto-create individual apparatus_findings per failed item
      if (check_type === 'weekly_check' && failedItems.length > 0 && unit) {
        const SCBA_KEYWORDS = ['scba', 'breathing', 'mask', 'regulator', 'bottle', 'air pack', 'scott', 'msa']

        const individualInserts = failedItems.map(item => {
          const lbl = item.label.toLowerCase()
          const isScba = SCBA_KEYWORDS.some(k => lbl.includes(k))
          return {
            apparatus_id,
            finding_type:  'repair_needed',
            description:   `Equipment Check Issue — ${item.label}`,
            photos_notes:  item.notes?.trim() || null,
            priority:      isScba ? 'high' : 'medium',
            reported_by:   officer.display_name,
            officer_id:    officer.officer_id,
            status:        'open',
            findings_data: {
              source_check_id: checkRecord.id,
              check_item_key:  item.key,
              auto_generated:  true
            }
          }
        })

        await supabase.from('apparatus_findings').insert(individualInserts).catch(e2 => {
          console.error('[manage-findings] auto-finding insert failed:', e2.message)
        })

        // Email per-item notifications
        for (const item of failedItems) {
          const lbl = item.label.toLowerCase()
          const isScba = SCBA_KEYWORDS.some(k => lbl.includes(k))
          await notifyCheckIssue(supabase, {
            unitName:    unit.unit_name,
            itemLabel:   item.label,
            itemNotes:   item.notes?.trim() || null,
            officerName: officer.display_name,
            priority:    isScba ? 'high' : 'medium',
            timestamp
          })
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify(checkRecord) }
    }

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
      const timestamp = new Date().toISOString()

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
          status:        'open'
        })
        .select()
        .single()

      if (error) throw error

      // Notify DCs (and Chief for critical)
      if (unit && ['damage', 'repair_needed', 'inspection'].includes(finding_type)) {
        const includingChief = pri === 'critical'
        await notifyFinding(supabase, {
          unitName: unit.unit_name,
          findingType: finding_type,
          description: description.trim(),
          priority: pri,
          officerName: officer.display_name,
          timestamp
        }, includingChief)
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

      // If this is an auto-generated check finding, check if all siblings are resolved
      // and if so, mark the parent weekly check finding as completed too
      if (['completed', 'cancelled'].includes(status) && data.findings_data?.source_check_id) {
        const srcId = data.findings_data.source_check_id
        try {
          const { data: siblings } = await supabase
            .from('apparatus_findings')
            .select('id, status')
            .filter('findings_data->>source_check_id', 'eq', srcId)
          const allResolved = (siblings || []).every(s => ['completed', 'cancelled'].includes(s.status))
          if (allResolved) {
            await supabase.from('apparatus_findings').update({ status: 'completed' }).eq('id', srcId)
          }
        } catch (e2) {
          console.error('[manage-findings] resolution propagation failed:', e2.message)
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (e) {
    console.error('[manage-findings] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
