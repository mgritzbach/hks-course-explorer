# HKS Course Explorer — v2 Hidden Features: Development Plan

## Architecture Overview
Three new routes, **not linked from main nav** (accessible by direct URL only):
- `/schedule-builder` — timetable + Harvard API + Q-guide enrichment + requirement tracking
- `/requirements` — standalone program requirements tracker
- `/admin` — password-protected data upload dashboard

---

## Gate Structure (each phase must pass ALL tests before advancing)

---

## PHASE 0 — Foundation
**Goal:** Routing works, DB tables exist, all dependencies installed, build passes.

### Tasks
- [x] Install deps: `xlsx`, `uuid`, `react-dnd`, `react-dnd-html5-backend`, `ics`
- [ ] Run `002_hidden_features.sql` Supabase migration
- [ ] Add 3 stub pages (ScheduleBuilder, Requirements, Admin) as lazy-loaded routes in App.jsx
- [ ] Create Cloudflare Function `functions/api/harvard-courses.js` (stub returns mock data)
- [ ] Create `functions/api/admin-verify.js` (stub)
- [ ] Create `src/lib/` utilities: `localUserId.js`, `scheduleStorage.js`, `conflictDetector.js`, `icalGenerator.js`, `xlsxParser.js`, `courseMatcher.js`, `requirementsEngine.js`, `harvardApi.js`
- [ ] Create `src/data/programRequirements.json` ✅ DONE

### ✅ Gate Tests (must ALL pass)
1. `npm run build` completes with no errors
2. `http://localhost:5173/schedule-builder` renders "Schedule Builder — Coming Soon"
3. `http://localhost:5173/requirements` renders "Requirements — Coming Soon"
4. `http://localhost:5173/admin` renders "Admin — Coming Soon"
5. Supabase `schedules` table exists (check Studio)
6. Supabase `uploads` table exists
7. Supabase `program_requirements` table exists
8. None of the 3 new routes appear in the sidebar nav

---

## PHASE 1 — Requirements Tracker `/requirements`
**Goal:** Full requirements page working for all 5 programs with real data.

### Tasks
- [ ] `requirementsEngine.js` — `computeProgress(programId, courses[])` function
- [ ] `Requirements.jsx` — program selector dropdown (MPA, MPP Y1, MPP Y2, MPA-ID, MC-MPA)
- [ ] Credit counter (earned X / required Y)
- [ ] Per-category progress bars (earned / required credits, %)
- [ ] "Find completing courses" link → `/courses?codes=API-165,DEV-130,...`
- [ ] Persists selected program in localStorage
- [ ] Dark/light theme using CSS variables only (no hardcoded colors)
- [ ] Responsive (works on mobile)

### ✅ Gate Tests
1. Visit `/requirements`, default shows MPA program
2. Change to MPP Y1 — total required shows 32 cr, 9 categories visible
3. Change to MC-MPA — total required shows 32 cr
4. With no courses selected: all progress bars at 0%
5. "Find completing courses" link for EconQuant opens `/courses?code=API-165` (or similar filter)
6. Selected program survives page refresh (localStorage)
7. Dark mode: all elements use CSS variables, no hardcoded hex colors
8. Mobile (375px): layout stacks cleanly, progress bars visible
9. `requirementsEngine.computeProgress('MPA_2YR', [])` returns `{ totals: { earned: 0, required: 64 }, categories: [...] }`
10. `requirementsEngine.computeProgress('MPA_2YR', [{ course_code_base: 'API-302', credits: 4 }])` marks dist_econquant as satisfied

---

## PHASE 2 — Admin Upload Page `/admin`
**Goal:** Password gate + all 4 upload tables functional.

### Tasks
- [ ] `PasswordGate.jsx` — form, POST to `/api/admin-verify`, store token in sessionStorage
- [ ] Hardcoded password configured via Cloudflare env var `ADMIN_PASSWORD`
- [ ] `XlsxDropzone.jsx` — drag-and-drop or file picker, parse with `xlsx`, preview first 5 rows
- [ ] `UploadTable.jsx` — shows last 10 uploads from Supabase `uploads` table, filename/date/rows/status
- [ ] Upload types: `bidding` (→ upsert `courses.bid_clearing_price` etc.), `qguide` (→ upsert `metrics_raw`), `requirements_tags` (→ upsert `is_core`, `is_stem`), `stem_designations` (→ upsert `is_stem`)
- [ ] All writes go through Cloudflare Function with service role key (RLS bypass)
- [ ] `DownloadButton` — export current Supabase data as xlsx
- [ ] Wrong password: show error, no session stored
- [ ] Session clears on tab close (sessionStorage)

