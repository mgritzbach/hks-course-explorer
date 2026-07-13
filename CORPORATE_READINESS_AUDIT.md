# HKS Course Explorer: Corporate-Readiness Change List

Audit date: 2026-07-09. The findings below are the original baseline and the
ordered corporate change list. Local implementation progress is tracked in
`GOAL_STATUS.md`; no release goal is considered complete without its stated
production evidence.

Scope update (2026-07-13): the original visitor-authentication recommendations
below are superseded. The product has no visitor login, so the unused OTP/email,
visitor JWT, and protected-KV catalogue paths were retired instead of expanded.
The hidden Admin session remains a separate, short-lived operations control.

## Production inspection update: 2026-07-10

Read-only inspection of the authorized `course-explorer-db` Supabase project
confirmed that it is active and that all 1,419 `live_courses` rows were synced
within the preceding 14 days. It also found production blockers that must be
remediated in a reviewed staging exercise before any release claim:

1. `public.live_courses` has an `ALL` RLS policy with `USING (true)` and
   `WITH CHECK (true)`. The browser needs public read access, but anonymous
   users must not be able to insert, update, or delete catalogue rows. The
   scheduled sync uses a server credential and does not need browser writes.
2. `public.schedules` has an `ALL` RLS policy with `USING (true)` and
   `WITH CHECK (true)`. The application writes plans with a browser-created
   user identifier, so the policy and identity design need a deliberate
   migration/reconciliation—not a blind lock-down that breaks saved plans.
3. The project is shared with non-Course-Explorer tables. Their security
   advisor findings are out of scope for this repository and must be handled
   with that application's owner; no shared production policy was changed.
4. The local forward-only corporate admin-import migration is not yet listed
   in the live project migration history. Do not apply it directly to this
   shared production project; validate on an approved branch/staging target.

The local catalogue build now produces 5,580 records with 5,580 unique IDs.
Distinct aggregate windows receive deterministic identifiers, complementary
evaluation/bidding records merge conservatively, and the loader aborts before
creating a Supabase client if a duplicate ID remains. These are local
integrity safeguards, not a database-promotion or rollback proof.

## Executive decision

The product has a strong working base: the production build, ESLint, and all 16
unit tests pass; the deployed application loads its Supabase-backed historical
catalogue and Schedule Builder data. It is **not ready for a risk-free corporate
handover yet**. The live Harvard catalogue proxy returns HTTP 502 in production,
and the end-to-end suite has one failing critical flow (two pass, one fails).

### Current local iteration status

The repository now includes local hardening for the Harvard proxy and sync
failure path, deterministic built-artifact browser tests, CI/deploy workflow
gates, static-guide routing, versioned handover documentation, restrictive
same-origin CORS, and bounded Chat Function requests. The latest local evidence
is: lint passed; 33 JavaScript tests passed; 2 Python sync-safety tests passed;
the production build passed; and 4 built-preview browser flows passed. This is
not production certification: the live proxy, database, deployment platform,
secrets, monitoring, rollback, dependency triage, performance budgets, and
accessibility still require the evidence listed in `GOAL_STATUS.md`.

Changes should be delivered in the order below, each behind a pull request,
staging deployment, automated checks, and a rollback plan.

## P0 - fix before expanding the product

1. **Make the Harvard catalogue integration observable and resilient.**
   - Reproduce and diagnose the deployed `GET /api/harvard-courses` 502 with
     Cloudflare logs and the upstream response; restore successful live search.
   - Add upstream request timeouts, retry/backoff only for transient failures,
     bounded concurrency, stale-cache fallback, and structured error codes.
   - Return an honest typed error to the UI. Do not silently label results
     `DB only` when a user expects a live catalogue search.
   - Add contract tests with recorded Harvard API fixtures and a production
     synthetic health check for HKS, Non-HKS, and empty-result cases.

2. **Make the scheduled data sync safe against partial upstream failure.**
   - The current script deletes every row not refreshed in the current run, but
     only aborts when *zero* rows are returned. A partial API outage can therefore
     erase valid live-course rows.
   - Write to a staging/versioned dataset, validate per-school and per-term count
     thresholds against the prior successful run, then atomically promote it.
   - Persist run metadata: source version, row counts, failures, duration,
     freshness, and an explicit last-known-good version for rollback.

3. **Repair the end-to-end regression suite and its empty state.**
   - Test 1 fails when the selected session has no offerings because the `N with
     schedule` element disappears. Keep a stable results-summary region that can
     say `0 courses with schedule`, and test that explicit empty state.
   - Replace fixed sleeps and ambiguous selectors with stable `data-testid`
     contracts plus waits for loaded/query-complete state.
   - Run E2E against a deterministic seeded preview environment; retain a small
     separate smoke suite against production.

## P1 - establish a dependable platform

4. **Make the database reproducible and controlled.**
   - Check in the complete Supabase schema: all tables, indexes, constraints,
     RLS policies, grants, seed/reference data, and migrations. The repository
     currently contains only a three-column alteration.
   - Add a migration runner and CI job that applies the schema to an empty
     database and exercises the application queries. Paginate `live_courses` and
     `course_sections` rather than relying on a silent 2,000-row client limit.
   - Define ownership and a retention/backup/restore runbook for schedules and
     catalogue data.

