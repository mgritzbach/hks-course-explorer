# Historical parity reconciliation

The `courses` table and generated `public/courses.json` remain independent
historical sources until their immutable IDs are reconciled. Do not delete,
overwrite, or automatically map either source to force a count match.

## Verified production accounting — 2026-07-14

The protected read-only audit classifies every row from both sources without
changing either one:

| Category | Database rows | Canonical rows | Interpretation |
| --- | ---: | ---: | --- |
| Same immutable ID and observation | 4,257 | 4,257 | Exact shared observations. |
| Same ID with non-identity title drift | 3 | 3 | Review wording; identity is unchanged. |
| Exact technical aggregate rekey | 1,255 | 1,255 | Aggregate storage-ID change with equal provenance. |
| Terminal section/code review | 6 | 6 | Never link automatically across A/B/C changes. |
| Genuine ambiguous groups | 14 | 18 | Ten groups require source review. |
| Database-only | 242 | 0 | Preserve; all remain production history. |
| Canonical-only | 0 | 6 | Review before any additive database change. |
| Professor unavailable | 35 | 35 | Course-level history only; never professor-specific. |
| Identity conflict | 0 | 0 | No detected cross-identity collision. |
| **Classified total** | **5,812** | **5,580** | **Zero unclassified rows.** |

The exact ID parity gate remains false. The complete accounting is evidence,
not permission to rekey, merge, delete, or replace production history.
`CATALOGUE_SNAPSHOT_ENABLED` and `CATALOGUE_API_ENABLED` remain disabled.

The deterministic accounting lives in `scripts/audit_catalogue_sources.py`.
It fails on missing/duplicate immutable IDs or if either population does not
close exactly. Raw course additions are part of observation identity; only the
candidate-grouping key normalizes a base code so that section changes become
review items rather than silent matches.

## ATS current/retained visibility

The protected exact-master verifier `29331189018` is the current production
observation. It recomputed 6,101 active ATS offerings and 1,723 retained inactive
ATS rows, with zero missing observation timestamps and active-manifest digest
`957cc9bbec1d96ba1627e35cb56e086740b7ce274a85cc4a43739d500d76450d`.
It also reconstructed the exact 1,829-row Fall ATS digest from public browser
responses and proved a current course addable.

Earlier complete observations contained 5,230 current plus 2,397 retained,
5,414 current plus 2,205 retained, and 6,092 current plus 1,526 retained.
Cumulative inventory moved only from 7,618 to 7,619 to 7,627 while hundreds of
identities moved between current and retained. This proves upstream result
volatility, not retirement.

Every retained row therefore has a formal **KEEP/no-delete** disposition. The
current 1,723 retained rows remain stored for recovery but inactive so the
public `active=true` query cannot present them as currently offered. Each
complete promotion persists an exact ATS row-count, sorted-ID SHA-256, and
term-count manifest. The same transaction deactivates prior ATS visibility and
activates only the complete new run-owned manifest.

The post-promotion classifier fails if:

- a current source row is missing, inactive, or owned by the wrong ATS run;
- a retained ATS row remains active;
- current IDs/counts/terms differ from the active ATS manifest;
- protected HKS ownership or its active/rollback manifests drift; or
- any database row cannot be assigned to exactly one population.

No per-course Harvard lookup, Harvard login, three-day observation process, or
HMAC history is required for KEEP. Retiring records would be a new
data-governance decision requiring separate authority, an encrypted recovery
point, and an exercised rollback.

## Read-only operator review

Run the audit with a read-only key in a controlled operator environment. The
optional detailed report belongs under ignored `artifacts/` or outside the
repository and must never be uploaded as a CI artifact.

```powershell
$env:SUPABASE_URL = 'https://your-project.supabase.co'
$env:SUPABASE_KEY = '<read-only-key>'
python scripts/audit_catalogue_sources.py `
  --review-report "$PWD\artifacts\historical-parity-review.json"
```

The review export identifies exact semantic ID changes, ambiguous groups,
one-sided records, missing identity fields, and the narrow terminal-section
queue. It never authorizes a mapping or copies evaluation data across
professors.

## Approval gate

Only evidence-backed aliases may enter the reviewed alias registry. Preserve
original IDs and source observations. Missing-professor rows remain course-only.
Any future canonical correction or additive production insert requires named
source evidence, an independent review, a clean backup, and an exact rollback
plan.
