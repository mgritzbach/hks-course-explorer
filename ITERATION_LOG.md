# Iteration Log
Generated: 2026-04-28
Goal: Raise ALL category scores to 9/10 or higher
Target scores: Core ≥9 · UX ≥9 · Data ≥9 · Performance ≥9 · Accessibility ≥9 · Code Quality ≥9
Status: IN PROGRESS

## Baseline scores (audit 2026-04-27)
- Core functionality:   7/10
- UX / discoverability: 6/10
- Data integrity:       7/10
- Performance:          6/10
- Accessibility:        5/10
- Code quality:         8/10

## Context for all agents
- Project root: C:\Users\micgr\OneDrive\Desktop\Antigravity\Data_Science_Claude\hks-course-explorer
- React + Vite SPA. Run `npm run build` after every JS/JSX change. Fix ALL errors before marking DONE.
- Commit each SC separately: `git commit -m "fix: SC-N · <title>"`
- Read every file before editing. Never blindly overwrite.
- Today is April 2026 → current semester is Spring 2026.
- sectionTimesMap keyed by course_code_base (e.g. "IGA-109").
- enrichedSearchResults merges sectionTimesMap into search result objects.

---

## SC-1 · Fix sectionTimesMap fetch limit (500 → 2000)
**Priority**: CRITICAL
**Category impact**: Core functionality +0.5, UX +0.3
**Goal**: The Supabase REST fetch for course_sections uses `limit=500`. Spring 2026 likely has >500 sections, causing silent truncation — courses beyond #500 all show "No time data". Raise the limit.

In `src/pages/ScheduleBuilder.jsx`, find line ~328:
  `fetch(\`${supabaseUrl}/rest/v1/course_sections?term=eq.${termStr}&select=...&limit=500\``
Change `limit=500` to `limit=2000`.

Done when: the fetch URL has limit=2000, build passes.
**Status**: DONE

---

## SC-2 · Fix ICS export — Spring semester uses Fall 2025 start date
**Priority**: CRITICAL
**Category impact**: Data integrity +0.5, Core functionality +0.3
**Goal**: `buildIcs()` in ScheduleBuilder.jsx has:
  `const TERM_START = { Q1: '20250902', Q2: '20251027', FULL: '20250902', SPRING: '20260127' }`
The `term` state is always 'Q1', 'Q2', or 'FULL' — never 'SPRING'. So the Spring 2026 start date is never used. A Spring 2026 schedule exported to iCal places every event in September 2025.

Fix: The `buildIcs` function receives `term` (Q1/Q2/FULL) but not `semester` (Spring/Fall/January). Pass `semester` as a second arg:
  `buildIcs(normalizedPlanCourses, term, semester)`

Update the function signature and date logic:
```js
function buildIcs(courses, term = 'FULL', semester = 'Spring') {
  const TERM_START = {
    // Fall semester
    'Fall-Q1':   '20250902',
    'Fall-Q2':   '20251027',
    'Fall-FULL': '20250902',
    // Spring semester
    'Spring-Q1':   '20260127',
    'Spring-Q2':   '20260309',
    'Spring-FULL': '20260127',
    // January
    'January-FULL': '20260105',
  }
  const dateBase = TERM_START[`${semester}-${term}`] || TERM_START['Spring-FULL']
  const weekCount = term === 'Q1' || term === 'Q2' ? 7 : 14
  // ... rest unchanged, use dateBase instead of old dateBase
```

Also add TZID to each event so calendar apps use Boston time:
```
DTSTART;TZID=America/New_York:${dateBase}T${...}
DTEND;TZID=America/New_York:${dateBase}T${...}
```
And add a VTIMEZONE block near the top of the VCALENDAR (before events):
```
BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:STANDARD
DTSTART:19671029T020000
RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=11
TZNAME:EST
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
END:STANDARD
BEGIN:DAYLIGHT
DTSTART:19870405T020000
RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3
TZNAME:EDT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
END:DAYLIGHT
END:VTIMEZONE
```

