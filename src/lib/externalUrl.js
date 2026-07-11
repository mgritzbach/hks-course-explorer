// Imported catalogue fields may become browser navigation targets. Keep only
// normal web URLs so a compromised data source cannot turn a trusted link
// into an executable scheme such as javascript: or data:.
export function safeExternalUrl(value) {
  if (typeof value !== 'string' || !value.trim()) return null

  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : null
  } catch {
    return null
  }
}

export function safeCourseLinks(course) {
  const source = course && typeof course === 'object' ? course : {}
  return {
    courseUrl: safeExternalUrl(source.course_url),
    instructorProfileUrl: safeExternalUrl(source.instructor_profile_url),
  }
}
