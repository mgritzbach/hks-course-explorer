# ADR-004: Term format differences between tables

## Status
Accepted

## Context
Two Supabase tables use different term string formats:
- `live_courses` uses `"YYYY Semester"` with a space (e.g. `"2026 Spring"`)
- `course_sections` uses no space (e.g. `"2026Spring"`)

Mixing formats causes silent no-match failures where courses exist in the database but never appear in the UI because the string comparison fails.

## Decision
Always check which table you're querying. When constructing term strings:
- For `live_courses`: use `"2026 Spring"` (with space)
- For `course_sections`: use `"2026Spring"` (no space)
- Add a comment wherever term strings are constructed to clarify the format

## Consequences
- Using the wrong format returns 0 results silently — no error message, just an empty list
- This is a source of subtle bugs that are hard to debug because the query runs successfully but returns no rows
- Any new query that depends on term matching must document which format is expected
