const nodemailer = require('nodemailer')
const { allowOrigin } = require('./_cors')
const { checkAdmin } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password, x-session-token',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const admin = await checkAdmin(event)
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) }

  const smtpUser = process.env.ZOHO_SMTP_USER
  const smtpPass = process.env.ZOHO_SMTP_PASS

  if (!smtpUser || !smtpPass) {
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        error: 'SMTP env vars not set',
        ZOHO_SMTP_USER: smtpUser ? 'set' : 'MISSING',
        ZOHO_SMTP_PASS: smtpPass ? 'set' : 'MISSING'
      })
    }
  }

  const recipients = ['sousa@sousapest.com', 'fsousa@hillsidefire.org']
  const timestamp  = new Date().toISOString()
  const results    = []

  for (const to of recipients) {
    console.log(`[SMTP TEST] Attempting → to: ${to}`)
    try {
      const transport = nodemailer.createTransport({
        host: 'smtp.zoho.com', port: 465, secure: true,
        auth: { user: smtpUser, pass: smtpPass }
      })
      const result = await transport.sendMail({
        from: `"Hillside Fire Department" <${smtpUser}>`,
        replyTo: 'noreply@hillsidefire.org',
        to,
        subject: 'TEST — Hillside FD SMTP Connection Test',
        text: `This is a test email from hillside-fd.netlify.app to verify the Zoho SMTP connection is working.\n\nFrom address: ${smtpUser}\nTimestamp: ${timestamp}`,
        html: `<div style="font-family:Arial,sans-serif;padding:20px;">
          <h2 style="color:#b91c1c;">Hillside FD — SMTP Test</h2>
          <p>This is a test email verifying the Zoho SMTP connection is working.</p>
          <p><strong>From:</strong> ${smtpUser}<br><strong>Timestamp:</strong> ${timestamp}</p>
          <p style="color:#15803d;font-weight:bold;">✓ If you received this, SMTP is working correctly.</p>
        </div>`
      })
      console.log(`[SMTP TEST] OK → to: ${to} | messageId: ${result.messageId}`)
      results.push({ to, ok: true, messageId: result.messageId })
    } catch (e) {
      console.error(`[SMTP TEST] FAILED → to: ${to} | error: ${e.message}`)
      results.push({ to, ok: false, error: e.message })
    }
  }

  const allOk = results.every(r => r.ok)
  return {
    statusCode: 200, headers,
    body: JSON.stringify({
      allOk,
      smtpConfigured: true,
      timestamp,
      results
    })
  }
}
