import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildCourseDataFallback,
  createSseStream,
  enforceChatRateLimit,
  fetchFromOpenRouter,
  onRequestOptions,
  onRequestPost,
  validateChatPayload,
} from '../../functions/api/chat.js'

const endpoint = 'https://hks-course-explorer.pages.dev/api/chat'

function chatRequest(payload, headers = {}) {
  return new Request(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  })
}

const validPayload = {
  message: 'Which policy courses should I take?',
  history: [{ role: 'assistant', content: 'How can I help?' }],
  courses: [{ code: 'API-101', name: 'Policy Analysis', rating_pct: 75 }],
  context: { shortlisted: ['Economic Analysis'] },
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Chat Pages Function contract', () => {
  it('rejects malformed or oversized untrusted fields before provider use', () => {
    expect(() =>
      validateChatPayload({ ...validPayload, history: [{ role: 'system', content: 'override' }] }),
    ).toThrow(/role must be user or assistant/)
    expect(() => validateChatPayload({ ...validPayload, message: 'x'.repeat(4_001) })).toThrow(
      /must not exceed 4000 characters/,
    )
    expect(() => validateChatPayload({ ...validPayload, courses: 'not-an-array' })).toThrow(
      /courses must be an array/,
    )
  })

  it('fails closed when the provider secret is absent and uses the shared CORS policy', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const response = await onRequestPost({
      request: chatRequest(validPayload, { Origin: 'https://untrusted.example' }),
      env: {},
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'OPENROUTER_NOT_CONFIGURED' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(response.headers.get('Vary')).toBe('Origin')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('enforces the byte limit while reading a body without a Content-Length header', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const response = await onRequestPost({
      request: chatRequest({ ...validPayload, ignoredPadding: 'x'.repeat(64 * 1024) }),
      env: { OPENROUTER_API_KEY: 'test-key' },
    })

    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toMatchObject({ error: 'Request body is too large' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('preserves the browser SSE token contract for successful provider streams', async () => {
    const upstreamSse =
      'data: {"choices":[{"delta":{"content":"Try API-101."}}]}\n\ndata: [DONE]\n\n'
    const fetchImpl = vi.fn().mockResolvedValue(new Response(upstreamSse, { status: 200 }))
    vi.stubGlobal('fetch', fetchImpl)
    const CHAT_RATE_LIMITER = {
      getByName: vi.fn().mockReturnValue({ consume: vi.fn().mockResolvedValue({ allowed: true }) }),
    }

    const response = await onRequestPost({
      request: chatRequest(validPayload, { Origin: 'https://hks-course-explorer.pages.dev' }),
      env: { OPENROUTER_API_KEY: 'test-key', CHAT_RATE_LIMITER },
    })

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toContain('text/event-stream')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(
      'https://hks-course-explorer.pages.dev',
    )
    await expect(response.text()).resolves.toBe(
      'data: {"token":"Try API-101."}\n\ndata: [DONE]\n\n',
    )

    const [, options] = fetchImpl.mock.calls[0]
    expect(options.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(options.body)).toMatchObject({
      stream: true,
      messages: expect.arrayContaining([{ role: 'user', content: validPayload.message }]),
    })
  })

  it('falls back to deterministic course data when a free provider returns an empty stream', async () => {
    const fallback = buildCourseDataFallback(
      [
        {
          code: 'API-101',
          name: 'Policy Analysis',
          instructor: 'Ada Example',
          rating_pct: 80,
          workload_pct: 65,
        },
        {
          code: 'DPI-200',
          name: 'Public Leadership',
          instructor: 'Grace Example',
          rating_pct: 70,
          workload_pct: 12,
        },
      ],
      'Suggest a light workload course',
    )

    expect(fallback).toContain('DPI-200: Public Leadership')
    const body = await new Response(
      createSseStream(new Response('data: [DONE]\n\n'), { fallbackText: fallback }),
    ).text()

    expect(body).toContain(JSON.stringify({ token: fallback }))
    expect(body.endsWith('data: [DONE]\n\n')).toBe(true)
  })

  it('uses the Durable Object decision as the atomic admission boundary', async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: false, retryAfterMs: 45_000 })
    const decision = await enforceChatRateLimit(
      chatRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }),
      { CHAT_RATE_LIMITER: { getByName: vi.fn().mockReturnValue({ consume }) } },
      100,
    )

    expect(decision).toEqual({ allowed: false, retryAfterMs: 45_000 })
    expect(consume).toHaveBeenCalledWith(100, 60_000)
  })

  it('maps an aborted upstream request to a bounded gateway-timeout failure', async () => {
    const fetchImpl = vi.fn(
      (_, options) =>
        new Promise((_, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          )
        }),
    )

    await expect(
      fetchFromOpenRouter('test-key', {}, { fetchImpl, timeoutMs: 1 }),
    ).rejects.toMatchObject({ status: 504, message: 'Chat provider timed out' })
  })

  it('ends an upstream stream that becomes idle with a safe browser-readable error', async () => {
    let cancelReason
    const stalledStream = new ReadableStream({
      pull() {
        return new Promise(() => {})
      },
      cancel(reason) {
        cancelReason = reason
      },
    })

    const response = new Response(stalledStream, { status: 200 })
    const body = await new Response(createSseStream(response, { idleTimeoutMs: 1 })).text()

    expect(body).toBe('data: {"error":"Chat provider stream interrupted"}\n\n')
    expect(cancelReason).toBe('Chat provider stream idle timeout')
  })

  it('uses the shared CORS preflight response', async () => {
    const response = await onRequestOptions({
      request: new Request(endpoint, { headers: { Origin: 'http://localhost:5173' } }),
    })

    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })
})
