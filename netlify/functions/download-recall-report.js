const { createClient } = require('@supabase/supabase-js')
const PDFDocument = require('pdfkit')
const { allowOrigin } = require('./_cors')

const SHIFT_ANCHOR = new Date('2026-04-30T11:30:00Z')

function currentShiftDate() {
  const shifts = Math.floor((Date.now() - SHIFT_ANCHOR.getTime()) / 86400000)
  return new Date(SHIFT_ANCHOR.getTime() + shifts * 86400000).toISOString().split('T')[0]
}

function fmtDateShort(iso) {
  if (!iso) return '—'
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtTime(t) {
  if (!t || t.length < 4) return t || ''
  const h = parseInt(t.slice(0, 2), 10)
  return `${h % 12 || 12}:${t.slice(2, 4)} ${h >= 12 ? 'PM' : 'AM'}`
}

function recallLabel(t) {
  return { full_shift: 'Full Shift', short_min: 'Short Min', refused: 'Refused', vacation_skip: 'Vac. Skip', substitution: 'Substitution', refused_no_penalty: 'Refused (no pen.)' }[t] || (t || '')
}

// Draw a simple table on the PDF document
function drawTable(doc, headers, rows, colWidths, x, y, rowHeight = 18) {
  const tableWidth = colWidths.reduce((a, b) => a + b, 0)

  // Header row
  doc.fontSize(9).font('Helvetica-Bold')
  doc.rect(x, y, tableWidth, rowHeight).fill('#e8e8e8')
  doc.fillColor('black')
  let cx = x
  for (let i = 0; i < headers.length; i++) {
    doc.text(headers[i], cx + 3, y + 4, { width: colWidths[i] - 6, lineBreak: false, ellipsis: true })
    cx += colWidths[i]
  }
  y += rowHeight

  // Data rows
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

  // Outer border
  doc.rect(x, y - rows.length * rowHeight - rowHeight, tableWidth, rows.length * rowHeight + rowHeight)
    .lineWidth(0.5).strokeColor('#888888').stroke()

  return y + 6
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': origin }, body: '' }
  }

  const params = event.queryStringParameters || {}
  const group = parseInt(params.group, 10)
  if (!group || group < 1 || group > 4) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ error: 'group must be 1–4' }) }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const todayShift = currentShiftDate()
  const historyStart = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0]

  // Fetch all data
  const ffRes = await supabase.from('firefighters')
    .select('id, name, rank, group_number, badge_number, phone')
    .eq('group_number', group).eq('active', true)
  if (ffRes.error) return { statusCode: 500, body: ffRes.error.message }

  const ffIds = ffRes.data.map(f => f.id)
  const safeIds = ffIds.length ? ffIds : ['00000000-0000-0000-0000-000000000000']
  const ffById = {}
  for (const f of ffRes.data) ffById[f.id] = f

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

  if (rlRes.error) return { statusCode: 500, body: rlRes.error.message }
  if (sickRes.error) return { statusCode: 500, body: sickRes.error.message }

  const sickMap = {}
  for (const s of sickRes.data) sickMap[s.firefighter_id] = s
  const todayMap = {}
  for (const r of (todayRes.data || [])) todayMap[r.firefighter_id] = r

  const refIds = [...new Set((histRes.data || []).filter(r => r.refused_ff_id).map(r => r.refused_ff_id))]
  const refNames = {}
  if (refIds.length) {
    const { data: rd } = await supabase.from('firefighters').select('id, name').in('id', refIds)
    if (rd) for (const f of rd) refNames[f.id] = f.name
  }

  // Build PDF
  const doc = new PDFDocument({ margin: 54, size: 'LETTER', info: { Title: `Recall Report - Tour ${group}` } })
  const chunks = []
  doc.on('data', c => chunks.push(c))

  const pdfPromise = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))))

  const pageW = doc.page.width - 108  // usable width (letter 612 - 2×54 margins)
  const M = 54  // left margin
  const dateStr = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // ── Header ──────────────────────────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(18).fillColor('black')
    .text('HILLSIDE FIRE DEPARTMENT', M, 54, { align: 'center', width: pageW })
  doc.fontSize(13).text(`Weekly Recall Report — Tour ${group}`, { align: 'center', width: pageW })
  doc.fontSize(9).font('Helvetica').fillColor('#444444')
    .text(dateStr, { align: 'center', width: pageW })
  doc.moveDown(0.3)
  doc.moveTo(M, doc.y).lineTo(M + pageW, doc.y).lineWidth(1.5).strokeColor('black').stroke()
  doc.moveDown(0.6)

  // ── Section 1 — Recall Order ─────────────────────────────────────────────
  doc.font('Helvetica-Bold').fontSize(11).fillColor('black')
    .text('SECTION 1 — CURRENT RECALL ORDER', M, doc.y)
  doc.moveTo(M, doc.y + 2).lineTo(M + pageW, doc.y + 2).lineWidth(0.8).strokeColor('black').stroke()
  doc.moveDown(0.5)

  for (const [label, rankFilter] of [['Captains', 'Captain'], ['Firefighters', 'FF']]) {
    const rows = rlRes.data.filter(e => e.rank_type === rankFilter)
    if (!rows.length) continue
    doc.font('Helvetica-Bold').fontSize(9).text(label, M, doc.y)
    doc.moveDown(0.2)

    const cols = [28, 110, 55, 50, 90, 125]  // #, Name, Rank, Badge, Phone, Status
    const hdrs = ['#', 'Name', 'Rank', 'Badge', 'Phone', 'Status']
    const tableRows = rows.map(r => {
      const ff = r.firefighters || {}
      const sick = sickMap[r.firefighter_id]
      const recalled = todayMap[r.firefighter_id]
      const status = [
        sick ? `SICK (since ${fmtDateShort(sick.marked_sick_date?.split('T')[0])})` : '',
        recalled ? `Recalled (${recallLabel(recalled.recall_type)})` : ''
      ].filter(Boolean).join(' / ') || '—'
      return [r.list_position, ff.name || '', ff.rank || r.rank_type, ff.badge_number || '—', ff.phone || '—', status]
    })

    const y = doc.y
    const newY = drawTable(doc, hdrs, tableRows, cols, M, y)
    doc.y = newY
    doc.moveDown(0.4)
  }

  // ── Section 2 — Recall History ───────────────────────────────────────────
  if (doc.y > doc.page.height - doc.page.margins.bottom - 120) doc.addPage()
  doc.moveDown(0.3)
  doc.font('Helvetica-Bold').fontSize(11).fillColor('black')
    .text('SECTION 2 — RECALL HISTORY (Last 7 Days)', M, doc.y)
  doc.moveTo(M, doc.y + 2).lineTo(M + pageW, doc.y + 2).lineWidth(0.8).strokeColor('black').stroke()
  doc.moveDown(0.5)

  const histData = histRes.data || []
  if (!histData.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#666666').text('No recalls recorded in the last 7 days.', M, doc.y)
    doc.moveDown(0.5)
  } else {
    const cols2 = [68, 90, 72, 90, 62, 76]  // Date, Member, Type, Covered For, Notified, Officer
    const hdrs2 = ['Date', 'Member', 'Type', 'Covered For', 'Notified', 'Officer']
    const rows2 = histData.map(r => {
      const ff = ffById[r.firefighter_id] || {}
      return [
        fmtDateShort(r.shift_date),
        `${ff.name || ''} (${ff.rank || ''})`,
        recallLabel(r.recall_type),
        r.refused_ff_id ? (refNames[r.refused_ff_id] || 'Unknown') : '—',
        r.recall_start_time ? fmtTime(r.recall_start_time) : '—',
        r.recorded_by || '—'
      ]
    })
    const newY2 = drawTable(doc, hdrs2, rows2, cols2, M, doc.y)
    doc.y = newY2
  }

  // ── Section 3 — Sick List ────────────────────────────────────────────────
  if (doc.y > doc.page.height - doc.page.margins.bottom - 100) doc.addPage()
  doc.moveDown(0.3)
  doc.font('Helvetica-Bold').fontSize(11).fillColor('black')
    .text(`SECTION 3 — CURRENT SICK LIST (Tour ${group})`, M, doc.y)
  doc.moveTo(M, doc.y + 2).lineTo(M + pageW, doc.y + 2).lineWidth(0.8).strokeColor('black').stroke()
  doc.moveDown(0.5)

  const sickList = sickRes.data || []
  if (!sickList.length) {
    doc.font('Helvetica').fontSize(9).fillColor('#666666').text('No members currently on sick leave.', M, doc.y)
  } else {
    const cols3 = [100, 60, 100, 55, 143]  // Name, Rank, Date Started, Days Out, Notes
    const hdrs3 = ['Name', 'Rank', 'Date Started', 'Days Out', 'Notes']
    const rows3 = sickList
      .sort((a, b) => new Date(a.marked_sick_date) - new Date(b.marked_sick_date))
      .map(s => {
        const ff = ffById[s.firefighter_id] || {}
        const daysOut = Math.floor((Date.now() - new Date(s.marked_sick_date).getTime()) / 86400000)
        return [ff.name || '', ff.rank || '', fmtDateShort(s.marked_sick_date?.split('T')[0]), `${daysOut} day${daysOut === 1 ? '' : 's'}`, s.notes || '—']
      })
    drawTable(doc, hdrs3, rows3, cols3, M, doc.y)
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
      'Content-Disposition': `attachment; filename="recall-report-tour-${group}.pdf"`,
      'Access-Control-Allow-Origin': origin
    },
    body: pdfBuffer.toString('base64'),
    isBase64Encoded: true
  }
}
