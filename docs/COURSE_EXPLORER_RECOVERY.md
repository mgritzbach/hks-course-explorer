# Course Explorer recovery boundary

This runbook defines the no-cost, allowlist-only logical recovery proof for the
Course Explorer objects that exist in the current production Supabase project.
It is not a whole-Supabase backup and it does not authorize a production
restore.

## Current production scope

The encrypted package contains exactly these tables:

| Object | Purpose | Recovery treatment |
|---|---|---|
| `public.courses` | Historical catalogue, evaluations, bidding history | Exact rows plus schema, indexes, public-read RLS, and SELECT-only browser grants. |
| `public.course_sections` | Section and meeting enrichment | Exact rows plus schema, indexes, public-read RLS, and SELECT-only browser grants. |
| `public.live_catalogue_runs` | Parent run and HKS manifest state | Exact rows, manifest constraints, one-active-run index, restricted anon column grant, and service-only writes. |
| `public.live_courses` | Current and retained HKS/non-HKS offerings | Exact rows, FK to run state, operational indexes, active-only RLS, triggers, and service-only sync RPCs. |
| `public.schedules` | Retained legacy plans; browser persistence is now local-only | Exact encrypted rows, indexes, RLS enabled, and no browser policy or privilege. |

The checked-in baseline is derived from the read-only production schema
inventory and is completed by the same forward migrations used in production.
The restore verifies the latest definitions of:

- `sync_live_courses_atomically(jsonb)`;
- `stage_myharvard_hks_offerings(uuid,jsonb)`;
- `promote_myharvard_hks_run(uuid)`;
- `rollback_myharvard_hks_run(uuid)`;
- the HKS/ATS isolation and sync-timestamp triggers; and
- the `pgcrypto` dependency in the `extensions` schema.

Every other object in the shared Supabase project is excluded by default. In
particular, the package does not read or restore `orders`, `availability`,
`profiles`, `vouchers`, Supabase Auth/Storage/Realtime objects, or unknown
public objects. The gated future catalogue snapshot and optional Admin import
objects are also excluded because they are not installed in the current
production schema; their forward migrations remain versioned separately.

## Backup controls

Run **Backup Course Explorer recovery package** manually with confirmation.
The workflow:

1. shares the production catalogue-sync concurrency lock, so scheduled HKS and
   non-HKS promotions cannot overlap the capture;
2. accepts only the exact production HTTPS project ref and rejects redirects;
3. performs GET-only, exact-count pagination for the five allowlisted tables;
4. captures the entire allowlist twice and aborts unless both captures are
   identical;
5. refuses non-`master` dispatches before any secret is injected and binds the
   package to the full 40-character backup commit;
6. validates exact columns, nonblank/unique identities, table bounds (including
   a 250-row retained-section floor), and deterministic per-table/package
   digests;
7. binds the package to a digest of the baseline, ordered migrations, restore
   SQL, semantic verifier, exact schema contract, and row exporter;
8. encrypts with AES-256-CBC/PBKDF2 and authenticates the ciphertext with
   HMAC-SHA-256 before upload; and
9. uploads only ciphertext plus its authentication tag for seven days, then
   removes every runner copy under `if: always()`.

The current service-role repository secret is broader than a dedicated backup
reader. Risk is contained by the exact host/table/method allowlist, disabled
redirects, double capture, and concurrency lock. A future dedicated SELECT-only
server credential would further reduce this residual risk without changing the
artifact format.

## Restore verification

Run **Verify Course Explorer recovery package** with the successful backup run
ID and explicit confirmation. The workflow first verifies that the referenced
run was a successful manual master run of the expected backup workflow. The
verification workflow itself also refuses non-`master` dispatches before its
passphrase is exposed. It then:

1. authenticates ciphertext before decryption;
2. rejects project, source commit, complete recovery-contract, schema, format,
   field, table, count, identity, and digest drift before opening PostgreSQL;
3. starts a pinned PostgreSQL 17 service with no Supabase target credentials;
4. creates an unrelated sentinel object, replays the allowlist baseline and
   reviewed migrations, and proves the sentinel remains unchanged;
5. first proves an orphaned child is rejected and that an earlier row in the
   same transaction rolls back, then restores parent tables before children in
   one transaction while suppressing only user triggers; FK triggers remain
   active throughout the real restore;
6. byte-compares a complete deterministic schema contract covering every
   ordered column/type/nullability/default, index definition, constraint,
   policy, effective table/column/function/schema privilege, function body,
   trigger, RLS flag, and extension location;
7. independently validates the FK with a zero-orphan anti-join, constraints,
   one-active-HKS manifest, browser/service privileges, RPC execution context,
   and triggers;
8. proves a representative current-offering → historical-course → section-time
   link without inventing a database FK; and
9. re-exports every table by primary key and requires exact semantic rows and
   per-table digests;
10. clones the restored database into a disposable PostgreSQL database and
    exercises `rollback_myharvard_hks_run(uuid)` only there. The exercise fails
    closed unless exactly one active manifest and one retained superseded
    snapshot exist, restores the predecessor by its persisted count, identity
    digest, and term manifest, rejects invalid repeated rollback attempts,
    preserves unrelated tables and catalogue rows, and leaves no orphaned run
    references; and
11. re-exports the untouched source recovery database and requires the original
    package digests a second time before dropping the clone and deleting all
    plaintext files.

The workflow is free and non-production. It has no `SUPABASE_URL`, API key,
Cloudflare credential, or production write path.

The reviewed migration chain also revokes PostgreSQL `MAINTAIN` from browser
roles, preserves it for `service_role`, and removes direct browser execution
of trigger-only functions. These grants are unnecessary for catalogue reading
and are asserted both semantically and in the exact ACL/grant-option contract.

## What this evidence does not prove

- Seven-day artifacts are a short recovery-point window, not durable archival
  retention.
- The package does not recover Supabase platform configuration, Auth, Storage,
  Cloudflare KV, bindings, secrets, DNS, or Pages deployments.
- The optional Admin/future-catalogue planes need their own clean baseline and
  recovery exercise before those feature flags may be enabled.
- A production restore remains a separately reviewed incident action. Never
  overwrite a nonempty production table from this workflow.
- The catalogue rollback proof runs against a production-derived clone. It
  proves the reviewed rollback function against retained production data but
  deliberately does not mutate the live Supabase project.

Record the exact repository commit, backup and verification run IDs, table
counts/digests, package digest, PostgreSQL image digest, and the statement
“production untouched; no production restore authorized” in the release
evidence document after each exercise.
