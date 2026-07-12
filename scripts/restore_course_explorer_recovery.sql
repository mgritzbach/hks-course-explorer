\set ON_ERROR_STOP on

begin;

-- Suppress only the two application-maintenance triggers while replaying the
-- exact captured rows. Foreign-key constraint triggers stay enabled, so an
-- orphaned live_courses.sync_run_id aborts the entire transaction.
alter table public.live_courses disable trigger user;

insert into public.courses
select (jsonb_populate_record(null::public.courses, payload)).*
from recovery_payloads where table_name = 'courses' order by ordinal;

insert into public.course_sections
select (jsonb_populate_record(null::public.course_sections, payload)).*
from recovery_payloads where table_name = 'course_sections' order by ordinal;

insert into public.schedules
select (jsonb_populate_record(null::public.schedules, payload)).*
from recovery_payloads where table_name = 'schedules' order by ordinal;

insert into public.live_catalogue_runs
select (jsonb_populate_record(null::public.live_catalogue_runs, payload)).*
from recovery_payloads where table_name = 'live_catalogue_runs' order by ordinal;

insert into public.live_courses
select (jsonb_populate_record(null::public.live_courses, payload)).*
from recovery_payloads where table_name = 'live_courses' order by ordinal;

alter table public.live_courses enable trigger user;
set constraints all immediate;
commit;

analyze public.courses;
analyze public.course_sections;
analyze public.schedules;
analyze public.live_catalogue_runs;
analyze public.live_courses;