Done when: Spring export puts events in Jan 2026, Fall in Sep 2025, January in Jan 2026; build passes.
**Status**: DONE

---

## SC-3 · Fix 'Remove X' → 'Remove ✕' in search result cards
**Priority**: HIGH
**Category impact**: UX +0.2, Code quality +0.1
**Goal**: Both the withTime and withoutTime card render blocks show 'Remove X' (ASCII X). The spec and the rest of the UI use ✕ (Unicode U+2715). Fix both occurrences.

In `src/pages/ScheduleBuilder.jsx`, find ALL occurrences of:
  `{added ? 'Remove X' : 'Add'}`
Replace with:
  `{added ? 'Remove ✕' : 'Add'}`

There are 2 occurrences (withTime map ~line 1202, withoutTime map ~line 1256). Fix both.

Done when: no 'Remove X' remains (grep confirms), build passes.
**Status**: DONE

---

## SC-4 · Fix HKS default flooding search panel + dead Browse button
**Priority**: HIGH
**Category impact**: UX +0.5, Core functionality +0.3
**Goal**: `searchSource` defaults to 'HKS'. The hasFilters guard at line ~347:
  `const hasFilters = ... || searchSource !== 'All' || ...`
Since 'HKS' !== 'All', hasFilters is always true on load. This causes an immediate DB search returning ~300-500 Spring HKS courses with NO user input — flooding the panel. The "Browse all HKS courses" empty-state button is also dead code (it sets searchSource to 'HKS', which it already is).

Fix in `src/pages/ScheduleBuilder.jsx`:
1. In the search useEffect, change the hasFilters guard so that the default HKS source does NOT count as an active filter:
   ```js
   const hasFilters = (searchConcentration !== 'All') || (searchStem !== 'all') || searchCoreOnly || (searchSource !== 'All' && searchSource !== 'HKS') || searchMinRating
   ```
   Wait — but we DO want the Browse button to trigger HKS results. So add a separate `browseAll` state:
   ```js
   const [browseAll, setBrowseAll] = useState(false)
   ```
   And change the guard:
   ```js
   const hasFilters = (searchConcentration !== 'All') || (searchStem !== 'all') || searchCoreOnly || (searchSource === 'Non-HKS') || searchMinRating || browseAll
   ```
   Reset `browseAll` to false when searchQ changes: add to the useEffect deps and reset it when query changes.

2. Fix the Browse button (line ~1314) to call `setBrowseAll(true)` instead of `setSearchSource('HKS')`:
   ```jsx
   <button onClick={() => setBrowseAll(true)} ...>
     Browse all {semester} HKS courses
   </button>
   ```

3. Reset `browseAll = false` when searchQ is cleared or filters change (add to the useEffect cleanup).

Done when: opening Schedule Builder shows empty search panel (not 300+ courses); clicking "Browse all Spring HKS courses" loads HKS courses; typing a query still works; build passes.
**Status**: DONE

---

## SC-5 · saveLoadTimeoutRef memory leak — add cleanup on unmount
**Priority**: MEDIUM
**Category impact**: Code quality +0.3
**Goal**: The cleanup useEffect at line ~314 clears exportMsgTimeoutRef and copyPlanTimeoutRef but NOT saveLoadTimeoutRef. This is a memory leak.

In `src/pages/ScheduleBuilder.jsx`, find the cleanup useEffect:
```js
useEffect(() => {
  return () => {
    if (exportMsgTimeoutRef.current) clearTimeout(exportMsgTimeoutRef.current)
    if (copyPlanTimeoutRef.current) clearTimeout(copyPlanTimeoutRef.current)
  }
}, [])
```
Add the missing cleanup:
```js
useEffect(() => {
  return () => {
    if (exportMsgTimeoutRef.current) clearTimeout(exportMsgTimeoutRef.current)
    if (copyPlanTimeoutRef.current) clearTimeout(copyPlanTimeoutRef.current)
    if (saveLoadTimeoutRef.current) clearTimeout(saveLoadTimeoutRef.current)
  }
}, [])
```