### ✅ Gate Tests
1. Visit `/admin` → password form visible, no dashboard content
2. Enter wrong password → "Incorrect password" error shown
3. Enter correct password → dashboard appears with 4 upload sections
4. Refresh → must re-enter password (sessionStorage only)
5. Drop a valid bidding xlsx → preview table shows first 5 rows
6. Confirm upload → Supabase `uploads` table gains a new row with correct type/filename
7. Drop an invalid file (e.g., .pdf in xlsx dropper) → error "Invalid file format"
8. Download button for `courses` → downloads a valid xlsx file
9. Admin page does NOT appear in main nav (confirm navItems array unchanged)

---

## PHASE 3 — Harvard API Proxy (Cloudflare Function)
**Goal:** Live Harvard course search working through the proxy.

### Tasks
- [ ] `functions/api/harvard-courses.js` — full implementation with caching, normalization
- [ ] `HARVARD_API_KEY` secret set in Cloudflare Pages (not in code)
- [ ] `harvardApi.js` — client wrapper: `searchCourses(q, term)` → normalized results
- [ ] `useHarvardSearch.js` hook — debounced 300ms, min 2 chars
- [ ] `courseMatcher.js` — match API results to Supabase by `course_code_base`
- [ ] Handle: no results, API down, CORS

### ✅ Gate Tests
1. `curl https://hks-course-explorer.pages.dev/api/harvard-courses?q=API-101` returns JSON with `results[]`
2. Each result has: `courseCode`, `title`, `instructors[]`, `sections[].meetings[]`
3. `curl` with `q=a` (1 char) returns 400 error
4. `courseMatcher.matchBatch(['API-101','API-302'])` returns map with Supabase enrichment data
5. Course found in Supabase: enrichment has `is_stem`, `is_core`, `metrics_pct`, `bid_clearing_price`
6. Course NOT in Supabase: enrichment is `null` (no crash)
7. Repeated same query within 5 min: served from edge cache (check CF Cache-Status header)

---

## PHASE 4 — Schedule Builder Phase A (Click-to-add, no drag)
**Goal:** Functional schedule builder — search, add to shortlist, place on grid, conflicts detected.

### Tasks
- [ ] `ScheduleBuilder.jsx` — layout with 3 panels (search / grid / shortlist+reqs)
- [ ] `TermTabs.jsx` — Q1 / Q2 / Full Term selector
- [ ] `PlanSwitcher.jsx` — Plan A / Plan B, stored in localStorage
- [ ] `TimetableGrid.jsx` — Mon–Fri, 8am–6pm, 30-min slots
- [ ] `TimetableBlock.jsx` — renders a placed course with time, code, location
- [ ] `CourseSearchPanel.jsx` — search box → `useHarvardSearch` → result cards with "+ Add" button
- [ ] `ShortlistPanel.jsx` — courses added but not yet placed; section selector
- [ ] `SectionSelector.jsx` — dropdown picking which meeting time section to use
- [ ] `ConflictBadge.jsx` — shown on conflicting courses in grid and shortlist
- [ ] `conflictDetector.js` — time-overlap algorithm (day + minute range)
- [ ] Courses from Harvard API that match Supabase: show Q-score, Core/STEM tags
- [ ] `EnrichmentTags.jsx` — Core / STEM / Q-score chip badges
- [ ] Click placed block → detail popover (title, instructor, Q-score, bid price)
- [ ] `scheduleStorage.js` — persist plan to localStorage + debounced Supabase upsert

### ✅ Gate Tests
1. Visit `/schedule-builder` — three-panel layout renders, no console errors
2. Type "API" in search → results appear within 500ms of debounce
3. Click "+ Add" on a result → course moves to shortlist
4. Select a section in shortlist → course block appears on timetable grid at correct time/day
5. Add two courses at same time → both show ConflictBadge (red warning icon)
6. Switch to Plan B → grid is empty; switch back to Plan A → courses restored
7. Refresh page → shortlist and grid restored from localStorage
8. Course that exists in Supabase DB shows: green Core tag OR blue STEM tag where applicable
9. Course NOT in Supabase shows: grey "No Q-data" label (no crash)
10. Q1 tab selected → only Q1 courses shown in timetable; Full Term shows all
11. Conflict algorithm test: `conflictDetector(['MON 10:15-11:30'], ['MON 11:00-12:00'])` → returns conflict

