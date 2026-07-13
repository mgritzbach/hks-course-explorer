\set ON_ERROR_STOP on

-- Exercise the reviewed catalogue rollback against an ephemeral clone of the
-- restored production package. This script is intentionally destructive to
-- the clone: the workflow drops that database after the assertions pass.
set lock_timeout = '5s';
set statement_timeout = '120s';

create temp table rollback_probe_runs as
select
  active_run.id as active_run_id,
  previous_run.id as previous_run_id,
  previous_run.offering_count as previous_offering_count,
  previous_run.identity_sha256 as previous_identity_sha256,
  previous_run.term_counts as previous_term_counts
from public.live_catalogue_runs as active_run
cross join lateral (
  select candidate.*
  from public.live_catalogue_runs as candidate
  where candidate.source = 'myharvard'
    and candidate.status = 'superseded'
    and candidate.id <> active_run.id
  order by candidate.activated_at desc nulls last, candidate.id
  limit 1
) as previous_run
where active_run.source = 'myharvard'
  and active_run.status = 'active';

do $$
declare
  run_count integer;
  retained_run_count integer;
  expected record;
  actual_count integer;
  actual_digest text;
  actual_terms jsonb;
begin
  select count(*) into run_count from rollback_probe_runs;
  if run_count <> 1 then
    raise exception
      'Rollback exercise requires exactly one active run and one retained predecessor; found % pair(s)',
      run_count;
  end if;

  select count(distinct run.id)
    into retained_run_count
    from public.live_catalogue_runs as run
    join public.live_courses as course on course.sync_run_id = run.id
   where run.source = 'myharvard'
     and run.status = 'superseded'
     and course.source = 'myharvard';
  if retained_run_count <> 1 then
    raise exception
      'Rollback exercise requires exactly one retained superseded snapshot; found %',
      retained_run_count;
  end if;

  select * into strict expected from rollback_probe_runs;
  select
    count(*),
    encode(
      extensions.digest(
        string_agg(source_offering_id, E'\n' order by source_offering_id),
        'sha256'
      ),
      'hex'
    )
    into actual_count, actual_digest
    from public.live_courses
   where sync_run_id = expected.previous_run_id
     and source = 'myharvard';
  select coalesce(
      jsonb_object_agg(term_rows.term, term_rows.offering_count order by term_rows.term),
      '{}'::jsonb
    )
    into actual_terms
    from (
      select term, count(*)::integer as offering_count
      from public.live_courses
      where sync_run_id = expected.previous_run_id
        and source = 'myharvard'
      group by term
    ) as term_rows;
  if actual_count <> expected.previous_offering_count
     or actual_digest is distinct from expected.previous_identity_sha256
     or actual_terms is distinct from expected.previous_term_counts then
    raise exception 'Retained predecessor does not match its persisted manifest';
  end if;

  begin
    perform public.rollback_myharvard_hks_run(expected.previous_run_id);
    raise exception 'Rollback unexpectedly accepted a non-active predecessor';
  exception
    when others then
      if sqlerrm <> 'The requested my.harvard run is not active' then
        raise;
      end if;
  end;
end;
$$;

create temp table rollback_probe_baseline (
  scope text primary key,
  row_count bigint not null,
  identity_sha256 text not null
);

insert into rollback_probe_baseline
select
  'courses',
  count(*),
  encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
from public.courses as row_data
union all
select
  'course_sections',
  count(*),
  encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
from public.course_sections as row_data
union all
select
  'schedules',
  count(*),
  encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
from public.schedules as row_data
union all
select
  'non_hks_live_courses',
  count(*),
  encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
from public.live_courses as row_data
where is_hks is not true
union all
select
  'unrelated_live_courses',
  count(*),
  encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
from public.live_courses as row_data
where sync_run_id is distinct from (select active_run_id from rollback_probe_runs)
  and sync_run_id is distinct from (select previous_run_id from rollback_probe_runs)
union all
select
  'unrelated_catalogue_runs',
  count(*),
  encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
from public.live_catalogue_runs as row_data
where id <> (select active_run_id from rollback_probe_runs)
  and id <> (select previous_run_id from rollback_probe_runs);

create temp table rollback_probe_result as
select public.rollback_myharvard_hks_run(active_run_id) as restored_rows
from rollback_probe_runs;

do $$
declare
  expected record;
  restored_rows integer;
  actual_count integer;
  actual_digest text;
  actual_terms jsonb;
  mismatch_count integer;