Done when: saveLoadTimeoutRef is cleaned up, build passes.
**Status**: DONE

---

## SC-6 · Fix credits hardcoded to 4 in fallbackSearch
**Priority**: HIGH
**Category impact**: Data integrity +0.5
**Goal**: `fallbackSearch` in ScheduleBuilder.jsx hardcodes `credits: 4` for ALL DB courses (line ~48). Half-courses (2 cr) and modules (2 cr) are incorrectly counted as 4 credits in the plan, corrupting requirements tracking.

In `src/pages/ScheduleBuilder.jsx`, in `fallbackSearch`, the mapped object has:
  `credits: 4,`

Change to use the course's actual credit value:
  `credits: Number(c.credits_min ?? c.credits_max ?? c.credits ?? 4) || 4,`

Done when: DB-sourced courses carry their actual credit value, build passes.
**Status**: DONE

---

## SC-7 · Quick-add completed courses — enrich from courses prop
**Priority**: HIGH
**Category impact**: Data integrity +0.4, UX +0.3
**Goal**: `handleQuickAddCompleted` creates a bare course object with no enrichment (no is_stem, no is_core, no metrics). Requirements engine can't count these for STEM/distribution requirements.

In `src/pages/ScheduleBuilder.jsx`, find `handleQuickAddCompleted` (~line 639):
```js
const handleQuickAddCompleted = () => {
  const courseCode = completedInput.trim().toUpperCase()
  if (!courseCode) return
  addToCompleted({
    courseCode,
    title: courseCode,
    credits: 4,
    sections: [],
    instructors: [],
    enrichment: {},
  })
  setCompletedInput('')
}
```

Replace with a lookup in the `courses` prop first:
```js
const handleQuickAddCompleted = () => {
  const courseCode = completedInput.trim().toUpperCase()
  if (!courseCode) return
  // Try to find the course in the DB for enrichment data
  const found = (Array.isArray(courses) ? courses : [])
    .filter(c => !c.is_average)
    .find(c => {
      const code = (c.course_code_base || c.course_code || '').toUpperCase()
      return code === courseCode || code.startsWith(courseCode + '-') || courseCode.startsWith(code + '-')
    })
  addToCompleted(found ? normalizeCourse({
    ...found,
    courseCode: found.course_code_base || found.course_code,
    title: found.course_name,
    instructors: [found.professor_display || found.professor].filter(Boolean),
    credits: Number(found.credits_min ?? found.credits_max ?? 4) || 4,
    enrichment: {
      is_stem: found.is_stem,
      is_core: found.is_core,
      metrics_pct: found.metrics_pct,
    },
  }) : {
    courseCode,
    title: courseCode,
    credits: 4,
    sections: [],
    instructors: [],
    enrichment: {},
  })
  setCompletedInput('')
}
```

Done when: typing "IGA-109" + Enter finds and enriches the course from DB data; build passes.
**Status**: DONE

---

## SC-8 · Add aria-live region for action feedback (Accessibility)
**Priority**: HIGH
**Category impact**: Accessibility +1.0
**Goal**: State changes like "Added to plan", "Remove ✕" toggle, "Copied!", "Saved!", "Loaded!" have no screen reader announcement. Add a visually hidden `aria-live="polite"` region.

In `src/pages/ScheduleBuilder.jsx`, near the top of the JSX return (inside the outermost div), add:
```jsx
{/* Screen reader announcements */}
<div aria-live="polite" aria-atomic="true" className="sr-only" id="sb-announcer" />
```

Add a helper that updates it: create a ref `const announcerRef = useRef(null)` and a function:
```js
const announce = (msg) => {
  if (announcerRef.current) {
    announcerRef.current.textContent = ''
    setTimeout(() => { if (announcerRef.current) announcerRef.current.textContent = msg }, 50)
  }
}
```

