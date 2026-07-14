\set ON_ERROR_STOP on

-- Execute only in a disposable PostgreSQL clone built through the migration
-- immediately preceding the ATS manifest change.

insert into public.live_catalogue_runs (
  id, source, status, offering_count, source_snapshot_at, activated_at,
  identity_sha256, term_counts
) values (
  '20000000-0000-0000-0000-000000000001', 'myharvard', 'active', 1,
  '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z', repeat('b', 64),
  '{"2027 Spring":1}'::jsonb
);

insert into public.live_courses (
  id, course_code, course_code_base, title, term, school, is_hks, synced_at,
  source, source_course_id, sync_run_id, active, source_offering_id
) values
  (
    '__ats_migration_probe_hks__', 'HKS-2', 'HKS-2', 'Existing HKS',
    '2027 Spring', 'HKS', true, '2026-02-01T00:00:00Z', 'myharvard',
    'existing-hks-course', '20000000-0000-0000-0000-000000000001', true,
    'existing-hks-offering'
  ),
  (
    '__ats_migration_probe_ats__', 'FAS-4', 'FAS-4', 'Existing ATS',
    '2027 Spring', 'FAS', false, '2026-02-02T00:00:00Z', 'ats',
    null, null, true, null
  );

create table public.ats_migration_probe_baseline (
  name text primary key,
  payload jsonb not null
);

insert into public.ats_migration_probe_baseline (name, payload)
select 'hks', to_jsonb(row_value)
from public.live_courses as row_value
where id = '__ats_migration_probe_hks__';

insert into public.ats_migration_probe_baseline (name, payload)
select 'ats_synced_at', to_jsonb(synced_at)
from public.live_courses
where id = '__ats_migration_probe_ats__';

\ir ../supabase/migrations/20260714075356_persist_ats_source_manifest.sql

do $$
begin
  if (select to_jsonb(row_value) - 'source_last_seen_at'
     from public.live_courses as row_value
      where id = '__ats_migration_probe_hks__') is distinct from
     (select payload from public.ats_migration_probe_baseline where name = 'hks') then
    raise exception 'ATS migration changed an existing HKS row';
  end if;
  if (select source_last_seen_at is not null
      from public.live_courses where id = '__ats_migration_probe_hks__') then
    raise exception 'ATS migration backfilled the HKS observation timestamp';
  end if;
  if (select to_jsonb(source_last_seen_at) is distinct from
             (select payload from public.ats_migration_probe_baseline
              where name = 'ats_synced_at')
      from public.live_courses where id = '__ats_migration_probe_ats__') then
    raise exception 'ATS migration did not backfill the existing ATS row';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'live_courses'
      and column_name = 'source_last_seen_at'
      and (is_nullable <> 'YES' or column_default is not null)
  ) then
    raise exception 'ATS observation timestamp is not HKS-neutral';
  end if;
  if (select count(*) from public.live_courses
      where id like '__ats_migration_probe_%') <> 2 then
    raise exception 'ATS migration changed the probe row count';
  end if;
end
$$;
