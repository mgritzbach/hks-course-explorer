# Unified current-course catalogue

## Outcome

The public application will read one versioned catalogue of currently offered
courses. Each offering has either verified historical evaluation context or an
explicit `unmatched` state. The Harvard API is a trusted daily ingestion
source, not a browser search dependency.

This document is a rollout plan. It does not authorize a production database
change by itself.

## Source and identity rules

| Source | Responsibility | Immutable identity |
| --- | --- | --- |
| Harvard daily sync | Current/future offering facts | Harvard offering `id` |
| Historical `courses` data | Observed evaluations and bidding history | Existing historical row `id` |
| Reviewed alias registry | Approved renumberings only | Exact old and new course codes |

The front-facing catalogue may combine those sources, but it must not replace
or mutate them. It must retain the source IDs, source timestamps, and match
evidence for every published row.

Do not match by title similarity, instructor name, code prefix, or by removing
a course suffix. Such similarities can propose an Admin review item, but must
never publish another course's ratings automatically.

## Proposed read contract

`catalog_snapshot_v1` is an additive, versioned read model. One row represents
one current Harvard offering, even when two offerings share a code and term.

Required fields:

- `offering_id`, `term`, `school`, current code/title/instructors/meetings;
- `canonical_course_code` when linked;
- `match_status`: `verified` or `unmatched`;
- `match_method`: `exact_code` or `approved_alias` when verified;
- `historical_course_codes`, evaluation summary, and observed evaluation years;
- `source_synced_at` and `catalogue_version`.

The browser queries this read model only after an old-versus-new parity run is
accepted. Existing `courses`, `live_courses`, and `course_sections` remain the
rollback path until then.

## Required promotion gates

1. Paginate every Supabase source read; never rely on a requested `limit` above
   the service row cap.
2. Fail a materialisation run if the expected historical and current source
   counts differ from the fetched counts.
3. Preserve the current offering ID; code plus term is not unique.
4. Publish an explicit unmatched state for every current HKS offering without
   a verified link.
5. Compare old and new records in parallel: offering IDs, terms, sections,
   match statuses, evaluation counts, and visible filters.
6. Promote a complete snapshot atomically. A partial daily fetch leaves the
   last verified snapshot live.
7. Run browser, accessibility, and mobile regression tests before changing any
   application read path.

## Rollout order

1. Correct paginated reads and capture source-count baselines.
2. Run `scripts/audit_catalogue_sources.py` against the existing project to
   capture paginated source counts and the verified/unmatched HKS baseline.
3. Materialise and validate the snapshot without serving it.
4. Review all non-exact aliases and unmatched current HKS offerings.
5. Run old and new catalogues in parallel and compare results.
6. Switch one feature at a time to the snapshot: Schedule Builder, then course
   browsing and course detail pages.
7. Retire browser use of `/api/harvard-courses` only after the daily sync and
   snapshot promotions have demonstrated stable complete coverage.
