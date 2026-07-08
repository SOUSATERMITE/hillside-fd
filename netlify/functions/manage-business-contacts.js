const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')
const { checkOfficerOrAdmin } = require('./_auth')

const FIELDS = [
  'business_name', 'address', 'premises_phone',
  'owner_name', 'owner_phone',
  'emergency_contact_1_name', 'emergency_contact_1_phone',
  'emergency_contact_2_name', 'emergency_contact_2_phone',
  'emergency_contact_3_name', 'emergency_contact_3_phone'
]

function pickFields(body) {
  const out = {}
  for (const f of FIELDS) {
    if (body[f] !== undefined) out[f] = (body[f] || '').toString().trim() || null
  }
  return out
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

  const officer = await checkOfficerOrAdmin(event)
  if (!officer) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Officer login required' }) }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
  const body = JSON.parse(event.body || '{}')
  const { action } = body

  try {
    if (action === 'add') {
      const fields = pickFields(body)
      if (!fields.business_name) return { statusCode: 400, headers, body: JSON.stringify({ error: 'business_name is required' }) }

      const { data, error } = await supabase.from('business_contacts').insert(fields).select().single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'edit') {
      const { id } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }
      const fields = pickFields(body)
      if (fields.business_name === null) return { statusCode: 400, headers, body: JSON.stringify({ error: 'business_name is required' }) }

      const { data, error } = await supabase
        .from('business_contacts')
        .update({ ...fields, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify(data) }
    }

    if (action === 'delete') {
      const { id } = body
      if (!id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id is required' }) }
      const { error } = await supabase.from('business_contacts').delete().eq('id', id)
      if (error) throw error
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) }
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid action' }) }
  } catch (e) {
    console.error('[manage-business-contacts] error:', e.message)
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Internal server error' }) }
  }
}
