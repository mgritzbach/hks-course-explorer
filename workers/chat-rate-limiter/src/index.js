import { DurableObject } from 'cloudflare:workers'

/**
 * Serialises a single anonymous client's chat admission decision.
 *
 * Pages Functions route a stable, one-way client digest to one object. Durable
 * Object event ordering makes the read/update atomic without storing a raw IP
 * address or coordinating a global hot object.
 */
export class ChatRateLimiter extends DurableObject {
  async consume(now, cooldownMs) {
    const nextAllowedAt = (await this.ctx.storage.get('nextAllowedAt')) || 0
    if (now < nextAllowedAt) return { allowed: false, retryAfterMs: nextAllowedAt - now }

    await this.ctx.storage.put('nextAllowedAt', now + cooldownMs)
    return { allowed: true, retryAfterMs: 0 }
  }
}

export default {
  fetch() {
    return new Response('Not found', { status: 404 })
  },
}
