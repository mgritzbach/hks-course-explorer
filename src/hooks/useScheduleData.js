/**
 * useScheduleData
 *
 * Encapsulates all Supabase data-fetching for the Schedule Builder:
 *   - live_courses  (fetched once on mount — all terms, client-side filtered)
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
import { supabase } from '../lib/supabase.js'

export function useScheduleData(semesterYear, semester) {
  const [liveCoursesData, setLiveCoursesData] = useState([])
  const [sectionTimesMap, setSectionTimesMap] = useState(new Map())
  const [sectionCanonicalCodes, setSectionCanonicalCodes] = useState(new Set())
  const [sectionInfoMap, setSectionInfoMap] = useState(new Map())
  const [sectionTimesLoading, setSectionTimesLoading] = useState(false)

  // Fetch live_courses once — all terms loaded upfront, semester filtering
  // happens client-side so switching semesters doesn't trigger a new fetch.
  useEffect(() => {
    supabase
      .from('live_courses')
      .select(
        'id,course_code,course_code_base,title,term,credits,instructors,' +
        'meeting_days,time_start,time_end,school,is_hks,session_code,' +
        'session_description,cross_reg_eligible'
      )
      .order('term', { ascending: false })
      .limit(2000)
      .then(({ data }) => setLiveCoursesData(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, []) // intentionally empty — see ADR-002

  // Fetch course_sections whenever the selected semester changes.
  // Resets all section maps immediately so stale data never shows.
  useEffect(() => {
    setSectionTimesMap(new Map())
    setSectionCanonicalCodes(new Set())
    setSectionInfoMap(new Map())
    setSectionTimesLoading(true)

    // Term format for course_sections: "2026Spring", "2026Fall", "2026January"
    // (no space — see ADR-004)
    const termStr = `${semesterYear}${semester === 'January' ? 'January' : semester}`

    supabase
      .from('course_sections')
      .select('course_code_base,meetings,title,instructors,credits')
      .eq('term', termStr)
      .limit(2000)
      .then(({ data }) => {
        const rows = Array.isArray(data) ? data : []
        const map = new Map()
        const canonical = new Set()
        const infoMap = new Map()

        rows.forEach((row) => {
          if (!row.course_code_base || !Array.isArray(row.meetings) || !row.meetings.length) return

          const { course_code_base: code, meetings, title, instructors, credits } = row
          map.set(code, meetings)
          canonical.add(code)

          if (title || instructors?.length || credits != null) {
            infoMap.set(code, {
              title: title || null,
              instructors: Array.isArray(instructors) ? instructors : [],
              credits: credits != null ? Number(credits) : null,
            })
          }

          // Also index common code variants so lookups hit regardless of format
          const withDash = code.replace(/([0-9])([A-Z])/, '$1-$2')
          if (withDash !== code) map.set(withDash, meetings)
          const base = code.replace(/-?[A-Z]+$/, '')
          if (base !== code && !map.has(base)) map.set(base, meetings)
        })

        setSectionTimesMap(map)
        setSectionCanonicalCodes(canonical)
        setSectionInfoMap(infoMap)
        setSectionTimesLoading(false)
      })
      .catch(() => setSectionTimesLoading(false))
  }, [semesterYear, semester])

  return {
    liveCoursesData,
    sectionTimesMap,
    sectionCanonicalCodes,
    sectionInfoMap,
    sectionTimesLoading,
  }
}
