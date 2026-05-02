const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { verifySession } = require('./_auth')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-session-token',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'GET') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  const officer = await verifySession(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Login required' }) }
  if (officer.role !== 'admin') return { statusCode: 403, headers, body: JSON.stringify({ error: 'DC or admin access required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

  // Fetch all active firefighters sorted by group then name
  const { data: firefighters, error } = await supabase
    .from('firefighters')
    .select('id, name, rank, badge_number, group_number, email, active')
    .eq('active', true)
    .order('group_number', { ascending: true })
    .order('name', { ascending: true })

  if (error) return { statusCode: 500, headers, body: JSON.stringify({ error: error.message }) }

  // YTD sick summary (call count only — fast)
  const yearStart = `${new Date().getFullYear()}-01-01`
  const { data: sickYTD } = await supabase
    .from('sick_log')
    .select('firefighter_id, marked_sick_date, cleared_date')
    .gte('marked_sick_date', yearStart)
    .eq('deleted', false)

  // YTD recall summary (count + hours)
  const { data: recallYTD } = await supabase
    .from('recall_log')
    .select('firefighter_id, hours_worked')
    .gte('shift_date', yearStart)
    .in('recall_type', ['full_shift', 'short_min', 'substitution'])
    .eq('deleted', false)

  // Build per-FF maps
  const sickMap = {}
  for (const s of (sickYTD || [])) {
    if (!sickMap[s.firefighter_id]) sickMap[s.firefighter_id] = { count: 0, last: null }
    sickMap[s.firefighter_id].count++
    if (!sickMap[s.firefighter_id].last || s.marked_sick_date > sickMap[s.firefighter_id].last) {
      sickMap[s.firefighter_id].last = s.marked_sick_date
    }
  }
  const recallMap = {}
  for (const r of (recallYTD || [])) {
    if (!recallMap[r.firefighter_id]) recallMap[r.firefighter_id] = { count: 0, hours: 0 }
    recallMap[r.firefighter_id].count++
    recallMap[r.firefighter_id].hours += (r.hours_worked || 0)
  }

  const result = (firefighters || []).map(ff => ({
    ...ff,
    ytd_sick_calls:  sickMap[ff.id]?.count  || 0,
    last_sick_date:  sickMap[ff.id]?.last   || null,
    ytd_recalls:     recallMap[ff.id]?.count || 0,
    ytd_ot_hours:    recallMap[ff.id]?.hours || 0
  }))

  return { statusCode: 200, headers, body: JSON.stringify({ firefighters: result }) }
}
