# Configuration contract

This document is the single source of truth for configuration ownership. Store
secret values in GitHub Actions or Cloudflare Pages secrets, never in the
repository, browser bundle, issue tracker, or logs.

## Browser build variables

| Name | Required | Owner | Purpose |
|---|---:|---|---|
| `VITE_SUPABASE_URL` | Yes | Platform | Supabase project endpoint used by the browser. |
| `VITE_SUPABASE_ANON_KEY` | Yes | Platform | Public Supabase anon key; access still depends on RLS. |
| `VITE_SENTRY_DSN` | No | Observability | Browser error reporting. |
| `VITE_POSTHOG_KEY` | No | Product analytics | Product events. Must follow the privacy policy. |

Only values prefixed with `VITE_` are included in the client bundle. Never
place service-role keys or provider secrets in this group.

Both browser values are required in every deployed environment. The client has
no project-specific fallback: missing values produce an explicit configuration
error instead of silently reading from a different Supabase project. CI uses
inert, non-secret values and mocks all REST traffic; it never needs production
credentials.

`VITE_SUPABASE_URL` must be an HTTPS `*.supabase.co` project endpoint; malformed
or placeholder domains are treated as unconfigured. Endpoint shape alone does
not prove that it is the intended project, so target deployment values still
require platform-owner verification.

The deployment workflow requires the GitHub variable
`DEPLOY_VITE_SUPABASE_URL` and secret `DEPLOY_VITE_SUPABASE_ANON_KEY` before it
creates the Cloudflare artifact. Configure matching target values in Cloudflare
Pages too if Pages can create builds outside this workflow.

## Sync and administrative scripts

| Name | Required | Purpose |
|---|---:|---|
| `SUPABASE_URL` | Yes | REST/client endpoint for trusted data-sync scripts. |
| `SUPABASE_KEY` | Yes | Supabase service-role/secret key for trusted scripts only. |
| `HARVARD_API_KEY` | Yes | Harvard ATS API key used by the non-HKS sync script. |
| `SYNC_MIN_UNIQUE_COURSES` | No | Minimum deduplicated non-HKS results required before the ATS sync writes. Script default: `1`; production uses `5000` against the reviewed 5,607-row accepted baseline from exact-master run `29189143811`. |
| `SYNC_ALLOW_STALE_DELETE` | No | Retired safety flag. Any `true` value makes the sync fail before Harvard or database activity; this workflow never deletes rows. |
| `MYHARVARD_MIN_HKS_OFFERINGS` | No | Minimum complete HKS offerings required before staging/promotion; production uses `285` against the current 297-row catalogue. |
| `MYHARVARD_PROMOTE` | Yes in production | Must be `true` only in the trusted scheduled HKS promotion; defaults to staging without promotion. |

The ATS job fails closed if any required source request fails or the minimum
course guard is not met. It accepts only the exact non-HKS school set in
`GENERAL_SYNC_SCHOOLS`; before writing, it removes ATS course IDs present in
the active authoritative my.harvard HKS set. The service-only RPC independently
rejects HKS-labelled rows and authoritative HKS course IDs. It requests
conservative 250-record Harvard pages and follows only provider-issued HTTPS
scroll links. It never follows a redirect after attaching the Harvard API key;
an invalid, repeated, redirected, or failed page aborts the whole run.

The complete validated payload is promoted through
`sync_live_courses_atomically(jsonb)`. The RPC validates IDs, terms, the
production count floor, and the exact ID/term manifest. In one Postgres
transaction it deactivates prior ATS visibility, upserts the complete current
manifest as active/run-owned, and preserves every absent row physically with
its last source-observation timestamp. It must run with a service account
restricted to the minimum required database privileges.

After promotion, a service-only paginated read inventories all `live_courses`
rows and both my.harvard and ATS run manifests. The classifier must assign every
row exactly once to the current ATS manifest, protected active HKS snapshot,
single HKS rollback snapshot, protected legacy HKS fallback, or inactive
retained ATS population. It fails on unowned rows, missing/inactive/run-mismatched
current rows, active retained rows, or either source manifest drifting. Output
contains only counts, bounded age/school/term buckets, and a SHA-256 digest.

The retained population has an explicit KEEP/no-delete disposition because
successive complete source runs demonstrably fluctuate. Retirement requires a
separately reviewed source decision, backup, restore proof, and migration. No
per-course Harvard login or three-day lookup process is part of normal
operation.

There is no retained-row HMAC key, per-course Harvard audit, or audit-history
file. Current-versus-retained ownership comes only from each complete ATS
manifest and the atomic database promotion described above.

The separate my.harvard job stages every student-facing HKS offering under a
run ID, verifies the upstream advertised count and configured minimum, then
atomically deactivates the prior HKS set and promotes only the verified run.
Scheduled executions promote after validation. A manual workflow dispatch is
staging-only by default; the operator must explicitly enable its `promote`
input after reviewing the candidate source state.

The my.harvard search has a bounded whole-snapshot retry for transient HTTP,
invalid JSON/schema, below-floor totals, empty parsed pages, and
mid-pagination count drift. Every retry discards all accumulated rows and
starts again at page one. Redirects or a changed response URL—including its
school, term, sort, page, and browse query—are refused. Exhausting the retry
budget raises before detail enrichment, database inventory reads, staging, or
promotion, so a transient empty/invalid search cannot replace the active
catalogue or mix pages from separate attempts.

