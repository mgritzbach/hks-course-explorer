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

## Reviewed additive reconciliation candidate

The versioned registry in `data/historical_parity_registry.json` closes the two
sources by observation rather than by guessed course similarity:

| Disposition | Rows | Production effect |
| --- | ---: | --- |
| Shared IDs with the same complete observation | 4,270 | Generated presentation metadata may refresh; evaluation/bidding observations are identical. |
| Shared IDs with source-only evaluation payloads | 16 | The exact existing database row is preserved in generated assets so an evaluation cannot disappear. |
| Shared IDs with a canonical-only evaluation payload | 1 | The canonical evaluation enriches the same bidding-only immutable observation. |
| Unique exact-observation storage-ID pairs | 1,273 | Generated assets retain the existing database ID; the database row is not changed. |
| Distinct database-only observations | 252 | Preserved in generated assets and unchanged in the database. |
| Distinct canonical-only observations | 20 | Added only after the guarded migration passes its exact baseline. |
| **Projected exact manifest** | **5,832** | Every existing database observation plus every distinct canonical observation. |

The observation fingerprint includes normalized course/professor/title/term
identity, evaluation versus bidding state, aggregate window, respondent count,
and complete raw/percentile metrics. It requires a unique one-to-one pair. This
is why section-specific evaluations such as `DPI-805-M-A/B` remain separate
from an unsuffixed bidding-only `DPI-805-M` record even though their base course,
professor, term, and title agree.

An equal immutable ID is audited separately from an equal observation. Sixteen
shared IDs have a production evaluation that the CSV-derived row does not carry;
the registry stores and digest-locks those existing source rows, and the build
uses them unchanged. One shared ID has the reverse disposition: its canonical
evaluation enriches the same production bidding-only row. Any shared-ID drift
that is not exactly one of those two evaluation-preservation directions aborts
registry generation. This never transfers data between courses, professors,
terms, or sections.

The generated migration is guarded at 5,812 existing rows. It locks the table
for the short transaction, requires the exact full-row preimage for the one
same-ID evaluation enrichment, changes only its seven evaluation fields,
rejects duplicate/colliding additive IDs, adds exactly 20 rows, and requires a
5,832-row postcondition. It contains no delete, upsert, or ID rewrite.
Production parity remains unclaimed until protected CI, deployment,
backup/recovery, exact 5,812-row read-only preflight, migration application,
exact read-back, and focused browser checks all pass.

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

Regenerate the committed reconciliation registry only from the public,
read-only database boundary and an unchanged reviewed CSV:

```powershell
$env:SUPABASE_URL = 'https://your-project.supabase.co'
$env:SUPABASE_KEY = '<publishable-or-other-read-only-key>'
python scripts/build_historical_parity_registry.py `
  --expected-database-rows 5812
python scripts/build_data.py
```

Any count, immutable-ID, observation, registry-digest, or canonical-source hash
drift aborts the build and requires a new review.

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