5. **Introduce safe delivery gates.**
   - Deploy only after lint, unit tests, data validation, build, E2E, and a
     dependency/security audit pass on the exact commit being deployed.
   - Add a preview deployment per pull request, a smoke check after deployment,
     immutable release identifiers, and one-click rollback to the prior Pages
     deployment/data version.
   - Pin Python dependencies in `requirements` files; keep Node on `npm ci`
     and add Dependabot/Renovate with controlled update PRs.

6. **Resolve dependency risk deliberately.**
   - Current production audit: 18 advisories (1 critical, 2 high); direct
     dependencies include `xlsx`, `posthog-js`, and `react-router-dom`.
   - Create an update matrix, patch one dependency family at a time, run the full
     regression suite and UI smoke checks, and document accepted residual risk.
   - Treat uploaded spreadsheet input as untrusted: size-limit it, parse in a
     constrained worker, validate its schema, and never render untrusted HTML.

7. **Harden environment and authentication operations.**
   - Maintain one versioned environment-variable contract for Pages Functions,
     CI, local development, and disaster recovery. Document `JWT_SECRET`, KV
     binding, Brevo, OpenRouter, Sentry, PostHog, Harvard, and Supabase settings
     without storing secrets in the repository.
   - Remove the hard-coded production Supabase endpoint/fallback and personal
     email whitelist from application code; fail fast with a clear operator
     message when configuration is missing.
   - Add OTP request/verification rate limits, attempt counters, audit events,
     secret rotation, a configurable allowed-domain policy, and correct CORS for
     every approved production/custom domain.

## P2 - make it fast and easy to use

8. **Set and enforce performance budgets.**
   - The production build contains a 4.87 MB Plotly chunk (1.48 MB gzip), a
     503 KB main bundle, and 405 KB Courses chunk. Measure real mobile LCP/INP
     and establish page-level JavaScript and API latency budgets.
   - Keep the visual explorer lazy; replace full Plotly with a smaller scatter
     implementation or a custom Plotly build, virtualize long course lists, and
     avoid fetching the complete historical catalogue on every new tab.
   - Version/cache static data by content hash and use server-side paginated,
     selective queries for the main catalogue.

9. **Improve navigation and feedback states.**
   - Preserve the current strong search/filter affordances, but centralize their
     states: loading, no matches, stale data, live-service unavailable, and
     retry/last-updated metadata.
   - Add a mobile and keyboard-accessibility acceptance checklist for every
     route, including focus order, shortcut discoverability, screen-reader
     announcements, and reduced-motion/colorblind modes.
   - Use product analytics only with a documented privacy policy, consent model,
     retention policy, and event schema; ensure Sentry replay masks all student
     data by default.

## P2 - IT-team handover and adjustability

10. **Create clear bounded modules.**
    - Split `ScheduleBuilder.jsx` (about 159 KB) and `Courses.jsx` into feature
      folders: state/query hooks, mapping/normalization, filter controls, results,
      schedule grid, persistence, and pure domain utilities.
    - Replace duplicated Harvard API normalization in the Worker and Python sync
      script with a versioned shared schema/fixture contract. Keep UI components
      focused on rendering, not data orchestration.
    - Add TypeScript incrementally for external data contracts and critical
      scheduling/requirements utilities; enforce formatting, imports, and
      complexity limits in CI.

11. **Turn implicit knowledge into maintainable documentation.**
    - Add `ARCHITECTURE.md`, an operations runbook, on-call/checklist pages, a
      data dictionary, API contracts, and a release/rollback guide.
    - Repair the broken `docs/data-pipeline-overview.txt` reference and README
      character encoding. Document the source-of-truth for each dataset and every
      term-format transformation.
    - Expand ADRs to cover deployment architecture, data freshness, auth,
      privacy, database/RLS, and caching decisions.

12. **Standardize configuration rather than scattering it.**
    - Use a typed runtime configuration layer for school branding, feature flags,
      term rules, supported schools, domains, API endpoints, and performance
      settings; validate it at startup and in CI.
    - Keep customer/school overrides in a documented config package with a schema
      and example files. This makes the fork model maintainable without editing
      product internals.

## Definition of done for every change

- Small, reviewed PR with a migration/data compatibility statement.
- Unit, integration, E2E, accessibility, and performance tests appropriate to
  the changed boundary.
- Preview deployment and production smoke test passing.
- Monitoring/dashboard updates and rollback validated before rollout.
- No production deployment until CI is fully green.

## Baseline verification performed in the initial audit

- `npm run lint`: passed.
- `npm test`: 2 files, 16 tests passed.
- `npm run build`: passed; data validation reported 36 recoverable warnings.
- `npm run test:e2e`: 2 passed, 1 failed (session-filter empty-state contract).
- Production home and Schedule Builder loaded successfully with stored
  Supabase-backed course and scheduling data.
- Production Harvard catalogue proxy returned HTTP 502 for an HKS course query.
