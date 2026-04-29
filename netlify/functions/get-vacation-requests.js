const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token, x-admin-password',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const params = event.queryStringParameters || {}

  try {
    // Public: FF checks own requests by firefighter_id
    if (params.firefighter_id) {
      const { data, error } = await supabase
        .from('vacation_requests')
        .select('*')
        .eq('firefighter_id', params.firefighter_id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data || []) }
    }

    // Officers: see all requests for their tour (or all if admin)
    const officer = await verifySession(event)
    if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }

    // Look up officer in firefighters table to get rank + group.
    // Try exact match first, fall back to case-insensitive match so that
    // minor name formatting differences (e.g. "gwidzz" vs "Gwidzz") don't break the lookup.
    let officerFF = null
    const { data: exactMatch } = await supabase
      .from('firefighters')
      .select('rank, group_number, name')
      .eq('name', officer.name)
      .eq('active', true)
      .maybeSingle()

    if (exactMatch) {
      officerFF = exactMatch
    } else {
      const { data: ilikeMatch } = await supabase
        .from('firefighters')
        .select('rank, group_number, name')
        .ilike('name', officer.name)
        .eq('active', true)
        .maybeSingle()
      if (ilikeMatch) officerFF = ilikeMatch
    }

    const rank    = officerFF?.rank || ''
    const isChief = rank === 'Chief' || officer.role === 'admin'

    console.log(`[get-vacation-requests] officer="${officer.name}" display="${officer.display_name}" role="${officer.role}" | ff_match="${officerFF?.name || 'NOT FOUND'}" rank="${rank}" group=${officerFF?.group_number ?? 'null'} isChief=${isChief}`)

    let query = supabase
      .from('vacation_requests')
      .select('*')
      .order('created_at', { ascending: false })

    // Status filter
    if (params.status && params.status !== 'all') {
      query = query.eq('status', params.status)
    }

    // Non-admin, non-Chief officers: filter to own tour
    if (officer.role !== 'admin' && !isChief && officerFF?.group_number) {
      query = query.eq('ff_group', officerFF.group_number)
    }

    const { data, error } = await query
    if (error) throw error

    console.log(`[get-vacation-requests] returning ${(data || []).length} requests, officerRank="${rank}"`)

    // Return requests + officer's rank so client can compute canAct per-request
    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        requests: data || [],
        officerRank: rank,
        // Debug fields — client logs these, never shown in UI
        _debug: { officerName: officer.name, ffMatch: officerFF?.name || null, rank, group: officerFF?.group_number ?? null }
      })
    }
  } catch (e) {
    console.error('[get-vacation-requests] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
