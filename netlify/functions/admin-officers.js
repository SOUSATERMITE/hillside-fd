const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { checkAdmin } = require('./_auth')
const crypto = require('crypto')

function hashPin(pin) {
  return crypto.createHash('sha256').update(String(pin)).digest('hex')
}

function randomPin() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-admin-password',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const admin = await checkAdmin(event)
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Admin login required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  try {
    // GET — list all permanent officer logins
    if (event.httpMethod === 'GET') {
      const { data, error } = await supabase
        .from('officers')
        .select('id, name, display_name, role, active, must_change_pin, created_at')
        .eq('is_temporary', false)
        .order('name')
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data || []) }
    }

    // POST — create a new permanent officer login
    if (event.httpMethod === 'POST') {
      const { firefighter_id, role } = JSON.parse(event.body || '{}')
      if (!firefighter_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'firefighter_id is required' }) }

      const { data: ff } = await supabase
        .from('firefighters')
        .select('id, name')
        .eq('id', firefighter_id)
        .eq('active', true)
        .single()
      if (!ff) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Firefighter not found' }) }

      // Block if permanent login already exists for this name
      const { data: existing } = await supabase
        .from('officers')
        .select('id')
        .eq('name', ff.name)
        .eq('is_temporary', false)
        .maybeSingle()
      if (existing) return { statusCode: 409, headers, body: JSON.stringify({ error: `${ff.name} already has a permanent officer login.` }) }

      const pin = randomPin()
      const officerRole = (role === 'admin') ? 'admin' : 'officer'
      const { data: newOfficer, error: insertErr } = await supabase
        .from('officers')
        .insert({
          name: ff.name,
          display_name: ff.name,
          role: officerRole,
          pin_hash: hashPin(pin),
          must_change_pin: true,
          is_temporary: false,
          active: true
        })
        .select()
        .single()
      if (insertErr) throw insertErr

      console.log(`[admin-officers] Created permanent login for ${ff.name} (role: ${officerRole}) by ${admin.display_name || 'admin'}`)
      return { statusCode: 200, headers, body: JSON.stringify({ name: ff.name, temp_pin: pin }) }
    }

    // PUT — reset an officer's PIN
    if (event.httpMethod === 'PUT') {
      const { id } = JSON.parse(event.body || '{}')
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }

      const pin = randomPin()
      const { data: updated, error: updateErr } = await supabase
        .from('officers')
        .update({ pin_hash: hashPin(pin), must_change_pin: true })
        .eq('id', id)
        .eq('is_temporary', false)
        .select('name')
        .single()
      if (updateErr) throw updateErr

      // Invalidate any live sessions
      await supabase.from('sessions').delete().eq('officer_id', id)

      console.log(`[admin-officers] Reset PIN for ${updated.name} by ${admin.display_name || 'admin'}`)
      return { statusCode: 200, headers, body: JSON.stringify({ name: updated.name, temp_pin: pin }) }
    }

    // DELETE — deactivate an officer login
    if (event.httpMethod === 'DELETE') {
      const { id } = JSON.parse(event.body || '{}')
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }

      const { data: updated, error: updateErr } = await supabase
        .from('officers')
        .update({ active: false })
        .eq('id', id)
        .eq('is_temporary', false)
        .select('name')
        .single()
      if (updateErr) throw updateErr

      await supabase.from('sessions').delete().eq('officer_id', id)

      console.log(`[admin-officers] Deactivated login for ${updated.name} by ${admin.display_name || 'admin'}`)
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  } catch (e) {
    console.error('[admin-officers] error:', e.message)
    console.error('[admin-officers] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
