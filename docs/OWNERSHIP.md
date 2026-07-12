# Service ownership and IT handover

This document names the accountable owner for every production boundary and
defines a no-cost path for transferring the service to an institutional IT
team. It contains roles and procedures only; secret values never belong here.

## Current ownership

| Boundary | Accountable owner | Responsibilities |
| --- | --- | --- |
| Product and release decisions | Michael Gritzbach (`@mgritzbach`) | User-facing scope, release approval, rollback decision, and public communications. |
| Repository and CI/CD | Michael Gritzbach (`@mgritzbach`) | Ruleset, workflow permissions, dependency review, exact-commit CI/deploy evidence, and recovery branches. |
| Supabase and catalogue data | Michael Gritzbach (`@mgritzbach`) | RLS/grants, migrations, daily sync health, backup/restore evidence, and source-parity review. |
| Cloudflare Pages and Functions | Michael Gritzbach (`@mgritzbach`) | Deployments, bindings, secrets, cache/security settings, Functions logs, and rollback. |
| Observability and providers | Michael Gritzbach (`@mgritzbach`) | Sentry/PostHog review, chat/email provider health, privacy, and zero-cost usage limits. |

The current project has one maintainer and therefore does not promise a 24/7
on-call service or response-time SLA. Reliability comes from failing closed,
retaining the last verified catalogue, blocking unverified deployments, and
keeping a tested rollback path. If the owner is unavailable, freeze releases
and leave the last-known-good production state in place.

## Incident intake and severity

- Report non-sensitive defects through the repository's GitHub Issues page.
- Report vulnerabilities or credential exposure through a private GitHub
  Security Advisory. Never paste secrets, student data, tokens, or raw provider
  responses into a public issue.
- Preserve the failing GitHub Actions run, Cloudflare deployment identifier,
  Supabase migration/sync identifier, and affected application commit.

| Severity | Definition | Required response |
| --- | --- | --- |
| P0 | Data exposure/corruption, compromised credential, or the core service unavailable. | Freeze promotion, disable the affected path if safe, preserve evidence, rotate exposed credentials, and use the tested rollback procedure. |
| P1 | Major route, catalogue, schedule, comparison, or provider function broken without data exposure. | Stop new releases, reproduce against the exact production commit, add a regression test, and promote only after the full gate passes. |
| P2 | Localized defect or documentation/operational issue with a safe workaround. | Track it, test the correction proportionally, and release through the normal protected path. |

The detailed diagnostic and rollback commands live in
[`OPERATIONS.md`](OPERATIONS.md).

## Release and data authority

1. Every production change must use a pull request and the current required
   `Quality gate`; unresolved review threads block merge.
2. Deploy only the exact commit proven by CI and the isolated release-candidate
   browser smoke. A failed gate leaves production unchanged.
3. Apply production database changes only from reviewed migrations, after
   current row/policy/grant evidence and a successful backup/restore drill.
4. Never restore unrestricted anonymous writes as a routine rollback.
5. Keep HKS and non-HKS catalogue ownership disjoint. Failed source validation
   must preserve the prior verified catalogue.

## Mandatory zero-cost control

- Do not enable a paid plan, metered overage, paid add-on, or billable provider
  without a new explicit owner decision that supersedes the project's standing
  zero-cost rule.
- Keep providers on their free plans with no payment method, or configure a
  hard `$0` spend/usage limit when the provider supports one.
- Review Cloudflare, Supabase, PostHog, Sentry, chat, and email-provider usage
  before enabling additional telemetry or traffic-generating features.
- If a free allowance is close to exhaustion, degrade the optional feature or
  disable its ingestion before a charge can occur; do not allow automatic paid
  overage.

## Successor IT-team acceptance checklist

The current owner and successor must complete this checklist together. A name
in `CODEOWNERS` is not sufficient handover evidence.

1. Grant the successor least-privilege administrative access to GitHub,
   Cloudflare, Supabase, observability, and required provider accounts.
2. Replace `CODEOWNERS` and this ownership table with the institutional team,
   named service owner, incident channel, and escalation path.
3. Inventory every variable, secret, and binding in
   [`CONFIGURATION.md`](CONFIGURATION.md); rotate credentials during transfer
   and verify that no secret enters the browser bundle or repository.
4. Complete a clean setup from the documented commands and pass lint, contracts,
   tests, build, bundle budgets, and local browser E2E.
5. Run the staging database proof, current catalogue parity audit, encrypted
   backup plus ephemeral restore verification, HKS sync, and non-HKS sync.
6. Deploy one no-op/documentation commit through exact-commit CI, isolated
   release-candidate smoke, production promotion, custom-domain smoke, and
   rollback to the prior Pages deployment.
7. Verify Home, Courses, Faculty, Compare, Resources, Schedule Builder,
   Requirements, chatbot failure/success behavior, graphs, shortlist, notes,
   links, static assets, desktop/mobile navigation, and keyboard flow.
8. Confirm free-plan status or `$0` limits for every provider and record the
   next quarterly ownership/access review date.

Until every item is recorded, the transfer is incomplete and the current owner
remains accountable. Review this document after any owner, provider, data
source, deployment path, or incident process changes.
