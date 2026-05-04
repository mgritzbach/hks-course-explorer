# ADR-001: No import.meta.env in ScheduleBuilder

## Status
Accepted

## Context
Cloudflare Pages build strips VITE_* env vars via dead-code elimination, causing the entire Supabase fetch block to silently disappear with no error. The component would just never load data, with no error message or warning to surface the problem.

## Decision
Always import `{ supabase }` from `../lib/supabase.js` (hardcoded credentials). Never use `import.meta.env.VITE_SUPABASE_*` anywhere in ScheduleBuilder.jsx.

## Consequences
The anon key is in source code — this is acceptable because:
- Supabase RLS enforces access control at the row level
- The anon key is public by design and cannot be kept secret in a browser app
- Violating this decision causes silent data-fetch failures with zero error output, making debugging nearly impossible
