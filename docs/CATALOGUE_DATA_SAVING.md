# Public catalogue delivery and rollback

The snapshot mode changes delivery only. Supabase remains the authoritative
store. No database grants, rows, schemas, or write endpoints are changed.

## Delivery contract

- `VITE_CATALOGUE_DATA_URL` enables the snapshot reader at build time. An empty
  value selects the original Supabase reader. Production uses the GitHub
  repository variable `DEPLOY_VITE_CATALOGUE_DATA_URL` to supply it.
- `history` is the exact anonymous historical field contract, including IDs,
  descriptions, evaluation values, bidding values, and nulls.
- `live/<term>` preserves the active-only filter and term/ID ordering.
- `credits` preserves the existing non-null filter and descending term/ID order,
  including ambiguous credit values for the existing resolver to handle.
- `terms` contains the active HKS offering inventory. `sections/<term>` preserves
  the existing section fields and ordering, including the no-space term format.
- The client verifies SHA-256, byte length, row count, and unique IDs. A valid
  manifest can represent an absent scheduling term as empty. Missing required
  datasets or malformed files cannot masquerade as a successful empty catalogue.
- Repeated reads share an in-flight request and reuse unchanged data. Callers
  receive separate objects so existing metric enrichment cannot corrupt caches.

## Refresh and failure behavior

The `Publish public catalogue snapshots` workflow runs daily at 08:30 UTC,
serialized with both upstream ingestion workflows. It validates the active HKS
source, exports through the anonymous key, and verifies every published candidate
file against the exact local manifest before promoting that same directory.
Run Wrangler from the exported directory so the app's Pages Functions are not
bundled into the static data project.

Cloudflare can briefly return the previous manifest after publishing. Verification
allows up to seven manifest reads with five seconds between mismatches, and still
requires the exact expected manifest before checking every file. This readiness
wait reads only Cloudflare; it never repeats the Supabase export.

The daily reader has a 32 MiB source-byte budget and a 20,000-row ceiling per
collection. It does not retry failed database requests automatically. A failure
before promotion leaves the previous production snapshot in place. GitHub marks
the run failed; do not treat a failed publish as a fresh catalogue.

The initial measured export was 18,065,814 uncompressed source bytes, approximately
0.56 GB for 31 daily runs. This is the catalogue publisher only. Other scripts,
backups, admin activity, old app versions, and direct anonymous API callers can
still consume Supabase egress. Do not claim a guaranteed organization-wide limit
based on the publisher budget alone. Manual exports consume the same quota and
should be used only for a needed refresh or recovery.

The browser revalidates the manifest every five minutes when data is requested.
Immutable dataset files use normal HTTP caching. On an outage, it uses a prior
verified in-memory or IndexedDB copy, then the verified snapshot bundled with the
app release. It never automatically falls back to Supabase in snapshot mode.
A visible notice identifies fallback data or an export older than 48 hours.
Saved plans, notes, favorites, and completed courses retain their existing storage.

## Release gates

1. Run the normal CI gates plus the snapshot transport and export safety tests.
2. Deploy the static data candidate, verify each file and exact manifest, and
   promote the data project before enabling app snapshot mode.
3. Bundle the verified snapshot in `public/catalogue-fallback` before building.
   This directory is generated and ignored by Git.
4. Deploy the app candidate. Run production acceptance with
   `REQUIRE_CATALOGUE_SNAPSHOTS=true`. This blocks and fails on any browser
   Supabase request, while checking every visitor route and all advertised HKS
   offerings. The outage test blocks the data host and verifies planning and
   saved favorites still work using the bundled copy.
5. Promote only after acceptance passes. Keep the prior app deployment.

## Revert

The pre-change production application deployment is
`87444673-d407-4ba8-b0af-8aa9f40ab94f`, from commit `dc066d5`.
Use Cloudflare Pages' rollback action for this deployment for immediate recovery.
This restores the original app and its Supabase reads without altering the
database or users' saved plans.

For a subsequent release on the legacy reader, clear
`DEPLOY_VITE_CATALOGUE_DATA_URL` and let the normal CI/deploy workflow build and
publish the approved commit. The publisher can stay running harmlessly or its
workflow can be disabled. Reverting delivery brings back the previous egress
profile, so it is a recovery measure rather than a quota fix.

To revert data without reverting the app, roll back the `hks-course-explorer-data`
Pages project to its last verified production deployment. Do not delete old
deployments during the rollout or recovery window.
