const ALLOWED = [
  'https://hillside-fd.netlify.app',
  'http://localhost:8888',
  'http://localhost:3000'
]

function allowOrigin(event) {
  const origin = (event.headers && event.headers.origin) || ''
  return ALLOWED.includes(origin) ? origin : ALLOWED[0]
}

module.exports = { allowOrigin }
