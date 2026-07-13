# Corporate release evidence — 2026-07-12

This is the evidence snapshot for the binary goals in `GOAL_STATUS.md`. It
separates a successful check from production certification: preview, staging,
or local proof is credited only for the boundary it actually exercises.

## Post-snapshot production evidence — 2026-07-12 18:23 PDT

| Boundary | Exact evidence | Result and limit |
|---|---|---|
| Current protected production | Master `19e854a73c304560c8f7f29a4b42365176dfa612`; deployment `a9351956-7073-4d4b-abdc-c2b496f9c4e4`; entry asset `index-CYL270LF.js` | Protected PRs #72-#73 passed two exact-head quality gates, exhaustive instructor/course-code audits, controller review, and final manager review. Exact Pages-domain static smoke and custom-domain production acceptance passed 5/5 after deployment. |
| Pages rollback target | Commit `f3ce8668ddcb946f080274bfe4bf6096081432fe`; deployment `e4368292-f73a-4966-aebf-59b70a3de64b`; entry asset `index-BgxvUVed.js` | The Cloudflare Pages rollback API accepted the previously successful production deployment. A detached exact-commit worktree was clean-installed and rebuilt with the existing browser configuration; target Pages static smoke and custom-domain visitor acceptance passed 5/5. |
| Pages re-promotion | Commit `19e854a73c304560c8f7f29a4b42365176dfa612`; deployment `a9351956-7073-4d4b-abdc-c2b496f9c4e4` | Cloudflare accepted re-promotion to the recorded current deployment, the custom-domain fingerprint returned to `index-CYL270LF.js`, exact Pages static smoke passed, and custom-domain visitor acceptance passed 5/5. No Supabase data/migration, KV, secret, or Durable Object state was changed. |
| Remaining cache-policy failure | Custom-domain static smoke during rollback | The app/browser checks passed, but the zone still extended fingerprinted assets beyond the reviewed Pages `max-age=0, must-revalidate` policy. This is the pre-existing Cloudflare zone-policy blocker and prevents G04/G09/G11 completion. It does not invalidate the narrower functional rollback evidence, but it keeps the complete production-smoke contract red. |
| Context-safe zero-cost advisor | PR #73 head `f9f6d14`; merge `19e854a`; production `a9351956` | Live requests used only DPI-851/852/853 for Hong Qu, sent relevant history only for the follow-up, and proved a `$0` `:free` OpenRouter response. Provider 5xx/timeouts remained explicit and never produced a canned answer. |

## Historical exact repository and release evidence

This table preserves the earlier same-day snapshot. The post-snapshot section
above is authoritative for current master and production.

| Boundary | Exact evidence | Result |
|---|---|---|
| Protected master | `167e20407cc70b72398276f816a0d1af3bba80d5` | PR #67 merged through protected master after controller review, automated review remediation, two exact-head quality gates, and final manager approval. |
| Exact-master quality gate | GitHub Actions `29208929319` | Dependency integrity/audit, lint, format, public contracts, architecture and complexity ratchets, 252 JavaScript tests, 168 Python tests, build, bundle budgets, and 38 built-artifact browser flows passed. |
| Exact-master release candidate | Deploy workflow `29209040956`; deployment `304ec26c-c03d-4e80-bfd4-8fe1ce66dcc5` | Target validation, catalogue parity, build, isolated Pages upload, static smoke, and release-candidate real-browser acceptance passed 5/5. The workflow then stopped safely at the Cloudflare zone cache-policy gate; production promotion and post-deploy checks were skipped. |
| Production runtime | Commit `67558bfa128d93630edaea2f4d35180c42e18653`; deployment `d83b6a60-f3a6-4bae-932d-80286a70c771` | Custom-domain production acceptance passed 5/5: all visitor routes, usable course advisor, every advertised HKS offering/session selectable, graph reset plus shortlist, and first-visit/mobile navigation. Two immediate advisor messages both returned recommendations. |
| Current-master delta at the earlier snapshot | PR #67 (`dfff5d29a4088504a48a04dd45eaff88908325c0`) merged as `167e204` | Added non-visual, privacy-bounded performance telemetry and its release controls. At that snapshot it had passed only the isolated release-candidate boundary; the later production state is recorded above. |

The canonical deployment workflow is still red because its token cannot verify
or set the custom-domain browser-cache policy. The separately recorded
production deployment and production acceptance prove G05 behavior. The
post-snapshot deployment proves the telemetry code is now present and the Pages
rollback/re-promotion boundary is exercised. Neither substitutes for the
missing Cloudflare control or a fully green canonical promotion.

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
| G05 Navigation / usability | 100% | 1 | The custom production domain passed all five desktop/mobile visitor acceptance boundaries; current master independently passed the same five release-candidate browser boundaries after its non-visual telemetry change. |
| G06 Accessibility | 94% | 0 | Automated route-wide desktop/mobile WCAG, focus, and keyboard checks pass; documented manual exact-production keyboard/mobile acceptance is missing. |
| G07 Dependency security | 100% | 1 | Reviewed dependency register, vendored integrity, immutable action pins, and exact-master production audit gate are complete. |
| G08 Performance | 82% | 0 | Exact-master has tested, privacy-bounded, zero-cost LCP/INP/CLS RUM, operational p75 queries, and a bundle-enforced lazy measurement chunk; the collector code is now deployed. Representative mobile field Web Vitals plus catalogue/API latency evidence are still absent, so the binary goal and conservative progress remain unchanged. |
| G09 Regression safety | 98% | 0 | Exact-commit CI, route/browser/a11y gates, functional custom-domain acceptance, and an exact rollback to `f3ce866` followed by verified re-promotion of `19e854a` are complete. The required custom-domain static smoke remains red on the cache-policy assertion, and the complete rollback/re-promotion smoke must be repeated after that policy is fixed. |
| G10 Maintainable architecture | 100% | 1 | Bounded modules/contracts, architecture/complexity/runtime ratchets, exact-master quality gates, and independent final review are complete. |
| G11 Operations / deployment | 97% | 0 | Ownership, runbooks, functional production/browser smoke, sync, complete database recovery, and functional Pages rollback mechanics are proven; the canonical Cloudflare cache-policy/promotion path, a cache-conformant rollback repeat, and successor/on-call acceptance remain incomplete. |

The evidence-weighted total is approximately 96%; five of eleven goals are
binary complete. Percentages are not release waivers.

## Required next evidence

1. Exercise a catalogue promotion rollback to a prior snapshot and restore the
   current promotion; decide ownership/reconciliation for retained non-current
   catalogue rows.
2. Correct the zero-cost Cloudflare token so it can verify and set the zone
   browser-cache/security policy, then complete the canonical exact-master
   deployment workflow.
3. Repeat the exact Pages rollback and re-promotion after the zone-policy fix;
   require the Pages and custom-domain static smokes plus browser acceptance to
   pass in both directions.
4. Record manual production desktop/mobile/keyboard accessibility acceptance.
5. Retain and review a representative 28-day field window split by device
   type. Require the independent `Mobile` segment to have at least 75 LCP
   samples, 75 CLS samples, and 30 INP interaction samples, with mobile p75 LCP
   at or below 2,500 ms, mobile p75 INP at or below 200 ms, and mobile p75 CLS at
   or below 0.1. Also require representative catalogue/API latency results
   against approved budgets. An all-device aggregate, empty window, or
   operator-only window is not mobile acceptance evidence.
6. Complete the successor/on-call handover acceptance record.

No item in this document authorizes a paid provider feature, destructive
catalogue reconciliation, production database restore, or broader
shared-project change.
