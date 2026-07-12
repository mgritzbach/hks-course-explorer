/**
 * useScheduleData
 *
 * Encapsulates all Supabase data-fetching for the Schedule Builder:
 *   - live_courses  (fetched for the selected term only)
 *   - course_sections (re-fetched whenever semesterYear or semester changes)
 *
 * Keeping these two fetches isolated here means ScheduleBuilder.jsx can focus
 * on UI logic without mixing in network concerns. It also makes the fetches
 * independently testable.
 *
 * @param {string} semesterYear  e.g. "2026"
 * @param {string} semester      e.g. "Spring" | "Fall" | "January"
 * @returns {{
 *   liveCoursesData: object[],
 *   sectionTimesMap: Map,
 *   sectionCanonicalCodes: Set,
 *   sectionInfoMap: Map,
 *   sectionTimesLoading: boolean,
 * }}
 */

import { useEffect, useState } from 'react'
import { fetchCataloguePages } from '../lib/cataloguePagination.js'
import {
  buildAvailableCatalogueTerms,
  getLiveCatalogueTerm,
} from '../lib/scheduleCatalogueOptions.js'
import { buildSectionCatalogueIndexes } from '../lib/sectionCatalogueIndexes.js'
import { isSupabaseConfigured, supabase } from '../lib/supabase.js'

// A stalled browser read is not a valid empty catalogue. Bound it so the UI
// can distinguish a temporary data problem from a term with no offerings.
const LIVE_CATALOGUE_REQUEST_TIMEOUT_MS = 8_000

export function useScheduleData(semesterYear, semester) {
  const [liveCoursesData, setLiveCoursesData] = useState([])
  const [liveCoursesLoading, setLiveCoursesLoading] = useState(false)
  const [liveCoursesError, setLiveCoursesError] = useState('')
  const [availableHksTerms, setAvailableHksTerms] = useState([])
  const [sectionTimesMap, setSectionTimesMap] = useState(new Map())
  const [sectionCanonicalCodes, setSectionCanonicalCodes] = useState(new Set())
  const [sectionInfoMap, setSectionInfoMap] = useState(new Map())
  const [sectionTimesLoading, setSectionTimesLoading] = useState(false)

  // Read the small active HKS catalogue once so the UI can offer only real
  // HKS terms and disclose complete coverage across them. Non-HKS browsing
  // retains the broader year/semester controls below.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()

    if (!isSupabaseConfigured) return () => controller.abort()

    fetchCataloguePages(() =>
      supabase
        .from('live_courses')
        .select('id,term,is_hks')
        .abortSignal(controller.signal)
        .eq('active', true)
        .eq('is_hks', true)
        .order('term', { ascending: true })
        .order('id', { ascending: true }),
    )
      .then((rows) => {
        if (!cancelled) setAvailableHksTerms(buildAvailableCatalogueTerms(rows))
      })
      .catch(() => {
        // Do not take down selected-term search if the coverage summary fails.
        if (!cancelled) setAvailableHksTerms([])
      })

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  // Fetch only the current term. The daily sync is the sole upstream source;
  // downloading every historical/future term makes the first Schedule Builder
  // view slower and can briefly show the wrong term while a selector changes.
  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    const liveTerm = getLiveCatalogueTerm(semesterYear, semester)
    const timeoutId = window.setTimeout(() => controller.abort(), LIVE_CATALOGUE_REQUEST_TIMEOUT_MS)

    setLiveCoursesData([])
    setLiveCoursesError('')
    setLiveCoursesLoading(true)
    if (!isSupabaseConfigured) {
      setLiveCoursesLoading(false)
      setLiveCoursesError('Current catalogue configuration is unavailable.')
      return () => {
        cancelled = true
        window.clearTimeout(timeoutId)
        controller.abort()
      }
    }

    fetchCataloguePages(() =>
      supabase
        .from('live_courses')
        .select(
          'id,course_code,course_code_base,title,term,credits,instructors,' +
            'meeting_days,time_start,time_end,school,is_hks,session_code,' +
            'session_description,cross_reg_eligible,source,source_course_id,' +
            'course_offer_nbr,section_code,source_url,active',
        )
        // The ID tie-breaker makes page boundaries stable when many offerings
        // share a term, preventing duplicate or skipped rows across requests.
        .abortSignal(controller.signal)
        .eq('term', liveTerm)
        .eq('active', true)
        .order('term', { ascending: false })
        .order('id', { ascending: true }),
    )
      .then((rows) => {
        if (!cancelled) setLiveCoursesData(rows)
      })
      .catch(() => {
        if (!cancelled) setLiveCoursesError('Current catalogue is temporarily unavailable.')
      })
      .finally(() => {
        window.clearTimeout(timeoutId)
        if (!cancelled) setLiveCoursesLoading(false)
      })

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
      controller.abort()
    }
  }, [semesterYear, semester])

  // Fetch course_sections whenever the selected semester changes.
  // Resets all section maps immediately so stale data never shows.
  useEffect(() => {
    let cancelled = false
    setSectionTimesMap(new Map())
    setSectionCanonicalCodes(new Set())
    setSectionInfoMap(new Map())
    setSectionTimesLoading(true)

    if (!isSupabaseConfigured) {
      setSectionTimesLoading(false)
      return () => {
        cancelled = true
      }
    }

    // Term format for course_sections: "2026Spring", "2026Fall", "2026January"
    // (no space — see ADR-004)
    const termStr = `${semesterYear}${semester === 'January' ? 'January' : semester}`

    fetchCataloguePages(() =>
      supabase
        .from('course_sections')
        .select('id,course_code_base,meetings,title,instructors,credits')
        .eq('term', termStr)
        .order('course_code_base', { ascending: true })
        .order('id', { ascending: true }),
    )
      .then((rows) => {
        const indexes = buildSectionCatalogueIndexes(rows)
        if (cancelled) return
        setSectionTimesMap(indexes.sectionTimesMap)
        setSectionCanonicalCodes(indexes.sectionCanonicalCodes)
        setSectionInfoMap(indexes.sectionInfoMap)
        setSectionTimesLoading(false)
      })
      .catch(() => {
        if (!cancelled) setSectionTimesLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [semesterYear, semester])

  return {
    liveCoursesData,
    liveCoursesLoading,
    liveCoursesError,
    availableHksTerms,
    sectionTimesMap,
    sectionCanonicalCodes,
    sectionInfoMap,
    sectionTimesLoading,
  }
}
