\set ON_ERROR_STOP on

-- Emergency visibility failback for an ATS-manifest incident.
--
-- Preconditions:
--   * scheduled catalogue sync is frozen;
--   * the encrypted pre-release recovery package is available;
--   * exactly one ATS manifest is active.
--
-- This restores the legacy application-visible state without deleting a
-- course: every non-HKS ATS row becomes visible and loses run ownership, while
-- HKS rows are untouched. The refresh trigger is disabled only for this
-- transaction so operational timestamps are not rewritten by the failback.
-- A full byte-exact database rollback still uses the encrypted recovery point.

begin;

select pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtext('myharvard-hks-catalogue-promotion')
);

do $$
declare
  active_run_id uuid;
begin
  if (select count(*) from public.live_catalogue_runs
      where source = 'ats' and status = 'active') <> 1 then
    raise exception 'ATS visibility rollback requires exactly one active ATS run';
  end if;

  select id into active_run_id
  from public.live_catalogue_runs
  where source = 'ats' and status = 'active';

  if exists (
    select 1 from public.live_courses
    where sync_run_id = active_run_id
      and (source is distinct from 'ats' or is_hks is distinct from false)
  ) then
    raise exception 'ATS visibility rollback found protected rows in the active ATS run';
  end if;

  if not exists (
    select 1 from public.live_courses
    where source = 'ats' and is_hks is false
  ) then
    raise exception 'ATS visibility rollback found no non-HKS ATS rows';
  end if;
end
$$;

alter table public.live_courses
  disable trigger live_courses_refresh_synced_at;

update public.live_courses
   set active = true,
       sync_run_id = null
 where source = 'ats'
   and is_hks is false;

alter table public.live_courses
  enable trigger live_courses_refresh_synced_at;

update public.live_catalogue_runs
   set status = 'superseded'
 where source = 'ats'
   and status = 'active';

do $$
begin
  if exists (
    select 1 from public.live_courses
    where source = 'ats' and is_hks is false
      and (not active or sync_run_id is not null)
  ) then
    raise exception 'ATS visibility rollback did not restore legacy visibility';
  end if;
  if exists (
    select 1 from public.live_catalogue_runs
    where source = 'ats' and status = 'active'
  ) then
    raise exception 'ATS visibility rollback left an active ATS manifest';
  end if;
end
$$;

commit;
