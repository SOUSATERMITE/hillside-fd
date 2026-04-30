const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const crypto = require('crypto')

// Session expires at 0730 ET next morning (matches officer-login.js)
function getSessionExpiry() {
  const now = new Date()
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const utcOffset = now - etNow

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false
  }).formatToParts(now)

  const get = t => parseInt(parts.find(p => p.type === t).value)
  const year = get('year'), month = get('month'), day = get('day')
  const hour = get('hour'), minute = get('minute')

  let targetDay = day
  if (hour > 7 || (hour === 7 && minute >= 30)) targetDay++

  const etExpiry = new Date(year, month - 1, targetDay, 7, 30, 0, 0)
  return new Date(etExpiry.getTime() + utcOffset).toISOString()
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { token } = JSON.parse(event.body || '{}')
    if (!token) return { statusCode: 400, headers, body: JSON.stringify({ error: 'token required' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Look up the magic token — must be unused and not expired
    const { data: mt, error: mtErr } = await supabase
      .from('magic_tokens')
      .select('id, officer_id, officers(id, name, display_name, role, active, must_change_pin, is_temporary)')
      .eq('token', token)
      .eq('used', false)
      .gt('expires_at', new Date().toISOString())
      .maybeSingle()

    if (mtErr) throw mtErr
    if (!mt) {
      console.log(`[redeem-magic-token] Invalid or expired token: ${token.slice(0, 8)}...`)
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'This link has expired or already been used. Please log in with your PIN.' }) }
    }

    const officer = mt.officers
    if (!officer || !officer.active) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Officer account not active.' }) }
    }

    // Mark token as used immediately (single-use)
    await supabase.from('magic_tokens').update({ used: true }).eq('id', mt.id)

    // Create a real session
    const sessionToken = crypto.randomUUID()
    const expiresAt = getSessionExpiry()

    const { error: sessionErr } = await supabase
      .from('sessions')
      .insert({ officer_id: mt.officer_id, token: sessionToken, expires_at: expiresAt })
    if (sessionErr) throw sessionErr

    console.log(`[redeem-magic-token] Session created for ${officer.display_name} (${officer.role})`)

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        token: sessionToken,
        officer_id: officer.id,
        display_name: officer.display_name,
        role: officer.role,
        is_acting: officer.is_temporary,
        expires_at: expiresAt,
        must_change_pin: false  // Never force PIN change on email link login
      })
    }
  } catch (e) {
    console.error('[redeem-magic-token] Error:', e.message)
    console.error('[redeem-magic-token] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
