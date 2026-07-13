import { describe, expect, it, vi } from 'vitest'
import {
  clearRetiredOtpState,
  RETIRED_OTP_STORAGE_KEYS,
} from '../../workers/chat-rate-limiter/src/retiredOtpState.js'

describe('legacy OTP alarm cleanup', () => {
  it('deletes only retired OTP state and preserves chat and Admin rate-limit state', async () => {
    const state = new Map([
      ['otp', { hash: 'retired' }],
      ['otpCooldownUntil', 123],
      ['pendingOtpRequestId', 'retired-request'],
      ['nextAllowedAt', 456],
      ['adminAttempts', { count: 2, resetAt: 789 }],
    ])
    const storage = {
      delete: vi.fn(async (keys) => {
        for (const key of keys) state.delete(key)
      }),
    }

    await clearRetiredOtpState(storage)

    expect(storage.delete).toHaveBeenCalledWith(RETIRED_OTP_STORAGE_KEYS)
    expect([...state]).toEqual([
      ['nextAllowedAt', 456],
      ['adminAttempts', { count: 2, resetAt: 789 }],
    ])
  })
})
