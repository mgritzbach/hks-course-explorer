import { describe, expect, it, vi } from 'vitest'
import { loadAdminUploadHistory, uploadAdminRows } from '../lib/adminDataApi.js'

describe('admin data browser client', () => {
  it('sends the in-memory session only in the request header', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, uploaded: 1 }), { status: 200 }))
    await expect(
      uploadAdminRows(
        'bidding',
        [{ course_code: 'API-101', bid_clearing_price: 10 }],
        'signed-session',
        { filename: 'bidding.xlsx', fetchImpl },
      ),
    ).resolves.toEqual({ ok: true, uploaded: 1 })
    expect(fetchImpl).toHaveBeenCalledWith(
      '/api/admin-upload',
      expect.objectContaining({
        credentials: 'same-origin',
        headers: expect.objectContaining({ 'X-Admin-Session': 'signed-session' }),
      }),
    )
    expect(fetchImpl.mock.calls[0][1].body).not.toContain('signed-session')
    expect(fetchImpl.mock.calls[0][1].body).toContain('bidding.xlsx')
  })

  it('fails closed on an expired admin session and invalid history response', async () => {
    await expect(
      uploadAdminRows('bidding', [{ course_code: 'API-101', bid_clearing_price: 10 }], '', {
        fetchImpl: vi.fn(),
      }),
    ).rejects.toMatchObject({ status: 401 })
    await expect(
      loadAdminUploadHistory('signed-session', {
        fetchImpl: vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ ok: true, uploads: 'not-an-array' }), { status: 200 }),
          ),
      }),
    ).rejects.toThrow('invalid history response')
  })
})
