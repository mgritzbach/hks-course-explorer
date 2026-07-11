# Historical parity reconciliation

The `courses` table and generated `public/courses.json` remain independent
historical sources until their immutable IDs are reconciled. Do not delete,
overwrite, or automatically map either source to make their counts match.

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

## Approval gate

Only evidence-backed approved aliases may enter the reviewed alias registry.
An ID-change candidate does not by itself approve a course-code renumbering or
allow ratings to cross professor identities. Preserve the original IDs and
sources; add a new reviewed mapping only after a named operator records the
supporting evidence and a second reviewer checks it.
