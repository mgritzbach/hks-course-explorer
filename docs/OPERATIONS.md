# Operations and release runbook

## Local quality gate

Run this before requesting review:

```bash
npm ci --legacy-peer-deps
npm run check:vendor-integrity
npm run lint
npm run check:format
npm run check:contracts
npm run check:architecture
npm run check:ui-complexity
npm run check:runtime-contracts
npm test
python -m unittest discover -s scripts/tests -v
npm run build
npm run check:bundle-budget
npm run test:e2e
```

The E2E suite must target a locally built preview or controlled preview
environment. A mutable production deployment is a smoke target, not a
deterministic test fixture.

Before production promotion, the deploy workflow uploads the exact CI commit to
the serialized `release-candidate` Pages preview. Static fingerprint checks and
`npm run test:e2e:production` must pass there before the production branch can
change. Immediately before promotion, the workflow also fetches `origin/master`
and refuses to deploy if a newer commit has superseded the tested candidate.
The same browser suite then confirms the custom production domain after
promotion. It executes the real React application, visits every visitor route,
requires at least two non-empty HKS terms and the authoritative sync's
285-offering safety floor, reconciles every advertised term/count with rendered
rows and unique enabled controls, exercises browser-local add/remove boundaries,
and verifies Plotly zoom/pan/reset and graph shortlisting. The browser blocks
PostHog, Sentry, and Cloudflare browser-RUM writes and fails on any other
non-read request, so it does not pollute telemetry, submit chat prompts, call an
upstream catalogue API, or write to Supabase. A failure prevents promotion or
leaves the production workflow red
and retains Playwright diagnostics for seven days; do not treat the release as
healthy until the failure is resolved or the prior deployment is restored.

The production workflow also enforces the Cloudflare zone's **Browser Cache
TTL** as **Respect Existing Headers** before it promotes the Pages candidate.
Cloudflare represents that setting as `browser_cache_ttl = 0`. This prevents
the zone's four-hour default from extending Pages' deployment-safe
`Cache-Control: public, max-age=0, must-revalidate` policy. The control resolves
exactly one active `hks-course-explorer.org` zone, refuses a non-editable or
ambiguous target, applies only that setting, and requires a successful API
read-back. The following custom-domain static smoke still validates every
manifest asset's exact body, MIME type, and cache directives, so a separate
Cache Rule override remains release-blocking.

The repository secret `CLOUDFLARE_API_TOKEN` must grant **Zone Read** and
**Zone Settings Write** only for the `hks-course-explorer.org` zone, in addition
to the existing Pages/Workers deployment permissions. Do not replace it with a
global API key. The policy control retries transient rate-limit, server, and
network failures twice with bounded backoff; permission, target-validation, and
read-back failures are never retried into a broader mutation.

## Manual Cloudflare Pages rollback

