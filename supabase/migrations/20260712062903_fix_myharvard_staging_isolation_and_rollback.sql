-- Isolate every staged snapshot from the currently active rows. Reusing the
-- stable upstream identity in live_courses.id would make ON CONFLICT update
-- and hide the active snapshot before validation and promotion completed.

alter table public.live_courses
  add column if not exists source_offering_id text;

create unique index if not exists live_courses_run_offering_identity
  on public.live_courses (sync_run_id, source_offering_id)
  where sync_run_id is not null and source_offering_id is not null;

create or replace function public.stage_myharvard_hks_offerings(
  p_run_id uuid,
  p_rows jsonb
)
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

  select offering_count
    into expected_rows
    from public.live_catalogue_runs
   where id = p_run_id
     and source = 'myharvard'
     and status = 'staged'
   for update;

  if expected_rows is null then
    raise exception 'The my.harvard catalogue run is missing or is not staged';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array'
     or jsonb_array_length(p_rows) <> expected_rows then
    raise exception 'Expected % staged offerings', expected_rows;
  end if;
  if exists (
    select 1
      from jsonb_array_elements(p_rows) as item(value)
     where item.value ->> 'id' not like 'myh|HKS|%'
        or item.value ->> 'school' is distinct from 'HKS'
        or coalesce((item.value ->> 'is_hks')::boolean, false) is not true
        or nullif(btrim(item.value ->> 'term'), '') is null
        or nullif(btrim(item.value ->> 'section_code'), '') is null
        or nullif(btrim(item.value ->> 'title'), '') is null
        or (item.value ->> 'credits') is null
  ) then
    raise exception 'Staged offerings contain invalid HKS identity or required fields';
  end if;
  if (
    select count(distinct item.value ->> 'id')
      from jsonb_array_elements(p_rows) as item(value)
  ) <> expected_rows then
    raise exception 'Staged offerings contain duplicate identities';
  end if;

  -- A crashed sync must not accumulate an inactive 297-row snapshot every day.
  -- The active and most recent rollback snapshot are never touched here.
  update public.live_catalogue_runs
     set status = 'failed'
   where source = 'myharvard'
     and status = 'staged'
     and id <> p_run_id;
  delete from public.live_courses as course
   using public.live_catalogue_runs as run
   where course.sync_run_id = run.id
     and course.source = 'myharvard'
     and run.status in ('failed', 'rolled_back');

  insert into public.live_courses (
    id, course_code, course_code_base, title, term, credits, instructors,
    description, location, meeting_days, time_start, time_end, school, is_hks,
    session_code, session_description, cross_reg_eligible, source,
    source_course_id, course_offer_nbr, section_code, source_url, sync_run_id,
    source_offering_id, active, synced_at
  )
  select
    row.id || '|run|' || p_run_id::text,
    row.course_code, row.course_code_base, row.title, row.term,
    row.credits, row.instructors, row.description, row.location,
    row.meeting_days, row.time_start, row.time_end, 'HKS', true,
    row.session_code, row.session_description, row.cross_reg_eligible,
    'myharvard', row.source_course_id, row.course_offer_nbr, row.section_code,
    row.source_url, p_run_id, row.id, false, now()
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
    session_code text,
    session_description text,
    cross_reg_eligible text,
    source_course_id text,
    course_offer_nbr text,
    section_code text,
    source_url text
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
    school = 'HKS',
    is_hks = true,
    session_code = excluded.session_code,
    session_description = excluded.session_description,
    cross_reg_eligible = excluded.cross_reg_eligible,
    source = 'myharvard',
    source_course_id = excluded.source_course_id,
    course_offer_nbr = excluded.course_offer_nbr,
    section_code = excluded.section_code,
    source_url = excluded.source_url,
    sync_run_id = p_run_id,
    source_offering_id = excluded.source_offering_id,
    active = false,
    synced_at = now();

  get diagnostics affected_rows = row_count;
  if affected_rows <> expected_rows then
    raise exception 'Staged % offerings; expected %', affected_rows, expected_rows;
  end if;
  return affected_rows;
