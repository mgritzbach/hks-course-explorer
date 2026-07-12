-- Persist the exact upstream HKS identity/term manifest and expose only the
-- active, non-sensitive manifest fields to the publishable browser role.

alter table public.live_catalogue_runs
  add column if not exists identity_sha256 text,
  add column if not exists term_counts jsonb;

with computed as (
  select
    run.id,
    encode(
      extensions.digest(
        string_agg(course.source_offering_id, E'\n' order by course.source_offering_id),
        'sha256'
      ),
      'hex'
    ) as identity_sha256,
    (
      select jsonb_object_agg(term_rows.term, term_rows.offering_count order by term_rows.term)
      from (
        select term, count(*)::integer as offering_count
        from public.live_courses
        where sync_run_id = run.id and source = 'myharvard'
        group by term
      ) as term_rows
    ) as term_counts
  from public.live_catalogue_runs as run
  join public.live_courses as course
    on course.sync_run_id = run.id and course.source = 'myharvard'
  where run.source = 'myharvard'
  group by run.id
)
update public.live_catalogue_runs as run
   set identity_sha256 = computed.identity_sha256,
       term_counts = computed.term_counts
  from computed
 where run.id = computed.id;

alter table public.live_catalogue_runs
  drop constraint if exists live_catalogue_runs_manifest_required,
  add constraint live_catalogue_runs_manifest_required check (
    source <> 'myharvard'
    or status not in ('staged', 'active')
    or (
      identity_sha256 is not null
      and term_counts is not null
      and identity_sha256 ~ '^[0-9a-f]{64}$'
      and jsonb_typeof(term_counts) = 'object'
      and term_counts <> '{}'::jsonb
    )
  );

create unique index if not exists live_catalogue_runs_one_active_myharvard
  on public.live_catalogue_runs (source)
  where source = 'myharvard' and status = 'active';

drop policy if exists "Publishable read active myharvard manifest"
  on public.live_catalogue_runs;
create policy "Publishable read active myharvard manifest"
  on public.live_catalogue_runs
  for select
  to anon
  using (source = 'myharvard' and status = 'active');

grant select (
  id, source, status, offering_count, source_snapshot_at, activated_at,
  identity_sha256, term_counts
) on table public.live_catalogue_runs to anon;

create or replace function public.promote_myharvard_hks_run(p_run_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_rows integer;
  expected_digest text;
  expected_terms jsonb;
  staged_rows integer;
  staged_digest text;
  staged_terms jsonb;
  previous_run_id uuid;
  previous_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('myharvard-hks-catalogue-promotion'));
  select offering_count, identity_sha256, term_counts
    into expected_rows, expected_digest, expected_terms
    from public.live_catalogue_runs
   where id = p_run_id and source = 'myharvard' and status = 'staged'
   for update;
  if expected_rows is null then
    raise exception 'The my.harvard catalogue run is missing or is not staged';
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
    into staged_rows, staged_digest
    from public.live_courses
   where sync_run_id = p_run_id and source = 'myharvard';
  select coalesce(
      jsonb_object_agg(term_rows.term, term_rows.offering_count order by term_rows.term),
      '{}'::jsonb
    )
    into staged_terms
    from (
      select term, count(*)::integer as offering_count
      from public.live_courses
      where sync_run_id = p_run_id and source = 'myharvard'
      group by term
    ) as term_rows;
  if staged_rows <> expected_rows
     or staged_digest is distinct from expected_digest
     or staged_terms is distinct from expected_terms then
    raise exception 'Staged offerings do not match the persisted upstream manifest';
  end if;

  select id, offering_count into previous_run_id, previous_rows
    from public.live_catalogue_runs
   where source = 'myharvard' and status = 'active' and id <> p_run_id
   order by activated_at desc nulls last
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

revoke all on function public.promote_myharvard_hks_run(uuid)
  from public, anon, authenticated;
grant execute on function public.promote_myharvard_hks_run(uuid) to service_role;

notify pgrst, 'reload schema';
