export class HarvardCourseSearchError extends Error {
  constructor(message, { status, code } = {}) {
    super(message)
    this.name = 'HarvardCourseSearchError'
    this.status = status
    this.code = code
  }
}

export async function searchHarvardCourses(query = '', options = {}, fetchImpl = fetch) {
  const params = new URLSearchParams()

  if (query) {
    params.set('q', query)
  }

  Object.entries(options).forEach(([key, value]) => {
    if (value != null && value !== '') {
      params.set(key, String(value))
    }
  })

  const response = await fetchImpl(
    `/api/harvard-courses${params.toString() ? `?${params.toString()}` : ''}`,
  )
  if (!response.ok) {
    const body = await response.json().catch(() => ({}))
    throw new HarvardCourseSearchError(
      body.error || `Harvard course search failed (${response.status})`,
      { status: response.status, code: body.code },
    )
  }

  return response.json()
}
