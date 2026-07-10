-- Preserve suspected same-professor renumberings as review-only snapshot data.
-- This is additive and updates only the private future catalogue boundary.

alter table public.catalogue_snapshot_v1
  add column if not exists renumbering_review_candidates jsonb not null default '[]'::jsonb;

-- The original private snapshot migration used anonymous CHECK constraints.
-- Locate only those exact constraints by their definitions so this forward
-- migration is safe for the existing staging database and a clean rollout.
do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'public.catalogue_snapshot_v1'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%exact_code_same_professor%';
  if constraint_name is not null then
    execute format('alter table public.catalogue_snapshot_v1 drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.catalogue_snapshot_v1
  add constraint catalogue_snapshot_v1_match_method_check
  check (match_method in (
    'exact_code_same_professor', 'approved_alias_same_professor',
    'exact_code_other_professor', 'approved_alias_other_professor',
    'exact_code_professor_unavailable', 'approved_alias_professor_unavailable',
    'suspected_section_split',
    'suspected_renumbering_same_professor_title',
    'suspected_section_split_and_renumbering'
  ));

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
    from pg_constraint
   where conrelid = 'public.catalogue_snapshot_v1'::regclass
     and contype = 'c'
     and pg_get_constraintdef(oid) like '%suspected_section_split%'
     and pg_get_constraintdef(oid) like '%canonical_course_code%';
  if constraint_name is not null then
    execute format('alter table public.catalogue_snapshot_v1 drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.catalogue_snapshot_v1
  add constraint catalogue_snapshot_v1_match_state_check
  check (
    (match_status in ('verified', 'course_only') and match_method is not null and canonical_course_code is not null)
    or (
      match_status = 'needs_review'
      and match_method in (
        'suspected_section_split',
        'suspected_renumbering_same_professor_title',
        'suspected_section_split_and_renumbering'
      )
      and canonical_course_code is null
    )
    or (match_status = 'unmatched' and match_method is null and canonical_course_code is null)
  );
