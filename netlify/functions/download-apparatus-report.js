const { createClient } = require('@supabase/supabase-js')
const PDFDocument = require('pdfkit')
const { allowOrigin } = require('./_cors')

const DEFICIENCY_TYPES = ['damage', 'repair_needed', 'inspection', 'manual_report']
const CHECK_TYPES       = ['daily_check', 'weekly_check']
const MAINTENANCE_TYPES = ['scheduled_maintenance', 'repair_completed']

function inRange(iso, start, end) {
  if (!iso) return false
  const d = iso.slice(0, 10)
  return d >= start && d <= end
}

function buildOosPeriods(log) {
  const periods = []
  for (let i = 0; i < log.length; i++) {
    const entry = log[i]
    if (entry.new_status !== 'out_of_service') continue
    const next = log[i + 1]
    periods.push({
      date_out:      entry.created_at,
      reason:        entry.finding || entry.notes || null,
      taken_out_by:  entry.changed_by,
      date_returned: next ? next.created_at : null,
      returned_by:   next ? next.changed_by : null
    })
  }
  return periods
}

function daysOverlap(period, start, end) {
  const periodStart = new Date(period.date_out).getTime()
  const periodEnd = period.date_returned ? new Date(period.date_returned).getTime() : Date.now()
  const rangeStart = new Date(start + 'T00:00:00').getTime()
  const rangeEnd = new Date(end + 'T23:59:59').getTime()
  const overlapStart = Math.max(periodStart, rangeStart)
  const overlapEnd = Math.min(periodEnd, rangeEnd)
  if (overlapEnd <= overlapStart) return 0
  return (overlapEnd - overlapStart) / 86400000
}

function fmtDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const FTYPE_LABEL = { damage: 'Damage', repair_needed: 'Repair Needed', inspection: 'Inspection', manual_report: 'Manual Report', scheduled_maintenance: 'Scheduled Maint.', repair_completed: 'Repair Completed', daily_check: 'Daily Check', weekly_check: 'Weekly Check' }

// Draw a simple table on the PDF document — mirrors download-recall-report.js's helper.
function drawTable(doc, headers, rows, colWidths, x, y, rowHeight = 18) {
  const tableWidth = colWidths.reduce((a, b) => a + b, 0)

  doc.fontSize(9).font('Helvetica-Bold')
  doc.rect(x, y, tableWidth, rowHeight).fill('#e8e8e8')
  doc.fillColor('black')
  let cx = x
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], cx + 3, y + 4, { width: colWidths[i] - 6, lineBreak: false, ellipsis: true })
    cx += colWidths[i]
  }
  y += rowHeight

  doc.font('Helvetica').fontSize(8)
  for (const row of rows) {
    if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
      doc.addPage()
      y = doc.page.margins.top
    }
    cx = x
    for (let i = 0; i < row.length; i++) {
      doc.text(String(row[i] ?? '—'), cx + 3, y + 3, { width: colWidths[i] - 6, lineBreak: false, ellipsis: true })
      cx += colWidths[i]
    }
    doc.moveTo(x, y + rowHeight).lineTo(x + tableWidth, y + rowHeight).lineWidth(0.3).strokeColor('#cccccc').stroke()
    y += rowHeight
  }

  doc.rect(x, y - rows.length * rowHeight - rowHeight, tableWidth, rows.length * rowHeight + rowHeight)
    .lineWidth(0.5).strokeColor('#888888').stroke()

  return y + 6
}

function sectionHeader(doc, M, pageW, title) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage()
  doc.moveDown(0.4)
  doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text(title, M, doc.y)
  doc.moveTo(M, doc.y + 2).lineTo(M + pageW, doc.y + 2).lineWidth(0.8).strokeColor('black').stroke()
  doc.moveDown(0.5)
}