begin
  select * into strict expected from rollback_probe_runs;
  select result.restored_rows into strict restored_rows from rollback_probe_result as result;

  if restored_rows <> expected.previous_offering_count then
    raise exception 'Rollback restored % rows; expected %',
      restored_rows, expected.previous_offering_count;
  end if;
  if (select status from public.live_catalogue_runs where id = expected.active_run_id)
     <> 'rolled_back' then
    raise exception 'Rolled-back run did not reach rolled_back status';
  end if;
  if exists (select 1 from public.live_courses where sync_run_id = expected.active_run_id) then
    raise exception 'Rolled-back run retained live_courses rows';
  end if;
  if (select status from public.live_catalogue_runs where id = expected.previous_run_id)
     <> 'active' then
    raise exception 'Retained predecessor did not become active';
  end if;
  if (select count(*) from public.live_catalogue_runs
      where source = 'myharvard' and status = 'active') <> 1 then
    raise exception 'Rollback did not leave exactly one active my.harvard manifest';
  end if;

  select
    count(*),
    encode(
      extensions.digest(
        string_agg(source_offering_id, E'\n' order by source_offering_id),
        'sha256'
      ),
      'hex'
    )
    into actual_count, actual_digest
    from public.live_courses
   where sync_run_id = expected.previous_run_id
     and source = 'myharvard'
     and active is true;
  select coalesce(
      jsonb_object_agg(term_rows.term, term_rows.offering_count order by term_rows.term),
      '{}'::jsonb
    )
    into actual_terms
    from (
      select term, count(*)::integer as offering_count
      from public.live_courses
      where sync_run_id = expected.previous_run_id
        and source = 'myharvard'
        and active is true
      group by term
    ) as term_rows;
  if actual_count <> expected.previous_offering_count
     or actual_digest is distinct from expected.previous_identity_sha256
     or actual_terms is distinct from expected.previous_term_counts then
    raise exception 'Active predecessor does not match its persisted manifest after rollback';
  end if;
  if exists (
    select 1 from public.live_courses
    where is_hks is true and active is true
      and (source <> 'myharvard' or sync_run_id <> expected.previous_run_id)
  ) then
    raise exception 'Rollback activated HKS rows outside the retained predecessor';
  end if;
  if exists (
    select 1 from public.live_courses as course
    where course.sync_run_id is not null
      and not exists (
        select 1 from public.live_catalogue_runs as run
        where run.id = course.sync_run_id
      )
  ) then
    raise exception 'Rollback left orphaned sync_run_id values';
  end if;

  with current_state as (
    select
      'courses'::text as scope,
      count(*) as row_count,
      encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex') as identity_sha256
    from public.courses as row_data
    union all
    select 'course_sections', count(*),
      encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
    from public.course_sections as row_data
    union all
    select 'schedules', count(*),
      encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
    from public.schedules as row_data
    union all
    select 'non_hks_live_courses', count(*),
      encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
    from public.live_courses as row_data where is_hks is not true
    union all
    select 'unrelated_live_courses', count(*),
      encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
    from public.live_courses as row_data
    where sync_run_id is distinct from expected.active_run_id
      and sync_run_id is distinct from expected.previous_run_id
    union all
    select 'unrelated_catalogue_runs', count(*),
      encode(extensions.digest(coalesce(string_agg(to_jsonb(row_data)::text, E'\n' order by id), ''), 'sha256'), 'hex')
    from public.live_catalogue_runs as row_data
    where id <> expected.active_run_id and id <> expected.previous_run_id
  )
  select count(*) into mismatch_count
  from rollback_probe_baseline as baseline
  full join current_state using (scope)
  where baseline.row_count is distinct from current_state.row_count
     or baseline.identity_sha256 is distinct from current_state.identity_sha256;
  if mismatch_count <> 0 then
    raise exception 'Rollback changed % protected data scope(s)', mismatch_count;
  end if;

  begin
    perform public.rollback_myharvard_hks_run(expected.active_run_id);
    raise exception 'Rollback unexpectedly accepted an already rolled-back run';
  exception
    when others then
      if sqlerrm <> 'The requested my.harvard run is not active' then
        raise;
      end if;
  end;
end;
$$;

select
  active_run_id as rolled_back_run_id,
  previous_run_id as restored_run_id,
  previous_offering_count as restored_rows,
  previous_identity_sha256 as restored_identity_sha256,
  previous_term_counts as restored_term_counts
from rollback_probe_runs;
