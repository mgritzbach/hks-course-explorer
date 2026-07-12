-- Retain the exact previously active snapshot rather than inferring it from a
-- timestamp. PostgreSQL now() is transaction-stable, so multiple promotions
-- in one transaction can legitimately have identical activated_at values.

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
begin
  perform pg_advisory_xact_lock(hashtext('myharvard-hks-catalogue-promotion'));

  select offering_count
    into expected_rows
    from public.live_catalogue_runs
   where id = p_run_id and source = 'myharvard' and status = 'staged'
   for update;
  if expected_rows is null then
    raise exception 'The my.harvard catalogue run is missing or is not staged';
  end if;
  select count(*) into staged_rows
    from public.live_courses
   where sync_run_id = p_run_id and source = 'myharvard';
  if staged_rows <> expected_rows then
    raise exception 'Run has % staged offerings; expected %', staged_rows, expected_rows;
  end if;

  select id into previous_run_id
    from public.live_catalogue_runs
   where source = 'myharvard' and status = 'active' and id <> p_run_id
   limit 1
   for update;

  update public.live_courses set active = false where is_hks is true;
  update public.live_courses set active = true
   where sync_run_id = p_run_id and source = 'myharvard';
  update public.live_catalogue_runs set status = 'superseded'
   where source = 'myharvard' and status = 'active' and id <> p_run_id;
  update public.live_catalogue_runs set status = 'active', activated_at = clock_timestamp()
   where id = p_run_id;

  delete from public.live_courses
   where source = 'myharvard'
     and sync_run_id <> p_run_id
     and sync_run_id <> coalesce(previous_run_id, p_run_id);
  return staged_rows;
end;
$$;

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

  update public.live_catalogue_runs set status = 'rolled_back' where id = p_run_id;
  update public.live_courses set active = false where sync_run_id = p_run_id;
  select run.id into previous_run_id
    from public.live_catalogue_runs as run
   where run.source = 'myharvard'
     and run.status = 'superseded'
     and run.id <> p_run_id
     and exists (select 1 from public.live_courses where sync_run_id = run.id)
   order by run.activated_at desc nulls last
   limit 1
   for update;

  if previous_run_id is not null then
    update public.live_courses set active = true where sync_run_id = previous_run_id;
    get diagnostics restored_rows = row_count;
    update public.live_catalogue_runs set status = 'active' where id = previous_run_id;
  else
    update public.live_courses set active = true
     where is_hks is true and source <> 'myharvard';
    get diagnostics restored_rows = row_count;
  end if;
  delete from public.live_courses where sync_run_id = p_run_id and source = 'myharvard';
  return restored_rows;
end;
$$;

revoke all on function public.promote_myharvard_hks_run(uuid)
  from public, anon, authenticated;
revoke all on function public.rollback_myharvard_hks_run(uuid)
  from public, anon, authenticated;
grant execute on function public.promote_myharvard_hks_run(uuid) to service_role;
grant execute on function public.rollback_myharvard_hks_run(uuid) to service_role;
