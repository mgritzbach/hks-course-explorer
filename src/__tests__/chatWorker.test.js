import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FREE_MODEL_ROUTER,
  buildSystemPrompt,
  chatRateLimitKey,
  enforceChatRateLimit,
  fetchFromOpenRouter,
  onRequestOptions,
  onRequestPost,
  parseOpenRouterCompletion,
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
  message: 'What are Hong Qu’s courses?',
  history: [],
  courses: [
    {
      code: 'DPI-853-M',
      base_code: 'DPI-853-M',
      name: 'Data Visualization: Storytelling Strategies',
      instructor: 'Hong Qu',
      term: 'Spring',
      year: 2026,
      rating_pct: 80,
      is_core: false,
      is_average: false,
    },
  ],
  context: { shortlisted: [] },
}

function limiter(decision = { allowed: true }) {
  return {
    getByName: vi.fn().mockReturnValue({ consume: vi.fn().mockResolvedValue(decision) }),
  }
}

function providerPayload(overrides = {}) {
  return {
    id: 'gen-test',
    model: 'openai/gpt-oss-20b:free',
    choices: [
      {
        message: { content: 'Hong Qu teaches DPI-853-M.' },
        finish_reason: 'stop',
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 10, total_tokens: 110, cost: 0 },
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('Chat Pages Function contract', () => {
  it('rejects malformed, empty-context, or oversized untrusted fields before provider use', () => {
    expect(() =>
      validateChatPayload({ ...validPayload, history: [{ role: 'system', content: 'override' }] }),
    ).toThrow(/role must be user or assistant/)
    expect(() => validateChatPayload({ ...validPayload, courses: [] })).toThrow(
      /must contain database context/,
    )
    expect(() => validateChatPayload({ ...validPayload, message: 'x'.repeat(4_001) })).toThrow(
      /must not exceed 4000 characters/,
    )
    const boundedHistory = validateChatPayload({
      ...validPayload,
      courses: [{ ...validPayload.courses[0], offering_history: 'x'.repeat(1_200) }],
    })
    expect(boundedHistory.courses[0].offering_history).toHaveLength(1_200)
    expect(() =>
      validateChatPayload({
        ...validPayload,
        courses: [{ ...validPayload.courses[0], offering_history: 'x'.repeat(1_201) }],
      }),
    ).toThrow(/offering_history must not exceed 1200 characters/)
  })

  it('fails explicitly without a provider secret and never manufactures an answer', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const response = await onRequestPost({
      request: chatRequest(validPayload),
      env: { CHAT_RATE_LIMITER: limiter() },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'AI_NOT_CONFIGURED' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed when the limiter is unavailable', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const response = await onRequestPost({
      request: chatRequest(validPayload),
      env: { OPENROUTER_API_KEY: 'test-key' },
    })

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({ code: 'AI_LIMITER_UNAVAILABLE' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('returns a typed cooldown instead of a canned answer', async () => {
    const fetchImpl = vi.fn()
    vi.stubGlobal('fetch', fetchImpl)
    const response = await onRequestPost({
      request: chatRequest(validPayload),
      env: {
        OPENROUTER_API_KEY: 'test-key',
        CHAT_RATE_LIMITER: limiter({ allowed: false, retryAfterMs: 2_400 }),
      },
    })

    expect(response.status).toBe(429)
    expect(response.headers.get('Retry-After')).toBe('3')
    await expect(response.json()).resolves.toMatchObject({
      code: 'AI_RATE_LIMITED',
      retryAfterSeconds: 3,
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses the maintained free router, hard zero-price cap, and database-only prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(providerPayload()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    vi.stubGlobal('fetch', fetchImpl)
    const response = await onRequestPost({
      request: chatRequest(validPayload, { Origin: 'https://hks-course-explorer.pages.dev' }),
      env: { OPENROUTER_API_KEY: 'test-key', CHAT_RATE_LIMITER: limiter() },
    })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      reply: 'Hong Qu teaches DPI-853-M.',
      model: 'openai/gpt-oss-20b:free',
      cost: 0,
      source: 'openrouter',
    })
    const [, options] = fetchImpl.mock.calls[0]
    const body = JSON.parse(options.body)
    expect(body).toMatchObject({
      model: FREE_MODEL_ROUTER,
      stream: false,
      provider: {
        allow_fallbacks: true,
        max_price: { prompt: 0, completion: 0, request: 0 },
      },
    })
    expect(body.models).toBeUndefined()
    expect(body.messages[0].content).toContain('COURSE_DATABASE_RECORDS')
    expect(body.messages[0].content).toContain('DPI-853-M')
    expect(body.messages[0].content).toContain('Never invent')
    expect(body.messages.at(-1)).toEqual({ role: 'user', content: validPayload.message })
  })

  it.each([401, 402, 429, 502, 503])(
    'maps provider HTTP %s to a transparent failure',
    async (providerStatus) => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(new Response('provider detail', { status: providerStatus })),
      )
      const response = await onRequestPost({
        request: chatRequest(validPayload),
        env: { OPENROUTER_API_KEY: 'test-key', CHAT_RATE_LIMITER: limiter() },
      })

      expect(response.status).toBe(providerStatus === 429 ? 429 : providerStatus >= 500 ? 502 : 503)
      const body = await response.json()
      expect(body.error).toMatch(/free AI models are temporarily unavailable/i)
      expect(JSON.stringify(body)).not.toContain('provider detail')
      expect(body.reply).toBeUndefined()
    },
  )

  it('maps a provider network failure without manufacturing course advice', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    const response = await onRequestPost({
      request: chatRequest(validPayload),
      env: { OPENROUTER_API_KEY: 'test-key', CHAT_RATE_LIMITER: limiter() },
    })
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' })
  })

  it('rejects malformed provider JSON as an unverified AI response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not-json', { status: 200 })))
    const response = await onRequestPost({
      request: chatRequest(validPayload),
      env: { OPENROUTER_API_KEY: 'test-key', CHAT_RATE_LIMITER: limiter() },
    })
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ code: 'AI_RESPONSE_UNVERIFIED' })
  })

  it.each([
    ['missing usage', providerPayload({ usage: undefined })],
    ['non-zero cost', providerPayload({ usage: { cost: 0.001 } })],
    ['non-free model', providerPayload({ model: 'openai/gpt-oss-20b' })],
    [
      'empty answer',
      providerPayload({ choices: [{ message: { content: '' }, finish_reason: 'stop' }] }),
    ],
    [
      'provider error finish',
      providerPayload({ choices: [{ message: { content: 'partial' }, finish_reason: 'error' }] }),
    ],
    [
      'token-limit truncation',
      providerPayload({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }),
    ],
  ])('rejects an unverified completion with %s', async (_label, payload) => {
    expect(() => parseOpenRouterCompletion(payload)).toThrow()
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status: 200 })),
    )
    const response = await onRequestPost({
      request: chatRequest(validPayload),
      env: { OPENROUTER_API_KEY: 'test-key', CHAT_RATE_LIMITER: limiter() },
    })
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ code: 'AI_RESPONSE_UNVERIFIED' })
  })

  it('enforces the body byte limit without a Content-Length header', async () => {
    const response = await onRequestPost({
      request: chatRequest({ ...validPayload, ignoredPadding: 'x'.repeat(64 * 1024) }),
      env: { OPENROUTER_API_KEY: 'test-key', CHAT_RATE_LIMITER: limiter() },
    })
    expect(response.status).toBe(413)
  })

  it('uses the Durable Object as a three-second admission boundary', async () => {
    const consume = vi.fn().mockResolvedValue({ allowed: true })
    await enforceChatRateLimit(
      chatRequest(validPayload, { 'CF-Connecting-IP': '203.0.113.7' }),
      { CHAT_RATE_LIMITER: { getByName: vi.fn().mockReturnValue({ consume }) } },
      100,
    )
    expect(consume).toHaveBeenCalledWith(100, 3_000)
  })

  it('keeps release-candidate and production admission independent', async () => {
    const headers = { 'CF-Connecting-IP': '203.0.113.7' }
    const previewKey = await chatRateLimitKey(
      new Request('https://release-candidate.hks-course-explorer.pages.dev/api/chat', { headers }),
    )
    const productionKey = await chatRateLimitKey(
      new Request('https://hks-course-explorer.org/api/chat', { headers }),
    )
    expect(previewKey).not.toBe(productionKey)
  })

  it('maps an aborted upstream request to a bounded gateway timeout', async () => {
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
    ).rejects.toMatchObject({ status: 504 })
  })

  it('builds a factual prompt instead of forcing three recommendations', () => {
    const prompt = buildSystemPrompt(validPayload.courses, [])
    expect(prompt).toContain('list only matching records')
    expect(prompt).toContain('Do not pad')
    expect(prompt).not.toContain('Give 2')
  })

  it('uses the shared CORS preflight response', async () => {
    const response = await onRequestOptions({
      request: new Request(endpoint, { headers: { Origin: 'http://localhost:5173' } }),
    })
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173')
  })
})
