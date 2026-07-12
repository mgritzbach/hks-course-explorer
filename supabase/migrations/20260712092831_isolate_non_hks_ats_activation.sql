-- Keep source ownership disjoint at the database boundary.
--
-- The general ATS sync owns non-HKS rows only. The authoritative my.harvard
-- promotion owns HKS rows. Incoming ATS rows are explicitly activated so an
-- offering that was previously classified/deactivated as HKS can safely return
-- to the non-HKS catalogue without remaining hidden.

create or replace function public.sync_live_courses_atomically(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_rows integer;
  affected_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('myharvard-hks-catalogue-promotion'));

  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Live-course sync payload must be a JSON array';
  end if;

  expected_rows := jsonb_array_length(p_rows);
  if expected_rows = 0 then
    raise exception 'Live-course sync payload must not be empty';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    where nullif(btrim(item.value ->> 'id'), '') is null
  ) then
    raise exception 'Every live-course sync record needs an id';
  end if;

  if (
    select count(*)
    from jsonb_array_elements(p_rows) as item(value)
  ) <> (
    select count(distinct item.value ->> 'id')
    from jsonb_array_elements(p_rows) as item(value)
  ) then
    raise exception 'Live-course sync payload contains duplicate ids';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_rows) as item(value)
    where item.value -> 'is_hks' is distinct from 'false'::jsonb
       or nullif(btrim(item.value ->> 'school'), '') is null
       or upper(btrim(item.value ->> 'school')) = 'HKS'
       or exists (
         select 1
         from public.live_courses as authoritative_hks
         where authoritative_hks.source = 'myharvard'
           and authoritative_hks.active is true
           and authoritative_hks.is_hks is true
           and authoritative_hks.source_course_id = item.value ->> 'id'
       )
  ) then
    raise exception 'General live-course sync accepts non-HKS rows only';
  end if;

  insert into public.live_courses (
    id, course_code, course_code_base, title, term, credits, instructors,
    description, location, meeting_days, time_start, time_end, school, is_hks,
    session_code, session_description, cross_reg_eligible, source, active
  )
  select
    row.id, row.course_code, row.course_code_base, row.title, row.term,
    row.credits, row.instructors, row.description, row.location,
    row.meeting_days, row.time_start, row.time_end, row.school, false,
    row.session_code, row.session_description, row.cross_reg_eligible,
    'ats', true
  from jsonb_to_recordset(p_rows) as row(
    id text, course_code text, course_code_base text, title text, term text,
    credits real, instructors jsonb, description text, location text,
    meeting_days text, time_start text, time_end text, school text,
    is_hks boolean, session_code text, session_description text,
    cross_reg_eligible text
  )
  on conflict (id) do update set
    course_code = excluded.course_code,
    course_code_base = excluded.course_code_base,
    title = excluded.title,
    term = excluded.term,
    credits = excluded.credits,
    instructors = excluded.instructors,
    description = excluded.description,
    location = excluded.location,
    meeting_days = excluded.meeting_days,
    time_start = excluded.time_start,
    time_end = excluded.time_end,
    school = excluded.school,
    is_hks = false,
    session_code = excluded.session_code,
    session_description = excluded.session_description,
    cross_reg_eligible = excluded.cross_reg_eligible,
    source = 'ats',
    active = true;

  get diagnostics affected_rows = row_count;
  if affected_rows <> expected_rows then
    raise exception 'Live-course sync applied % rows; expected %', affected_rows, expected_rows;
  end if;

  return affected_rows;
end;
$$;

revoke all on function public.sync_live_courses_atomically(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_live_courses_atomically(jsonb) to service_role;
