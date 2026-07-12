# Architecture overview

## Runtime boundaries

```
Browser (React/Vite)
  |-- Supabase read client: historical courses, live courses, sections
  |-- Cloudflare Pages Functions: auth, protected catalogue, chat
  |-- Static assets: courses.json, sim_coords.json, Guide, SPA routes
  '-- Local browser storage: plans, shortlist, notes, UI preferences

GitHub Actions
  |-- Build and test gates
  |-- Scheduled authoritative HKS sync -> my.harvard -> Supabase live_courses
  '-- Scheduled non-HKS sync -> Harvard ATS API -> Supabase live_courses
```

The browser uses only the Supabase anon key. Trusted source synchronisation,
provider keys, OTP delivery, and JWT signing run outside the browser.

## Source-of-truth rules

- `data/canonical_courses_enriched.csv` is the canonical historical-evaluation
  input. `scripts/build_data.py` generates `public/courses.json` and
  `public/sim_coords.json`.
- `live_courses` and `course_sections` are the current-offering sources.
  Active HKS rows are owned only by the my.harvard promotion; the general ATS
  sync owns non-HKS rows. A failed sync must preserve the previously served
  catalogue.
- Browser local storage is a convenience copy for personal planning; it is not a
  substitute for a backed-up authenticated schedule service.
- Term formats are intentionally different: live courses use `YYYY Semester`,
  while sections use `YYYYSemester`. ADR-004 describes the conversion.

## Reliability contracts

- my.harvard and the Harvard ATS API are daily ingestion dependencies, not
  browser search dependencies. HKS and non-HKS ownership is disjoint so one
  source cannot replace the other. A failed sync preserves the last
  successfully synced catalogue.
- The deployed legacy Harvard proxy is not called by the browser and is kept
  only until a separately reviewed external-consumer retirement decision.
- Live-sync writes are skipped entirely if any upstream source request fails.
- After upstream validation, one service-only Postgres RPC validates and
  upserts the entire fetched catalogue in a single transaction. A database
  failure therefore preserves the prior `live_courses` state rather than
  exposing a partial batch refresh. Stale-row deletion remains opt-in.
- Static routes that must not fall through to the SPA are explicitly listed
  before the SPA catch-all in `public/_redirects`.
- Every external contract requires fixtures/contract tests before a release.

## Maintainability controls

`npm run check:architecture` prevents further growth of the four largest
legacy UI modules while they are decomposed behind existing regression tests.
Do not raise a limit casually: the pull request must include the reason, a
reviewed architecture decision, and evidence that the affected user flow still
works. The ratchet is deliberately not a substitute for incremental module
extraction; it keeps that extraction from becoming harder while preserving a
stable production baseline.

The limits were recalibrated once when Prettier was adopted for the complete
JavaScript/JSX baseline. [ADR-006](decisions/ADR-006-formatter-normalized-architecture-ratchet.md)
records the approved figures, evidence standard, and mandatory successor-ADR
process. The UI complexity gate remains format-independent and continues to
prevent growth in the guarded root functions.

The ESLint import boundary also treats `src/lib/` as the dependency floor:
libraries may not import pages, components, or the application shell. Move
shared behavior downward into a library or upward into a hook instead of
coupling a reusable data contract to a specific screen.

`src/lib/schedulePlanMutations.js` owns the pure, immutable transitions for
Schedule Builder's persisted plan and completed-course collections. The page
retains browser-storage persistence, UI announcements, and component-local
interaction state; tests exercise the mutation contract directly.

`src/components/CompletedCoursesPanel.jsx` owns the Completed Courses sidebar
presentation plus its ephemeral search and quick-add input state. Schedule
Builder retains the persisted completed collection, normalized course data,
and add/remove callbacks, making browser storage and user-visible
announcements a single parent-owned responsibility. `src/lib/hksCourseCodes.js`
is the shared, tested HKS-prefix contract used by both boundaries.

`src/components/ManualCourseModal.jsx` owns the temporary cross-registration
form, including Escape handling and course-entry normalization. Schedule
Builder retains plan persistence and the explicit add/close callbacks. Its
companion `ScheduleProgressBar` is an accessible display primitive rather than
another responsibility of the page root. After these extractions, the Schedule
Builder size ratchet is 3,577 non-empty lines; it must not be increased without
the ADR and regression evidence described above.

`src/lib/analytics.js` queues non-critical PostHog initialization and capture
until after the app starts. Product analytics remain available when configured,
but course search and navigation no longer carry the analytics library in the
startup bundle.

`src/components/SchedulePlanHeader.jsx` owns only the desktop plan-management
controls. Schedule Builder retains all storage, import/export, and scheduling
orchestration, passing explicit callbacks to keep the header independently
reviewable and reusable.

`src/lib/courseCatalogPresentation.js` owns Course Explorer's deterministic
option deduplication, filtering, and ordering. The page retains URL state,
React deferral, and selection behavior; focused tests protect the catalogue
presentation contract.

## Required future platform work

The repository includes a forward-only administrative-import migration at
`supabase/migrations/20260710003218_corporate_admin_import.sql`. It is not a
complete baseline for a new project: it relies on the established production
catalogue and `uploads` contracts. Do not apply it to an unverified project.
Before promotion, apply it to a staging clone and verify role access, repeated
imports, rollback behavior, and restore procedures.
