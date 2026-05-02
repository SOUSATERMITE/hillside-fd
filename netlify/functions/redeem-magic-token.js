const { allowOrigin } = require('./_cors')

// Magic token login removed — officers log in with PIN at /vacation
exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  return {
    statusCode: 410,
    headers,
    body: JSON.stringify({ error: 'Magic link login has been removed. Please log in at hillside-fd.netlify.app/vacation with your PIN.' })
  }
}
