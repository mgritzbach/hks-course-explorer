import { COURSES_CACHE_KEY, COURSES_CACHE_TTL } from './appConstants.js'
import { fetchAllCourses } from './courseDataLoader.js'

/**
 * Load the full historical catalogue while keeping the database client out of
 * the startup bundle. Cache failures are non-fatal and never replace a fresh
 * database read with partial data.
 */
export async function fetchAllCoursesWithCache(onProgress, onCacheStatus) {
  try {
    const raw = sessionStorage.getItem(COURSES_CACHE_KEY)
    if (raw) {
      const cached = JSON.parse(raw)
      if (
        cached &&
        cached.ts &&
        Date.now() - cached.ts < COURSES_CACHE_TTL &&
        Array.isArray(cached.data) &&
        cached.data.length > 1000
      ) {
        onCacheStatus?.('hit')
        onProgress?.(cached.data.length)
        return cached.data
      }
    }
  } catch {
    // Storage may be disabled or over quota; a fresh read remains available.
  }

  onCacheStatus?.('miss')
  const { isSupabaseConfigured, supabase } = await import('./supabase.js')
  if (!isSupabaseConfigured) {
    throw new Error(
      'Course data is not configured. Ask the site administrator to set the Supabase browser environment variables.',
    )
  }

  const courses = await fetchAllCourses(supabase, onProgress)
  try {
    sessionStorage.setItem(COURSES_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: courses }))
  } catch {
    // Quota failure only disables this optional same-tab optimization.
  }
  return courses
}
