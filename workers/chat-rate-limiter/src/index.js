import { DurableObject } from 'cloudflare:workers'
import { clearRetiredOtpState } from './retiredOtpState.js'

/**
 * Serialises a single anonymous client's chat admission decision.
 *
 * Pages Functions route a stable, one-way client digest to one object. Durable
 * Object event ordering makes the read/update atomic without storing a raw IP
 * address or coordinating a global hot object.
 */
export class ChatRateLimiter extends DurableObject {
  /**
   * Atomically admits a chat request for this object key.
   *
   * Each caller is routed to a distinct named object, so this state does not
   * create a global bottleneck or retain a raw client address.
   */
  async consume(now, cooldownMs) {
    const nextAllowedAt = (await this.ctx.storage.get('nextAllowedAt')) || 0
    if (now < nextAllowedAt) return { allowed: false, retryAfterMs: nextAllowedAt - now }

    await this.ctx.storage.put('nextAllowedAt', now + cooldownMs)
    return { allowed: true, retryAfterMs: 0 }
  }

  /**
   * Tracks failed admin-password attempts for one hashed client identity.
   * A successful verification resets only that client's short-lived window.
   */
  async recordAdminAttempt(now, attemptLimit, windowMs) {
    const current = await this.ctx.storage.get('adminAttempts')
    const active =
      current &&
      typeof current === 'object' &&
      Number.isFinite(current.expiresAt) &&
      now < current.expiresAt
        ? current
        : { count: 0, expiresAt: now + windowMs }
    if (!Number.isInteger(active.count) || active.count >= attemptLimit) {
      return { allowed: false, retryAfterMs: Math.max(0, active.expiresAt - now) }
    }

    await this.ctx.storage.put('adminAttempts', { ...active, count: active.count + 1 })
    return { allowed: true, retryAfterMs: 0 }
  }

  async resetAdminAttempts() {
    await this.ctx.storage.delete('adminAttempts')
  }

  /**
   * Retire OTP state left by the previous deployment. Existing alarms can run
   * briefly while Pages and this Durable Object roll forward independently.
   * This cleanup handler cannot create, send, or verify an OTP.
   */
  async alarm() {
    await clearRetiredOtpState(this.ctx.storage)
  }
}

export default {
  fetch() {
    return new Response('Not found', { status: 404 })
  },
}
