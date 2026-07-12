const encoder = new TextEncoder()

export async function hashedLimiterKey(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function limiterStub(env, namespace, identity) {
  if (!env?.CHAT_RATE_LIMITER?.getByName) return null
  return env.CHAT_RATE_LIMITER.getByName(`${namespace}:${await hashedLimiterKey(identity)}`)
}

export function clientIdentity(request) {
  // CF-Connecting-IP is set by the trusted Cloudflare edge. Do not persist it
  // directly: the Durable Object only receives its one-way digest.
  return request.headers.get('CF-Connecting-IP') || 'unknown-client'
}
