# Corporate release evidence — 2026-07-12

This is the evidence snapshot for the binary goals in `GOAL_STATUS.md`. It
separates a successful check from production certification: preview, staging,
or local proof is credited only for the boundary it actually exercises.

## Exact repository and release evidence

| Boundary | Exact evidence | Result |
|---|---|---|
| Protected master | `a7c22081cc3c737fb72b56ad198bcaa3dac59526` | Ownership/handover PR #61 merged through the protected branch. |
| Exact-master quality gate | GitHub Actions `29199690286` | Dependency integrity/audit, lint, format, public contracts, architecture and complexity ratchets, unit and Python tests, build, bundle budgets, and built-artifact browser E2E passed. |
| Exact release candidate | Deploy workflow `29199795932` | Target validation, HKS manifest parity, build, isolated Pages upload, static fingerprint smoke, and real-browser acceptance passed. |
| Production promotion | Deploy workflow `29199795932` | Stopped safely at the custom-domain cache-policy gate because the token resolved zero active `hks-course-explorer.org` zones. Production deploy and all post-deploy smokes were skipped. |

The failed deployment did not mutate production. The current master must not be
described as deployed until the Cloudflare token is corrected and the complete
workflow succeeds.

## Production catalogue and database evidence

| Boundary | Exact evidence | Result and limit |
|---|---|---|
| HKS source parity | Catalogue parity `29198009270`; HKS sync `29198010160` | 297 active/distinct HKS offerings retained: 141 Fall and 156 Spring. |
| Non-HKS daily source | Non-HKS sync `29198011099` | Atomic no-delete promotion succeeded. Rows retained outside the current source remain reconciliation evidence, not deletion authority. |
| Encrypted backup | Backup `29198008604` | Production `live_courses` payload retained as an encrypted seven-day artifact. |
| Isolated restore | Restore verification `29198048899` | The encrypted payload round-tripped exactly in ephemeral PostgreSQL 17. It does not recreate foreign keys, indexes, RLS, related run rows, or a Supabase recovery target. |
| Browser policy hardening | Production migration `20260710230627_restrict_course_explorer_browser_writes` | Public catalogue reads retained; unrestricted browser policies removed; schedules remain retained but browser-inaccessible. |
| Browser grant hardening | Production migration record `20260712150803_revoke_course_explorer_browser_write_grants` | Catalogue browser roles are SELECT-only, schedules has no browser grants, service role remains authoritative, and scoped rows/digests are unchanged. |
| Section grant hardening | Production migrations `20260712164711_revoke_course_sections_browser_write_grants` and `20260712165347_assert_course_sections_browser_grant_postconditions` | All 265 rows and digest were retained; browser roles are SELECT-only; service role and the sole public read policy are unchanged; effective privilege assertions and four post-change live browser flows passed. |

The Course Explorer target advisor result remaining after hardening is the
informational `schedules` RLS-without-policy state. That is intentional because
schedule persistence is browser-local. Advisor findings on unrelated objects in
the shared Supabase project are not Course Explorer changes and require their
own owner and scope.

## Binary goal audit

| Goal | Status | Acceptance decision |
|---|---:|---|
| G01 Foundations / governance | 1 | Protected ruleset, named accountable owner, CODEOWNERS, private vulnerability intake, zero-cost/incident contracts, exact-master clean CI, and final manager/controller review are complete. |
| G02 Data integrity | 0 | Source promotion/parity is strong, but no production catalogue rollback has been exercised and retained non-current rows are not fully reconciled. |
| G03 Supabase reliability | 0 | Production policy/grant hardening, sync health, encrypted backup, and an exact table-payload restore are proven; full application schema/relationship/policy recovery is not. |
| G04 Security | 0 | Course Explorer database hardening is complete, but live Cloudflare zone/security/cache-policy verification is missing. |
| G05 Navigation / usability | 0 | Exact-master release-candidate visitor acceptance passed, but exact-master production/custom-domain acceptance did not run. |
| G06 Accessibility | 0 | Automated route-wide desktop/mobile WCAG, focus, and keyboard checks pass; documented manual acceptance on the exact production release is missing. |
| G07 Dependency security | 1 | Reviewed dependency register, vendored integrity, immutable action pins, and exact-master production audit gate are complete. |
| G08 Performance | 0 | Bundle/lab budgets and telemetry code exist; the telemetry is not deployed and representative field LCP/INP/API-latency evidence is absent. |
| G09 Regression safety | 0 | Exact-master CI and release-candidate regression suites pass; exact production smoke and an exercised Pages rollback are absent. |
| G10 Maintainable architecture | 1 | Bounded modules/contracts, architecture/complexity/runtime ratchets, exact-master quality gates, and independent final review are complete. |
| G11 Operations / deployment | 0 | Ownership, runbooks, sync, and partial recovery controls exist; production promotion, rollback exercise, and successor/on-call acceptance remain incomplete. |

## Required next evidence

1. Correct the zero-cost Cloudflare token so it has Zone Read and Zone Settings
   Write only for `hks-course-explorer.org`; rerun the exact-master deployment.
2. Retain successful Pages-domain and custom-domain static and real-browser
   production smoke evidence.
3. Exercise the reviewed Pages rollback from its recorded production commit,
   verify it from that exact commit, and re-promote current master through the
   complete path.
4. Produce a fuller Course Explorer recovery proof or document the accepted
   operational limit of service-key logical recovery on the free Supabase plan.
5. Record manual desktop/mobile/keyboard acceptance on the exact production
   release and collect representative field Web Vitals/catalogue latency.
6. Complete the successor/on-call handover acceptance record.

No item in this document authorizes a paid provider feature, a destructive
catalogue reconciliation, a database restore, or a broader shared-project
change.
