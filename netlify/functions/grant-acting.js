const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { checkAdmin } = require('./_auth')
const crypto = require('crypto')

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex')
}

function getShiftExpiry() {
  // Same logic as officer-login — expires at 0730 ET next morning
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
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-admin-password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const admin = await checkAdmin(event)
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Admin login required' }) }

  try {
    const { firefighter_id } = JSON.parse(event.body || '{}')
    if (!firefighter_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'firefighter_id is required' }) }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Get the firefighter
    const { data: ff, error: ffError } = await supabase
      .from('firefighters')
      .select('id, name')
      .eq('id', firefighter_id)
      .single()

    if (ffError || !ff) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Firefighter not found' }) }

    // Block only if a permanent (non-temp) officer already has this name
    const { data: existingPerm } = await supabase
      .from('officers')
      .select('id')
      .eq('name', ff.name)
      .eq('active', true)
      .eq('is_temporary', false)
      .maybeSingle()

    if (existingPerm) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: `${ff.name} already has an officer account. They can log in directly.` }) }
    }

    // Expire any previous acting grant for this FF
    await supabase
      .from('acting_captains')
      .delete()
      .eq('firefighter_id', firefighter_id)

    // Generate 4-digit PIN
    const pin = String(Math.floor(1000 + Math.random() * 9000))
    const pinHash = hashPin(pin)
    const expiresAt = getShiftExpiry()

    const grantedByName = admin.display_name || 'Admin'

    // Check for any existing temp officer with this name (active or inactive)
    // If found, update in place to avoid hitting the unique constraint on name
    const { data: existingTemp } = await supabase
      .from('officers')
      .select('id')
      .eq('name', ff.name)
      .eq('is_temporary', true)
      .maybeSingle()

    let tempOfficer, officerError
    if (existingTemp) {
      // Expire any live sessions for the old temp record
      await supabase.from('sessions').delete().eq('officer_id', existingTemp.id)
      // Refresh the existing record with new credentials
      const result = await supabase
        .from('officers')
        .update({
          display_name: `Acting: ${ff.name} (${grantedByName})`,
          pin_hash: pinHash,
          must_change_pin: false,
          active: true
        })
        .eq('id', existingTemp.id)
        .select()
        .single()
      tempOfficer = result.data
      officerError = result.error
    } else {
      // No prior record — insert fresh
      const result = await supabase
        .from('officers')
        .insert({
          name: ff.name,
          display_name: `Acting: ${ff.name} (${grantedByName})`,
          role: 'officer',
          pin_hash: pinHash,
          must_change_pin: false,
          is_temporary: true,
          active: true
        })
        .select()
        .single()
      tempOfficer = result.data
      officerError = result.error
    }

    if (officerError) throw officerError

    // Create acting_captains record
    const grantedById = admin.officer_id || tempOfficer.id
    const { error: actingError } = await supabase
      .from('acting_captains')
      .insert({
        firefighter_id: ff.id,
        officer_id: tempOfficer.id,
        granted_by_officer_id: grantedById,
        expires_at: expiresAt
      })

    if (actingError) throw actingError

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        name: ff.name,
        temp_pin: pin,
        display_name: tempOfficer.display_name,
        expires_at: expiresAt
      })
    }
  } catch (e) {
    console.error('[grant-acting] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
