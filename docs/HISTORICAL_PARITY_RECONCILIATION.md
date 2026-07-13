# Historical parity reconciliation

The `courses` table and generated `public/courses.json` remain independent
historical sources until their immutable IDs are reconciled. Do not delete,
overwrite, or automatically map either source to make their counts match.

## Verified production baseline — 2026-07-11

The protected, read-only [Catalogue parity audit](https://github.com/mgritzbach/hks-course-explorer/actions/runs/29138370719)
completed against production at commit `db5a769`. It made no schema, policy,
or data changes. Its results are the current release baseline:

| Evidence | Observed count | Interpretation |
| --- | ---: | --- |
| `live_courses` rows | 7,283 | Complete paginated database read. The latest full Harvard source contained 5,890 offerings, so 1,393 retained rows are absent from that source and require reconciliation; they are not automatically deleted. |
| Historical database rows | 5,812 | Existing `courses` source remains immutable during reconciliation. |
| Browser canonical history rows | 5,580 | Generated `public/courses.json` served by the current application. |
| Exact semantic one-to-one history rows | 5,163 | Candidates with matching normalized evidence, not automatic ID rewrites. |
| Semantic ID-change candidates | 1,261 | Require controlled reconciliation; do not treat as approved mappings. |
| Ambiguous semantic keys | 178 | Must be decided by an operator with source evidence. |
| Current HKS offerings | 229 | One record per raw Harvard offering identity. |
| Verified same-professor history links | 102 | May carry professor-specific evaluation context in a future snapshot. |
| Course-only links | 21 | May show prior-offering context, never a current-professor rating. |
| Needs-review / unmatched links | 53 / 53 | Must remain explicitly labelled, never guessed. |

The historical ID parity gate is still **false**: 1,525 database-only IDs and
1,293 canonical-only IDs remain. Snapshot publication therefore remains
disabled by design. Do not set `CATALOGUE_SNAPSHOT_ENABLED=true` or
`CATALOGUE_API_ENABLED=true` on the basis of this audit.

The 1,261 semantic candidates are evidence for review, not permission to
rewrite IDs. The next controlled step is to generate the local review report
below with a trusted service key, review ambiguous and missing-identity rows
against authoritative course records, then make separately reviewed source
corrections. This repository intentionally does not upload that report from
GitHub Actions or write it into source control.

The live-course count above was rechecked by the protected read-only audit at
commit `6dac43a` after the scheduled sync. It explains the earlier 6,553/7,283
discrepancy: the sync successfully upserted its complete current source but
retained database rows that were not in that source. These rows are a
reconciliation queue, not proof of a safe deletion set. The sync now records
this aggregate inventory after every successful promotion and rejects all
deletion requests before API or database activity.

## Source-aware retained-row queue

The earlier aggregate mixed unrelated ownership populations and therefore
cannot support a keep/retire decision. After each complete non-HKS promotion,
the sync now performs a read-only, service-authorized inventory that must place
every database row in exactly one population:

- current, active non-HKS ATS rows from the just-promoted source;
- the active my.harvard HKS snapshot;
- the one retained my.harvard rollback snapshot;
- inactive legacy HKS fallback rows; or
- actionable retained non-HKS ATS rows absent from the current source.

The active and rollback HKS populations are checked against their persisted
row-count, source-offering identity SHA-256, and exact term-count manifests.
Unknown ownership, duplicate identities, missing/inactive current ATS rows,
active legacy HKS fallback rows, or manifest drift fail the audit. The Actions
summary contains only population counts, actionable school/term/last-seen-age
buckets, and a deterministic SHA-256 of the sorted actionable IDs. It never
publishes raw IDs or course content.

The classifier requires both the active snapshot and exactly one row-bearing
rollback snapshot; either snapshot missing is a failed audit. The actionable
digest makes successive complete ATS runs comparable, but neither absence from
one upstream result nor a stable digest authorizes mutation. Every actionable
row still needs authoritative source evidence and an explicit keep/retire
decision. Until that review is complete, the sync retains the row and performs
no delete or active-state change.

### Exact retained-ATS observation audit

The first observation cohort is frozen at **1,526 unique IDs** with SHA-256
`fbd0a26cc18c195150f6f8d6e402db69edf28f0227c3ad5911814518c04312a5`.
The manual `scripts/audit_retained_ats.py` tool refuses to inspect a subset: it
reconstructs the complete current ATS source, authoritative HKS exclusions,
database ownership partition, row count, and digest before the first retained
lookup. Any source, manifest, ownership, count, duplicate, HKS-overlap, or
digest mismatch stops the run as `queue_snapshot_mismatch`. Once a valid
history location and HMAC key are available, a bounded failed-attempt record is
appended so an interrupted run cannot be mistaken for a clean observation.

The first successful schema-v2 observation establishes the immutable cohort,
an immutable ownership commitment, and a separate locator commitment for every
member. Later runs recover
those same 1,526 rows from the complete database inventory, even when a row has
reappeared in the current Harvard source and therefore left the current
actionable queue. A verified current-source reappearance may advance that row's
term, code, school, session, and active-state commitment without changing its
ownership or cohort token. An absent row cannot change those fields. Reappeared
cohort rows remain observable, while newly
actionable rows outside the frozen cohort are counted and digested separately.
Any outside-cohort row blocks G02 completion until it receives a separately
reviewed disposition; it is never silently excluded. The complete source and
database inventory is read again after all provider lookups, and any intervening
change invalidates the run.

After a known-current positive control, the tool performs one sequential,
paced Harvard search per retained ID. Each search uses exact `courseID`, never a
`catalogSchool` facet, follows only exact allow-listed Harvard HTTPS scroll
URLs, disables redirects, and consumes every page so a late duplicate cannot
be missed. Every queue row receives exactly one outcome:

- `exact_instance`: one exact ID and all stored locator fields agree;
- `moved_instance`: one exact ID but school, term, course code, or session moved;
- `confirmed_absence`: a complete valid search contained no exact ID; or
- `unknown`: request, pagination, schema, identity, or locator evidence was
  insufficient. Unknown is allowed and must never be converted into absence.

Membership in the complete current-source sweep always dominates an individual
exact-search absence. That disagreement becomes `unknown` with the bounded
`source_disagreement` reason and can never support retirement review.

The local JSONL history contains HMAC tokens, outcome names, moved field names,
bounded reason codes, counts, provenance, and a chained HMAC—never raw IDs,
descriptions, request URLs, response bodies, or credentials. The chain is
authenticated by the shared operator secret; it is not a digital signature and
is not independently tamper-proof unless its printed chain head is retained in
an external change ticket or other access-controlled record. A token can become
a `future_retirement_review_candidate` only after its latest three eligible
observations are clean absences on three distinct UTC dates and are at least 18
hours apart. A later present, moved, unknown, invalid, or incomplete observation
blocks that status until three newer clean absences exist. Pre-v2 observations
do not count toward this barrier, and schema-v1 records are forbidden after the
first schema-v2 record. A run with any newly actionable outside-cohort row also
cannot count toward the barrier. Candidate status is evidence for a future
human review only; it does not mutate, hide, deactivate, delete, merge, enrich,
or publish anything.

Run only from a clean reviewed commit, with the persistent HMAC secret supplied
through the operator environment:

```powershell
$env:SUPABASE_URL = 'https://cbtroatixvydpwoviezf.supabase.co'
$env:SUPABASE_KEY = '<service-role-or-secret-key>'
$env:HARVARD_API_KEY = '<harvard-api-key>'
$env:RETAINED_ATS_AUDIT_HMAC_KEY = '<unique-persistent-secret-at-least-32-bytes>'
python scripts/audit_retained_ats.py --history "$PWD\artifacts\retained-ats-audit-history.jsonl"
```

`SUPABASE_URL` must be that exact production origin; the runtime transport guard
permits only GET requests to its REST API and the reviewed Harvard ATS hosts.
Before a run, confirm that the provider request volume remains inside the free
quota with no paid overage. A successful run performs two complete general-source
sweeps plus one positive control and 1,526 exact searches, with additional
pagination and bounded transient retries. Avoid the scheduled 07:00 UTC sync
window so both inventory reads observe one stable catalogue. Do not schedule
this command, upload its history, or treat one successful run as G02 completion
or retirement approval. After a successful run, copy the aggregate terminal
line—including `history_chain_head`—to an external access-controlled change
record. Never copy the JSONL history, raw identifiers, or secrets into that
record.

## Read-only operator review

Run the audit with service-role credentials only in a controlled operator
environment. The optional report must be written outside the repository (or
under the ignored `artifacts/` directory) and must never be committed or
uploaded as an Action artifact.

```powershell
$env:SUPABASE_URL = 'https://your-project.supabase.co'
$env:SUPABASE_KEY = '<service-role-key>'
python scripts/audit_catalogue_sources.py `
  --review-report "$PWD\artifacts\historical-parity-review.json"
```

The report is evidence, not a migration. Its statuses mean:

- `exact_semantic_id_change`: code, year, term, professor, title, and
  aggregate status agree exactly but storage IDs differ. A human must still
  verify provenance before approving a mapping.
- `ambiguous_semantic_key`: at least one side has multiple records under the
  same semantic identity. Never choose a row automatically.
- `source_only_semantic_key` / `canonical_only_semantic_key`: investigate the
  authoritative provenance and whether a record is intentionally retired.
- `*_missing_identity_fields`: repair source metadata before attempting any
  mapping.

The report additionally includes `manual_nonaggregate_section_code_change_reviews`.
This is a narrow subset of exact semantic ID-change candidates: non-aggregate,
one-to-one records where the historical structured ID has exactly one terminal
section token (such as `-A`) that is absent from the browser canonical ID.
It excludes generated aggregates, ambiguous rows, and all other renumbering
patterns. The queue makes potentially consequential A/B/C section changes
visible without treating them as approved aliases. Every item still requires
authoritative catalogue evidence and two-person approval before any reviewed
alias is added.

## Approval gate

Only evidence-backed approved aliases may enter the reviewed alias registry.
An ID-change candidate does not by itself approve a course-code renumbering or
allow ratings to cross professor identities. Preserve the original IDs and
sources; add a new reviewed mapping only after a named operator records the
supporting evidence and a second reviewer checks it.
