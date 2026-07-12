\set ON_ERROR_STOP on

create table live_courses_restore_probe (
  ordinal bigint not null unique,
  id text primary key,
  course_code text,
  course_code_base text,
  title text,
  term text,
  credits real,
  instructors jsonb,
  description text,
  location text,
  meeting_days text,
  time_start text,
  time_end text,
  school text,
  is_hks boolean,
  synced_at timestamptz,
  session_code text,
  session_description text,
  cross_reg_eligible text,
  source text not null,
  source_course_id text,
  course_offer_nbr text,
  section_code text,
  source_url text,
  sync_run_id uuid,
  active boolean not null,
  source_offering_id text
);

insert into live_courses_restore_probe (
  ordinal, id, course_code, course_code_base, title, term, credits,
  instructors, description, location, meeting_days, time_start, time_end,
  school, is_hks, synced_at, session_code, session_description,
  cross_reg_eligible, source, source_course_id, course_offer_nbr, section_code,
  source_url, sync_run_id, active, source_offering_id
)
select
  payload.ordinal, row.id, row.course_code, row.course_code_base, row.title,
  row.term, row.credits, row.instructors, row.description, row.location,
  row.meeting_days, row.time_start, row.time_end, row.school, row.is_hks,
  row.synced_at, row.session_code, row.session_description,
  row.cross_reg_eligible, row.source, row.source_course_id,
  row.course_offer_nbr, row.section_code, row.source_url, row.sync_run_id,
  row.active, row.source_offering_id
from live_courses_restore_payloads as payload
cross join lateral jsonb_to_record(payload.payload) as row(
  id text, course_code text, course_code_base text, title text, term text,
  credits real, instructors jsonb, description text, location text,
  meeting_days text, time_start text, time_end text, school text,
  is_hks boolean, synced_at timestamptz, session_code text,
  session_description text, cross_reg_eligible text, source text,
  source_course_id text, course_offer_nbr text, section_code text,
  source_url text, sync_run_id uuid, active boolean, source_offering_id text
)
where payload.id = row.id;
