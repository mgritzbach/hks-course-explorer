-- Keep all current offerings in the future catalogue while explicitly
-- preventing HKS-only legacy history from being attached to other schools.
-- This alters only the private, disabled snapshot boundary; it does not touch
-- live_courses, courses, schedule data, or browser permissions.

alter table public.catalogue_snapshot_v1
  drop constraint if exists catalogue_snapshot_v1_match_method_check;

alter table public.catalogue_snapshot_v1
  add constraint catalogue_snapshot_v1_match_method_check
  check (
    match_method is null
    or match_method in (
      'exact_code_same_professor', 'approved_alias_same_professor',
      'exact_code_other_professor', 'approved_alias_other_professor',
      'exact_code_professor_unavailable', 'approved_alias_professor_unavailable',
      'suspected_section_split',
      'suspected_renumbering_same_professor_title',
      'suspected_section_split_and_renumbering',
      'non_hks_current_only'
    )
  );

alter table public.catalogue_snapshot_v1
  drop constraint if exists catalogue_snapshot_v1_match_state_check;

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
    or (
      match_status = 'not_applicable'
      and match_method = 'non_hks_current_only'
      and canonical_course_code is null
    )
  );
