\set ON_ERROR_STOP on

-- Execute only in a disposable PostgreSQL recovery clone. The workflow drops
-- that clone after this exercise and never supplies a production endpoint.

create table public.ats_manifest_probe_baseline (
  name text primary key,
  payload jsonb not null
);

insert into public.live_catalogue_runs (
  id, source, status, offering_count, source_snapshot_at, activated_at,
  identity_sha256, term_counts
) values (
  '10000000-0000-0000-0000-000000000001', 'myharvard', 'active', 1,
  '2026-07-14T00:00:00Z', '2026-07-14T00:00:00Z', repeat('a', 64),
  '{"2027 Spring":1}'::jsonb
);

insert into public.live_courses (
  id, course_code, course_code_base, title, term, school, is_hks, synced_at,
  source, source_course_id, sync_run_id, active, source_offering_id
) values
  (
    '__ats_manifest_probe_hks__', 'HKS-1', 'HKS-1', 'Protected HKS',
    '2027 Spring', 'HKS', true, '2026-01-01T00:00:00Z', 'myharvard',
    'hks-source-course', '10000000-0000-0000-0000-000000000001', true,
    'hks-source-offering'
  ),
  (
    '__ats_manifest_probe_a__', 'FAS-1', 'FAS-1', 'ATS A',
    '2027 Spring', 'FAS', false, '2026-01-02T00:00:00Z', 'ats',
    null, null, true, null
  ),
  (
    '__ats_manifest_probe_b__', 'FAS-2', 'FAS-2', 'ATS B',
    '2027 Spring', 'FAS', false, '2026-01-03T00:00:00Z', 'ats',
    null, null, true, null
  );

insert into public.ats_manifest_probe_baseline (name, payload)
select 'hks', to_jsonb(row_value)
from public.live_courses as row_value
where id = '__ats_manifest_probe_hks__';

select public.sync_live_courses_atomically(
  '[{"id":"__ats_manifest_probe_a__","course_code":"FAS-1","course_code_base":"FAS-1","title":"ATS A","term":"2027 Spring","school":"FAS","is_hks":false,"instructors":[]},{"id":"__ats_manifest_probe_b__","course_code":"FAS-2","course_code_base":"FAS-2","title":"ATS B","term":"2027 Spring","school":"FAS","is_hks":false,"instructors":[]}]'::jsonb
);

do $$
begin
  if (select count(*) from public.live_courses
      where source = 'ats' and is_hks is false and active) <> 2 then
    raise exception 'ATS probe first promotion did not activate both rows';
  end if;
  if (select count(*) from public.live_catalogue_runs
      where source = 'ats' and status = 'active' and offering_count = 2) <> 1 then
    raise exception 'ATS probe first manifest is not exact';
  end if;
end
$$;

select public.sync_live_courses_atomically(
  '[{"id":"__ats_manifest_probe_b__","course_code":"FAS-2","course_code_base":"FAS-2","title":"ATS B","term":"2027 Spring","school":"FAS","is_hks":false,"instructors":[]}]'::jsonb
);

do $$
declare
  active_before jsonb;
begin
  if not exists (
    select 1 from public.live_courses
    where id = '__ats_manifest_probe_a__' and source = 'ats'
      and is_hks is false and active is false
  ) or not exists (
    select 1 from public.live_courses
    where id = '__ats_manifest_probe_b__' and source = 'ats'
      and is_hks is false and active is true
  ) then
    raise exception 'ATS probe did not retain the missing row as inactive';
  end if;

  select jsonb_build_object(
    'rows', (select jsonb_agg(to_jsonb(row_value) order by id)
             from public.live_courses as row_value
             where id like '__ats_manifest_probe_%'),
    'runs', (select jsonb_agg(to_jsonb(run_value) order by id)
             from public.live_catalogue_runs as run_value
             where source = 'ats')
  ) into active_before;

  begin
    perform public.sync_live_courses_atomically(
      '[{"id":"__ats_manifest_probe_duplicate__","course_code":"FAS-3","course_code_base":"FAS-3","title":"Duplicate","term":"2027 Spring","school":"FAS","is_hks":false,"instructors":[]},{"id":"__ats_manifest_probe_duplicate__","course_code":"FAS-3","course_code_base":"FAS-3","title":"Duplicate","term":"2027 Spring","school":"FAS","is_hks":false,"instructors":[]}]'::jsonb
    );
    raise exception 'ATS probe duplicate payload was unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%contains duplicate ids%' then raise; end if;
  end;

  if active_before is distinct from jsonb_build_object(
    'rows', (select jsonb_agg(to_jsonb(row_value) order by id)
             from public.live_courses as row_value
             where id like '__ats_manifest_probe_%'),
    'runs', (select jsonb_agg(to_jsonb(run_value) order by id)
             from public.live_catalogue_runs as run_value
             where source = 'ats')
  ) then
    raise exception 'ATS probe duplicate rejection changed database state';
  end if;

  begin
    perform public.sync_live_courses_atomically(
      '[{"id":"__ats_manifest_probe_hks__","course_code":"FAS-X","course_code_base":"FAS-X","title":"Collision","term":"2027 Spring","school":"FAS","is_hks":false,"instructors":[]}]'::jsonb
    );
    raise exception 'ATS probe protected collision was unexpectedly accepted';
  exception when others then
    if sqlerrm not like '%collides with a protected row%' then raise; end if;
  end;

  if active_before is distinct from jsonb_build_object(
    'rows', (select jsonb_agg(to_jsonb(row_value) order by id)
             from public.live_courses as row_value
             where id like '__ats_manifest_probe_%'),
    'runs', (select jsonb_agg(to_jsonb(run_value) order by id)
             from public.live_catalogue_runs as run_value
             where source = 'ats')
  ) then
    raise exception 'ATS probe protected-collision rejection changed database state';
  end if;
end
$$;

\ir rollback_ats_manifest_visibility.sql

do $$
begin
  if (select to_jsonb(row_value) from public.live_courses as row_value
      where id = '__ats_manifest_probe_hks__') is distinct from
     (select payload from public.ats_manifest_probe_baseline where name = 'hks') then
    raise exception 'ATS probe changed the protected HKS row';
  end if;
  if (select count(*) from public.live_courses
      where id in ('__ats_manifest_probe_a__', '__ats_manifest_probe_b__')
        and source = 'ats' and is_hks is false and active and sync_run_id is null) <> 2 then
    raise exception 'ATS probe rollback did not restore both legacy ATS rows';
  end if;
  if exists (
    select 1 from public.live_courses where id = '__ats_manifest_probe_duplicate__'
  ) then
    raise exception 'ATS probe retained a rejected duplicate row';
  end if;
end
$$;
