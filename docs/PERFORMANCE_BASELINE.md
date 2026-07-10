# Local production-build performance baseline

This is a reproducible local laboratory trace, not a claim about production
real-user performance. Run it against the exact built artifact with inert
Supabase configuration before changing performance budgets or loading strategy.

## 2026-07-10 baseline

Target: local Vite production preview, Home route (`/`), cold navigation,
Chrome DevTools, no CPU or network throttling.

| Metric | Observed value | Notes |
| --- | ---: | --- |
| LCP | 409 ms | Text LCP; 8 ms TTFB and 401 ms render delay. |
| CLS | 0.00 | No layout shift observed. |
| TTFB | 8 ms | Local-preview measurement only. |

DevTools found no render-blocking request with measurable FCP/LCP savings.
Third-party analytics work was measured but did not have an estimated FCP or
LCP saving in this trace: PostHog used 72 ms main-thread time, while Tally used
6 ms. Do not remove analytics or forms based on this local result alone;
reassess them with a production mobile trace before making a product tradeoff.

## Remaining production evidence

This baseline does not complete G08. Before production certification, collect:

1. a mobile-throttled trace against the deployed domain;
2. deployed cache-header evidence for static assets and Functions;
3. API latency evidence for catalogue, Harvard, and chat failure states; and
4. real-user LCP/INP/CLS data or a documented free alternative if RUM is not
   enabled.
