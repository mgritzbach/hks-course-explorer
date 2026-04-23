export async function searchHarvardCourses(query = '', options = {}) {
  const params = new URLSearchParams()

  if (query) {
    params.set('q', query)
  }

  Object.entries(options).forEach(([key, value]) => {
    if (value != null && value !== '') {
      params.set(key, String(value))
    }
  })

  const response = await fetch(`/api/harvard-courses${params.toString() ? `?${params.toString()}` : ''}`)
  if (!response.ok) {
    throw new Error(`Harvard course search failed (${response.status})`)
  }

  return response.json()
}