function emptyNote(doc, M, text) {
  doc.font('Helvetica').fontSize(9).fillColor('#666666').text(text, M, doc.y)
  doc.moveDown(0.5)
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': origin }, body: '' }

  const params = event.queryStringParameters || {}
  const apparatusId = params.id
  if (!apparatusId) return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'id is required' }) }

  const today = new Date().toISOString().split('T')[0]
  const yearStart = `${new Date().getFullYear()}-01-01`
  const start = params.start || yearStart
  const end = params.end || today

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const [apRes, findingsRes, logRes] = await Promise.all([
    supabase.from('apparatus').select('*').eq('id', apparatusId).single(),
    supabase.from('apparatus_findings').select('*').eq('apparatus_id', apparatusId).order('created_at', { ascending: false }),
    supabase.from('apparatus_log').select('*').eq('apparatus_id', apparatusId).order('created_at', { ascending: true })
  ])

  if (apRes.error || !apRes.data) return { statusCode: 404, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'Apparatus not found' }) }
  const unit = apRes.data
  const allFindings = findingsRes.data || []
  const allLog = logRes.data || []

  const deficiencies = allFindings.filter(f => DEFICIENCY_TYPES.includes(f.finding_type) && inRange(f.created_at, start, end))
  const checklists    = allFindings.filter(f => CHECK_TYPES.includes(f.finding_type) && inRange(f.created_at, start, end))
  const maintenance   = allFindings.filter(f => MAINTENANCE_TYPES.includes(f.finding_type) && inRange(f.created_at, start, end))
  const outstandingRepairs = allFindings.filter(f => DEFICIENCY_TYPES.includes(f.finding_type) && ['open', 'in_progress'].includes(f.status))
  const allOosPeriods = buildOosPeriods(allLog)
  const oosHistory = allOosPeriods.filter(p => inRange(p.date_out, start, end))
  const daysOosPeriod = Math.round(allOosPeriods.reduce((sum, p) => sum + daysOverlap(p, start, end), 0) * 10) / 10
  const periodDeficiencies = { total: deficiencies.length, open: deficiencies.filter(f => ['open', 'in_progress'].includes(f.status)).length, resolved: deficiencies.filter(f => ['completed', 'cancelled'].includes(f.status)).length }
  const lastInspection = allFindings.filter(f => CHECK_TYPES.includes(f.finding_type)).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0]
  const lastMaintenance = allFindings.filter(f => MAINTENANCE_TYPES.includes(f.finding_type)).sort((a, b) => new Date(b.completed_date || b.created_at) - new Date(a.completed_date || a.created_at))[0]

  // ── Build PDF ─────────────────────────────────────────────────────────────
  const doc = new PDFDocument({ margin: 54, size: 'LETTER', info: { Title: `Apparatus Report - ${unit.unit_name}` } })
  const chunks = []
  doc.on('data', c => chunks.push(c))
  const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const pageW = doc.page.width - 108
  const M = 54

  // Header
  doc.font('Helvetica-Bold').fontSize(18).fillColor('black').text('HILLSIDE FIRE DEPARTMENT', M, 54, { align: 'center', width: pageW })
  doc.fontSize(13).text(`Apparatus History Report — ${unit.unit_name}`, { align: 'center', width: pageW })
  doc.fontSize(9).font('Helvetica').fillColor('#444444').text(`${fmtDate(start)} – ${fmtDate(end)}`, { align: 'center', width: pageW })
  doc.moveDown(0.3)
  doc.moveTo(M, doc.y).lineTo(M + pageW, doc.y).lineWidth(1.5).strokeColor('black').stroke()
  doc.moveDown(0.6)

  // Summary
  sectionHeader(doc, M, pageW, 'SUMMARY')
  const summaryRows = [
    ['Total Deficiencies (period)', `${periodDeficiencies.total} (${periodDeficiencies.open} open / ${periodDeficiencies.resolved} resolved)`],
    ['Total Maintenance Entries (period)', String(maintenance.length)],
    ['Days Out of Service (period)', String(daysOosPeriod)],
    ['Last Maintenance Date', lastMaintenance ? fmtDate(lastMaintenance.completed_date || lastMaintenance.created_at) : '—'],
    ['Last Inspection Date', lastInspection ? fmtDate(lastInspection.created_at) : '—']
  ]
  drawTable(doc, ['Metric', 'Value'], summaryRows, [260, pageW - 260], M, doc.y)
  doc.y += 6

  // Section 1 — Apparatus Info
  sectionHeader(doc, M, pageW, 'SECTION 1 — APPARATUS INFO')
  const infoRows = [
    ['Unit Name', unit.unit_name],
    ['Type', unit.unit_type],
    ['Year / Make / Model', [unit.year, unit.make, unit.model].filter(Boolean).join(' ') || '—'],
    ['Current Status', (unit.status || '').replace(/_/g, ' ')],
    ['Location', unit.location || '—'],
    ['Last Inspection Date', lastInspection ? fmtDate(lastInspection.created_at) : '—']
  ]
  drawTable(doc, ['Field', 'Value'], infoRows, [180, pageW - 180], M, doc.y)
  doc.y += 6

  // Section 2 — Deficiency History
  sectionHeader(doc, M, pageW, 'SECTION 2 — DEFICIENCY HISTORY')
  if (!deficiencies.length) {
    emptyNote(doc, M, 'No deficiencies reported in this period.')
  } else {
    const cols = [62, 60, 150, 78, 62, 90]
    const rows = deficiencies.map(f => [
      fmtDate(f.created_at), FTYPE_LABEL[f.finding_type] || f.finding_type, f.description, f.reported_by, f.priority,
      f.status === 'open' || f.status === 'in_progress' ? f.status.replace('_', ' ') : `${f.status} · ${f.completed_by || '—'}`
    ])
    doc.y = drawTable(doc, ['Date', 'Type', 'Description', 'Reported By', 'Priority', 'Status'], rows, cols, M, doc.y)
  }

  // Section 3 — Checklist/Inspection History
  sectionHeader(doc, M, pageW, 'SECTION 3 — CHECKLIST / INSPECTION HISTORY')
  if (!checklists.length) {
    emptyNote(doc, M, 'No completed checklists in this period.')
  } else {
    const cols = [62, 70, 90, 60, pageW - 62 - 70 - 90 - 60]
    const rows = checklists.map(f => {
      const fd = f.findings_data || {}
      const failed = (fd.failed_items || []).length
      return [fmtDate(f.created_at), FTYPE_LABEL[f.finding_type] || f.finding_type, fd.submitted_by || f.reported_by, failed ? `${failed} failed` : 'All pass', fd.notes || '—']
    })
    doc.y = drawTable(doc, ['Date', 'Type', 'Completed By', 'Result', 'Notes'], rows, cols, M, doc.y)
  }

  // Section 4 — Maintenance History (basic)
  sectionHeader(doc, M, pageW, 'SECTION 4 — MAINTENANCE HISTORY')
  if (!maintenance.length) {
    emptyNote(doc, M, 'No maintenance records in this period.')
  } else {
    const cols = [55, 55, 140, 90, pageW - 55 - 55 - 140 - 90]
    const rows = maintenance.map(f => [
      f.scheduled_date ? fmtDate(f.scheduled_date) : '—',
      f.completed_date ? fmtDate(f.completed_date) : '—',
      f.description,
      f.completed_by || f.assigned_to || '—',
      f.photos_notes || '—'
    ])
    doc.y = drawTable(doc, ['Scheduled', 'Completed', 'Description', 'By', 'Notes'], rows, cols, M, doc.y)
  }

  // Section 5 — Out of Service History
  sectionHeader(doc, M, pageW, 'SECTION 5 — OUT OF SERVICE HISTORY')
  if (!oosHistory.length) {
    emptyNote(doc, M, 'No out-of-service periods in this period.')
  } else {
    const cols = [70, 130, 70, 90, pageW - 70 - 130 - 70 - 90]
    const rows = oosHistory.map(p => [
      fmtDate(p.date_out), p.reason || '—', p.date_returned ? fmtDate(p.date_returned) : 'Still OOS', p.taken_out_by || '—', p.returned_by || '—'
    ])
    doc.y = drawTable(doc, ['Date Out', 'Reason', 'Date Returned', 'Taken Out By', 'Returned By'], rows, cols, M, doc.y)
  }

  // Section 6 — Maintenance & Repair Log
  sectionHeader(doc, M, pageW, 'SECTION 6 — MAINTENANCE & REPAIR LOG')
  if (!maintenance.length) {
    emptyNote(doc, M, 'No maintenance/repair log entries in this period.')
  } else {
    const cols = [50, 50, 75, 70, 45, 60, pageW - 50 - 50 - 75 - 70 - 45 - 60]
    const rows = maintenance.map(f => [
      f.scheduled_date ? fmtDate(f.scheduled_date) : '—',
      f.completed_date ? fmtDate(f.completed_date) : '—',
      f.maintenance_type || '—',
      f.completed_by || f.assigned_to || f.reported_by || '—',
      f.cost != null ? `$${Number(f.cost).toFixed(2)}` : '—',
      f.maintenance_category ? f.maintenance_category : '—',
      f.parts_replaced || '—'
    ])
    doc.y = drawTable(doc, ['Sched.', 'Compl.', 'Type', 'By', 'Cost', 'Category', 'Parts Replaced'], rows, cols, M, doc.y)
  }

  doc.moveDown(0.4)
  doc.font('Helvetica-Bold').fontSize(9).fillColor('black').text('Outstanding / Open Repairs (all-time, not resolved)', M, doc.y)
  doc.moveDown(0.3)
  if (!outstandingRepairs.length) {
    emptyNote(doc, M, 'None — no open deficiencies on record.')
  } else {
    const cols = [62, 60, 170, 78, 90]
    const rows = outstandingRepairs.map(f => [fmtDate(f.created_at), FTYPE_LABEL[f.finding_type] || f.finding_type, f.description, f.priority, f.status.replace('_', ' ')])
    doc.y = drawTable(doc, ['Date', 'Type', 'Description', 'Priority', 'Status'], rows, cols, M, doc.y)
  }

  // Footer
  const footerY = doc.page.height - doc.page.margins.bottom + 10
  doc.font('Helvetica').fontSize(8).fillColor('#888888')
    .text(`Generated ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })} ET`, M, footerY, { align: 'right', width: pageW })

  doc.end()
  const pdfBuffer = await pdfPromise

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="apparatus-report-${unit.unit_name}.pdf"`,
      'Access-Control-Allow-Origin': origin
    },
    body: pdfBuffer.toString('base64'),
    isBase64Encoded: true
  }
}
