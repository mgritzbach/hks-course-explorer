# Iteration Log
Generated: 2026-04-26
Goal: Add day-of-week and time-of-day filter to the course list
Status: COMPLETE

## Context for all agents
- Project root: C:\Users\micgr\OneDrive\Desktop\Antigravity\Data_Science_Claude\hks-course-explorer
- React + Vite SPA. Data served from Supabase (5,581 courses) AND cached in public/courses.json
- NO meeting schedule data exists anywhere in the current dataset — courses.json has no day/time fields
- All filter logic lives in src/pages/Home.jsx (applyFilters function) and src/components/Sidebar.jsx
- Filters state is managed in App.jsx and passed down as props
- Term filter uses toggle pills (multi-select array). Day filter should follow the same pattern
- After any JS/JSX change: run `npm run build` in project root to verify no compile errors
- Commit each SC separately with message: "feat: SC-N · <title>"

---

## SC-1 · Add meeting_days and meeting_time fields to the data schema
**Priority**: HIGH
**Goal**: Every course object throughout the codebase (courses.json structure, Supabase table,
load_to_supabase.py prepare_row) gains two new nullable fields:
  - `meeting_days`: array of strings e.g. ["Mon", "Wed"] — null if unknown
  - `meeting_time`: string "HH:MM" 24h start time e.g. "10:00" — null if unknown
  - `meeting_time_end`: string "HH:MM" 24h end time e.g. "11:30" — null if unknown

Tasks:
1. Add an ALTER TABLE migration SQL file at supabase/migrations/add_meeting_schedule.sql:
   ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS meeting_days text[] DEFAULT NULL;
   ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS meeting_time text DEFAULT NULL;
   ALTER TABLE public.courses ADD COLUMN IF NOT EXISTS meeting_time_end text DEFAULT NULL;
   CREATE INDEX IF NOT EXISTS idx_courses_meeting_days ON public.courses USING GIN (meeting_days);

2. In scripts/load_to_supabase.py inside prepare_row(), add the three new fields with
   row.get('meeting_days', None), row.get('meeting_time', None), row.get('meeting_time_end', None)

3. In public/courses.json — do NOT modify the file itself. The schema change is additive;
   courses without schedule data will simply have null for these fields when loaded.

4. Add a comment in src/App.jsx above the fetchAllCourses function noting that
   meeting_days, meeting_time, meeting_time_end are nullable fields added 2026-04-26.

Done when: migration SQL file exists, load_to_supabase.py includes the three fields,
src/App.jsx has the comment. `npm run build` passes.
**Status**: DONE

---

## SC-2 · Write a meeting-time scraper script
**Priority**: HIGH
**Goal**: Create scripts/scrape_meeting_times.py that fetches meeting schedule data
from public HKS course catalog pages and writes results to scripts/meeting_times_output.json.