Call `announce()` in:
- `addToShortlist`: `announce(\`Added \${normalized.courseCode} to plan\`)`
- `removeCourse`: `announce(\`Removed \${courseCode} from plan\`)`
- `addToCompleted`: `announce(\`Marked \${normalized.courseCode} as completed\`)`
- `handleCopyPlan` success: `announce('Plan copied to clipboard')`
- `handleExport` success: `announce(\`Exported \${exportable.length} calendar events\`)`

Add `ref={announcerRef}` to the announcer div.

Done when: key actions have aria-live announcements; `sr-only` class is in CSS (check index.css — add if missing: `.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }`); build passes.
**Status**: DONE

---

## SC-9 · Show loading state while sectionTimesMap is fetching
**Priority**: MEDIUM
**Category impact**: UX +0.4
**Goal**: When user changes semester, the sectionTimesMap fetch begins but there's no indication. Cards briefly show "No time data" until data arrives. Add a loading state.

In `src/pages/ScheduleBuilder.jsx`:
1. Add state: `const [sectionTimesLoading, setSectionTimesLoading] = useState(false)`
2. In the sectionTimesMap useEffect, add `setSectionTimesLoading(true)` at the start and `setSectionTimesLoading(false)` in both `.then()` and `.catch()`.
3. In the search results card chip area, when `sectionTimesLoading` is true AND the course has no time data, show a "Loading times…" chip instead of "No time data":
   ```jsx
   {sectionTimesLoading && !courseHasSchedule(course) ? (
     <Chip tone="default">⏳ Loading…</Chip>
   ) : courseHasSchedule(course) ? (
     // existing time chip
   ) : (
     <Chip tone="danger">No time data</Chip>
   )}
   ```
   Apply the same in the shortlist panel cards.

Done when: switching semesters shows "Loading…" chip briefly; build passes.
**Status**: DONE

---

## SC-10 · Conflict indicator — add text label, not just color
**Priority**: MEDIUM
**Category impact**: Accessibility +0.5
**Goal**: Conflicting courses on the schedule grid are shown only via red border/background (color-only). Add a "⚡ Conflict" text label on the block itself so colorblind users can see it.

In `src/pages/ScheduleBuilder.jsx`, in the blocks render (line ~1372), find the course block div:
```jsx
<div key={key} className="absolute z-10 rounded-2xl border p-2" style={{ ..., background: conflict ? 'var(--panel-soft)' : 'var(--accent-soft)', borderColor: conflict ? 'var(--danger)' : 'var(--accent)', ... }}>
  <button ...>
    <p className="truncate pr-6 text-xs font-semibold">{course.courseCode}</p>
    ...
  </button>
```

Add a conflict badge below the course code:
```jsx
{conflict && (
  <p className="mt-0.5 text-[9px] font-bold uppercase tracking-[0.08em]" style={{ color: 'var(--danger)' }}>⚡ Conflict</p>
)}
```

Also update the block's `aria-label` on the inner button to include conflict status:
```jsx
aria-label={`${course.courseCode}${conflict ? ' — time conflict' : ''}`}
```

Done when: conflict blocks show "⚡ Conflict" text label; build passes.
**Status**: DONE

---

## SC-11 · Performance: cache courses in localStorage with 30-min TTL
**Priority**: HIGH
**Category impact**: Performance +1.5
**Goal**: Currently every page load fetches all 5,581 courses from Supabase (6 roundtrips, 3-8 seconds). Cache the result in localStorage with a 30-minute TTL so repeat visits are instant.

In `src/App.jsx`, modify `fetchAllCourses` (or wrap the useEffect that calls it):

```js
const COURSES_CACHE_KEY = 'hks_courses_cache'
const COURSES_CACHE_TTL = 30 * 60 * 1000 // 30 minutes

async function fetchAllCoursesWithCache(onProgress) {
  // Check cache
  try {
    const cached = JSON.parse(localStorage.getItem(COURSES_CACHE_KEY) || 'null')
    if (cached && cached.ts && (Date.now() - cached.ts) < COURSES_CACHE_TTL && Array.isArray(cached.data) && cached.data.length > 1000) {
      if (onProgress) onProgress(cached.data.length)
      return cached.data
    }
  } catch {}
  
  // Fetch fresh
  const courses = await fetchAllCourses(onProgress)
  
  // Cache it
  try {
    localStorage.setItem(COURSES_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: courses }))
  } catch {} // quota exceeded — ignore
  
  return courses
}
```

