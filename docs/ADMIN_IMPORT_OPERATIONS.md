# Admin import operations

## Purpose and current boundary

The Admin page is a controlled **staging** interface for four source datasets:
`bidding`, `qguide`, `requirements_tags`, and `stem_designations`. It accepts
one bounded Excel workbook, normalizes its headings to the documented
snake-case contract, validates row types, and records an audit row in `uploads`
inside the same database transaction.

An accepted upload does **not** update the course cards immediately. The
customer-facing catalogue is produced only from
`data/canonical_courses_enriched.csv` through `scripts/build_data.py`, then
promoted with `scripts/load_to_supabase.py`. This distinction is deliberate:
an unreviewed workbook must not silently alter the published catalogue.

## Operator workflow

1. Prepare one workbook per target with the required columns shown in the UI.
   Human headings such as `Course Code` and `Bid Clearing Price` are accepted
   and normalized. Do not include two headings that normalize to the same
   value.
2. Sign in to Admin, inspect the normalized preview, and confirm the row count
   and target. The UI disables upload when a required column is absent.
3. Confirm upload. Verify the target, filename, row count, status, and time in
   the recent-upload history.
4. Review staged rows against the canonical CSV. Reconcile course identifiers,
   term/year conventions, and data quality before any publish request.
5. Update the reviewed canonical source, run `python scripts/build_data.py`,
   inspect the generated data/validation warnings, and run the full local
   quality gate from `docs/OPERATIONS.md`.
6. Promote only through a future controlled catalogue-promotion mechanism and
   the approved staging/production change process. Record the release
   identifier and rollback target.

`scripts/load_to_supabase.py` currently upserts in 200-row batches. It
preflights source shape and IDs before opening a client, but it is **not** a
transactional publish mechanism: a later batch failure can leave earlier
batches committed. Do not call that script a safe production promotion until a
versioned, transactional/staged publish and restore checkpoint are available.
The generated catalogue must have unique IDs. The loader fails closed before it
creates a database client if its preflight detects a duplicate, so a source-data
ambiguity can never silently become last-write-wins during a promotion.

## Failure handling

- A malformed workbook, unknown field, invalid number/boolean, duplicate
  natural key, expired admin session, or unavailable service fails closed; no
  partial Admin import is acknowledged.
- Re-uploading the same supported natural key is idempotent: it updates the
  staged source record and writes one audit entry for that operation.
- If the database transaction cannot write its audit row, the target mutation
  rolls back as well. This must be proven on a staging clone before production
  enablement.
- Do not delete or overwrite canonical-source data to “fix” a failed upload.
  Correct the workbook, review it again, and retain the upload-history record.

## Required platform evidence before enablement

The platform owner must apply
`supabase/migrations/20260710003218_corporate_admin_import.sql` to a staging
clone and prove role/RLS denial, repeated-import merge behavior, audit rollback,
and history retrieval before approving production use. This document does not
authorize a database change.