The script must:
1. Read public/courses.json and extract all unique course_url values where course_url is not null/empty
2. For each URL (rate-limited to 1 request/second, with retry on 429/503):
   - Fetch the HKS course page (e.g. https://www.hks.harvard.edu/courses/api-101)
   - Parse HTML using BeautifulSoup to find meeting day/time patterns
   - Look for patterns like: "Monday, Wednesday 10:00am-11:30am", "Tues/Thurs 2:15-3:45pm"
   - Common CSS selectors to try: .course-schedule, .meeting-times, .field--name-field-meeting-time,
     any element containing text matching regex: (Mon|Tue|Wed|Thu|Fri|Monday|Tuesday|Wednesday|Thursday|Friday)
3. Normalize extracted data into:
   - meeting_days: list of short codes ["Mon", "Tue", "Wed", "Thu", "Fri"]
   - meeting_time: "HH:MM" 24h string for start
   - meeting_time_end: "HH:MM" 24h string for end
4. Write results to scripts/meeting_times_output.json as:
   { "course_url": { "meeting_days": [...], "meeting_time": "...", "meeting_time_end": "..." }, ... }
5. Print progress every 50 URLs. Skip URLs that 404 or timeout after 10s.

Also create scripts/apply_meeting_times.py that:
- Reads scripts/meeting_times_output.json
- Reads public/courses.json
- Merges meeting schedule data into each course by matching course_url
- Writes updated public/courses.json in place (preserving all other fields)

Done when: both scripts exist, are syntactically valid Python 3, include a `if __name__ == "__main__":` block,
and have a short usage comment at the top. No need to actually run them — Codex should not make network calls.
**Status**: DONE

---

## SC-3 · Add Day-of-Week filter UI to Sidebar
**Priority**: HIGH
**Goal**: Add a "Days" filter section to src/components/Sidebar.jsx that lets users
select one or more days (Mon Tue Wed Thu Fri) using toggle pills — identical in style
to the existing Term filter pills (Fall / Spring / January).

Implementation:
1. The filter value is `filters.days` — an array of day codes e.g. ["Mon", "Wed"].
   Empty array means "all days" (no filter applied). This matches how `filters.terms` works.
2. In Sidebar.jsx add the Days section directly below the Term pills section.
   Only show it when `filters.year !== 0` (same condition as Term filter).
   Label: "Days" (same kicker style as other filter labels).
   Pills: Mon · Tue · Wed · Thu · Fri — each toggles its code in/out of filters.days.
   Pill style: match exactly the Term pill style (aria-pressed, active class, same colors).
3. Add a "Time" filter section directly below Days:
   Three toggle pills: "Morning" (before 12:00) · "Afternoon" (12:00–17:00) · "Evening" (after 17:00)
   Filter value: `filters.timeOfDay` — array of "morning"/"afternoon"/"evening". Empty = all.
4. In the filter reset logic (wherever "Clear all" or preset reset happens), add
   days: [] and timeOfDay: [] to the reset object.
5. Add days: [] and timeOfDay: [] to the initial filter state in App.jsx.

Done when: Days and Time pills render in sidebar, toggling them updates filter state,
cleared by reset, and `npm run build` passes with no errors.
**Status**: DONE

---

## SC-4 · Wire day/time filters into applyFilters() in Home.jsx
**Priority**: HIGH
**Goal**: The day and time filters actually remove courses from the list.

In src/pages/Home.jsx inside applyFilters():

1. After the existing term filter block, add a Days filter block:
   ```
   if (filters.days && filters.days.length > 0) {
     if (!course.meeting_days || course.meeting_days.length === 0) {
       // If "Hide courses without schedule" is true, exclude; otherwise include (null = unknown)
       // Default: INCLUDE courses with no schedule data (don't penalize missing data)
       // Only exclude if course has schedule data that doesn't match
     } else {
       const match = filters.days.some(d => course.meeting_days.includes(d));
       if (!match) return false;
     }
   }
   ```

2. Add a timeOfDay filter block:
   ```
   if (filters.timeOfDay && filters.timeOfDay.length > 0 && course.meeting_time) {
     const hour = parseInt(course.meeting_time.split(':')[0], 10);
     const bucket = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
     if (!filters.timeOfDay.includes(bucket)) return false;
   }
   ```
   (Courses with null meeting_time are always included when a time filter is active)

3. Add the same filters to the FilterSidebar inside src/pages/Courses.jsx if it has
   its own separate applyFilters or filter logic — check the file first and mirror the change.

4. Ensure filters.days and filters.timeOfDay are passed through all filter prop chains.

Done when: selecting "Mon" removes courses that have schedule data for other days,
courses with null meeting_days are still shown, `npm run build` passes.
**Status**: DONE

---

## SC-5 · Show meeting time on CourseCard
**Priority**: MEDIUM
**Goal**: When a course has meeting_days and/or meeting_time data, display it
on the CourseCard in a compact, legible way.

In src/components/CourseCard.jsx:
1. Add a meeting-time display row between the course code/title area and the metrics.
   Only render if `course.meeting_days?.length > 0 || course.meeting_time`.
2. Format: "Mon · Wed  10:00–11:30am" — days joined with " · ", time formatted as
   12h with am/pm (e.g. "10:00" → "10:00am", "13:30" → "1:30pm").
   If only days known (no time): "Mon · Wed"
   If only time known (no days): "10:00–11:30am"
3. Style: small muted line (11px, color: var(--text-muted)), with a 🕐 or calendar
   icon prefix (use the existing icon patterns in the file — likely just an emoji or SVG).
4. In compact card mode (when `compact` prop is true), still show meeting time —
   it's critical scheduling info.
5. Do NOT show this row when meeting_days is null AND meeting_time is null.

Done when: a course object with meeting_days:["Mon","Wed"] and meeting_time:"10:00"
meeting_time_end:"11:30" renders "🕐 Mon · Wed  10:00–11:30am" below the title,
null fields render nothing, `npm run build` passes.
**Status**: DONE

---

## SC-6 · Add "Hide courses with no schedule" toggle + filter count badge
**Priority**: MEDIUM
**Goal**: Two small quality-of-life additions to the day/time filter.

1. Below the Days pills in Sidebar.jsx, add a small checkbox:
   "□ Hide courses without schedule info"
   Filter value: `filters.hideNoSchedule` (boolean, default false).
   When true: applyFilters excludes any course where meeting_days is null/empty.
   When false (default): courses without schedule data are always shown.

   Wire this into applyFilters() in Home.jsx:
   if (filters.hideNoSchedule && (!course.meeting_days || course.meeting_days.length === 0)) return false;

2. When any day or time filter is active, show a count badge on the filter toggle button
   (the "Filters" button that opens the sidebar on mobile) indicating how many
   schedule-related filters are active. Follow the existing pattern for other filter badges.

3. Update the Sidebar's active-filter summary chips (if they exist — check the file)
   to include active day pills and time-of-day pills in the same dismissible chip style
   as existing filter chips.

Done when: checkbox renders, hideNoSchedule wired into filter, badge appears when
day/time filters active, `npm run build` passes.
**Status**: DONE

---

## SC-7 · Seed 30 courses with realistic mock schedule data for testing
**Priority**: MEDIUM
**Goal**: Since the scraper (SC-2) hasn't run yet and the Supabase table has no real
schedule data, seed 30 representative courses in public/courses.json with
realistic HKS meeting patterns so the filter can be visually tested locally.

HKS typical patterns:
- Mon/Wed 10:15am–11:45am  → meeting_days:["Mon","Wed"], meeting_time:"10:15", meeting_time_end:"11:45"
- Tue/Thu 1:00pm–2:30pm    → meeting_days:["Tue","Thu"], meeting_time:"13:00", meeting_time_end:"14:30"
- Mon/Wed/Fri 9:00–10:00am → meeting_days:["Mon","Wed","Fri"], meeting_time:"09:00", meeting_time_end:"10:00"
- Thursday 6:15pm–8:45pm   → meeting_days:["Thu"], meeting_time:"18:15", meeting_time_end:"20:45"
- Tue/Thu 10:15am–11:45am  → meeting_days:["Tue","Thu"], meeting_time:"10:15", meeting_time_end:"11:45"

Write a small Python script scripts/seed_mock_schedule.py that:
1. Reads public/courses.json
2. Picks the first 30 courses from the first 3 concentrations (API, DPI, HKS)
   that have year=2024 and has_eval=true
3. Assigns one of the 5 patterns above round-robin
4. Writes updated public/courses.json

Run the script to actually update public/courses.json so the dev server has testable data.

Done when: scripts/seed_mock_schedule.py exists, public/courses.json has 30 courses
with non-null meeting_days values, `npm run build` passes.
**Status**: DONE

---

## SC-8 · End-to-end smoke test + README update
**Priority**: LOW
**Goal**: Verify the complete filter pipeline works and document the new feature.

1. Run `npm run build` — must pass with zero errors and zero new warnings.
2. Check that src/components/Sidebar.jsx renders the Days and Time sections
   without any undefined-variable or missing-prop errors (read the file and verify
   all referenced variables are defined and passed).
3. Check that applyFilters in Home.jsx references filters.days, filters.timeOfDay,
   and filters.hideNoSchedule without typos.
4. Add a section to the project's README.md (if it exists) or create a
   docs/FEATURES.md entry describing the day/time filter:
   "## Day & Time Filter
   Filter courses by meeting day (Mon–Fri) and time of day (Morning/Afternoon/Evening).
   Courses without schedule data are shown by default; use 'Hide courses without schedule info'
   to show only courses with known meeting times.
   Schedule data is populated via scripts/scrape_meeting_times.py + apply_meeting_times.py."
5. Commit everything with message "feat: SC-8 · smoke test + docs"

Done when: build passes, no prop/variable errors found in key files, docs updated.
**Status**: DONE
