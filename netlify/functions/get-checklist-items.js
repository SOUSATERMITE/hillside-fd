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

  const { type, apparatus } = event.queryStringParameters || {}
  if (!type || !apparatus) return { statusCode: 400, headers, body: JSON.stringify({ error: 'type and apparatus required' }) }

  try {
    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    if (type === 'weekly') {
      // Items where apparatus_ids contains this unit OR apparatus_ids is empty (applies to all)
      const { data, error } = await supabase
        .from('weekly_check_items')
        .select('id, name, category, apparatus_ids, priority_if_failed, sort_order')
        .eq('active', true)
        .or(`apparatus_ids.cs.["${apparatus}"],apparatus_ids.eq.[]`)
        .order('category')
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data || []) }
    }

    if (type === 'daily') {
      // Items where applies_to contains this unit OR applies_to contains 'all'
      const { data, error } = await supabase
        .from('daily_check_items')
        .select('id, name, item_type, applies_to, sort_order')
        .eq('active', true)
        .or(`applies_to.cs.["${apparatus}"],applies_to.cs.["all"]`)
        .order('sort_order')
        .order('created_at')
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data || []) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'type must be weekly or daily' }) }
  } catch (e) {
    console.error('[get-checklist-items]', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message || 'Internal server error' }) }
  }
}
