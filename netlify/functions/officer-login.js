const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const crypto = require('crypto')

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex')
}

function getSessionExpiry() {
  // Returns ISO string for 0730 ET the following morning (or today if before 0730)
  const now = new Date()
  const etNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }))
  const utcOffset = now - etNow // ms difference between UTC and ET representation

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', hour12: false
  }).formatToParts(now)

  const get = t => parseInt(parts.find(p => p.type === t).value)
  const year = get('year'), month = get('month'), day = get('day')
  const hour = get('hour'), minute = get('minute')

  // If already past 07:30 ET, target is next day; otherwise today
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
    const { name, pin } = JSON.parse(event.body || '{}')
    if (!name || !pin) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'name and pin are required' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    const pinHash = hashPin(pin)

    const { data: officer, error: officerError } = await supabase
      .from('officers')
      .select('*')
      .eq('name', name)
      .eq('active', true)
      .maybeSingle()

    if (officerError) throw officerError
    if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Name not found or incorrect PIN.' }) }
    if (officer.pin_hash !== pinHash) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Incorrect PIN.' }) }

    // Create session
    const token = crypto.randomUUID()
    const expiresAt = getSessionExpiry()

    const { error: sessionError } = await supabase
      .from('sessions')
      .insert({ officer_id: officer.id, token, expires_at: expiresAt })

    if (sessionError) throw sessionError

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        token,
        officer_id: officer.id,
        display_name: officer.display_name,
        role: officer.role,
        is_acting: officer.is_temporary,
        expires_at: expiresAt,
        must_change_pin: officer.must_change_pin
      })
    }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
