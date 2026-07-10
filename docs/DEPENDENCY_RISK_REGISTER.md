# Dependency risk register

This register records the production dependency audit on 2026-07-09. It is a release control, not a claim that the dependency estate is fully risk-free.

| ID | Component | Decision | Evidence | Release status |
| --- | --- | --- | --- | --- |
| DEP-01 | `posthog-js` | Updated within the existing `^1.365.1` range: `1.365.1` to `1.399.1`. | Removes the `protobufjs@7.5.4` dependency chain that produced the critical advisory. | Resolved locally |
| DEP-02 | `ws` | Updated transitively within Supabase Realtime's existing `^8.18.2` range: `8.20.0` to `8.21.0`. | Removes the high-severity memory-exhaustion advisory without changing `@supabase/supabase-js@2.104.0` or its Node 20 engine contract. | Resolved locally |
| DEP-03 | `react-router-dom` / `react-router` | Updated within the current v6 contract: `6.30.3` to `6.30.4`; the declared minimum is now `^6.30.4`. | Removes the direct `react-router-dom` moderate advisory without a React Router major-version migration. | Resolved locally |
| DEP-04 | `xlsx` | Replaced registry-stale `0.18.5` with vendored SheetJS CE `0.20.3` from the official distribution. The exact archive and SHA-512 are committed under `vendor/`; uploads retain the existing 10 MB/signature/range limits. | `npm audit --omit=dev` no longer reports `xlsx`; CI fails on any high-severity production dependency finding. The parser remains browser-resident, so workbook-size and schema limits stay enforced. | Resolved locally; monitor SheetJS releases and revalidate the vendor checksum before upgrades. |

## Audit evidence

- Before: `npm audit --omit=dev` reported 18 findings: 1 critical (`protobufjs`), 2 high (`ws`, `xlsx`), and 15 moderate.
- After: the same command reports 3 moderate findings (`brace-expansion`, `dompurify`, and `tar`); there are no critical or high findings. `npm audit --omit=dev --audit-level=high` therefore passes and is enforced in CI.
- A clean `npm ci --ignore-scripts` completed using the retained lockfile. Its all-dependency install-time summary reported 11 findings (including development dependencies); this is distinct from the production-only audit above.

## Moderate-finding disposition

| Finding | Current disposition | Owner | Target | Rationale and evidence |
| --- | --- | --- | --- | --- |
| `react-router-dom` / `react-router` | Resolved by `6.30.4`; no longer present in the production audit. | Platform owner | Completed in this pass | Stayed within React Router v6 and passed the local regression suite. |
| `dompurify` | Open, fix available through its parent dependency. | Platform owner | Before release | Upgrade the owning dependency or add a tested compatible override, then repeat the rendered-content and browser regression tests. Do not suppress the advisory. |
| `tar` | Open, fix available through its parent dependency. | Platform owner | Before release | Upgrade the owning dependency or add a tested compatible override, then repeat clean-install and build verification. Do not suppress the advisory. |
| `brace-expansion` | Open, fix available through its parent dependency. | Platform owner | Before release | Upgrade the owning dependency or add a tested compatible override, then repeat clean-install and build verification. Do not suppress the advisory. |

## Ongoing control for DEP-04

Do not treat spreadsheet input as trusted. The approved SheetJS archive is vendored with its SHA-512 checksum, and CI enforces that checksum with `npm run check:vendor-integrity`; the application keeps its 10 MB, signature, and supported-range checks. Before any SheetJS upgrade, the owning team must verify the release source and checksum, run a clean install, run the workbook parser compatibility tests (including legacy `.xls`), and pass the production dependency audit gate. The three remaining moderate findings remain release items with the owners and remediation paths listed above.
