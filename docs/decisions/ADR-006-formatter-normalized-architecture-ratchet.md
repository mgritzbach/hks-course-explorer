# ADR-006: Formatter-normalized architecture ratchet

## Status

Accepted during the corporate-readiness manager/controller re-review.

## Context

The architecture guard originally counted non-empty source lines in four
legacy UI roots. Much of the legacy JSX was compressed onto long lines, so a
repository-wide Prettier baseline materially increased that physical-line
count without changing control flow or adding UI behavior. Keeping the old
limits would make the formatter incompatible with CI; raising them without a
decision would make the no-growth guard untrustworthy.

## Decision

Prettier is the canonical JavaScript/JSX representation and the architecture
ratchet is measured against the once-formatted baseline below:

| Root | Formatted baseline |
| --- | ---: |
| `src/App.jsx` | 1,123 non-empty lines |
| `src/pages/ScheduleBuilder.jsx` | 4,437 non-empty lines |
| `src/pages/Courses.jsx` | 1,993 non-empty lines |
| `src/components/ScatterPlot.jsx` | 1,121 non-empty lines |

`npm run check:format` runs before `npm run check:architecture` in CI. No
future limit increase is permitted without a successor ADR, a named owner,
focused regression evidence, and an independent controller review. The
format-independent UI-complexity guard remains mandatory, and meaningful
extractions must reduce a root below this baseline rather than reset it.

## Consequences

- Code has one deterministic review format after a clean install.
- The line-based ratchet again detects uncontrolled growth in the canonical
  representation instead of penalizing formatting.
- Large legacy roots remain explicit technical debt. The ratchet does not
  certify their modularity; owners must continue extracting coherent
  state/presentation boundaries with direct tests.