Replace the call `fetchAllCourses((n) => setLoadCount(n))` with `fetchAllCoursesWithCache((n) => setLoadCount(n))`.

Also: when the STORAGE_VERSION wipe runs (App.jsx line ~219), also clear the courses cache:
  `window.localStorage.removeItem(COURSES_CACHE_KEY)`

Done when: second page load is instant (courses from cache); build passes.
**Status**: DONE

---

## SC-12 · Performance: lazy-load Home, Courses, Faculty, Compare pages
**Priority**: MEDIUM
**Category impact**: Performance +0.8
**Goal**: The main bundle (index-*.js) is 727 kB because Home, Courses, Faculty, Compare are imported statically. Lazy-load them to reduce initial JS parse time.

In `src/App.jsx`, change static imports to lazy:
```js
// BEFORE (static):
import Compare from './pages/Compare.jsx'
import Courses from './pages/Courses.jsx'
import Faculty from './pages/Faculty.jsx'
import Home from './pages/Home.jsx'
import Resources from './pages/Resources.jsx'

// AFTER (lazy):
const Compare   = lazy(() => import('./pages/Compare.jsx'))
const Courses   = lazy(() => import('./pages/Courses.jsx'))
const Faculty   = lazy(() => import('./pages/Faculty.jsx'))
const Home      = lazy(() => import('./pages/Home.jsx'))
const Resources = lazy(() => import('./pages/Resources.jsx'))
```

These are already wrapped in `<Suspense>` via `pageRoutes`, so this should work without further changes.

Done when: build shows separate chunks for Compare, Courses, Faculty, Home; main index bundle is smaller; build passes.
**Status**: DONE

---

## SC-13 · Fix silent plan wipe on storage version mismatch
**Priority**: HIGH
**Category impact**: Data integrity +0.5, UX +0.3
**Goal**: When `STORAGE_VERSION` changes, all plans are silently deleted with no warning. Students can lose their entire semester plan invisibly.

In `src/App.jsx`, find the storage version check useEffect (~line 214):
```js
useEffect(() => {
  const storedVersion = window.localStorage.getItem('hks_storage_version')
  if (storedVersion === STORAGE_VERSION) return
  window.localStorage.removeItem('hks_plan_A')
  // ...
  window.localStorage.setItem('hks_storage_version', STORAGE_VERSION)
}, [])
```

