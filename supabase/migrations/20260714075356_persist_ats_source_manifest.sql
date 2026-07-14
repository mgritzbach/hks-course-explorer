-- Persist each complete ATS catalogue manifest and make current visibility
-- follow that manifest without deleting any previously observed offering.
--
-- The source feed can fluctuate between runs. Rows absent from the latest
-- complete feed therefore remain stored for evidence and recovery, but are
-- marked inactive so the browser never presents them as currently offered.

alter table public.live_courses
  add column if not exists source_last_seen_at timestamptz;

alter table public.live_courses
  alter column source_last_seen_at drop default,
  alter column source_last_seen_at drop not null;

update public.live_courses
   set source_last_seen_at = coalesce(source_last_seen_at, synced_at, now())
 where source = 'ats'
   and is_hks is false
   and source_last_seen_at is null;

create index if not exists live_courses_source_active_term_idx
  on public.live_courses (source, active, term, id);

alter table public.live_catalogue_runs
  drop constraint if exists live_catalogue_runs_manifest_required,
  add constraint live_catalogue_runs_manifest_required check (
    status not in ('staged', 'active')
    or (
      identity_sha256 is not null
      and term_counts is not null
      and identity_sha256 ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(term_counts) = 'object'
      and term_counts <> '{}'::jsonb
    )
  );

create unique index if not exists live_catalogue_runs_one_active_ats
  on public.live_catalogue_runs (source)
  where source = 'ats' and status = 'active';

create or replace function public.sync_live_courses_atomically(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  expected_rows integer;
  affected_rows integer;
  run_id uuid;
  manifest_digest text;
  manifest_terms jsonb;
  previous_active_count integer;
  existing_ats_count integer;
  source_observed_at timestamptz;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('myharvard-hks-catalogue-promotion')
  );
  source_observed_at := pg_catalog.clock_timestamp();

  if pg_catalog.jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'Live-course sync payload must be a JSON array';
  end if;

  expected_rows := pg_catalog.jsonb_array_length(p_rows);
  if expected_rows = 0 then
    raise exception 'Live-course sync payload must not be empty';
  end if;

  select offering_count
    into previous_active_count
    from public.live_catalogue_runs
   where source = 'ats' and status = 'active';

  select count(*)::integer
    into existing_ats_count
    from public.live_courses
   where source = 'ats' and is_hks is false;

  -- Match the application-side production floor at the database boundary. A
  -- small clean-room/staging fixture remains valid until that environment has
  -- ever held a production-sized ATS catalogue.
  if expected_rows < 5000
     and greatest(
       coalesce(previous_active_count, 0),
       existing_ats_count
     ) >= 5000 then
    raise exception 'Live-course sync payload has % rows; production minimum is 5000',
      expected_rows;
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
    where nullif(pg_catalog.btrim(item.value ->> 'id'), '') is null
  ) then
    raise exception 'Every live-course sync record needs an id';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
    where nullif(pg_catalog.btrim(item.value ->> 'term'), '') is null
  ) then
    raise exception 'Every live-course sync record needs a term';
  end if;

  if (
    select count(*)
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
  ) <> (
    select count(distinct item.value ->> 'id')
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
  ) then
    raise exception 'Live-course sync payload contains duplicate ids';
  end if;

  -- A shared primary key must never let a general-catalogue record take over
  -- an authoritative HKS row or any row owned by another source. This check is
  -- deliberately broader than source_course_id overlap and runs before the
  -- current ATS population is deactivated.
  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
    join public.live_courses as existing
      on existing.id = item.value ->> 'id'
    where existing.source is distinct from 'ats'
       or existing.is_hks is distinct from false
  ) then
    raise exception 'Live-course sync payload id collides with a protected row';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_rows) as item(value)
    where item.value -> 'is_hks' is distinct from 'false'::jsonb
       or nullif(pg_catalog.btrim(item.value ->> 'school'), '') is null
       or pg_catalog.upper(pg_catalog.btrim(item.value ->> 'school')) = 'HKS'
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

  select
    pg_catalog.encode(
      extensions.digest(
        pg_catalog.string_agg(item.value ->> 'id', E'\n' order by item.value ->> 'id'),
        'sha256'
      ),
      'hex'
    ),
    (
      select pg_catalog.jsonb_object_agg(
        term_rows.term,
        term_rows.offering_count
        order by term_rows.term
      )
      from (
        select item.value ->> 'term' as term, count(*)::integer as offering_count
        from pg_catalog.jsonb_array_elements(p_rows) as item(value)
        where nullif(pg_catalog.btrim(item.value ->> 'term'), '') is not null
        group by item.value ->> 'term'
      ) as term_rows
    )
    into manifest_digest, manifest_terms
  from pg_catalog.jsonb_array_elements(p_rows) as item(value);

  if manifest_terms is null or manifest_terms = '{}'::jsonb then
    raise exception 'Live-course sync payload needs at least one term';
  end if;

  insert into public.live_catalogue_runs (
    source, status, offering_count, source_snapshot_at, identity_sha256, term_counts
  ) values (
    'ats', 'staged', expected_rows, source_observed_at,
    manifest_digest, manifest_terms
  ) returning id into run_id;

  -- This visibility transition and the upsert commit together. Readers see
  -- either the complete previous manifest or the complete new manifest.
  update public.live_courses
     set active = false
   where source = 'ats'
     and is_hks is false
     and active is true;

  insert into public.live_courses (
    id, course_code, course_code_base, title, term, credits, instructors,
    description, location, meeting_days, time_start, time_end, school, is_hks,
    session_code, session_description, cross_reg_eligible, source, sync_run_id,
    active, source_last_seen_at
  )
  select
    row.id, row.course_code, row.course_code_base, row.title, row.term,
    row.credits, row.instructors, row.description, row.location,
    row.meeting_days, row.time_start, row.time_end, row.school, false,
    row.session_code, row.session_description, row.cross_reg_eligible,
    'ats', run_id, true, source_observed_at
  from pg_catalog.jsonb_to_recordset(p_rows) as row(
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
    sync_run_id = excluded.sync_run_id,
    active = true,
    source_last_seen_at = excluded.source_last_seen_at;

  get diagnostics affected_rows = row_count;
  if affected_rows <> expected_rows then
    raise exception 'Live-course sync applied % rows; expected %', affected_rows, expected_rows;
  end if;

  update public.live_catalogue_runs
     set status = 'superseded'
   where source = 'ats' and status = 'active' and id <> run_id;
  update public.live_catalogue_runs
     set status = 'active', activated_at = source_observed_at
   where id = run_id;

  return affected_rows;
end;
$$;

revoke all on function public.sync_live_courses_atomically(jsonb)
  from public, anon, authenticated;
grant execute on function public.sync_live_courses_atomically(jsonb) to service_role;

notify pgrst, 'reload schema';
