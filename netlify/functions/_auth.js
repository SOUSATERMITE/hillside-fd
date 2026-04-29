const { createClient } = require('@supabase/supabase-js')

async function verifySession(event) {
  const token = (event.headers && (event.headers['x-session-token'] || event.headers['X-Session-Token'])) || ''
  if (!token) return null

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  const { data, error } = await supabase
    .from('sessions')
    .select('*, officers(id, name, display_name, role, active)')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (error || !data || !data.officers || !data.officers.active) return null

  return {
    session_id: data.id,
    officer_id: data.officers.id,
    name: data.officers.name,
    display_name: data.officers.display_name,
    role: data.officers.role
  }
}

// Check session OR legacy admin password
async function checkAdmin(event) {
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const officer = await verifySession(event)
  if (officer && officer.role === 'admin') return officer

  // Legacy admin password fallback
  const provided = (event.headers && event.headers['x-admin-password']) || ''
  const expected = process.env.ADMIN_PASSWORD || ''
  if (provided && expected && provided === expected) {
    return { officer_id: null, display_name: 'Admin', role: 'admin', name: 'Admin' }
  }
  return null
}

// Find an officer's firefighter record by name, trying progressively looser matches.
// Returns { rank, group_number, name } or null.
async function findOfficerInFirefighters(supabase, officer) {
  async function attempt(pattern) {
    const { data } = await supabase
      .from('firefighters')
      .select('rank, group_number, name')
      .ilike('name', pattern)
      .eq('active', true)
      .limit(1)
    return data?.[0] || null
  }

  // 1. Exact case-insensitive
  let ff = await attempt(officer.name)
  // 2. Wildcard: FF name contains officer.name  e.g. "Gwidzz" inside "John Gwidzz"
  if (!ff) ff = await attempt(`%${officer.name}%`)
  // 3. Wildcard on display_name
  if (!ff && officer.display_name) ff = await attempt(`%${officer.display_name}%`)
  // 4. Last-word (last name) fallback
  if (!ff) {
    const src = (officer.display_name || officer.name).trim()
    const last = src.split(/[\s,\.]+/).filter(Boolean).pop()
    if (last && last.length > 2) ff = await attempt(`%${last}%`)
  }
  return ff
}

module.exports = { verifySession, checkAdmin, findOfficerInFirefighters }