end;
$$;

-- Keep storage bounded to one active my.harvard snapshot plus one immediate
-- rollback snapshot. Existing ATS rows remain intact as the final fallback.
create or replace function public.promote_myharvard_hks_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_rows integer;
  staged_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('myharvard-hks-catalogue-promotion'));

  select offering_count
    into expected_rows
    from public.live_catalogue_runs
   where id = p_run_id
     and source = 'myharvard'
     and status = 'staged'
   for update;
  if expected_rows is null then
    raise exception 'The my.harvard catalogue run is missing or is not staged';
  end if;

  select count(*)
    into staged_rows
    from public.live_courses
   where sync_run_id = p_run_id
     and source = 'myharvard';
  if staged_rows <> expected_rows then
    raise exception 'Run has % staged offerings; expected %', staged_rows, expected_rows;
  end if;

  update public.live_courses set active = false where is_hks is true;
  update public.live_courses
     set active = true
   where sync_run_id = p_run_id and source = 'myharvard';

  update public.live_catalogue_runs
     set status = 'superseded'
   where source = 'myharvard' and status = 'active' and id <> p_run_id;
  update public.live_catalogue_runs
     set status = 'active', activated_at = now()
   where id = p_run_id;

  -- Delete only redundant, inactive snapshots. Retain the active run and the
  -- newest superseded run so rollback always remains one transaction away.
  delete from public.live_courses as course
   where course.source = 'myharvard'
     and course.sync_run_id <> p_run_id
     and course.sync_run_id <> coalesce(
       (
         select id from public.live_catalogue_runs
          where source = 'myharvard' and status = 'superseded'
          order by activated_at desc nulls last
          limit 1
       ),
       p_run_id
     );
  return staged_rows;
end;
$$;

-- Mark the failed/current run non-active before reactivating ATS rows so the
-- safety trigger cannot immediately force the rollback rows inactive again.
-- Prefer the previous validated my.harvard snapshot when one exists.
create or replace function public.rollback_myharvard_hks_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_run_id uuid;
  restored_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('myharvard-hks-catalogue-promotion'));
  if not exists (
    select 1 from public.live_catalogue_runs
     where id = p_run_id and source = 'myharvard' and status = 'active'
  ) then
    raise exception 'The requested my.harvard run is not active';
  end if;

  update public.live_catalogue_runs
     set status = 'rolled_back'
   where id = p_run_id;
  update public.live_courses
     set active = false
   where sync_run_id = p_run_id;

  select id
    into previous_run_id
    from public.live_catalogue_runs
   where source = 'myharvard'
     and status = 'superseded'
     and id <> p_run_id
   order by activated_at desc nulls last
   limit 1
   for update;

  if previous_run_id is not null then
    update public.live_courses
       set active = true
     where sync_run_id = previous_run_id;
    get diagnostics restored_rows = row_count;
    update public.live_catalogue_runs
       set status = 'active'
     where id = previous_run_id;
  else
    update public.live_courses
       set active = true
     where is_hks is true
       and source <> 'myharvard';
    get diagnostics restored_rows = row_count;
  end if;
  delete from public.live_courses
   where sync_run_id = p_run_id and source = 'myharvard';
  return restored_rows;
end;
$$;

revoke all on function public.stage_myharvard_hks_offerings(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.promote_myharvard_hks_run(uuid)
  from public, anon, authenticated;
revoke all on function public.rollback_myharvard_hks_run(uuid)
  from public, anon, authenticated;
grant execute on function public.stage_myharvard_hks_offerings(uuid, jsonb) to service_role;
grant execute on function public.promote_myharvard_hks_run(uuid) to service_role;
grant execute on function public.rollback_myharvard_hks_run(uuid) to service_role;
