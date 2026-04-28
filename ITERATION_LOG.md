# Iteration Log
Generated: 2026-04-27
Goal: 4-issue quality pass — Schedule Builder UX, mobile pinch zoom, requirements double-counting, HKS default view
Status: COMPLETE

## Context for all agents
- Project root: C:\Users\micgr\OneDrive\Desktop\Antigravity\Data_Science_Claude\hks-course-explorer
- React + Vite SPA. Run `npm run build` after every JS/JSX change. Fix ALL errors before marking DONE.
- Commit each SC separately: `git commit -m "fix: SC-N · <title>"`
- Read every file before editing. Never blindly overwrite.
- Today is April 2026 → current semester is Spring.
- The sectionTimesMap is keyed by course_code_base (e.g. "IGA-109"), not full code.
- enrichedSearchResults already merges sectionTimesMap into search result objects.

---

## SC-1 · Remove prominent Spring/Fall/J-term tabs from Schedule Builder search panel
**Priority**: HIGH
**Goal**: The semester pills (Spring | Fall | J-term) should not take up a full row in the search panel. Replace with a small compact inline selector that is visually secondary. The semester is still needed internally (it drives sectionTimesMap fetch and search API calls), so don't delete the state — just demote the UI.

Read src/pages/ScheduleBuilder.jsx.
Find the two occurrences of SEMESTER_OPTIONS.map in the JSX (search panel filter area).
The one INSIDE the filter section (around line 1049–1068): replace the full pill row with a single compact inline `<select>` dropdown styled like the other selects in the panel:
  <select value={semester} onChange={e => setSemester(e.target.value)} style={{ ...existing select styles... }}>
    <option value="Spring">Spring 2026</option>
    <option value="Fall">Fall 2025</option>
    <option value="January">January 2025</option>
  </select>

