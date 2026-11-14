# Daily catalogue reliability

## November 2026 recovery

Two separate incidents must not be conflated:

- GitHub disabled the scheduled workflows after repository inactivity. Successful
  daily Actions runs do not themselves prevent the inactivity policy.
- The non-HKS ingestion completed its atomic write but the subsequent read-only
  reconciliation hit a 10,000-row inventory ceiling. The inventory includes
  retained my.harvard rollback snapshots, not only today's offerings. With 319
  HKS offerings per daily snapshot, that old ceiling is unsuitable for routine
  unattended operation. Do not delete retained data to make validation pass.

The inventory reader now supports 250,000 rows (250 bounded 1,000-row requests),
warns at 200,000, and rejects an oversized exact total immediately rather than
reading every page before failing. It still requires stable exact counts,
continuous ranges and unique identities. It never truncates, deletes, changes
source ownership or bypasses reconciliation. At 319 new rows/day, the extra
240,000 rows provide roughly 752 days of incremental headroom, not an unlimited
retention policy. Growth or more frequent manual runs can consume it faster.

## Operational checks (including December, January and February)

Verify all three workflows are active, not merely that their last run passed:

- `sync-live-courses.yml`: daily 07:00 UTC
- `sync-myharvard-hks.yml`: daily 07:30 UTC
- `publish-public-catalogue.yml`: inspect its current schedule and source triggers

An independent monitor must check workflow state and freshness, because a
workflow disabled for inactivity cannot run its own recovery code. It should
check the latest successful ingestion and publication, distinguish post-write
inventory failures from failed writes, and verify the public manifest's source
freshness. Notify on a disabled workflow or missing daily result; recover within
existing authorization. Do not use artificial data changes, delete history, or
relax the 5,000-course pre-write source floor as a keepalive.

Re-enabling the schedules and merging this repair are separate operations.
After the repair is on the default branch, run the non-HKS workflow and verify
both atomic upsert and the full reconciliation summary, then verify the next
scheduled runs and public catalogue publication. A passing unit test is not
production delivery evidence. Monitor capacity warnings and plan separately
reviewed archival if needed; preserve rollback records until approved otherwise.

## Follow-on resilience (November 2026)

A review of failed HKS runs linked from issues #126, #128, #129, #130 and #131
found duplicate offering identities across paginated source reads in every
sample. All recovered the following day. Those logs do not prove whether the
provider's ordering, cache or underlying data caused the duplication. The old
three attempts waited only 0.5 and 1 second, exhausting in roughly 13–21 seconds.

- Whole HKS snapshots now restart after 30 and 90 seconds, never mixing rows
  across attempts. Duplicates are rejected as soon as their page arrives, with
  page/count diagnostics. No deduplication or incomplete promotion is allowed.
- Database GETs in both syncs, manifest verification and public export retry
  transient transport/408/425/429/5xx failures up to three attempts. Backoff is
  bounded, numeric Retry-After is capped at 30 seconds, and certificate/permanent
  failures are not retried. JSON/count/schema validation stays outside retries.
- Failed public export responses count toward the existing 32 MiB source budget.
- Staging, promotion and rollback POSTs are NOT retried. An ambiguous write
  timeout still requires investigating the active generation, rather than
  assuming that a failed response means no commit occurred.
- Public publication has its own failure issue and verified-recovery closure;
  ingestion success does not prove public delivery. Repeated publication failures
  update one issue instead of adding identical daily comments.
- Dependabot now covers npm as well as Python and Actions, with weekly review
  PRs, at most two open per ecosystem. Updates do not auto-merge or bypass CI.

The existing workflow timeouts, atomic promotion, last-good public snapshot,
source-count floors, checksums and browser tests remain in force. These changes
reduce transient failure and expose distinct stages; they cannot guarantee that
an upstream provider, credentials, network or GitHub service never fails.
Independent state/freshness monitoring is still essential for disabled schedules.
The public manifest export time is not a source-specific non-HKS observation
stamp; retain workflow/source evidence when assessing freshness. Future work may
add durable source-specific provenance and ambiguous-write reconciliation, but
must preserve current data and independently prove any new contract.
