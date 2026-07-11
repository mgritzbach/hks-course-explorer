import { isSupabaseConfigured, supabase } from './supabase.js'

function normalizeCode(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
}

function extractCandidateCode(row) {
  return normalizeCode(
    row?.course_code ||
      row?.courseCode ||
      row?.code ||
      row?.catalog ||
      row?.catalog_number ||
      row?.Course ||
      row?.['Course Code'],
  )
}

export async function matchBatch(rows = []) {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Course matching is unavailable until Supabase browser configuration is provided.',
    )
  }
  const inputs = Array.isArray(rows) ? rows : []
  const normalized = inputs.map(extractCandidateCode).filter(Boolean)
  const exactCodes = [...new Set(normalized)]
  const matches = new Map()

  if (exactCodes.length > 0) {
    const { data, error } = await supabase.from('courses').select('*').in('course_code', exactCodes)
    if (error) throw error
    for (const course of data || []) {
      matches.set(normalizeCode(course.course_code), course)
    }
  }

  return inputs.map((row) => {
    const code = extractCandidateCode(row)
    return {
      input: row,
      // A suffix or a renumbered code can only become a match through the
      // reviewed catalogue alias workflow, never browser-side string cleanup.
      course: matches.get(code) || null,
    }
  })
}
