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
| `HARVARD_API_KEY` | Yes | Harvard ATS API key used by the sync script. |
| `SYNC_MIN_UNIQUE_COURSES` | No | Minimum deduplicated results required before the sync writes. Default: `1`; set an environment-specific guardrail only after establishing a trustworthy baseline. |
| `SYNC_ALLOW_STALE_DELETE` | No | Enables destructive deletion of rows not refreshed by a successful sync. Default: `false`; enable only with verified complete upstream coverage and a tested `live_courses.synced_at` trigger. |

The sync job fails closed if any required source request fails or the minimum
course guard is not met. It requests Harvard's documented 1,000-record pages
and follows only provider-issued HTTPS scroll links; an invalid, repeated, or
failed page aborts the whole run. It passes the complete validated payload to the
server-only `sync_live_courses_atomically(jsonb)` RPC, which validates IDs and
upserts in one Postgres transaction. It must run with a service account
restricted to the minimum required database privileges. The default schedule
does not delete historical rows, because a 200 response alone does not prove
an upstream search was complete.

## Cloudflare Pages Functions

| Name/binding | Required by | Purpose |
|---|---|---|
| `HARVARD_API_KEY` | `/api/harvard-courses` | Server-side Harvard API proxy. |
| `HKS_KV` binding | Auth and `/api/courses` | One-time passwords and protected catalogue payloads. |
| `JWT_SECRET` | Auth and protected catalogue | HMAC signing/verification. Rotate on a defined schedule. |
| `RESEND_API_KEY` | Auth request | Preferred one-time-password delivery provider. |
| `BREVO_API_KEY` | Auth request | Legacy one-time-password delivery fallback. |
| `AUTH_FROM_EMAIL` | Auth request | Optional verified sender address; defaults to the current HKS Course Explorer sender. |
| `OPENROUTER_API_KEY` | Chat endpoint | Course-advisor provider access. |
| `ADMIN_PASSWORD` | `/api/admin-verify` | Verifies the Admin UI password. Never expose it to the browser. |
| `ADMIN_SESSION_SECRET` | Admin endpoints | Distinct, randomly generated HMAC secret (at least 32 characters) for 15-minute admin data sessions. Rotate it to invalidate all outstanding Admin sessions. |
| `SUPABASE_URL` | Admin upload/history | Server-only Supabase REST endpoint used by Pages Functions. It must not use the `VITE_` prefix. |
| `SUPABASE_SERVICE_ROLE_KEY` | Admin upload/history | Server-only service-role/secret key. It is never bundled or returned by Pages Functions. |

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
