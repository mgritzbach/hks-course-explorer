-- Serialize the legacy Harvard API sync with my.harvard promotion at the
-- database boundary, and reject an unexpected material catalogue drop.

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
    select 1 from jsonb_array_elements(p_rows) as item(value)
     where nullif(btrim(item.value ->> 'id'), '') is null
  ) then
    raise exception 'Every live-course sync record needs an id';
  end if;
  if (select count(*) from jsonb_array_elements(p_rows) as item(value)) <>
     (select count(distinct item.value ->> 'id') from jsonb_array_elements(p_rows) as item(value))
  then
    raise exception 'Live-course sync payload contains duplicate ids';
  end if;

  insert into public.live_courses (
    id, course_code, course_code_base, title, term, credits, instructors,
    description, location, meeting_days, time_start, time_end, school, is_hks,
    session_code, session_description, cross_reg_eligible
  )
  select row.id, row.course_code, row.course_code_base, row.title, row.term,
    row.credits, row.instructors, row.description, row.location,
    row.meeting_days, row.time_start, row.time_end, row.school, row.is_hks,
    row.session_code, row.session_description, row.cross_reg_eligible
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
    is_hks = excluded.is_hks,
    session_code = excluded.session_code,
    session_description = excluded.session_description,
    cross_reg_eligible = excluded.cross_reg_eligible;
  get diagnostics affected_rows = row_count;
  if affected_rows <> expected_rows then
    raise exception 'Live-course sync applied % rows; expected %', affected_rows, expected_rows;
  end if;
  return affected_rows;
end;
$$;

create or replace function public.promote_myharvard_hks_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_rows integer;
  staged_rows integer;
  previous_run_id uuid;
  previous_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('myharvard-hks-catalogue-promotion'));
  select offering_count into expected_rows
    from public.live_catalogue_runs
   where id = p_run_id and source = 'myharvard' and status = 'staged'
   for update;
  if expected_rows is null then
    raise exception 'The my.harvard catalogue run is missing or is not staged';
  end if;
  select count(*) into staged_rows from public.live_courses
   where sync_run_id = p_run_id and source = 'myharvard';
  if staged_rows <> expected_rows then
    raise exception 'Run has % staged offerings; expected %', staged_rows, expected_rows;
  end if;
  select id, offering_count into previous_run_id, previous_rows
    from public.live_catalogue_runs
   where source = 'myharvard' and status = 'active' and id <> p_run_id
   limit 1 for update;
  if previous_rows is not null and expected_rows < ceil(previous_rows * 0.95) then
    raise exception 'Material catalogue drop rejected: % offerings after %', expected_rows, previous_rows;
  end if;

  update public.live_courses set active = false where is_hks is true;
  update public.live_courses set active = true
   where sync_run_id = p_run_id and source = 'myharvard';
  update public.live_catalogue_runs set status = 'superseded'
   where source = 'myharvard' and status = 'active' and id <> p_run_id;
  update public.live_catalogue_runs set status = 'active', activated_at = clock_timestamp()
   where id = p_run_id;
  delete from public.live_courses
   where source = 'myharvard' and sync_run_id <> p_run_id
     and sync_run_id <> coalesce(previous_run_id, p_run_id);
  return staged_rows;
end;
$$;

revoke all on function public.sync_live_courses_atomically(jsonb)
  from public, anon, authenticated;
revoke all on function public.promote_myharvard_hks_run(uuid)
  from public, anon, authenticated;
grant execute on function public.sync_live_courses_atomically(jsonb) to service_role;
grant execute on function public.promote_myharvard_hks_run(uuid) to service_role;
