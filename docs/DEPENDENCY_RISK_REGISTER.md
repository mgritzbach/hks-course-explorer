# Dependency risk register

This register records the production dependency audit on 2026-07-11. It is a release control, not a claim that the dependency estate is fully risk-free.

| ID | Component | Decision | Evidence | Release status |
| --- | --- | --- | --- | --- |
| DEP-01 | `posthog-js` | Updated within the existing `^1.365.1` range: `1.365.1` to `1.399.1`. | Removes the `protobufjs@7.5.4` dependency chain that produced the critical advisory. | Resolved locally |
| DEP-02 | `ws` | Updated transitively within Supabase Realtime's existing `^8.18.2` range: `8.20.0` to `8.21.0`. | Removes the high-severity memory-exhaustion advisory without changing `@supabase/supabase-js@2.104.0` or its Node 20 engine contract. | Resolved locally |
| DEP-03 | `react-router-dom` / `react-router` | Updated within the current v6 contract: `6.30.3` to `6.30.4`; the declared minimum is now `^6.30.4`. | Removes the direct `react-router-dom` moderate advisory without a React Router major-version migration. | Resolved locally |
| DEP-04 | `xlsx` | Replaced registry-stale `0.18.5` with vendored SheetJS CE `0.20.3` from the official distribution. The exact archive and SHA-512 are committed under `vendor/`; uploads retain the existing 10 MB/signature/range limits. | `npm audit --omit=dev` no longer reports `xlsx`; CI fails on any high-severity production dependency finding. The parser remains browser-resident, so workbook-size and schema limits stay enforced. | Resolved locally; monitor SheetJS releases and revalidate the vendor checksum before upgrades. |
| DEP-05 | `dompurify` | Pinned transitively through the reviewed npm override to `3.4.11`, within PostHog's declared `^3.3.2` contract. | Clean npm 10 install, full unit/Python/browser suites, and `npm audit --omit=dev --audit-level=moderate` report zero production findings. | Resolved locally |
| DEP-06 | Capacitor CLI chain (`tar`, `brace-expansion`) | Moved `@capacitor/cli` from runtime dependencies to development dependencies; it is a build command and is not imported by the deployed website. | The production install/audit no longer includes the CLI chain; browser build and end-to-end tests passed after a clean install. | Resolved locally |

## Audit evidence

- Before: `npm audit --omit=dev` reported 18 findings: 1 critical (`protobufjs`), 2 high (`ws`, `xlsx`), and 15 moderate.
- After: `npm audit --omit=dev --audit-level=moderate` reports zero production findings, and CI enforces that same threshold on every change.
- A clean npm 10 install and the full Python, unit, built-artifact browser, and production-audit checks passed. The repository declares npm `10.9.8` because npm 11's peer resolver rewrites this established lockfile extensively; any package-manager upgrade requires its own reviewed lockfile diff.

## Moderate-finding disposition

| Finding | Current disposition | Owner | Target | Rationale and evidence |
| --- | --- | --- | --- | --- |
| `react-router-dom` / `react-router` | Resolved by `6.30.4`; no longer present in the production audit. | Platform owner | Completed in this pass | Stayed within React Router v6 and passed the local regression suite. |
| `dompurify` | Resolved by the explicit compatible `3.4.11` override. | Platform owner | Completed in this pass | The override stays inside PostHog's declared range and passed clean-install and browser regression checks. |
| `tar` | Removed from the production dependency set with the Capacitor CLI reclassification. | Platform owner | Completed in this pass | It remains a development-only tool dependency and cannot ship in the website artifact. |
| `brace-expansion` | Removed from the production dependency set with the Capacitor CLI reclassification. | Platform owner | Completed in this pass | It remains a development-only tool dependency and cannot ship in the website artifact. |

## Ongoing control for DEP-04

Do not treat spreadsheet input as trusted. The approved SheetJS archive is vendored with its SHA-512 checksum, and CI enforces that checksum with `npm run check:vendor-integrity`; the application keeps its 10 MB, signature, and supported-range checks. Before any SheetJS upgrade, the owning team must verify the release source and checksum, run a clean install, run the workbook parser compatibility tests (including legacy `.xls`), and pass the production dependency audit gate.