Change to: back up existing plans before wiping, and show a recoverable toast. Simpler approach — just check if plans actually exist before wiping, and if they do, log a warning to console (since we can't show UI before data loads):
```js
useEffect(() => {
  const storedVersion = window.localStorage.getItem('hks_storage_version')
  if (storedVersion === STORAGE_VERSION) return
  // Back up old plans to a recovery key before wiping
  const backup = {}
  ;['A', 'B', 'C', 'D'].forEach(p => {
    const v = window.localStorage.getItem(`hks_plan_Plan ${p}`)
    if (v) backup[`Plan ${p}`] = v
  })
  if (Object.keys(backup).length) {
    window.localStorage.setItem('hks_plan_backup_v1', JSON.stringify({ savedAt: new Date().toISOString(), plans: backup }))
  }
  window.localStorage.removeItem('hks_plan_A')
  window.localStorage.removeItem('hks_plan_B')
  window.localStorage.removeItem('hks_plan_C')
  window.localStorage.removeItem('hks_plan_D')
  window.localStorage.removeItem('hks_completed_courses')
  window.localStorage.setItem('hks_storage_version', STORAGE_VERSION)
}, [])
```

Done when: old plans are backed up to `hks_plan_backup_v1` before wipe; build passes.
**Status**: DONE

---

## SC-14 · Harvard API non-HKS search — don't hardcode school:'HKS'
**Priority**: MEDIUM
**Category impact**: Core functionality +0.4
**Goal**: `searchHarvardCourses` is called with `school: 'HKS'` hardcoded regardless of `searchSource`. When user selects 'All' or 'Non-HKS', cross-reg courses won't appear in live results.

In `src/pages/ScheduleBuilder.jsx`, line ~360:
```js
const remote = await searchHarvardCourses(query, { term: `${termYear}${semesterKey}`, school: 'HKS' })
```

Change to:
```js
const schoolParam = searchSource === 'Non-HKS' ? undefined : searchSource === 'HKS' ? 'HKS' : undefined
const remote = await searchHarvardCourses(query, { term: `${termYear}${semesterKey}`, ...(schoolParam ? { school: schoolParam } : {}) })
```

Then apply the source filter client-side after normalization (already done for stem/core — add source):
```js
if (searchSource === 'HKS') normalized = normalized.filter(c => isHksCourse(c.courseCode))
if (searchSource === 'Non-HKS') normalized = normalized.filter(c => !isHksCourse(c.courseCode))
```

Done when: 'All' and 'Non-HKS' source selections search across schools; build passes.
**Status**: DONE

---

## SC-15 · Requirements page real-time sync within same SPA session
**Priority**: MEDIUM
**Category impact**: UX +0.4, Core functionality +0.3
**Goal**: If Schedule Builder is used and then user navigates to Requirements in the same session via NavLink (no tab change, no focus event), Requirements shows stale plan data.

In `src/pages/Requirements.jsx`, the sync relies on `window.addEventListener('focus', syncPlanCourses)` — which doesn't fire on same-tab SPA navigation.

Fix: Add a `storage` event listener to catch same-origin localStorage changes:
```js
// Already present — confirm it handles same-tab writes
```

Actually the `storage` event only fires in OTHER tabs/windows, not the same tab. For same-tab sync, use a custom event:

In `src/lib/scheduleStorage.js`, in `savePlan`, after writing to localStorage, dispatch a custom event:
```js
window.dispatchEvent(new CustomEvent('hks-plan-updated', { detail: { planName: stampedPlan.name } }))
```

In `src/pages/Requirements.jsx`, add listener:
```js
window.addEventListener('hks-plan-updated', syncPlanCourses)
// cleanup:
window.removeEventListener('hks-plan-updated', syncPlanCourses)
```

Done when: adding a course in Schedule Builder immediately updates Requirements if user switches; build passes.
**Status**: DONE

---

## SC-16 · End-to-end score verification
**Priority**: HIGH
**Goal**: After all SCs are DONE, re-evaluate all 6 category scores. Each must be 9/10 or higher.

Checklist:
1. `npm run build` — zero errors
2. Verify SC-1: grep `limit=2000` in ScheduleBuilder
3. Verify SC-2: grep `TZID=America/New_York` and Spring-FULL date in buildIcs
4. Verify SC-3: grep `Remove ✕` — no `Remove X` remains
5. Verify SC-4: browseAll state exists, hasFilters doesn't count HKS default
6. Verify SC-5: saveLoadTimeoutRef in cleanup
7. Verify SC-6: credits use course value not hardcoded 4
8. Verify SC-7: handleQuickAddCompleted looks up courses prop
9. Verify SC-8: aria-live announcer div exists
10. Verify SC-9: sectionTimesLoading state exists
11. Verify SC-10: conflict text label in block render
12. Verify SC-11: fetchAllCoursesWithCache in App.jsx
13. Verify SC-12: Compare/Courses/Faculty/Home are lazy in App.jsx
14. Verify SC-13: backup logic before wipe
15. Verify SC-14: school param conditional on searchSource
16. Verify SC-15: hks-plan-updated custom event in scheduleStorage + Requirements listener
17. Run build again
18. Re-score all 6 categories. If any <9, identify remaining gaps and add new SCs.
19. Mark ITERATION_LOG Status: COMPLETE only when ALL categories ≥9.

**Status**: PENDING
