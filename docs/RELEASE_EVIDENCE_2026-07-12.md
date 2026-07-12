# Corporate release evidence — 2026-07-12

This is the evidence snapshot for the binary goals in `GOAL_STATUS.md`. It
separates a successful check from production certification: preview, staging,
or local proof is credited only for the boundary it actually exercises.

## Exact repository and release evidence

| Boundary | Exact evidence | Result |
|---|---|---|
| Protected master | `ed81c2413cbef79fcc51dc27277bb6e634f96626` | Recovery ordering PR #65 merged through the protected branch after independent manager review. |
| Exact-master quality gate | GitHub Actions `29206470877` | Dependency integrity/audit, lint, format, public contracts, architecture and complexity ratchets, 244 JavaScript tests, 168 Python tests, build, bundle budgets, and built-artifact browser E2E passed. |
| Exact-master release candidate | Deploy workflow `29206574864`; deployment `2248ffcb-1276-4f15-ad44-0ab9bfbcce40` | Target validation, catalogue parity, build, isolated Pages upload, static fingerprint smoke, and release-candidate real-browser acceptance passed. The workflow then stopped safely at the Cloudflare zone cache-policy gate. |
| Production runtime | Commit `67558bfa128d93630edaea2f4d35180c42e18653`; deployment `d83b6a60-f3a6-4bae-932d-80286a70c771` | Custom-domain production acceptance passed 5/5: all visitor routes, usable course advisor, every advertised HKS offering/session selectable, graph reset plus shortlist, and first-visit/mobile navigation. Two immediate advisor messages both returned recommendations. |
| Runtime equivalence | `git diff 67558bf..ed81c24` over `src`, `functions`, `public`, production tests, package manifests, and Vite configuration | No user-facing runtime difference. The later master commits contain recovery workflows/scripts/docs and the database privilege migration only. |

The canonical deployment workflow is still red because its token cannot verify
or set the custom-domain browser-cache policy. The separately recorded
production deployment and production acceptance prove G05 behavior, but do not
substitute for that missing Cloudflare control, a rollback exercise, or a fully
green canonical promotion.

## Production catalogue and database evidence

| Boundary | Exact evidence | Result and limit |
|---|---|---|
| HKS source parity | Catalogue parity `29198009270`; HKS sync `29198010160` | 297 active/distinct HKS offerings retained: 141 Fall and 156 Spring. |
| Non-HKS daily source | Non-HKS sync `29198011099` | Atomic no-delete promotion succeeded. Rows retained outside the current source remain reconciliation evidence, not deletion authority. |
| Browser policy hardening | Production migration `20260710230627_restrict_course_explorer_browser_writes` | Public catalogue reads retained; unrestricted browser policies removed; schedules remain retained but browser-inaccessible. |
| Browser grant hardening | Production migration records `20260712150803_revoke_course_explorer_browser_write_grants`, `20260712164711_revoke_course_sections_browser_write_grants`, and `20260712165347_assert_course_sections_browser_grant_postconditions` | Catalogue browser roles are SELECT-only, schedules has no browser grants, service role remains authoritative, and scoped rows/digests are unchanged. |
| Residual privilege hardening | Production migration `20260712224500_harden_maintain_and_trigger_function_grants` plus live read-back | `anon` and `authenticated` have no `MAINTAIN` on the five Course Explorer tables and cannot directly execute trigger-only functions; `service_role` retains both. RLS remains enabled and four scoped policies remain. |
| Post-migration health | Live read-back after the privilege migration | Counts remain `courses=5812`, `course_sections=265`, `schedules=63`, `live_catalogue_runs=5`, and `live_courses=8398`; live-course orphans remain `0`. |
| Encrypted five-table backup | GitHub Actions `29206580982` on exact master `ed81c24` | Two complete GET-only captures matched, 14,543 rows were encrypted/authenticated before upload, ciphertext retention is seven days, and runner plaintext was removed. |
| Isolated five-table restore | GitHub Actions `29206612080` on exact master `ed81c24` | PostgreSQL 17 rebuilt the exact schema/access contract, proved FK rejection and rollback, restored all five tables atomically, retained RLS/grants/functions/indexes/triggers and zero-orphan linking, matched every row count/digest, and removed decrypted files. No production credential or restore target was present. |

This recovery proof covers the complete Course Explorer relational boundary in
the shared project. It intentionally excludes unrelated shared-project data and
unused Supabase platform products. Seven-day encrypted artifacts are a short
no-cost recovery-point window, not durable archival retention.

## Binary goal audit

| Goal | Progress | Status | Acceptance decision |
|---|---:|---:|---|
| G01 Foundations / governance | 100% | 1 | Protected ruleset, named accountable owner, CODEOWNERS, private vulnerability intake, zero-cost/incident contracts, exact-master clean CI, and final manager/controller review are complete. |
| G02 Data integrity | 94% | 0 | Source promotion/parity and full disaster recovery are strong; no catalogue-promotion rollback has been exercised and retained non-current rows are not fully reconciled. |
| G03 Supabase reliability | 100% | 1 | Production RLS/privilege exercises, unchanged health counts, zero orphans, an exact-master encrypted five-table backup, and a complete isolated schema/relationship/policy restore are proven. |
| G04 Security | 90% | 0 | Course Explorer database hardening and live security headers are proven; authenticated Cloudflare zone/cache-policy verification and remaining shared-project advisor ownership are not closed. |
| G05 Navigation / usability | 100% | 1 | The custom production domain passed all five desktop/mobile visitor acceptance boundaries, and current master has no user-facing runtime difference from the tested deployment. |
| G06 Accessibility | 94% | 0 | Automated route-wide desktop/mobile WCAG, focus, and keyboard checks pass; documented manual exact-production keyboard/mobile acceptance is missing. |
| G07 Dependency security | 100% | 1 | Reviewed dependency register, vendored integrity, immutable action pins, and exact-master production audit gate are complete. |
| G08 Performance | 75% | 0 | Bundle/lab budgets and telemetry code exist; representative field LCP/INP and catalogue/API latency evidence is incomplete. |
| G09 Regression safety | 96% | 0 | Exact-master CI plus custom-domain production acceptance pass; an exercised Pages rollback/re-promotion is absent. |
| G10 Maintainable architecture | 100% | 1 | Bounded modules/contracts, architecture/complexity/runtime ratchets, exact-master quality gates, and independent final review are complete. |
| G11 Operations / deployment | 94% | 0 | Ownership, runbooks, production smoke, sync, and complete database recovery are proven; canonical Cloudflare promotion, Pages rollback/re-promotion, and successor/on-call acceptance remain incomplete. |

The evidence-weighted total is approximately 95%; five of eleven goals are
binary complete. Percentages are not release waivers.

## Required next evidence

1. Exercise a catalogue promotion rollback to a prior snapshot and restore the
   current promotion; decide ownership/reconciliation for retained non-current
   catalogue rows.
2. Correct the zero-cost Cloudflare token so it can verify and set the zone
   browser-cache/security policy, then complete the canonical exact-master
   deployment workflow.
3. Exercise the reviewed Pages rollback from a recorded production deployment,
   smoke the prior exact commit, and re-promote current through the complete
   path.
4. Record manual production desktop/mobile/keyboard accessibility acceptance.
5. Collect representative field LCP/INP and catalogue/API latency evidence.
6. Complete the successor/on-call handover acceptance record.

No item in this document authorizes a paid provider feature, destructive
catalogue reconciliation, production database restore, or broader
shared-project change.
