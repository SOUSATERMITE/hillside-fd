// Scheduled: Monday 10:00 UTC (6am ET). Sends weekly recall report for each tour.
const { createClient } = require('@supabase/supabase-js')
const { buildGroupReport, buildEmailHtml, makeTransport, fromAddr, currentShiftDate, HISTORY_DAYS } = require('./_recall-report-builder')

exports.handler = async () => {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const transport = makeTransport()
  const from = fromAddr()
  const todayShift = currentShiftDate()
  const historyStart = new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString().split('T')[0]
  const weekOf = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric', year: 'numeric' })
  const results = []

  for (let group = 1; group <= 4; group++) {
    try {
      const reportData = await buildGroupReport(supabase, group, todayShift, historyStart)
      if (!reportData.recipients.length) {
        console.log(`[recall-report] Tour ${group}: no officer emails, skipping`)
        results.push({ group, skipped: true, reason: 'no officer emails' })
        continue
      }
      const html = buildEmailHtml(group, todayShift, HISTORY_DAYS, reportData)
      await transport.sendMail({
        from,
        to: reportData.recipients.join(', '),
        subject: `Weekly Recall Report - Tour ${group} - Week of ${weekOf}`,
        html
      })
      console.log(`[recall-report] Tour ${group}: sent to ${reportData.recipients.join(', ')}`)
      results.push({ group, sent: true, recipients: reportData.recipients })
    } catch (e) {
      console.error(`[recall-report] Tour ${group} error:`, e.message)
      results.push({ group, error: e.message })
    }
  }

  console.log('[recall-report] Done:', JSON.stringify(results))
  return { statusCode: 200, body: JSON.stringify({ results }) }
}