Use this only after a production promotion has occurred and a subsequent smoke
or monitoring check proves the new deployment unsafe. Cloudflare accepts only a
previously successful **production** deployment as a Pages rollback target;
preview/release-candidate deployments are not valid targets. See Cloudflare's
[Pages rollback documentation](https://developers.cloudflare.com/pages/configuration/rollbacks/).

1. Freeze new merges and cancel or disable any queued production deployment.
2. In **Cloudflare > Workers & Pages > hks-course-explorer > Deployments > All
   deployments**, record the current production deployment ID/commit and the
   last successful production deployment that passed both Pages and custom-
   domain smoke. Do not select a preview deployment. Record the target ID,
   commit, URL, and the evidence that made it last-known-good.
3. Open the target's three-dot menu, choose **Rollback to this deployment**,
   confirm, and record the resulting production deployment ID and timestamp.
   The equivalent API operation requires only Pages Write and is useful when
   the dashboard is unavailable:

   ```powershell
   $env:CLOUDFLARE_ACCOUNT_ID = '54cdc2ac5fbe86216672ccf2589cf9cb'
   $env:CLOUDFLARE_PAGES_PROJECT = 'hks-course-explorer'
   $env:ROLLBACK_DEPLOYMENT_ID = '<reviewed successful production deployment UUID>'
   # CLOUDFLARE_API_TOKEN must be supplied as a secret environment variable.
   $headers = @{ Authorization = "Bearer $env:CLOUDFLARE_API_TOKEN" }
   $uri = "https://api.cloudflare.com/client/v4/accounts/$env:CLOUDFLARE_ACCOUNT_ID/pages/projects/$env:CLOUDFLARE_PAGES_PROJECT/deployments/$env:ROLLBACK_DEPLOYMENT_ID/rollback"
   $result = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers
   if (-not $result.success) { throw 'Cloudflare Pages rollback was not accepted.' }
   ```

4. Verify from an isolated checkout of the **recorded rollback commit**. The
   static smoke compares deployed asset fingerprints and bodies with local
   `dist`, so running it from the failed/newer checkout would produce a false
   mismatch. Keep the incident checkout and logs untouched; create a detached
   worktree, rebuild with the production browser configuration, and run every
   smoke from that exact target. `VITE_SUPABASE_ANON_KEY` must come from the
   existing browser deployment secret and must never be printed:

   ```powershell
   $ErrorActionPreference = 'Stop'
   $rollbackCommit = '<recorded 40-character rollback commit>'
   if ($rollbackCommit -notmatch '^[0-9a-f]{40}$') { throw 'Invalid rollback commit.' }
   if (-not $env:VITE_SUPABASE_ANON_KEY) { throw 'Production browser key is required.' }
   $env:VITE_SUPABASE_URL = 'https://cbtroatixvydpwoviezf.supabase.co'
   git fetch origin --prune
   if ($LASTEXITCODE -ne 0) { throw 'Failed to fetch the rollback commit.' }
   git rev-parse --verify "${rollbackCommit}^{commit}"
   if ($LASTEXITCODE -ne 0) { throw 'Rollback commit is not available locally.' }
   $rollbackWorktree = Join-Path $env:TEMP "hks-course-explorer-rollback-$($rollbackCommit.Substring(0, 12))"
   if (Test-Path -LiteralPath $rollbackWorktree) { throw "Rollback worktree path already exists: $rollbackWorktree" }
   git worktree add --detach $rollbackWorktree $rollbackCommit
   if ($LASTEXITCODE -ne 0) { throw 'Failed to create the isolated rollback worktree.' }
   $verificationSucceeded = $false
   $insideRollbackWorktree = $false
   try {
       Push-Location $rollbackWorktree
       $insideRollbackWorktree = $true
       npm ci --legacy-peer-deps
       if ($LASTEXITCODE -ne 0) { throw 'Rollback dependency install failed.' }
       npm run build
       if ($LASTEXITCODE -ne 0) { throw 'Rollback build failed.' }
       npx playwright install chromium
       if ($LASTEXITCODE -ne 0) { throw 'Rollback browser install failed.' }
       $env:DEPLOY_SMOKE_URL = 'https://hks-course-explorer.pages.dev/'
       node scripts/smoke_deployed_site.mjs
       if ($LASTEXITCODE -ne 0) { throw 'Pages-domain rollback smoke failed.' }
       $env:DEPLOY_SMOKE_URL = 'https://hks-course-explorer.org/'
       node scripts/smoke_deployed_site.mjs
       if ($LASTEXITCODE -ne 0) { throw 'Custom-domain rollback smoke failed.' }
       $env:DEPLOY_MIN_HKS_OFFERINGS = '285'
       npm run test:e2e:production
       if ($LASTEXITCODE -ne 0) { throw 'Rollback production browser suite failed.' }
       $verificationSucceeded = $true
   }
   finally {
       if ($insideRollbackWorktree) { Pop-Location }
       if ($verificationSucceeded) {
           git worktree remove $rollbackWorktree
           if ($LASTEXITCODE -ne 0) { throw 'Rollback worktree cleanup failed.' }
       }
       else {
           Write-Warning "Rollback verification failed; evidence retained at $rollbackWorktree"
       }
   }
   ```

   If verification fails, preserve the detached worktree until its output is
   attached to the incident, then remove it explicitly. Do not switch or reset
   the original incident checkout.
5. Confirm the custom domain serves the recorded rollback deployment and retain
   the smoke output with the incident. Re-enable promotion only after the
   regression is fixed and the normal exact-commit release path passes again.

A Pages rollback changes application/Function code only. It does **not** roll
back Supabase data, migrations, KV contents, secrets, or Durable Object state.
Do not perform a database restore unless its separately approved recovery plan
requires it. If the failed release changed the `ChatRateLimiter` Worker, review
binding/state compatibility before any response. This repository does not yet
have an exercised Worker rollback procedure, so Worker rollback is not a
routine operator action: keep the affected path failed closed and escalate to
the platform owner rather than improvising a version or Durable Object change.
Never assume the Pages rollback reverted that Worker.

If port 4173 is intentionally occupied by another local preview, run the
same isolated built-artifact suite on a different port, for example:

```powershell
$env:PLAYWRIGHT_PORT=4174; npm run test:e2e
```

## Admin source imports

Admin uploads stage governed source records; they do not publish course-card
data directly. Follow [Admin import operations](ADMIN_IMPORT_OPERATIONS.md)
for the workbook contract, review/publish boundary, failure handling, and
required staging proof.

## Accessibility baseline

The built-artifact suite verifies keyboard skip navigation and runs the full
Axe WCAG A/AA serious/critical gate for Home and Schedule Builder. Contrast and
scrollable-region keyboard access are included; no Axe rule is disabled. This
is a deterministic regression gate, not a substitute for production manual
assistive-technology acceptance.

The first-visit landing screen is a labelled modal portal. While it is open,
the application root is inert and hidden from assistive technology, focus is
contained within the Direct/Tutorial choice, and body scrolling is paused. Do
not replace the dialog semantics with a second page `<main>` element.

## Response security headers

`public/_headers` protects Cloudflare Pages static responses, while
`functions/_shared/cors.js` applies the matching baseline to Function
responses. The policy includes `nosniff`, a strict referrer policy, disabled
unused browser permissions, same-origin framing, and HTTPS transport
enforcement. `scripts/tests/security_headers.test.js` prevents static and
Function headers from drifting apart.

Content Security Policy is intentionally not enabled by this baseline. It must
be introduced only after an owner inventories and tests every current browser
integration (including observability and analytics endpoints), because an
untested CSP can break a working release.

## Bundle budgets

`npm run check:bundle-budget` reads Vite's generated
`dist/.vite/manifest.json` (kept separate from the public PWA
`/manifest.json`). It
measures the HTML shell plus the lazy Home chunk and all of their static
dependencies: the code required to render `/`. That graph must remain at or
below **1,050,000 raw bytes** and **310,000 gzip bytes**. It intentionally does
not include Home's dynamic imports; the guard verifies the Plotly chunk remains
outside this root-route graph because the similarity map is loaded on demand.

The same command also protects direct navigation to `/courses` and
`/schedule-builder`: each must remain a Vite dynamic route imported lazily by
the app shell, and each route graph is checked against documented raw/gzip
limits. Treat a budget failure as a release-blocking regression. Do not loosen
a limit without a measured performance review and an approved documented
rationale.

## Production performance evidence

After a visitor enters the application, `src/lib/performanceTelemetry.js`
dynamically loads Google's standard `web-vitals` build and sends bounded
`app_web_vital` events through the existing PostHog adapter. The standard build
contains no DOM attribution. Custom properties are limited to `metric`,
`value`, `rating`, `navigation_type`, and a query-free navigation `route`; do
not add DOM nodes, catalogue records, or user-entered values. The analytics
adapter's final `before_send` boundary removes query strings and fragments from
PostHog-added URL/referrer properties for every event. Analytics failure must
remain a no-op for the application.

PostHog's built-in Web Vitals collector is explicitly disabled even if its
remote project setting changes, preventing duplicate metrics. The custom
collector loads after two paints and an idle boundary, binds metrics to the
document's navigation route rather than a later SPA route, and sends at most 12
measurements per document including back/forward-cache re-reports.
Each measurement uses PostHog's immediate `sendBeacon` transport so final
values emitted while a page is hidden or unloading are not left in the normal
in-memory batch queue. The analytics adapter must preserve capture options for
both already-initialized and temporarily queued events.

Review a rolling 28-day window with this HogQL query:

```sql
SELECT
  properties.$device_type AS device_type,
  properties.metric AS metric,
  count() AS samples,
  quantile(0.75)(toFloat(properties.value)) AS p75,
  quantile(0.9)(toFloat(properties.value)) AS p90
FROM events
WHERE event = 'app_web_vital'
  AND timestamp >= now() - INTERVAL 28 DAY
  AND properties.metric IN ('LCP', 'INP', 'CLS')
GROUP BY device_type, metric
ORDER BY device_type, metric
```

Use Google's Core Web Vitals p75 "good" thresholds as release budgets: LCP at
or below 2,500 ms, INP at or below 200 ms, and CLS at or below 0.1. The mobile
rows are an independent release gate; an all-device or desktop result cannot
substitute for them. Do not call mobile field performance representative until
the `Mobile` segment has at least 75 LCP samples, 75 CLS samples, and 30 INP
interaction samples, and the 28-day window includes normal student usage rather
than only operator smoke tests. Record every device-segment row and the time
window in the release evidence. An empty, operator-only, or desktop-dominated
result is not passing mobile performance evidence.

## Live-course sync

Two scheduled GitHub Actions share one concurrency group:

- `scripts/sync_myharvard_hks.py` stages, validates, and atomically promotes
  the complete student-facing HKS catalogue.
- `scripts/sync_live_courses.py` upserts non-HKS Harvard ATS offerings only.

Do not add HKS to `GENERAL_SYNC_SCHOOLS`. Source ownership is intentionally
disjoint so the broader ATS job cannot make HKS rows appear, disappear, or
duplicate between runs. Because `catalogSchool` is a search facet rather than
proof of ownership, the job also excludes every ATS `courseID` present in the
active my.harvard HKS `source_course_id` set; the database function repeats
that check inside the serialized write transaction.

Scheduled and manually dispatched runs share one production concurrency group.
GitHub will not run them simultaneously, so a recovery attempt cannot race the
scheduled run's atomic promotion. Do not cancel an in-progress sync solely to
start another one; wait for its summary and start the follow-up only if needed.

The non-HKS sync will upsert data only when every planned Harvard request
succeeds and the configured minimum unique-course count is reached. Production
uses a 5,000-row floor against the 5,607 non-HKS rows promoted by exact-master
run `29189143811`, after the authoritative HKS ownership filter. The 89.2% floor
preserves a bounded fluctuation margin while rejecting a material partial
catalogue before any write. It never deletes
`live_courses` rows: `SYNC_ALLOW_STALE_DELETE=true` is rejected before any
Harvard or database activity. A successful API response alone does not prove
the upstream search returned a complete catalogue, so deletion requires a
separate, reviewed reconciliation with a tested backup and restore path.

- Any failed Harvard source request causes a non-zero exit before database writes.
- After a successful atomic upsert, the job reads every `live_courses` ID and
  reports only aggregate counts: database rows, retained rows absent from the
  current source, and source rows missing from the database, plus retained
  school/term coverage. It never emits a deletion list or course content.
- An inventory-read failure is a non-zero post-promotion incident: the upsert
  has succeeded, but no cleanup has been attempted and the run is not
  reconciliation-ready.
- The script default `SYNC_MIN_UNIQUE_COURSES=1` is only for unconfigured local
  runs. Production must retain its reviewed 5,000 floor. Do not infer deletion
  authorization from an HTTP success or the inventory.
- Keep the last verified catalogue/data version available for rollback.
- Treat a partial run as an incident, not as an empty current catalogue.
- Each scheduled run writes a compact GitHub Actions summary with its outcome,
  source-request count, unique offering count, and school/term coverage. It
  intentionally contains no course content, API key, or database credential.
  Retain that summary with the release/incident record; it is operational
  evidence, not a replacement for a database backup or rollback exercise.

### Remaining production evidence

`live_courses` is promoted through the service-only
`sync_live_courses_atomically(jsonb)` Postgres RPC. A rejected payload or
database error therefore leaves the prior live catalogue intact. This does not
by itself prove production recovery: a database owner must still provide and
test backup/restore, and the future versioned catalogue path must prove a
staged rollback before G02 can be marked complete.

### Manual live-course backup

Before any separately approved reconciliation, RLS migration, or recovery
exercise, run **Backup live courses** from the GitHub Actions tab with
`confirm_backup` checked. It reads `live_courses` using the existing
service-only repository secrets and creates an encrypted GitHub Actions
artifact for seven days. It never writes to Supabase and does not change the
deployed site.

Create a strong, unique `BACKUP_ARTIFACT_PASSPHRASE` repository secret before
the first run. The workflow refuses to upload a plaintext backup if that
secret is absent. This is necessary because people with read access to a
repository can download its GitHub Actions artifacts; do not reuse a database
or application secret as the passphrase.

The artifact includes the complete row payload, row count, timestamp, and a
SHA-256 digest of the canonical row payload. Record the run URL, row count,
and digest in the change record. To inspect it, download the artifact and use
the stored passphrase with `openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000`.
The artifact is rollback evidence only: do not restore it automatically. A
database owner must review and test any restore procedure before a destructive
reconciliation is considered.

### Non-production restore verification

Use **Verify live-course backup restore** with the successful backup workflow
run ID and explicit confirmation. The workflow downloads that run's encrypted
artifact, decrypts it only on the ephemeral GitHub-hosted runner, validates the
manifest, and
restores every row into a schema-compatible `live_courses` scratch table on an
ephemeral PostgreSQL 17 service. The probe validates the production project
identity, a reviewed row-count floor, the complete column set, PostgreSQL column
types, required `id`/`source`/`active` constraints, and unique identities. It
then exports the scratch rows in original order and requires exact semantic row
equality before dropping the scratch tables and deleting decrypted runner files.

This is a no-cost, non-production restore proof: the workflow has no Supabase
URL or key and cannot write to staging or production. It proves that the
retained encrypted artifact is decryptable and structurally restorable. It
does not recreate foreign keys, indexes, RLS policies, or the related catalogue
run rows, and it does not authorize a production restore. A real incident still
requires owner approval, a migration-created target, restoration of related
tables, and post-restore application smoke tests.

### Multi-table Course Explorer recovery verification

The single-table probe above remains useful for older `live_courses` artifacts,
but it is not the current application-recovery boundary. Use **Backup Course
Explorer recovery package** followed by **Verify Course Explorer recovery
package** for the allowlist-only five-table package, clean PostgreSQL 17 schema
replay, exact row/digest round trip, FK/index/RLS/policy/grant/function/trigger
assertions, and shared-project sentinel check.

The complete scope, controls, exclusions, and residual limits are maintained in
[`docs/COURSE_EXPLORER_RECOVERY.md`](COURSE_EXPLORER_RECOVERY.md). Neither
workflow can restore production, and neither is permission to expand into
unrelated objects in the shared Supabase project.

Both secret-bearing workflows are master-only. The backup package records the
exact backup commit and a digest of the complete ordered recovery contract.
Verification refuses a package from a different commit or a changed recovery
contract, proves FK rejection/transaction rollback before loading data, and
byte-compares the generated schema/access contract before accepting restored
row digests. It then clones the verified database, exercises the active
my.harvard catalogue rollback in that disposable clone, validates the retained
manifest and protected data digests, and re-verifies the untouched source
database against the encrypted package. No step has a production database
credential or production write path.

### Schedule-plan persistence

Schedule plans are intentionally browser-local. `savePlan` persists the plan in
`localStorage` and emits the `hks-plan-updated` event used by the rest of the
application; it does not write a browser-generated identifier to Supabase.
This preserves the supported local planning workflow without creating a remote
record that cannot be protected by authenticated ownership. Existing production
`schedules` records and their RLS policy require a separately authorized
cleanup/migration exercise before any platform certification.

## Admin data operations

The Admin UI uses same-origin Functions, not direct browser Supabase writes.
Required Cloudflare secrets are `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`,
`SUPABASE_URL`, and `SUPABASE_SERVICE_ROLE_KEY`. Configure them only as Pages
Function secrets/bindings, verify they do not begin with `VITE_`, and rotate the
session secret to immediately invalidate all Admin sessions.

Before production promotion, run an authorized staging exercise that proves:

1. An unauthenticated browser cannot read Admin history or mutate an allowed
   table.
2. An Admin session expires after 15 minutes and is invalid after session-secret
   rotation.
3. Every allowed import target accepts its expected schema; an unknown table or
   column is rejected with no database write.
4. The `uploads` history projection contains the documented six display fields
   and no additional sensitive data.
5. Function logs retain status/target diagnostics without passwords, sessions,
   row values, or service-role credentials.

Do not promote based on local contract tests alone: table schema, RLS/public
grants, backup/restore, Function secrets, and Cloudflare log retention require
platform-owner evidence.

## Incident response

Accountability, severity definitions, private/public intake, zero-cost limits,
and the successor-team acceptance process are defined in
[`OWNERSHIP.md`](OWNERSHIP.md).

1. Stop promotion and preserve the failing release/data-sync logs.
2. Classify the incident: browser UI, Pages Function, Harvard API, Supabase,
   sync job, or third-party provider.
3. Roll back the Pages deployment and, if applicable, restore the last-known-good
   live catalogue only after approved backup/restore verification.
4. Create a regression test before re-promoting.
5. Record impact, root cause, owner, and follow-up in an ADR or incident record.

## Release approval

A release is blocked while any P0 item in `GOAL_STATUS.md` is `0`. Required
evidence includes an exact-commit CI run, preview smoke checks, data freshness,
rollback target, and post-deploy monitoring. Production secrets, database
migrations, and provider accounts require the responsible platform owner.