---

## PHASE 5 — Schedule Builder Phase B (Drag + Requirements Sidebar)
**Goal:** Drag-and-drop, requirements sidebar synced with schedule.

### Tasks
- [ ] Wrap `ScheduleBuilder` in `<DndProvider backend={HTML5Backend}>`
- [ ] `DraggableCourseCard.jsx` — courses in shortlist are draggable
- [ ] Drop targets on `TimetableGrid` (30-min cells) → snap to nearest section meeting
- [ ] `RequirementsSidebar` embedded in schedule builder right panel
- [ ] Live requirement progress updates as courses are added/removed from schedule
- [ ] `ICalExportButton.jsx` — generate `.ics` file with RRULE for each meeting through term end
- [ ] Desktop-only message on mobile (below `md` breakpoint)
- [ ] iCal export tested for correct VEVENT format

### ✅ Gate Tests
1. Drag a course from shortlist → drop on timetable → course placed at correct time
2. Drag course OFF timetable → returns to shortlist
3. Add API-101 (a Core course) to schedule → EconQuant distribution shows progress increase
4. Add MLD-201 → MLD distribution shows satisfied (100%)
5. Remove course from schedule → requirement progress reverts
6. Click "iCal Export" → downloads `.ics` file
7. `.ics` file opens in Calendar app and shows events on correct days
8. Visit `/schedule-builder` on 375px viewport → "Desktop recommended" message shown
9. Total credit counter updates correctly as courses added/removed

---

## PHASE 6 — Polish, Theme Audit & Deployment
**Goal:** All pages pixel-perfect in dark+light, deployed to Cloudflare, all buttons tested.

### Tasks
- [ ] Audit every new component: zero hardcoded hex colors, uses `var(--crimson)`, `var(--gold)`, `var(--text)`, `var(--panel)`, etc.
- [ ] Test dark/light toggle on every new page
- [ ] All loading states: spinners/skeletons for API calls
- [ ] All error states: network errors, empty results, parse failures
- [ ] Add `HARVARD_API_KEY` and `ADMIN_PASSWORD` to Cloudflare Pages env vars
- [ ] Push to master → Cloudflare deploys
- [ ] Verify all 3 hidden pages accessible on production URL

### ✅ Gate Tests (Final Acceptance)
1. `/schedule-builder`, `/requirements`, `/admin` all load on production
2. Dark mode: no white flashes, all backgrounds match theme
3. Light mode: all text readable, no crimson-on-crimson issues
4. Main nav (`/`, `/courses`, `/faculty`, `/compare`) shows NO new links
5. All console errors = 0 on each new page
6. Admin password gate: wrong password rejected on production
7. Harvard API proxy working on production (not just localhost)
8. A full schedule (3 courses) can be built, requirements tracked, exported to iCal
9. Upload a test xlsx on `/admin` → data updates in Supabase Studio
10. Lighthouse accessibility score ≥ 80 on `/requirements`

---

## Dependencies to Install
```bash
npm install xlsx uuid react-dnd react-dnd-html5-backend ics
```

## Cloudflare Secrets Needed
```
HARVARD_API_KEY = <from Harvard ATS portal>
ADMIN_PASSWORD  = <set by Michael>
SUPABASE_SERVICE_ROLE_KEY = <from Supabase Settings > API>
```

## Supabase Migration: `002_hidden_features.sql`
Run via Supabase MCP `apply_migration` on project `cbtroatixvydpwoviezf`.

---

## Testing Protocol After Each Phase
1. Run `npm run build` — must succeed
2. Run `npm run preview` — load each route manually
3. Check browser console — zero errors
4. Check network tab — no failed requests
5. Test dark AND light mode
6. Test on Chrome + Safari (check for CSS issues)
7. Resize to 375px — check mobile handling
8. Run all gate tests listed for that phase
9. Git commit with phase tag: `[PHASE-X] description`
10. If ANY gate fails: fix before moving to next phase
