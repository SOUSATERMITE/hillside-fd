const { createClient } = require('@supabase/supabase-js')
const { allowOrigin } = require('./_cors')

const SYSTEM_PROMPT = `You are a helpful assistant for Hillside Fire Department. Answer questions ONLY based on the provided documents. Always cite which document and section your answer comes from. Be concise and clear. If the answer is not in the documents, say exactly: "I couldn't find that in the uploaded documents. Please contact your officer directly."`

exports.handler = async (event) => {
  const origin = allowOrigin(event)
  const headers = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  }

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' }
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) }

  try {
    const { question, history } = JSON.parse(event.body || '{}')
    if (!question || !question.trim()) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'question is required' }) }
    }

    const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

    // Fetch all documents that have content_text, plus titles/descriptions of all docs
    const { data: docs, error: dbError } = await supabase
      .from('fd_documents')
      .select('title, category, description, content_text')
      .eq('active', true)
      .order('category', { ascending: true })

    if (dbError) throw dbError

    // Build document context
    const docContext = (docs || []).map(d => {
      let block = `[Document: ${d.title} | Category: ${d.category}]`
      if (d.description) block += `\nDescription: ${d.description}`
      if (d.content_text) block += `\nContent:\n${d.content_text.slice(0, 6000)}`
      return block
    }).join('\n\n---\n\n')

    const contextMessage = docContext
      ? `Here are the Hillside FD documents:\n\n${docContext}\n\n---\n\nUser question: ${question.trim()}`
      : `No documents have been uploaded yet.\n\nUser question: ${question.trim()}`

    // Build messages array — include prior turns for context
    const messages = []
    if (Array.isArray(history)) {
      for (const turn of history.slice(-8)) { // keep last 8 turns
        if (turn.role && turn.content) messages.push({ role: turn.role, content: turn.content })
      }
    }
    messages.push({ role: 'user', content: contextMessage })

    // Call Anthropic API
    const apiRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages
      })
    })

    if (!apiRes.ok) {
      const err = await apiRes.json().catch(() => ({}))
      throw new Error(err.error?.message || `Anthropic API error ${apiRes.status}`)
    }

    const aiData = await apiRes.json()
    const answer = aiData.content?.[0]?.text || 'No response received.'

    return { statusCode: 200, headers, body: JSON.stringify({ answer }) }
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) }
  }
}
