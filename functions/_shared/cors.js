// Shared CORS helper for Pages Functions.
//
// Same-origin Pages requests are allowed automatically, while local Vite
// development origins are explicitly supported. Unknown cross-origin callers do
// not receive CORS permission headers; browsers therefore cannot read responses
// or send credentialed requests from an unapproved site.
const LOCAL_DEVELOPMENT_ORIGINS = new Set(['http://localhost:5173', 'http://localhost:4173'])

// Apply these to every Pages Function response. The static counterpart lives
// in public/_headers; Content Security Policy remains deliberately separate
// because it needs an audited inventory of current browser integrations.
export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), geolocation=(), microphone=(), payment=(), usb=()',
  'X-Frame-Options': 'SAMEORIGIN',
  'Strict-Transport-Security': 'max-age=31536000',
}

function requestOrigin(request) {
  try {
    return new URL(request.url).origin
  } catch {
    return ''
  }
}

export function corsHeaders(request) {
  const origin = request.headers.get('Origin') || ''
  const allowed = new Set([...LOCAL_DEVELOPMENT_ORIGINS, requestOrigin(request)])

  // Origin is absent for ordinary same-origin navigation/fetches. CORS headers
  // are unnecessary in that case, but Vary keeps proxy caches correct.
  if (!origin || !allowed.has(origin)) {
    return { ...SECURITY_HEADERS, Vary: 'Origin' }
  }

  return {
    ...SECURITY_HEADERS,
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Session',
    'Access-Control-Allow-Credentials': 'true',
    Vary: 'Origin',
  }
}

export function handleOptions(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}
