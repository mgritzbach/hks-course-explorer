// Shared JWT utilities using Web Crypto API (no npm needed, runs in Workers)

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function b64urlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}

export async function signJWT(payload, secret) {
  const enc = new TextEncoder()
  const header = { alg: 'HS256', typ: 'JWT' }
  const headerB64 = b64url(enc.encode(JSON.stringify(header)))
  const payloadB64 = b64url(enc.encode(JSON.stringify(payload)))
  const data = `${headerB64}.${payloadB64}`
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data))
  return `${data}.${b64url(sig)}`
}

export async function verifyJWT(token, secret) {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [headerB64, payloadB64, sigB64] = parts
    const enc = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw',
      enc.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    )
    const data = `${headerB64}.${payloadB64}`
    const valid = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), enc.encode(data))
    if (!valid) return null
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)))
    if (payload.exp < Math.floor(Date.now() / 1000)) return null
    return payload
  } catch {
    return null
  }
}