The other occurrence (around line 902 — if it's in the top-of-panel header area): remove it entirely.

After the change the semester is still fully functional — just takes up a single compact dropdown line instead of a full pill row.

Done when: semester pills are gone, replaced by a compact select, build passes.
**Status**: DONE

---

## SC-2 · Make "Added ✓" button toggle — click again removes course from plan
**Priority**: HIGH
**Goal**: When a course card in the search results shows "Added ✓", clicking it again should remove the course from the plan (call removeCourse). Currently the button is `disabled={added || done}`.

In src/pages/ScheduleBuilder.jsx, find the search result card button (around line 1206):
  <button ... disabled={added || done} onClick={() => addToShortlist(course)}>
    {added ? 'Added ✓' : 'Add'}
  </button>

Change to:
  <button
    type="button"
    disabled={done}  // only disable if marked done, not if added
    onClick={() => added ? removeCourse(course.courseCode) : addToShortlist(course)}
    className="rounded-full border px-3 py-1.5 text-xs font-semibold transition-transform enabled:hover:-translate-y-[1px] disabled:cursor-default"
    style={{
      background: added ? 'var(--danger-soft, #fff0f0)' : 'var(--accent-soft)',
      borderColor: added ? 'var(--danger, #c0392b)' : 'var(--line-strong)',
      color: added ? 'var(--danger, #c0392b)' : 'var(--text)',
    }}
    aria-label={added ? `Remove ${course.courseCode} from plan` : `Add ${course.courseCode} to plan`}
  >
    {added ? 'Remove ✕' : 'Add'}
  </button>

Done when: clicking "Remove ✕" removes the course from the plan and card reverts to "Add". Build passes.
**Status**: DONE

---

## SC-3 · Sort search results: time-data courses first, then "not currently offered"
**Priority**: HIGH
**Goal**: Courses with schedule/time data (from sectionTimesMap or API) appear at the TOP of search results. Courses with no time data (DB-only, not currently offered in the selected semester) appear at the BOTTOM with a visual separator label.

In src/pages/ScheduleBuilder.jsx, in the `filteredSearchResults` useMemo (currently the final filter step):
After filtering, sort the results:
  const withTime = results.filter(c => courseHasSchedule(c) || c._hasLiveTimes)
  const withoutTime = results.filter(c => !courseHasSchedule(c) && !c._hasLiveTimes)
  return [...withTime, ...withoutTime]

Then in the JSX where filteredSearchResults.map renders cards, split the render into two groups:
  const withTime = filteredSearchResults.filter(c => courseHasSchedule(c) || c._hasLiveTimes)
  const withoutTime = filteredSearchResults.filter(c => !courseHasSchedule(c) && !c._hasLiveTimes)

Render withTime group first (no label needed, or small "Offered this semester" label).
Then if withoutTime.length > 0, render a divider:
  <div style={{ borderTop: '1px solid var(--line)', margin: '8px 0 4px', paddingTop: 8 }}>
    <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.1em', color: 'var(--text-muted)' }}>
      Not offered this semester · {withoutTime.length}
    </p>
  </div>
Then render withoutTime cards.

Update the result count line to show: "N offered · M not offered this semester" when both groups are present.

Done when: courses with time data visually appear first, "Not offered this semester" section is clearly labeled, build passes.
**Status**: DONE

---

## SC-4 · Mobile: scatter plot zooms only on 2-finger pinch, not on single-touch scroll
**Priority**: HIGH
**Goal**: On mobile, scrolling into the corner of the scatter plot currently triggers zoom. Fix: disable Plotly's built-in scrollZoom and implement custom 2-finger pinch detection that calls the existing zoom function.

Read src/components/ScatterPlot.jsx.

Step 1: In the plotConfig useMemo (around line 669), change:
  scrollZoom: true
to:
  scrollZoom: false

Step 2: Find where chartWrapperRef is used. Add a useEffect that attaches touch listeners to the plot container div:

useEffect(() => {
  const el = chartWrapperRef.current
  if (!el) return
  let lastDist = null

  const onTouchMove = (e) => {
    if (e.touches.length !== 2) return  // only 2-finger pinch
    e.preventDefault()
    const dx = e.touches[0].clientX - e.touches[1].clientX
    const dy = e.touches[0].clientY - e.touches[1].clientY
    const dist = Math.sqrt(dx * dx + dy * dy)
    if (lastDist !== null) {
      const factor = lastDist / dist  // >1 = zoom in, <1 = zoom out
      if (Math.abs(factor - 1) > 0.01) {
        // call the existing handleWheel-style zoom — look for handleWheel or zoom function
        // If there's a handleZoom or handleWheel function, call it with factor
        // Otherwise call setZoomedX/setZoomedY directly:
        setZoomedX(prev => zoomNumericDomain(prev, xMode.domain, factor))
        setZoomedY(prev => zoomNumericDomain(prev, yMode.domain, factor))
      }
    }
    lastDist = dist
  }

  const onTouchEnd = () => { lastDist = null }

  el.addEventListener('touchmove', onTouchMove, { passive: false })
  el.addEventListener('touchend', onTouchEnd, { passive: true })
  return () => {
    el.removeEventListener('touchmove', onTouchMove)
    el.removeEventListener('touchend', onTouchEnd)
  }
}, [xMode.domain, yMode.domain])

Read the file carefully to find the exact names of: chartWrapperRef, zoomNumericDomain, xMode, yMode, setZoomedX, setZoomedY. Use the exact names from the file.

Done when: single-finger touch no longer zooms the plot on mobile; two-finger pinch still zooms; desktop scroll wheel still works (if handled separately); build passes.
**Status**: DONE

---

## SC-5 · Fix STEM double-counting cap: only 8 credits may overlap with other requirements
**Priority**: HIGH
**Goal**: The rule is: "16 STEM credits required. Up to 8 credits may simultaneously count toward another distribution requirement." Currently the engine has nonExclusive: true with NO credit cap — all 16 STEM credits can also count for other requirements, which is wrong.

Read src/lib/requirementsEngine.js and src/data/programRequirements.json.

The fix requires two parts:

Part A — programRequirements.json:
For each program that has a STEM category (MPA_2YR, MPA_ID, MC_MPA), add a field:
  "overlapCap": 8
to the STEM category object. This means "at most 8 credits of this nonExclusive category may also count toward exclusive categories."

Part B — requirementsEngine.js:
In the computeProgress function, after computing all categories, find the STEM category result.
Currently nonExclusive categories "don't consume usedIndices" — all their courses remain available for other categories.
With the overlapCap fix:
- STEM courses that are ALSO counted by another (exclusive) category should be capped at 8 credits
- Courses beyond the 8-credit overlap must be STEM-only (they count toward STEM but NOT toward other exclusive requirements)

Implementation:
After the main category loop, do a second pass:
1. Find all categories with overlapCap defined
2. For each such category, look at how many credits of its selectedCourses are ALSO in other categories' selectedCourses
3. If overlap exceeds overlapCap, un-consume the excess from other categories (add back to usedIndices) and report a warning in the category result

Simpler approach (good enough for display purposes):
In the STEM category result, add a field:
  overlapCredits: number of STEM credits that also appear in other categories' selectedCourses
  cappedOverlapCredits: Math.min(overlapCredits, category.overlapCap || Infinity)
  effectiveNonStemCredits: STEM credits that do NOT overlap (must be satisfied by pure STEM courses)

Then in the Requirements UI display (find the STEM category display in src/pages/Requirements.jsx or wherever it renders), show a note:
  "Up to 8 credits may also count toward distribution requirements. X of your Y STEM credits currently overlap."

Done when: overlapCap: 8 added to all STEM categories in programRequirements.json, engine tracks overlap, UI shows a note if overlap > 8; build passes.
**Status**: DONE

---

## SC-6 · Make HKS the default source view; update onboarding tour to reflect this
**Priority**: MEDIUM
**Goal**: The Schedule Builder already defaults to HKS (useState('HKS') at line 287 — confirmed). Check and confirm this is working. Then update the onboarding tour steps and user-guide.html to say "HKS courses" as the default view, not "All sources".

Step 1: Read src/pages/ScheduleBuilder.jsx line 287. Confirm searchSource default is 'HKS'. If not, change it.

Step 2: Read src/components/OnboardingTour.jsx. Find any step text that mentions "All sources", "all courses", or implies non-HKS courses are shown by default. Update to say "HKS courses are shown by default. Use the source filter to include cross-registration courses."

Step 3: Check if public/user-guide.html exists. If yes, find any mention of "All" sources filter. Update to reflect HKS as default.

Step 4: In the Schedule Builder search panel, confirm the "All | HKS | Non-HKS" row visually shows HKS as highlighted/selected by default when the page loads. If the default state already does this, just verify.

Done when: HKS confirmed as default, tour/guide text updated, build passes.
**Status**: DONE

---

## SC-7 · End-to-end verification + real-life test checklist
**Priority**: HIGH
**Goal**: Run a systematic check of all 6 SCs after they are implemented.

1. `npm run build` — must pass with zero errors
2. Check SC-1: read ScheduleBuilder.jsx — semester pills line must be gone, compact select must exist
3. Check SC-2: read the Add/Remove button — must call removeCourse when added=true
4. Check SC-3: read filteredSearchResults logic — withTime sorted before withoutTime
5. Check SC-4: read ScatterPlot.jsx — scrollZoom must be false, touchmove handler must exist, 2-touch check must be present
6. Check SC-5: read programRequirements.json — STEM categories must have overlapCap: 8; read requirementsEngine.js — overlap tracking must exist
7. Check SC-6: confirm useState('HKS') default in ScheduleBuilder
8. Run build one more time after all checks pass
9. Mark ITERATION_LOG Status: COMPLETE

Done when: all checks pass, build passes, status set to COMPLETE.
**Status**: DONE
