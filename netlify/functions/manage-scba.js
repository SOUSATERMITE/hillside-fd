const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')
const nodemailer = require('nodemailer')

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
    console.error('[manage-scba] Email failed:', e.message)
  }
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  // GET: public read
  if (event.httpMethod === 'GET') {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const { section, apparatus } = event.queryStringParameters || {}

    try {
      if (section === 'packs') {
        const { data, error } = await supabase
          .from('scba_packs').select('*').eq('active', true)
          .order('apparatus_id').order('pack_id')
        if (error) throw error
        // Get last inspection per pack
        const packIds = (data || []).map(p => p.id)
        let lastInspMap = {}
        if (packIds.length) {
          const { data: insp } = await supabase
            .from('scba_inspections')
            .select('pack_id, inspection_date, inspected_by, psi, pressure_full, overall_pass')
            .in('pack_id', packIds)
            .order('inspection_date', { ascending: false })
          for (const i of (insp || [])) {
            if (!lastInspMap[i.pack_id]) lastInspMap[i.pack_id] = i
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ packs: data || [], lastInsp: lastInspMap }) }
      }

      if (section === 'inspections') {
        const q = supabase.from('scba_inspections').select('*').order('inspection_date', { ascending: false }).limit(200)
        if (apparatus) {
          // Get pack ids for this apparatus first
          const { data: packs } = await supabase.from('scba_packs').select('id').eq('apparatus_id', apparatus).eq('active', true)
          const ids = (packs || []).map(p => p.id)
          if (!ids.length) return { statusCode: 200, headers, body: JSON.stringify([]) }
          const { data, error } = await supabase.from('scba_inspections').select('*, scba_packs(pack_id)').in('pack_id', ids).order('inspection_date', { ascending: false }).limit(100)
          if (error) throw error
          return { statusCode: 200, headers, body: JSON.stringify(data || []) }
        }
        const { data, error } = await q
        if (error) throw error
        return { statusCode: 200, headers, body: JSON.stringify(data || []) }
      }

      if (section === 'bottles') {
        const { data: bottles, error } = await supabase.from('spare_bottles').select('*').order('apparatus_assigned').order('bottle_number')
        if (error) throw error
        // Get last 4 weeks of PSI logs per bottle
        const ids = (bottles || []).map(b => b.id)
        let psiLogs = {}
        if (ids.length) {
          const { data: logs } = await supabase.from('bottle_psi_log').select('*').in('bottle_id', ids).order('logged_date', { ascending: false })
          for (const l of (logs || [])) {
            if (!psiLogs[l.bottle_id]) psiLogs[l.bottle_id] = []
            if (psiLogs[l.bottle_id].length < 4) psiLogs[l.bottle_id].push(l)
          }
        }
        return { statusCode: 200, headers, body: JSON.stringify({ bottles: bottles || [], psiLogs }) }
      }

      if (section === 'batteries') {
        // Latest battery log per apparatus
        const { data, error } = await supabase.from('scba_batteries').select('*').order('changed_date', { ascending: false })
        if (error) throw error
        return { statusCode: 200, headers, body: JSON.stringify(data || []) }
      }

      if (section === 'flow_tests') {
        // All flow tests joined with pack info, ordered by test_date desc
        const { data, error } = await supabase
          .from('scba_flow_tests')
          .select('*, scba_packs(pack_id, apparatus_id, assigned_apparatus)')
          .order('test_date', { ascending: false })
        if (error) throw error
        return { statusCode: 200, headers, body: JSON.stringify(data || []) }
      }

      return { statusCode: 400, headers, body: JSON.stringify({ error: 'section required' }) }
    } catch (e) {
      console.error('[manage-scba GET]', e.message)
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
    }
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body
  const isAdmin = officer.role === 'admin'

  try {
    // ── PACKS ──────────────────────────────────────────────────────────────────
    if (action === 'add_pack') {
      if (!isAdmin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin required' }) }
      const { pack_id, apparatus_id, assigned_apparatus, status, notes } = body
      if (!pack_id?.trim() || !apparatus_id?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'pack_id and apparatus_id required' }) }
      const { data, error } = await supabase.from('scba_packs').insert({
        pack_id: pack_id.trim().toUpperCase(), apparatus_id: apparatus_id.trim(),
        assigned_apparatus: assigned_apparatus?.trim() || apparatus_id.trim(),
        status: ['in_service','out_of_service','at_shop','spare'].includes(status) ? status : 'in_service',
        notes: notes?.trim() || null
      }).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'update_pack') {
      if (!isAdmin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin required' }) }
      const { id, apparatus_id, assigned_apparatus, status, notes } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const upd = {}
      if (apparatus_id      !== undefined) upd.apparatus_id      = apparatus_id.trim()
      if (assigned_apparatus !== undefined) upd.assigned_apparatus = assigned_apparatus.trim()
      if (status            !== undefined) upd.status            = status
      if (notes             !== undefined) upd.notes             = notes?.trim() || null
      const { data, error } = await supabase.from('scba_packs').update(upd).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'delete_pack') {
      if (!isAdmin) return { statusCode: 403, headers, body: JSON.stringify({ error: 'Admin required' }) }
      const { id } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const { data, error } = await supabase.from('scba_packs').update({ active: false }).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── INSPECTION ─────────────────────────────────────────────────────────────
    if (action === 'submit_inspection') {
      const { inspections, inspected_by } = body
      if (!Array.isArray(inspections) || !inspections.length) return { statusCode: 400, headers, body: JSON.stringify({ error: 'inspections array required' }) }

      const CHECK_FIELDS = ['harness_frame','straps_buckles','air_gauge','heads_up_display','first_stage_reg','audible_alarm','pass_alarm','rit_bottle']
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      const saved = []
      const failed = []
      const notFull = []

      for (const insp of inspections) {
        const overall_pass = CHECK_FIELDS.every(f => insp[f] === 'pass')
        const row = {
          pack_id: insp.pack_id,
          inspection_date: today,
          inspected_by: inspected_by || officer.display_name,
          officer_id: officer.officer_id,
          apparatus_assigned: insp.apparatus_assigned || null,
          psi: null,
          pressure_full: insp.pressure_full !== undefined ? insp.pressure_full : null,
          bottle_number: insp.bottle_number?.trim() || null,
          harness_frame:    insp.harness_frame    || null,
          straps_buckles:   insp.straps_buckles   || null,
          air_gauge:        insp.air_gauge        || null,
          heads_up_display: insp.heads_up_display || null,
          first_stage_reg:  insp.first_stage_reg  || null,
          audible_alarm:    insp.audible_alarm    || null,
          pass_alarm:       insp.pass_alarm       || null,
          rit_bottle:       insp.rit_bottle       || null,
          overall_pass,
          notes: insp.notes?.trim() || null
        }
        const { data, error } = await supabase.from('scba_inspections').insert(row).select().single()
        if (error) throw error
        saved.push(data)
        if (!overall_pass) failed.push({ ...data, pack_label: insp.pack_label })
        if (insp.pressure_full === false) notFull.push({ ...data, pack_label: insp.pack_label })
      }

      // Create findings + send email for failed packs (check failures)
      for (const f of failed) {
        const { data: pack } = await supabase.from('scba_packs').select('pack_id, apparatus_id, assigned_apparatus').eq('id', f.pack_id).single()
        if (pack) {
          const { data: apparatus } = await supabase.from('apparatus').select('id').eq('unit_name', pack.apparatus_id).maybeSingle()
          if (apparatus) {
            await supabase.from('apparatus_findings').insert({
              apparatus_id: apparatus.id,
              finding_type: 'inspection',
              title: `SCBA Inspection FAILED — Pack ${pack.pack_id}`,
              description: `Pack ${pack.pack_id} failed weekly SCBA inspection on ${f.inspection_date}. Inspected by: ${f.inspected_by}. Notes: ${f.notes || 'None'}`,
              priority: 'high',
              status: 'open',
              reported_by: f.inspected_by,
              officer_id: f.officer_id
            }).catch(() => {})
          }
        }

        // Email DCs + Chief
        const { data: recipients } = await supabase
          .from('firefighters')
          .select('name, email')
          .in('rank', ['DC','D/C','D/C 1','D/C 2','D/C 3','D/C 4','Chief'])
          .eq('active', true)
        const emails = (recipients || []).filter(r => r.email).map(r => r.email)
        if (emails.length) {
          const packLabel = f.pack_label || f.pack_id
          const subject = `⚠️ SCBA INSPECTION FAILED — Pack ${packLabel} — ${today}`
          const html = `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;">
  <div style="background:#dc2626;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;">⚠️ SCBA INSPECTION FAILED</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#fef2f2;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;width:140px;">Pack</td><td style="padding:8px 12px;font-weight:700;">${packLabel}</td></tr>
      <tr style="background:#fee2e2;"><td style="padding:8px 12px;font-weight:600;">Apparatus</td><td style="padding:8px 12px;">${f.apparatus_assigned || ''}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Inspected By</td><td style="padding:8px 12px;">${f.inspected_by}</td></tr>
      <tr style="background:#fee2e2;"><td style="padding:8px 12px;font-weight:600;">Date</td><td style="padding:8px 12px;">${f.inspection_date}</td></tr>
      ${f.notes ? `<tr><td style="padding:8px 12px;font-weight:600;">Notes</td><td style="padding:8px 12px;">${f.notes}</td></tr>` : ''}
    </table>
    <p style="margin:0;color:#dc2626;font-weight:600;">This pack has been flagged as a high-priority finding. Immediate follow-up required.</p>
  </div>
</div>`
          await sendEmail({ to: emails.join(', '), subject, html, text: `SCBA INSPECTION FAILED\nPack: ${packLabel}\nApparatus: ${f.apparatus_assigned}\nInspected By: ${f.inspected_by}\nDate: ${f.inspection_date}\n${f.notes || ''}` })
        }
      }

      // Handle NOT FULL packs — set OOS + create finding + email
      for (const f of notFull) {
        // Set pack status to out_of_service
        await supabase.from('scba_packs').update({ status: 'out_of_service' }).eq('id', f.pack_id).catch(() => {})

        const { data: pack } = await supabase.from('scba_packs').select('pack_id, apparatus_id, assigned_apparatus').eq('id', f.pack_id).single()
        if (pack) {
          const { data: apparatus } = await supabase.from('apparatus').select('id').eq('unit_name', pack.apparatus_id).maybeSingle()
          if (apparatus) {
            await supabase.from('apparatus_findings').insert({
              apparatus_id: apparatus.id,
              finding_type: 'inspection',
              title: `SCBA Pack ${pack.pack_id} not at full pressure — needs air fill`,
              description: f.notes || `Pack ${pack.pack_id} was found NOT at full pressure during inspection on ${f.inspection_date} by ${f.inspected_by}.`,
              priority: 'high',
              status: 'open',
              reported_by: f.inspected_by,
              officer_id: f.officer_id
            }).catch(() => {})
          }

          // Email DCs + Chief about not-full pack
          const { data: recipients } = await supabase
            .from('firefighters')
            .select('name, email')
            .in('rank', ['DC','D/C','D/C 1','D/C 2','D/C 3','D/C 4','Chief'])
            .eq('active', true)
          const emails = (recipients || []).filter(r => r.email).map(r => r.email)
          if (emails.length) {
            const packLabel = f.pack_label || pack.pack_id
            const subject = `⚠️ SCBA PACK NOT AT FULL PRESSURE — Pack ${packLabel} — ${today}`
            const html = `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;">
  <div style="background:#d97706;padding:20px 28px;border-radius:10px 10px 0 0;">
    <h2 style="color:#fff;margin:0;">⚠️ SCBA Pack Not at Full Pressure</h2>
  </div>
  <div style="background:#fff;padding:24px 28px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;">
    <table style="width:100%;border-collapse:collapse;background:#fffbeb;border-radius:8px;overflow:hidden;margin-bottom:20px;">
      <tr><td style="padding:8px 12px;font-weight:600;width:140px;">Pack</td><td style="padding:8px 12px;font-weight:700;">${packLabel}</td></tr>
      <tr style="background:#fef3c7;"><td style="padding:8px 12px;font-weight:600;">Apparatus</td><td style="padding:8px 12px;">${pack.assigned_apparatus || pack.apparatus_id}</td></tr>
      <tr><td style="padding:8px 12px;font-weight:600;">Inspected By</td><td style="padding:8px 12px;">${f.inspected_by}</td></tr>
      <tr style="background:#fef3c7;"><td style="padding:8px 12px;font-weight:600;">Date</td><td style="padding:8px 12px;">${f.inspection_date}</td></tr>
      ${f.notes ? `<tr><td style="padding:8px 12px;font-weight:600;">Notes</td><td style="padding:8px 12px;">${f.notes}</td></tr>` : ''}
    </table>
    <p style="margin:0;color:#d97706;font-weight:600;">Pack has been marked Out of Service. Air fill required before returning to service.</p>
  </div>
</div>`
            await sendEmail({ to: emails.join(', '), subject, html, text: `SCBA PACK NOT AT FULL PRESSURE\nPack: ${packLabel}\nApparatus: ${pack.assigned_apparatus || pack.apparatus_id}\nInspected By: ${f.inspected_by}\nDate: ${f.inspection_date}\n${f.notes || ''}` })
          }
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ saved: saved.length, failed: failed.length, notFull: notFull.length }) }
    }

    // ── SPARE BOTTLES ──────────────────────────────────────────────────────────
    if (action === 'add_bottle') {
      const { bottle_number, current_psi, apparatus_assigned } = body
      if (!bottle_number?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'bottle_number required' }) }
      const { data, error } = await supabase.from('spare_bottles').insert({
        bottle_number: bottle_number.trim(), current_psi: current_psi ? parseInt(current_psi) : null,
        apparatus_assigned: apparatus_assigned?.trim() || null,
        last_checked: new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }),
        checked_by: officer.display_name
      }).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'update_bottle') {
      const { id, bottle_number, current_psi, apparatus_assigned } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const upd = {}
      if (bottle_number     !== undefined) upd.bottle_number     = bottle_number.trim()
      if (current_psi       !== undefined) upd.current_psi       = current_psi ? parseInt(current_psi) : null
      if (apparatus_assigned !== undefined) upd.apparatus_assigned = apparatus_assigned?.trim() || null
      const { data, error } = await supabase.from('spare_bottles').update(upd).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'delete_bottle') {
      const { id } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id required' }) }
      const { data, error } = await supabase.from('spare_bottles').update({ active: false }).eq('id', id).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'log_psi') {
      const { bottle_id, is_full, logged_by } = body
      if (!bottle_id || is_full === undefined) return { statusCode: 400, headers, body: JSON.stringify({ error: 'bottle_id and is_full required' }) }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      const d = new Date()
      const week = Math.ceil((d - new Date(d.getFullYear(), 0, 1)) / 604800000)

      // Update is_full on bottle (keep current_psi as-is for existing records)
      await supabase.from('spare_bottles').update({
        is_full, last_checked: today, checked_by: logged_by || officer.display_name
      }).eq('id', bottle_id)

      const { data, error } = await supabase.from('bottle_psi_log').insert({
        bottle_id, psi: null, is_full, logged_date: today,
        logged_by: logged_by || officer.display_name, week_number: week
      }).select().single()
      if (error) throw error

      // Auto-create finding if NOT full
      if (is_full === false) {
        const { data: bottle } = await supabase.from('spare_bottles').select('bottle_number, apparatus_assigned').eq('id', bottle_id).single()
        if (bottle) {
          const { data: apparatus } = await supabase.from('apparatus').select('id').eq('unit_name', bottle.apparatus_assigned).maybeSingle()
          if (apparatus) {
            await supabase.from('apparatus_findings').insert({
              apparatus_id: apparatus.id,
              finding_type: 'inspection',
              title: `CRITICAL: Spare Bottle ${bottle.bottle_number} not at full pressure`,
              description: `Spare bottle ${bottle.bottle_number} was found NOT at full pressure on ${today} by ${logged_by || officer.display_name}.`,
              priority: 'critical',
              status: 'open',
              reported_by: logged_by || officer.display_name,
              officer_id: officer.officer_id
            }).catch(() => {})
          }
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── BATTERIES ──────────────────────────────────────────────────────────────
    if (action === 'log_battery') {
      const { apparatus, changed_by, notes } = body
      if (!apparatus?.trim()) return { statusCode: 400, headers, body: JSON.stringify({ error: 'apparatus required' }) }
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      // next_due = 28 days from today
      const next = new Date()
      next.setDate(next.getDate() + 28)
      const next_due = next.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })
      const { data, error } = await supabase.from('scba_batteries').insert({
        apparatus: apparatus.trim(),
        changed_date: today,
        changed_by: changed_by || officer.display_name,
        next_due,
        notes: notes?.trim() || null
      }).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    // ── FLOW TESTS ────────────────────────────────────────────────────────────
    if (action === 'log_flow_test') {
      const { pack_id, test_date, result, tested_by, notes } = body
      if (!pack_id || !test_date || !result || !tested_by) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'pack_id, test_date, result, and tested_by are required' }) }
      }
      if (!['passed','failed'].includes(result)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'result must be passed or failed' }) }
      }
      // Auto-calculate next_due = test_date + 365 days
      const testDateObj = new Date(test_date + 'T12:00:00')
      const nextDueObj  = new Date(testDateObj.getTime() + 365 * 86400000)
      const next_due    = nextDueObj.toISOString().split('T')[0]

      const { data, error } = await supabase.from('scba_flow_tests').insert({
        pack_id,
        test_date,
        result,
        tested_by: tested_by.trim(),
        next_due,
        notes: notes?.trim() || null
      }).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (e) {
    console.error('[manage-scba]', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'Internal server error' }) }
  }
}
