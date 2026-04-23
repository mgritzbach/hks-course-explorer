import { supabase } from './supabase.js'

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
    row?.['Course Code']
  )
}

export async function matchBatch(rows = []) {
  const inputs = Array.isArray(rows) ? rows : []
  const normalized = inputs.map(extractCandidateCode).filter(Boolean)
  const exactCodes = [...new Set(normalized)]
  const baseCodes = [...new Set(normalized.map((code) => code.replace(/-[A-Z]$/, '')))]
  const matches = new Map()

  if (exactCodes.length > 0) {
    const { data } = await supabase.from('courses').select('*').in('course_code', exactCodes)
    for (const course of data || []) {
      matches.set(normalizeCode(course.course_code), course)
    }
  }

  if (baseCodes.length > 0) {
    const { data } = await supabase.from('courses').select('*').in('course_code_base', baseCodes)
    for (const course of data || []) {
      const key = normalizeCode(course.course_code_base || course.course_code)
      if (!matches.has(key)) {
        matches.set(key, course)
      }
    }
  }

  return inputs.map((row) => {
    const code = extractCandidateCode(row)
    const fallbackCode = code.replace(/-[A-Z]$/, '')
    return {
      input: row,
      course: matches.get(code) || matches.get(fallbackCode) || null,
    }
  })
}
