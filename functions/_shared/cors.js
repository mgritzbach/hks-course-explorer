// Shared CORS helper — allows localhost dev + production origin
export function corsHeaders(request) {
  const origin = request.headers.get('Origin') || ''
  const allowed = ['http://localhost:5173', 'http://localhost:4173', 'https://hkscourseexplorer.pages.dev']
  const allowOrigin = allowed.includes(origin) ? origin : allowed[2]
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  }
}

export function handleOptions(request) {
  return new Response(null, { status: 204, headers: corsHeaders(request) })
}
