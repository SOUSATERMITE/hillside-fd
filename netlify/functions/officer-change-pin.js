const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')
const crypto = require('crypto')

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex')
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

  try {
    const officer = await verifySession(event)
    if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

    const { new_pin } = JSON.parse(event.body || '{}')
    if (!new_pin || String(new_pin).length < 4) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'PIN must be at least 4 digits' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    const { error } = await supabase
      .from('officers')
      .update({ pin_hash: hashPin(new_pin), must_change_pin: false })
      .eq('id', officer.officer_id)

    if (error) throw error

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
  } catch (e) {
    console.error('[officer-change-pin] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
