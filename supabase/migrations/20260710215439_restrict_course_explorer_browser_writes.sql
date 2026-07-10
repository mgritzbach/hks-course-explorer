-- Course Explorer RLS hardening. This migration retains all rows and keeps
-- the existing public catalogue read policy; it removes only the two observed
-- unrestricted browser-write policies. The application persists schedules
-- locally, and server-side sync uses service_role rather than browser RLS.

drop policy if exists "Anon write live_courses" on public.live_courses;
drop policy if exists "schedules_anon_all" on public.schedules;
