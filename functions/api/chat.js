export async function onRequestPost({ request, env }) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
  }

  try {
    const { message, history = [], courses = [] } = await request.json()

    const courseList = courses.length > 0
      ? '\n\nRelevant HKS courses (percentile scores vs all courses; bid_price in points):\n' +
        JSON.stringify(courses, null, 1)
      : ''

    const system = `You are a course advisor for Harvard Kennedy School (HKS). Help students find the right courses.

Metrics are percentiles vs all HKS courses: rating = course quality, workload = amount of work (higher = more), instructor_rating = instructor quality. bid_price = last bidding clearing price in points (higher = more competitive to get in).

Give 2–3 specific recommendations. For each include: course code, name, instructor, and one concise sentence on why it fits. Be direct and practical.${courseList}`

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hks-course-explorer.pages.dev',
        'X-Title': 'HKS Course Explorer',
      },
      body: JSON.stringify({
        model: 'openrouter/free',
        max_tokens: 600,
        messages: [
          { role: 'system', content: system },
          ...history,
          { role: 'user', content: message },
        ],
      }),
    })

    const data = await resp.json()
    if (!resp.ok) {
      return new Response(
        JSON.stringify({ error: data.error?.message || 'OpenRouter error' }),
        { status: 502, headers }
      )
    }

    return new Response(
      JSON.stringify({ reply: data.choices[0].message.content }),
      { headers }
    )
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers })
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
