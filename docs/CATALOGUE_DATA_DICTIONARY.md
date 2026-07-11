# Current catalogue data dictionary

This dictionary describes the additive unified-catalogue design. It is not
permission to apply the migration or enable snapshot publishing in production.

## Identity layers

| Layer | Meaning | Stable key | Never use it for |
| --- | --- | --- | --- |
| Raw offering | A specific class occurrence | Harvard `offering_id` | Combining repeated or parallel sections |
| Course family | A reviewed code lineage across renumberings | Canonical course code plus approved aliases | Treating every professor as the same teaching experience |
| Teaching lineage | The comparable course experience | Course family + normalised professor identity | Collapsing multi-professor or uncertain-name cases without review |
| Historical observation | One recorded evaluation/bidding row | Existing historical row `id` | Rewriting source values into a present-day offering |

An offering's addition/suffix, term, and part-semester are retained as source
facts. They locate a particular delivery; they do not automatically establish
or break a teaching lineage.

## Source tables and their ownership

| Source | Owner/process | Read model role | Mutation rule |
| --- | --- | --- | --- |
| `live_courses` | Daily Harvard sync | Current offerings | Never overwritten by snapshot publishing |
| `course_sections` | Section import/sync | Meeting-time enrichment | Never keyed only by stripped course code |
| `courses` | Reviewed historical imports | Evaluations and bidding observations | Remains immutable to catalogue materialisation |
| `catalogue_sync_runs` | Opt-in snapshot publisher | Promotion/rollback record | New, private, versioned table |
| `catalogue_snapshot_v1` | Opt-in snapshot publisher | One row per current offering | New, private, versioned table |

## Snapshot match states

`not_applicable` is reserved for a current offering outside HKS. The record
remains in the read model so scheduling, credits, meeting times, title,
description, and instructors remain available. It deliberately has no legacy
course history, evaluations, aliases, or review candidates because the legacy
evaluation dataset is HKS-only.

| State | What it means | What the UI may show | What it must not show |
| --- | --- | --- | --- |
| `verified` | Exact or reviewed alias code lineage and at least one matching professor | Professor-specific evaluation history and course history | Ratings from a different professor |
| `course_only` | Course-family history exists, but the current professor differs or is absent | “Previously offered” and separately labelled prior-professor history | A current-instructor score or combined rating |
| `needs_review` | A same-professor terminal suffix or an exact normalized title under a different code suggests a section split or renumbering | “Historical link under review” | Any carried-over evaluation metric |
| `unmatched` | No supported lineage evidence exists | “No verified historical link” | Implied zero rating or a guessed link |

## Approved alias registry

An alias is an operator-reviewed historical code change, not a string-cleaning
rule. Each registry entry must have:

- the exact old and current code;
- an effective academic period when known;
- a change type: `renumber`, `rename`, `section_variant`, or `demand_split`;
- evidence (official catalogue reference or documented curriculum decision);
- reviewer identity and approval date.

Title similarity, prefix similarity, shared subject area, or a stripped suffix
may create a review candidate only. They cannot create an approved alias. In
particular, an exact normalized title with the same professor but a different
code is reported as a suspected renumbering. It remains unlinked until an
operator records evidence in the reviewed alias registry.

## Operator review procedure

1. Run the read-only parity audit and save its counts and `review_candidate_hks_codes` output with the release evidence.
2. Review every `needs_review` row against official catalogue data. Decide whether it is a true section/demand split, a distinct course, or unresolvable.
3. Review code-family records with a different professor. Preserve the course-only label unless the historical evaluation explicitly applies to the same instructor.
4. Add only evidence-backed aliases to the reviewed registry; re-run the audit and confirm the candidate count changes as expected.
5. Publish one staging snapshot. Verify current-offering IDs, match states, evaluation summaries, and rollback to the previously promoted run.
6. Only then enable the browser read-path migration behind its release gate.

## Required provenance in the future public response

Every catalogue response must retain `offering_id`, `source_snapshot_at`,
`match_status`, `match_method`, `historical_course_codes`, and the observed
evaluation years/counts. This lets the site explain what data it is showing and
lets an operator trace it back to the raw source records.
