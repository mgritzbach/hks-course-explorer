-- Make a complete daily Harvard sync atomic without changing the browser read
-- contract. The service role calls this function; browser roles cannot.

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

  insert into public.live_courses (
    id, course_code, course_code_base, title, term, credits, instructors,
    description, location, meeting_days, time_start, time_end, school, is_hks,
    session_code, session_description, cross_reg_eligible
  )
  select
    row.id, row.course_code, row.course_code_base, row.title, row.term,
    row.credits, row.instructors, row.description, row.location,
    row.meeting_days, row.time_start, row.time_end, row.school, row.is_hks,
    row.session_code, row.session_description, row.cross_reg_eligible
  from jsonb_to_recordset(p_rows) as row(
    id text,
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
    session_code text,
    session_description text,
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

-- SECURITY DEFINER functions inherit PUBLIC execute by default. Keep this
-- write path server-only; the browser continues to have no write capability.
revoke all on function public.sync_live_courses_atomically(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_live_courses_atomically(jsonb) to service_role;
