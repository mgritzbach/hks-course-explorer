// Streams HKS course-advisor responses from OpenRouter as Server-Sent Events.
// Request limits are deliberately enforced before an upstream request so this
// public endpoint cannot turn oversized or malformed client input into provider
// spend, latency, or an oversized prompt.
import { corsHeaders, handleOptions } from '../_shared/cors.js'

// Top 3 free models on OpenRouter (April 2026). Update this list if models go offline.
// OpenRouter route:fallback tries each in order — max 3 allowed.
const FREE_MODELS = ['google/gemma-4-31b-it:free', 'minimax/minimax-m2.5:free', 'openrouter/free']

const MAX_REQUEST_BYTES = 64 * 1024
const MAX_MESSAGE_CHARS = 4_000
const MAX_HISTORY_ITEMS = 4
const MAX_HISTORY_MESSAGE_CHARS = 4_000
const MAX_COURSES = 30
const MAX_SHORTLISTED_COURSES = 30
const MAX_SHORTLISTED_NAME_CHARS = 200
const UPSTREAM_TIMEOUT_MS = 20_000
const UPSTREAM_STREAM_IDLE_TIMEOUT_MS = 15_000

const COURSE_STRING_FIELDS = new Set([
  'code',
  'name',
  'instructor',
  'concentration',
  'term',
  'stem',
])
const COURSE_NUMBER_FIELDS = new Set([
  'rating_pct',
  'workload_pct',
  'instructor_pct',
  'bid_price_pts',
])

class RequestValidationError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'RequestValidationError'
    this.status = status
  }
}

class UpstreamError extends Error {
  constructor(message, status = 502) {
    super(message)
    this.name = 'UpstreamError'
    this.status = status
  }
}

function jsonResponse(body, status, request) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) },
  })
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function boundedString(value, field, maxLength, { allowEmpty = false } = {}) {
  if (typeof value !== 'string') {
    throw new RequestValidationError(`${field} must be a string`)
  }
  const trimmed = value.trim()
  if (!allowEmpty && !trimmed) {
    throw new RequestValidationError(`${field} must not be empty`)
  }
  if (trimmed.length > maxLength) {
    throw new RequestValidationError(`${field} must not exceed ${maxLength} characters`, 413)
  }
  return trimmed
}

async function readJsonBody(request) {
  const contentLength = request.headers.get('Content-Length')
  if (contentLength && Number(contentLength) > MAX_REQUEST_BYTES) {
    throw new RequestValidationError('Request body is too large', 413)
  }

  if (!request.body) {
    throw new RequestValidationError('Request body is required')
  }

  const reader = request.body.getReader()
  const chunks = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_REQUEST_BYTES) {
        await reader.cancel('Request body exceeded maximum size')
        throw new RequestValidationError('Request body is too large', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  } catch {
    throw new RequestValidationError('Request body must contain valid JSON')
  }
}

function sanitiseHistory(history) {
  if (history === undefined) return []
  if (!Array.isArray(history)) {
    throw new RequestValidationError('history must be an array')
  }
  if (history.length > MAX_HISTORY_ITEMS) {
    throw new RequestValidationError(
      `history must contain at most ${MAX_HISTORY_ITEMS} messages`,
      413,
    )
  }

  return history.map((entry, index) => {
    if (!isPlainObject(entry)) {
      throw new RequestValidationError(`history[${index}] must be an object`)
    }
    if (entry.role !== 'user' && entry.role !== 'assistant') {
      throw new RequestValidationError(`history[${index}].role must be user or assistant`)
    }
    return {
      role: entry.role,
      content: boundedString(entry.content, `history[${index}].content`, MAX_HISTORY_MESSAGE_CHARS),
    }
  })
}

function sanitiseCourses(courses) {
  if (courses === undefined) return []
  if (!Array.isArray(courses)) {
    throw new RequestValidationError('courses must be an array')
  }
  if (courses.length > MAX_COURSES) {
    throw new RequestValidationError(`courses must contain at most ${MAX_COURSES} items`, 413)
  }

  return courses.map((course, index) => {
    if (!isPlainObject(course)) {
      throw new RequestValidationError(`courses[${index}] must be an object`)
    }

    const summary = {}
    for (const field of COURSE_STRING_FIELDS) {
      if (course[field] === undefined || course[field] === null) continue
      summary[field] = boundedString(course[field], `courses[${index}].${field}`, 300, {
        allowEmpty: true,
      })
    }
    for (const field of COURSE_NUMBER_FIELDS) {
      if (course[field] === undefined || course[field] === null) continue
      if (typeof course[field] !== 'number' || !Number.isFinite(course[field])) {
        throw new RequestValidationError(`courses[${index}].${field} must be a finite number`)
      }
      summary[field] = course[field]
    }
    if (course.is_core !== undefined && typeof course.is_core !== 'boolean') {
      throw new RequestValidationError(`courses[${index}].is_core must be a boolean`)
    }
    if (course.is_core !== undefined) summary.is_core = course.is_core
    return summary
  })
}

function sanitiseShortlist(context) {
  if (context === undefined) return []
  if (!isPlainObject(context)) {
    throw new RequestValidationError('context must be an object')
  }
  if (context.shortlisted === undefined) return []
  if (!Array.isArray(context.shortlisted)) {
    throw new RequestValidationError('context.shortlisted must be an array')
  }
  if (context.shortlisted.length > MAX_SHORTLISTED_COURSES) {
    throw new RequestValidationError(
      `context.shortlisted must contain at most ${MAX_SHORTLISTED_COURSES} courses`,
      413,
    )
  }
  return context.shortlisted.map((name, index) =>
    boundedString(name, `context.shortlisted[${index}]`, MAX_SHORTLISTED_NAME_CHARS),
  )
}

