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
