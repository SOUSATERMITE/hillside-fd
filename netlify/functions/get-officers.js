const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Lazy cleanup: deactivate any temp officers whose acting grant has expired
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
      .select('name, display_name, role, is_temporary')
      .eq('active', true)
      .order('name', { ascending: true })

    if (error) throw error

    // Deduplicate by name — keep highest rank (admin > officer > firefighter)
    const RANK = { admin: 0, officer: 1, firefighter: 2 }
    const seen = {}
    for (const o of (data || [])) {
      const key = o.name.toLowerCase().trim()
      if (!seen[key] || (RANK[o.role] ?? 3) < (RANK[seen[key].role] ?? 3)) {
        seen[key] = o
      }
    }
    const deduped = Object.values(seen)
    deduped.sort((a, b) => {
      // Temporary (acting) always last
      if (a.is_temporary !== b.is_temporary) return a.is_temporary ? 1 : -1
      // Then by rank
      const rd = (RANK[a.role] ?? 3) - (RANK[b.role] ?? 3)
      if (rd !== 0) return rd
      // Then alphabetically
      return a.display_name.localeCompare(b.display_name)
    })

    return { statusCode: 200, headers, body: JSON.stringify(deduped) }
  } catch (e) {
    console.error('[get-officers] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
