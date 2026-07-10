-- Additive foundation for the unified current-course catalogue.
--
-- This migration intentionally does not modify public.courses,
-- public.live_courses, public.course_sections, or their current policies.
-- Apply only after the read-only parity audit has captured a baseline and a
-- staging restore/rollback exercise has passed.

create table if not exists public.catalogue_sync_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null check (status in ('staging', 'promoted', 'retired', 'failed')),
  source_snapshot_at timestamptz not null,
  current_offering_count integer not null check (current_offering_count >= 0),
  historical_record_count integer not null check (historical_record_count >= 0),
  snapshot_offering_count integer not null check (snapshot_offering_count >= 0),
  hks_verified_history_count integer not null check (hks_verified_history_count >= 0),
  hks_course_only_history_count integer not null check (hks_course_only_history_count >= 0),
  hks_needs_review_count integer not null check (hks_needs_review_count >= 0),
  hks_unmatched_history_count integer not null check (hks_unmatched_history_count >= 0),
  alias_registry_version text not null,
  failure_reason text,
  created_at timestamptz not null default now(),
  promoted_at timestamptz,
  check (
    (status = 'promoted' and promoted_at is not null)
    or (status <> 'promoted')
  )
);

create unique index if not exists catalogue_sync_runs_one_promoted
  on public.catalogue_sync_runs ((status = 'promoted'))
  where status = 'promoted';

create table if not exists public.catalogue_snapshot_v1 (
  sync_run_id uuid not null references public.catalogue_sync_runs(id) on delete restrict,
  offering_id text not null,
  course_code text,
  course_code_base text,
  term text,
  school text,
  title text,
  instructors jsonb not null default '[]'::jsonb,
  current_offering jsonb not null,
  canonical_course_code text,
  current_instructor_keys jsonb not null default '[]'::jsonb,
  match_status text not null check (match_status in ('verified', 'course_only', 'needs_review', 'unmatched')),
  match_method text check (match_method in (
    'exact_code_same_professor', 'approved_alias_same_professor',
    'exact_code_other_professor', 'approved_alias_other_professor',
    'exact_code_professor_unavailable', 'approved_alias_professor_unavailable',
    'suspected_section_split'
  )),
  historical_course_codes jsonb not null default '[]'::jsonb,
  evaluation_summary jsonb not null default '{}'::jsonb,
  course_history_summary jsonb not null default '{}'::jsonb,
  historical_records jsonb not null default '[]'::jsonb,
  course_history_records jsonb not null default '[]'::jsonb,
  review_candidates jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  primary key (sync_run_id, offering_id),
  check (
    (match_status in ('verified', 'course_only') and match_method is not null and canonical_course_code is not null)
    or (match_status = 'needs_review' and match_method = 'suspected_section_split' and canonical_course_code is null)
    or (match_status = 'unmatched' and match_method is null and canonical_course_code is null)
  )
);

create index if not exists catalogue_snapshot_v1_run_school_term
  on public.catalogue_snapshot_v1 (sync_run_id, school, term);

create index if not exists catalogue_snapshot_v1_run_code
  on public.catalogue_snapshot_v1 (sync_run_id, course_code_base);

-- New tables are private by default. The future public catalogue Function
-- will return only the promoted snapshot; no browser policy is granted here.
alter table public.catalogue_sync_runs enable row level security;
alter table public.catalogue_snapshot_v1 enable row level security;

-- RLS is the row-level guard, but explicit revocation is defense in depth:
-- these tables are not a browser API and must remain server-only even if a
-- broad schema/table grant exists elsewhere in the project.
revoke all on table public.catalogue_sync_runs from public, anon, authenticated;
revoke all on table public.catalogue_snapshot_v1 from public, anon, authenticated;

create or replace function public.promote_catalogue_snapshot(p_sync_run_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  source_count integer;
  snapshot_count integer;
begin
  select current_offering_count, snapshot_offering_count
    into source_count, snapshot_count
    from public.catalogue_sync_runs
   where id = p_sync_run_id
     and status = 'staging'
   for update;

  if not found then
    raise exception 'Catalogue run % is not a staging run', p_sync_run_id;
  end if;

  if source_count <> snapshot_count then
    raise exception 'Catalogue run % has mismatched source and snapshot counts', p_sync_run_id;
  end if;

  if (select count(*) from public.catalogue_snapshot_v1 where sync_run_id = p_sync_run_id) <> source_count then
    raise exception 'Catalogue run % does not contain every current offering', p_sync_run_id;
  end if;

  update public.catalogue_sync_runs
     set status = 'retired'
   where status = 'promoted';

  update public.catalogue_sync_runs
     set status = 'promoted', promoted_at = now()
   where id = p_sync_run_id;
end;
$$;

-- New functions normally inherit PUBLIC execute. Revoke it explicitly from
-- every browser-facing role before allowing the server-only service role.
revoke all on function public.promote_catalogue_snapshot(uuid)
  from public, anon, authenticated;
grant execute on function public.promote_catalogue_snapshot(uuid) to service_role;

-- The browser is not granted access to this view. The future Pages Function
-- uses the server-only service role and returns this promoted snapshot only.
create or replace view public.catalogue_current_v1
with (security_invoker = true)
as
select
  snapshot.*,
  runs.source_snapshot_at,
  runs.promoted_at,
  runs.alias_registry_version
from public.catalogue_snapshot_v1 as snapshot
join public.catalogue_sync_runs as runs on runs.id = snapshot.sync_run_id
where runs.status = 'promoted';

comment on table public.catalogue_snapshot_v1 is
  'Versioned, private read model for current offerings plus verified historical evaluation context.';
