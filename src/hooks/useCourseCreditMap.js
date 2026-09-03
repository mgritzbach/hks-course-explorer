import { useEffect, useState } from 'react'
import { fetchCatalogueDataset } from '../lib/catalogueTransport.js'
import { usesCatalogueSnapshots } from '../lib/catalogueSnapshot.js'
import { buildCourseCreditMap } from '../lib/courseCredits.js'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'

/**
 * Loads authoritative credit values independently of the historical Q-guide
 * catalogue, whose rows intentionally do not contain scheduling credits.
 */
export function useCourseCreditMap() {
  const [creditsByCode, setCreditsByCode] = useState(() => new Map())

  useEffect(() => {
    let cancelled = false
    if (!isSupabaseConfigured && !usesCatalogueSnapshots) return () => {}

    fetchCatalogueDataset('credits', () =>
      supabase
        .from('live_courses')
        .select('id,course_code,course_code_base,credits,term,session_description')
        .not('credits', 'is', null)
        .order('term', { ascending: false })
        .order('id', { ascending: true }),
    )
      .then((rows) => {
        if (!cancelled) setCreditsByCode(buildCourseCreditMap(rows))
      })
      .catch(() => {
        // Keep the existing values when the live catalogue is unavailable.
        // The requirements engine can still use explicit credits already
        // stored on plan entries.
      })

    return () => {
      cancelled = true
    }
  }, [])

  return creditsByCode
}
