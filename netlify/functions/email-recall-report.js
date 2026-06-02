const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')
const { buildGroupReport, buildEmailHtml, makeTransport, fromAddr, currentShiftDate, HISTORY_DAYS } = require('./_recall-report-builder')

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
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Officer login required' }) }

  const { group } = JSON.parse(event.body || '{}')
  if (!group || group < 1 || group > 4) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'group must be 1–4' }) }
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const todayShift = currentShiftDate()
  const historyStart = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().split('T')[0]
  const weekOf = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })

  try {
    const reportData = await buildGroupReport(supabase, group, todayShift, historyStart)

    if (!reportData.recipients.length) {
      return { statusCode: 200, headers, body: JSON.stringify({ sent: false, reason: 'No officer emails on file for Tour ' + group }) }
    }

    const html = buildEmailHtml(group, todayShift, HISTORY_DAYS, reportData)
    const transport = makeTransport()
    await transport.sendMail({
      from: fromAddr(),
      to: reportData.recipients.join(', '),
      subject: `Recall Report - Tour ${group} - ${weekOf}`,
      html
    })

    console.log(`[email-recall-report] Tour ${group} sent by ${officer.display_name} to ${reportData.recipients.join(', ')}`)
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ sent: true, group, recipients: reportData.recipients, sent_by: officer.display_name })
    }
  } catch (e) {
    console.error('[email-recall-report] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
