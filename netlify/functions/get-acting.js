const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { checkAdmin } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-admin-password',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }

  const admin = await checkAdmin(event)
  if (!admin) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Admin login required' }) }

  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Lazy cleanup: deactivate expired acting grants
    const now = new Date().toISOString()
    const { data: expired } = await supabase
      .from('acting_captains')
      .select('officer_id')
      .lt('expires_at', now)

    if (expired && expired.length > 0) {
      const expiredIds = expired.map(e => e.officer_id)
      await Promise.all([
        supabase.from('officers').update({ active: false }).in('id', expiredIds),
        supabase.from('sessions').delete().in('officer_id', expiredIds),
        supabase.from('acting_captains').delete().lt('expires_at', now)
      ])
    }

    const { data, error } = await supabase
      .from('officers')
      .select('id, name, display_name, created_at')
      .eq('is_temporary', true)
      .eq('active', true)
      .order('created_at', { ascending: false })

    if (error) throw error

    return { statusCode: 200, headers, body: JSON.stringify(data || []) }
  } catch (e) {
    console.error('[get-acting] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
