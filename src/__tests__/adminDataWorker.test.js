import { describe, expect, it, vi } from 'vitest'
import { ADMIN_REQUEST_LIMITS, validateUploadPayload } from '../../functions/_shared/adminData.js'
import { issueAdminSession } from '../../functions/_shared/adminSession.js'
import { __test__ as upload } from '../../functions/api/admin-upload.js'
import { __test__ as history } from '../../functions/api/admin-history.js'

const env = {
  ADMIN_SESSION_SECRET: 'a-long-random-admin-session-secret-value',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'a-service-role-key-that-is-never-a-browser-value',
}

async function adminRequest(url, options = {}) {
  const session = await issueAdminSession(env)
  return new Request(url, {
    ...options,
    headers: { 'X-Admin-Session': session, ...(options.headers || {}) },
  })
}

describe('admin data Pages Functions', () => {
  it('denies missing sessions before reading or contacting Supabase', async () => {
    const fetchImpl = vi.fn()
    const response = await upload.handlePost(
      {
        request: new Request('https://app.example/api/admin-upload', {
          method: 'POST',
          body: JSON.stringify({ type: 'bidding', rows: [] }),
        }),
        env,
      },
      fetchImpl,
    )
    expect(response.status).toBe(401)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('stops an oversized stream without Content-Length before Supabase', async () => {
    const session = await issueAdminSession(env)
    const bytes = new TextEncoder().encode(
      `{"type":"bidding","rows":[],"ignoredPadding":"${'x'.repeat(ADMIN_REQUEST_LIMITS.maxJsonBytes)}"}`,
    )
    const request = new Request('https://app.example/api/admin-upload', {
      method: 'POST',
      headers: { 'X-Admin-Session': session },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(bytes)
          controller.close()
        },
      }),
      duplex: 'half',
    })
    const fetchImpl = vi.fn()
    expect(request.headers.get('Content-Length')).toBeNull()
    const response = await upload.handlePost({ request, env }, fetchImpl)
    expect(response.status).toBe(413)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Request body is too large.',
    })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('inserts only allow-listed target data through the server service role', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(null, { status: 201 }))
    const request = await adminRequest('https://app.example/api/admin-upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'bidding',
        filename: 'bidding.xlsx',
        rows: [{ course_code: 'API-101', bid_clearing_price: 12, term: 'Fall' }],
      }),
    })
    const response = await upload.handlePost({ request, env }, fetchImpl)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, uploaded: 1 })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://example.supabase.co/rest/v1/rpc/admin_import',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          apikey: env.SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
        }),
      }),
    )
    expect(fetchImpl.mock.calls[0][1].body).toBe(
      JSON.stringify({
        p_type: 'bidding',
        p_filename: 'bidding.xlsx',
        p_rows: [{ course_code: 'API-101', bid_clearing_price: 12, term: 'Fall' }],
      }),
    )
  })

  it('rejects arbitrary tables, columns, and oversized row batches before Supabase', async () => {
    const fetchImpl = vi.fn()
    const invalidColumnRequest = await adminRequest('https://app.example/api/admin-upload', {
      method: 'POST',
      body: JSON.stringify({
        type: 'bidding',
        rows: [{ course_code: 'API-101', bid_clearing_price: 12, role: 'service_role' }],
      }),
    })
    const invalidColumn = await upload.handlePost({ request: invalidColumnRequest, env }, fetchImpl)
    expect(invalidColumn.status).toBe(400)

    const humanHeaderRequest = await adminRequest('https://app.example/api/admin-upload', {
      method: 'POST',
      body: JSON.stringify({
        type: 'bidding',
        rows: [{ 'Course Code': 'API-101', bid_clearing_price: 12 }],
      }),
    })
    const humanHeader = await upload.handlePost({ request: humanHeaderRequest, env }, fetchImpl)
    expect(humanHeader.status).toBe(400)

    const arbitraryTargetRequest = await adminRequest('https://app.example/api/admin-upload', {
      method: 'POST',
      body: JSON.stringify({ type: 'users', rows: [{ id: 'other' }] }),
    })
    const arbitraryTarget = await upload.handlePost(
      { request: arbitraryTargetRequest, env },
      fetchImpl,
    )
    expect(arbitraryTarget.status).toBe(400)
    expect(
      validateUploadPayload({
        type: 'bidding',
        rows: Array.from({ length: ADMIN_REQUEST_LIMITS.maxRows + 1 }, () => ({
          course_code: 'API-101',
          bid_clearing_price: 12,
        })),
      }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      validateUploadPayload({
        type: 'qguide',
        rows: [{ course_code: 'API-101', instructor_rating: 'not-a-number', course_rating: 4 }],
      }),
    ).toMatchObject({
      ok: false,
      status: 400,
      error: 'Upload contains an invalid instructor_rating value.',
    })
    expect(
      validateUploadPayload({
        type: 'stem_designations',
        rows: [{ course_code_base: 'API-101', is_stem: 'yes' }],
      }),
    ).toMatchObject({ ok: true, rows: [{ course_code_base: 'API-101', is_stem: true }] })
    expect(
      validateUploadPayload({
        type: 'bidding',
        rows: [
          { course_code: 'API-101', bid_clearing_price: 12, term: 'Fall' },
          { course_code: 'API-101', bid_clearing_price: 20, term: 'Fall' },
        ],
      }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('fails closed for missing server credentials and upstream failures', async () => {
    const request = await adminRequest('https://app.example/api/admin-upload', {
      method: 'POST',
      body: JSON.stringify({
        type: 'bidding',
        rows: [{ course_code: 'API-101', bid_clearing_price: 12 }],
      }),
    })
    const notConfigured = await upload.handlePost(
      { request, env: { ADMIN_SESSION_SECRET: env.ADMIN_SESSION_SECRET } },
      vi.fn(),
    )
    expect(notConfigured.status).toBe(503)

    const failingRequest = await adminRequest('https://app.example/api/admin-upload', {
      method: 'POST',
      body: JSON.stringify({
        type: 'bidding',
        rows: [{ course_code: 'API-101', bid_clearing_price: 12 }],
      }),
    })
    const upstreamFailure = await upload.handlePost(
      { request: failingRequest, env },
      vi.fn().mockResolvedValue(new Response('denied', { status: 403 })),
    )
    expect(upstreamFailure.status).toBe(502)
  })

  it('returns only the allow-listed history projection', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            id: 'upload-1',
            upload_type: 'bidding',
            filename: 'safe.xlsx',
            row_count: 1,
            status: 'ok',
            uploaded_at: '2026-07-09T00:00:00Z',
            secret: 'must-not-leak',
          },
        ]),
        { status: 200 },
      ),
    )
    const request = await adminRequest('https://app.example/api/admin-history')
    const response = await history.handleGet({ request, env }, fetchImpl)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({
      ok: true,
      uploads: [
        {
          id: 'upload-1',
          type: 'bidding',
          filename: 'safe.xlsx',
          row_count: 1,
          status: 'ok',
          created_at: '2026-07-09T00:00:00Z',
        },
      ],
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      expect.stringContaining('/rest/v1/uploads?select='),
      expect.objectContaining({ method: 'GET' }),
    )
  })

  it('denies history requests without an admin session', async () => {
    const response = await history.handleGet(
      { request: new Request('https://app.example/api/admin-history'), env },
      vi.fn(),
    )
    expect(response.status).toBe(401)
  })

  it('fails closed when the history upstream is unavailable', async () => {
    const request = await adminRequest('https://app.example/api/admin-history')
    const response = await history.handleGet(
      { request, env },
      vi.fn().mockRejectedValue(new Error('network down')),
    )
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Admin data service is unavailable.',
    })
  })
})
