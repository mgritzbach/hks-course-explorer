import { DurableObject } from 'cloudflare:workers'

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
   * Reserves an OTP send without replacing a currently usable code. The
   * request is confirmed only after the mail provider accepts delivery.
   */
  async startOtpRequest(now, requestId, cooldownMs) {
    const cooldownUntil = (await this.ctx.storage.get('otpCooldownUntil')) || 0
    if (now < cooldownUntil) {
      return { allowed: false, retryAfterMs: cooldownUntil - now }
    }

    await this.ctx.storage.put({
      otpCooldownUntil: now + cooldownMs,
      pendingOtpRequestId: requestId,
    })
    await this.ctx.storage.setAlarm(now + cooldownMs)
    return { allowed: true, retryAfterMs: 0 }
  }

  async confirmOtpRequest(now, requestId, otpHash, ttlMs) {
    const pendingRequestId = await this.ctx.storage.get('pendingOtpRequestId')
    if (pendingRequestId !== requestId) return { confirmed: false }

    await this.ctx.storage.put({
      otp: { hash: otpHash, expiresAt: now + ttlMs, attempts: 0 },
      pendingOtpRequestId: null,
    })
    await this.ctx.storage.setAlarm(now + ttlMs)
    return { confirmed: true }
  }

  async cancelOtpRequest(requestId) {
    const pendingRequestId = await this.ctx.storage.get('pendingOtpRequestId')
    if (pendingRequestId !== requestId) return { cancelled: false }

    await this.ctx.storage.delete(['pendingOtpRequestId', 'otpCooldownUntil'])
    await this.scheduleCleanup(Date.now())
    return { cancelled: true }
  }

  /**
   * Consumes one OTP verification attempt and deletes a valid code before the
   * result returns, making both the attempt ceiling and single use atomic.
   */
  async verifyOtp(now, otpHash, attemptLimit) {
    const otp = await this.ctx.storage.get('otp')
    if (!otp || typeof otp !== 'object' || !Number.isFinite(otp.expiresAt) || now > otp.expiresAt) {
      await this.ctx.storage.delete('otp')
      return { status: 'missing' }
    }

    if (otpHash !== otp.hash) {
      const attempts = Number.isInteger(otp.attempts) && otp.attempts >= 0 ? otp.attempts + 1 : 1
      if (attempts >= attemptLimit) {
        await this.ctx.storage.delete('otp')
        return { status: 'locked' }
      }
      await this.ctx.storage.put('otp', { ...otp, attempts })
      return { status: 'incorrect' }
    }

    await this.ctx.storage.delete('otp')
    return { status: 'valid' }
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

  async alarm() {
    await this.scheduleCleanup(Date.now())
  }

  async scheduleCleanup(now) {
    const [otp, cooldownUntil] = await Promise.all([
      this.ctx.storage.get('otp'),
      this.ctx.storage.get('otpCooldownUntil'),
    ])
    const keys = []
    if (otp && typeof otp === 'object' && Number.isFinite(otp.expiresAt) && now >= otp.expiresAt) {
      keys.push('otp')
    }
    if (Number.isFinite(cooldownUntil) && now >= cooldownUntil) {
      keys.push('otpCooldownUntil', 'pendingOtpRequestId')
    }
    if (keys.length) await this.ctx.storage.delete(keys)

    const activeOtp = keys.includes('otp') ? null : otp
    const activeCooldown = keys.includes('otpCooldownUntil') ? 0 : cooldownUntil
    const deadlines = [
      activeOtp && typeof activeOtp === 'object' ? activeOtp.expiresAt : 0,
      Number.isFinite(activeCooldown) ? activeCooldown : 0,
    ].filter((deadline) => deadline > now)
    if (deadlines.length) await this.ctx.storage.setAlarm(Math.min(...deadlines))
  }
}

export default {
  fetch() {
    return new Response('Not found', { status: 404 })
  },
}
