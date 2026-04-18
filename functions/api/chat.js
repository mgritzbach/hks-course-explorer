// Top 3 free models on OpenRouter (April 2026). Update this list if models go offline.
// OpenRouter route:fallback tries each in order — max 3 allowed.
const FREE_MODELS = [
  'google/gemma-4-31b-it:free',
  'minimax/minimax-m2.5:free',
  'openrouter/free',
]

export async function onRequestPost({ request, env }) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
  }

  try {
    const { message, history = [], courses = [], context = {} } = await request.json()
    const shortlisted = Array.isArray(context?.shortlisted) ? context.shortlisted.filter(Boolean) : []

    const courseList = courses.length > 0
      ? '\n\nRelevant HKS courses (percentile scores; bid_price in points):\n' +
        JSON.stringify(courses.slice(0, 15), null, 1)
      : ''

    const shortlistContext = shortlisted.length > 0
      ? `Student has shortlisted: ${shortlisted.join(', ')}. Suggest complementary courses or flag heavy load.\n\n`
      : ''

    const system = `${shortlistContext}You are a concise HKS course advisor. All _pct fields are percentile scores (0–100) vs all HKS courses — NOT hours or raw scores. Higher rating_pct = better rated. Higher workload_pct = heavier workload. bid_price_pts = last bidding clearing price in points.

Give 2–3 specific recommendations. For each: course code, name, instructor, one sentence why it fits. When citing metrics always say e.g. "workload: 68th percentile", never "68 hours". Be brief and direct.${courseList}`

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hks-course-explorer.pages.dev',
        'X-Title': 'HKS Course Explorer',
      },
      body: JSON.stringify({
        models: FREE_MODELS,
        route: 'fallback',
        max_tokens: 350,
        stream: true,
        messages: [
          { role: 'system', content: system },
          ...history.slice(-4),
          { role: 'user', content: message },
        ],
      }),
    })

    if (!resp.ok) {
      const data = await resp.json().catch(() => ({}))
      return new Response(
        JSON.stringify({ error: data.error?.message || `OpenRouter error ${resp.status}` }),
        { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
      )
    }

    // Stream SSE tokens back to the client
    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    ;(async () => {
      const reader = resp.body.getReader()
      let buffer = ''
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop()
          for (const line of lines) {
            if (!line.startsWith('data: ')) continue
            const payload = line.slice(6).trim()
            if (payload === '[DONE]') {
              await writer.write(encoder.encode('data: [DONE]\n\n'))
              return
            }
            try {
              const parsed = JSON.parse(payload)
              const token = parsed.choices?.[0]?.delta?.content
              if (token) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`))
              }
            } catch {}
          }
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        await writer.write(encoder.encode(`data: ${JSON.stringify({ error: err.message })}\n\n`))
      } finally {
        await writer.close()
      }
    })()

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        ...corsHeaders,
      },
    })
  } catch (err) {
    return new Response(
      JSON.stringify({ error: err.message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } }
    )
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  })
}
