# Production RLS remediation plan

Status: applied to production on 2026-07-10 as
`20260710230627_restrict_course_explorer_browser_writes`. This document is the
release record and rollback reference for that scoped migration.

Follow-up status: browser table-grant hardening is proven on the isolated free
staging project and is not yet applied to production. The reviewed source is
`20260712144500_revoke_course_explorer_browser_write_grants.sql`.

## Scope and evidence

Read-only inspection on 2026-07-10 found:

- `public.live_courses` has a public `ALL` policy with `USING (true)` and
  `WITH CHECK (true)`. The Course Explorer browser needs only public `SELECT`.
- `public.schedules` has a public `ALL` policy with `USING (true)` and
  `WITH CHECK (true)`. There are 63 existing records over 52 old
  browser-generated identifiers.
- The project is shared with other applications. The initial policy migration
  did not touch any table, function, grant, or policy outside the two Course
  Explorer tables. The separately reviewed follow-up also includes the
  read-only `courses` catalogue grant and changes no other object.

The application change that removes browser writes to `schedules` must be
deployed before the database policy change. Plans remain local-storage based;
there is no supported remote plan-read path to preserve.

## Preflight and backup

1. Record the exact deployed application commit and current migration list.
2. Assert and record that RLS is enabled on both target tables. Inventory the
   exact policy names, roles, commands, `USING`, and `WITH CHECK` expressions;
   stop if they differ from this plan's observed definitions.
3. Before dropping `Anon write live_courses`, assert that the distinct
   `Public read` `SELECT` policy exists and permits the browser's required
   catalogue columns. Stop rather than removing the only browser read path.
4. Export or verify a point-in-time backup covering `public.schedules` and the
   two target policy definitions. Retain the 58 legacy schedule rows; do not
   delete them as part of access hardening.
5. Apply the approved code release that makes schedule persistence local-only.
6. On staging, verify a visitor can read `live_courses`, browse Schedule
   Builder, save/reload a local plan, and cannot call either target table's
   write endpoint with a browser publishable key.

## Applied database policy change

The managed migration tool recorded version
`20260710230627_restrict_course_explorer_browser_writes`; the committed source
file uses that exact version. It made only these changes:

```sql
-- Preserve existing public read policy for the catalogue.
drop policy if exists "Anon write live_courses" on public.live_courses;

-- The application no longer has a remote schedules feature. Remove the
-- unauthenticated all-access policy; existing rows remain retained but are
-- inaccessible through browser RLS.
drop policy if exists "schedules_anon_all" on public.schedules;
```

Do not add a replacement write policy until plan ownership is backed by a
server-verified authenticated identity and has dedicated integration tests.

### Production acceptance record

The application release was deployed and browser-smoked before this migration.
Immediately before application, both target tables had RLS enabled; the
expected public `SELECT` policy remained on `live_courses`; and the two
unrestricted `ALL` policies matched the definitions documented above. The
database contained 1,555 live-course rows and 63 legacy schedule rows.

Immediately after application:

- `live_courses` retained the public `SELECT` policy and all 1,555 rows;
- `schedules` retained all 63 rows but has no browser-access policy;
- no `ALL` policy remains on either scoped table; and
- an `anon`-role verification can read 1,555 live-course rows and zero
  schedule rows.

## Staging acceptance

The platform owner must capture all of the following before promotion:

1. `anon` can select the exact columns used by `live_courses` and
   `course_sections` but receives permission/RLS denial for inserting,
   updating, or deleting `live_courses`.
2. `anon` cannot select, insert, update, or delete `schedules`.
3. The service-role scheduled sync still upserts a controlled live-course test
   row and leaves existing rows intact on an injected upstream partial failure.
4. Schedule Builder browser smoke, local save/reload, and all existing route
   checks pass against the staged environment.
5. Security advisors no longer report permissive `ALL` policies for these two
   Course Explorer tables.

### Completed isolated staging exercise

The exact migration ran on the separate free `hks-course-explorer-staging`
project using replicas of the current two table shapes and policies. After the
migration:

- an anonymous user could read the retained live-course record;
- anonymous live-course insert was rejected;
- the retained legacy schedule row was invisible to anonymous users;
- anonymous schedule insert was rejected;
- both rows remained present; and
- no `ALL` policy remained on either table.

This staging proof preceded the production policy application recorded above.
The policy migration is now applied to production; the later table-grant
follow-up remains staging-only until its separate acceptance record is added.

## Browser table-grant follow-up

A read-only production audit on 2026-07-12 confirmed that RLS is enabled, only
the intended `SELECT` policy remains on `courses` and `live_courses`, and
`schedules` has no policy. It also found the default Supabase table grants still
included `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, and `TRIGGER`
for `anon` and `authenticated`. RLS blocked those unsupported operations, but
leaving the underlying grants was unnecessary defense-in-depth debt.

The follow-up migration fails closed if either required table is missing, RLS
is disabled, a catalogue lacks a `SELECT` policy, an unexpected write policy
returns, or `schedules` gains any policy. It then:

- preserves `SELECT` on `courses` and `live_courses` for browser roles;
- revokes all write-oriented table grants on both catalogues;
- revokes every browser table privilege on the unsupported remote `schedules`
  store; and
- leaves `service_role`, rows, schemas, indexes, functions, and policies
  unchanged.

### Completed grant-hardening staging exercise

The migration ran on `hks-course-explorer-staging` on 2026-07-12. Read-back
proved that the retained `live_courses` and `schedules` rows remained present;
`anon` and `authenticated` retained only `live_courses` `SELECT` and had no
schedule privilege; `service_role` retained catalogue read/write/delete and
schedule read/write authority. An explicit read-only transaction under the
`anon` role still returned the active staging catalogue row.

Production promotion is pending independent review, exact-head CI, and the
same post-migration grant/policy/row-count read-back. Because the migration only
revokes unsupported browser privileges, rollback must not broadly re-grant
`ALL`; any successor browser write feature requires authenticated ownership and
dedicated integration tests.

## Rollback and retention

Keep the policy definition export and backup checkpoint with the release
record. Roll back the application commit first only if required, then restore
database policy/data only under an incident owner’s approval. Reintroducing an
unrestricted browser `ALL` policy is not a routine rollback; a secure
authenticated plan-sync design is the successor feature. Set a documented
retention decision for the legacy schedule records before eventual deletion.
