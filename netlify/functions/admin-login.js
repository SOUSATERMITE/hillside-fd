const { allowOrigin } = require('./_cors')

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type, x-admin-password',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' }
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }
  }

  const provided = (event.headers && event.headers['x-admin-password']) || ''
  const expected = process.env.ADMIN_PASSWORD || ''

  if (!expected) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'ADMIN_PASSWORD not configured' }) }
  }

  if (provided !== expected) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Incorrect password' }) }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) }
}