export function validateChatPayload(payload) {
  if (!isPlainObject(payload)) {
    throw new RequestValidationError('Request body must be a JSON object')
  }
  return {
    message: boundedString(payload.message, 'message', MAX_MESSAGE_CHARS),
    history: sanitiseHistory(payload.history),
    courses: sanitiseCourses(payload.courses),
    shortlisted: sanitiseShortlist(payload.context),
  }
}

function buildSystemPrompt(courses, shortlisted) {
  const courseList =
    courses.length > 0
      ? '\n\nRelevant HKS courses (percentile scores; bid_price in points):\n' +
        JSON.stringify(courses.slice(0, 15), null, 1)
      : ''
  const shortlistContext =
    shortlisted.length > 0
      ? `Student has shortlisted: ${shortlisted.join(', ')}. Suggest complementary courses or flag heavy load.\n\n`
      : ''

  return `${shortlistContext}You are a concise HKS course advisor. All _pct fields are percentile scores (0–100) vs all HKS courses — NOT hours or raw scores. Higher rating_pct = better rated. Higher workload_pct = heavier workload. bid_price_pts = last bidding clearing price in points.

Give 2–3 specific recommendations. For each: course code, name, instructor, one sentence why it fits. When citing metrics always say e.g. "workload: 68th percentile", never "68 hours". Be brief and direct.${courseList}`
}

export async function fetchFromOpenRouter(
  apiKey,
  requestBody,
  { fetchImpl = fetch, timeoutMs = UPSTREAM_TIMEOUT_MS } = {},
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://hks-course-explorer.pages.dev',
        'X-Title': 'HKS Course Explorer',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    })
  } catch {
    if (controller.signal.aborted) {
      throw new UpstreamError('Chat provider timed out', 504)
    }
    throw new UpstreamError('Chat provider is unavailable', 502)
  } finally {
    clearTimeout(timeout)
  }
}

function readWithIdleTimeout(reader, idleTimeoutMs) {
  let timeout
  const timeoutPromise = new Promise((resolve) => {
    timeout = setTimeout(() => resolve({ timedOut: true }), idleTimeoutMs)
  })

  return Promise.race([reader.read().then((result) => ({ result })), timeoutPromise]).finally(() =>
    clearTimeout(timeout),
  )
}

export function createSseStream(
  response,
  { idleTimeoutMs = UPSTREAM_STREAM_IDLE_TIMEOUT_MS } = {},
) {
  const { readable, writable } = new TransformStream()
  const writer = writable.getWriter()
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()

  void (async () => {
    try {
      if (!response.body) throw new Error('Chat provider returned no stream')
      const reader = response.body.getReader()
      let buffer = ''
      try {
        while (true) {
          const next = await readWithIdleTimeout(reader, idleTimeoutMs)
          if (next.timedOut) {
            await reader.cancel('Chat provider stream idle timeout')
            throw new Error('Chat provider stream timed out')
          }
          const { done, value } = next.result
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
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
              if (typeof token === 'string' && token) {
                await writer.write(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`))
              }
            } catch {
              // Ignore malformed provider chunks; a later valid token can still arrive.
            }
          }
        }
        await writer.write(encoder.encode('data: [DONE]\n\n'))
      } finally {
        reader.releaseLock()
      }
    } catch {
      // Do not expose provider or runtime internals in a browser-readable stream.
      try {
        await writer.write(
          encoder.encode(
            `data: ${JSON.stringify({ error: 'Chat provider stream interrupted' })}\n\n`,
          ),
        )
      } catch {
        // The browser may have disconnected before the stream error was written.
      }
    } finally {
      try {
        await writer.close()
      } catch {
        // Closing an already-cancelled client stream is expected.
      }
    }
  })()

  return readable
}

export async function onRequestPost({ request, env }) {
  const apiKey = typeof env?.OPENROUTER_API_KEY === 'string' ? env.OPENROUTER_API_KEY.trim() : ''
  if (!apiKey) {
    return jsonResponse(
      { error: 'Course advisor is not configured', code: 'OPENROUTER_NOT_CONFIGURED' },
      503,
      request,
    )
  }

  try {
    const { message, history, courses, shortlisted } = validateChatPayload(
      await readJsonBody(request),
    )
    const response = await fetchFromOpenRouter(apiKey, {
      models: FREE_MODELS,
      route: 'fallback',
      max_tokens: 350,
      stream: true,
      messages: [
        { role: 'system', content: buildSystemPrompt(courses, shortlisted) },
        ...history,
        { role: 'user', content: message },
      ],
    })

    if (!response.ok) {
      const data = await response.json().catch(() => ({}))
      return jsonResponse(
        {
          error:
            typeof data?.error?.message === 'string'
              ? data.error.message
              : `Chat provider error ${response.status}`,
        },
        502,
        request,
      )
    }

    return new Response(createSseStream(response), {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
        ...corsHeaders(request),
      },
    })
  } catch (error) {
    if (error instanceof RequestValidationError || error instanceof UpstreamError) {
      return jsonResponse({ error: error.message }, error.status, request)
    }
    console.error('Chat request failed unexpectedly', error)
    return jsonResponse({ error: 'Unable to process chat request' }, 500, request)
  }
}

export async function onRequestOptions({ request }) {
  return handleOptions(request)
}