Meeting data is read only from each offering's exact public my.harvard detail
URL. Redirects and one URL claimed by distinct offering identities are refused,
so a course-level response is never copied across section URLs. An empty detail
schedule is valid only when the corresponding source card explicitly says TBA;
that schedule-pending offering remains active/selectable. A partial meeting
pattern, an unparseable interval, more than one distinct interval, or loss of a
previously published schedule for the same active offering fails before
staging because the current flat `live_courses` meeting columns cannot
represent those states safely.

## Cloudflare Pages Functions

| Name/binding | Required by | Purpose |
|---|---|---|
| `HARVARD_API_KEY` | Legacy `/api/harvard-courses` endpoint | Retained temporarily for a separately reviewed retirement; the deployed browser must not call it. Daily GitHub Actions sync is the only supported Harvard API consumer. |
| `CHAT_RATE_LIMITER` Durable Object binding | Chat and `/api/admin-verify` | Per-client chat cooldown and failed-admin-attempt coordination. The binding must target the deployed `ChatRateLimiter` class. Every consumer fails closed when it is absent; the chat endpoint never substitutes a non-LLM answer. |
| `OPENROUTER_API_KEY` | Chat endpoint | Required for the Course Advisor. The endpoint calls only `openrouter/free` with an independent zero-price provider cap, validates the selected `:free` model and returned cost `0`, and returns a typed unavailable response instead of fabricated advice when the model service fails. Configure the OpenRouter key with a zero-dollar credit limit and no automatic credit purchase. |
| `ADMIN_PASSWORD` | `/api/admin-verify` | Verifies the Admin UI password. Never expose it to the browser. |
| `ADMIN_SESSION_SECRET` | Admin endpoints | Distinct, randomly generated HMAC secret (at least 32 characters) for 15-minute admin data sessions. Rotate it to invalidate all outstanding Admin sessions. |
| `SUPABASE_URL` | Admin upload/history | Server-only Supabase REST endpoint used by Pages Functions. It must not use the `VITE_` prefix. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin upload/history | Server-only service-role/secret key. It is never bundled or returned by Pages Functions. |
| `CATALOGUE_API_ENABLED` | `/api/catalogue` | Explicit `true` switch for the private, promoted `catalogue_current_v1` read contract. Keep `false` until the parity and rollback gates in `UNIFIED_CATALOGUE_ROLLOUT.md` have passed. |

Cloudflare stores Production and Preview Pages bindings separately. The Course
Advisor is optional and is not a core release gate: when Preview or Production
does not provide `OPENROUTER_API_KEY`, acceptance requires the typed
`AI_NOT_CONFIGURED` response and rejects any fabricated fallback. When it is
configured, the named-instructor diagnostic still proves the selected model is
free and the answer is grounded. The `CHAT_RATE_LIMITER` binding remains
required for Admin brute-force protection and for any enabled chat traffic.

The visitor application intentionally has no login, OTP delivery, visitor JWT,
or protected-KV catalogue endpoint. Do not configure `JWT_SECRET`,
`RESEND_API_KEY`, `BREVO_API_KEY`, `AUTH_FROM_EMAIL`, or `HKS_KV` for this
application. The hidden Admin session is a separate boundary and uses only
`ADMIN_PASSWORD` plus `ADMIN_SESSION_SECRET`.

The deploy token needs only the account-scoped Pages and Workers permissions
used by the release workflow. It must not receive Zone Settings Write, use a
global API key, or mutate `browser_cache_ttl`. The release smoke enforces the
effective response policy instead: exact HTML and mutable JSON revalidate on
every use, while only manifest-listed fingerprinted CSS/JavaScript may use a
bounded browser TTL of at most four hours. This keeps deployment behavior
verifiable on the free Pages path without a paid cache feature or hidden zone
state dependency.

### Admin data Functions

`/api/admin-verify` returns a 15-minute HMAC-signed `admin:data` bearer
session after validating `ADMIN_PASSWORD`. The browser holds it in React memory
only and sends it in the `X-Admin-Session` header to `/api/admin-upload` and
`/api/admin-history`; a page reload requires a new sign-in. These Functions
reject unauthenticated requests before parsing their bodies, apply fixed row,
payload, table, column, and scalar-value limits, and call Supabase only with
the server-side service-role binding.

The Functions intentionally do not create schema or change RLS. Before
promotion, the platform owner must apply the reviewed forward migration and
verify that the resulting `bidding`, `qguide`, `requirements_tags`,
`stem_designations`, and `uploads` contracts match the endpoint allowlists,
that the service-role key is scoped and rotated under the organization policy,
and that no browser role retains Admin write access.

## Promotion checklist

1. Validate every required value in a disposable preview environment.
2. Clone the target schema into a disposable Supabase project, apply
   `supabase/migrations/20260710003218_corporate_admin_import.sql`, and verify
   catalogue reads plus trusted ingestion contracts. It is not a complete
   empty-project baseline.
3. Confirm browser variables are correct for the target Supabase project and
   that RLS allows only intended anonymous operations.
4. Set Functions secrets/bindings in Cloudflare; do not rely on local `.env`
   files at runtime.
5. Run the synthetic catalogue, auth-denial, and data-freshness checks.
6. Record the release ID, data-sync version, and rollback target.

Missing values must fail closed and return an observable operator-safe error.
