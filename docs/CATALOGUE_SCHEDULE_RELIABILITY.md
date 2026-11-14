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
