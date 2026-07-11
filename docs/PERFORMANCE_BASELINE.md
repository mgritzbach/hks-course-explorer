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

## 2026-07-11 production mobile trace

Target: `https://hks-course-explorer.pages.dev/`, Home route (`/`), a
cache-revalidating navigation at a 390 x 844 mobile viewport with Fast 4G
network emulation and 4x CPU throttling. This is one reproducible lab trace,
not real-user data; a fully cache-cold production trace remains outstanding.

| Metric | Observed value | Status |
| --- | ---: | --- |
| LCP | 1,407 ms | Good lab result |
| CLS | 0.00 | Good lab result |
| TTFB | 31 ms | Good lab result |

The LCP was text. Its 1,376 ms render delay dominated the result; network
delivery was not the bottleneck. The longest critical request path was 601 ms:
document, application CSS, Google Fonts stylesheet, then Instrument Sans.
DevTools estimates that deferring the two render-blocking stylesheets could
save about 126 ms of FCP/LCP, but doing so risks a visible font/style flash and
is not justified without a visual regression design.

The trace observed third-party main-thread work from PostHog (519 ms) and
Tally (16 ms), plus a 1.9 MB Supabase transfer. DevTools did not attribute an
LCP saving to those resources. Keep telemetry unchanged unless a product owner
accepts the measurement tradeoff; revisit after collecting route interaction
and real-user INP evidence.

## Startup dependency policy

The Home route must not statically import the Supabase browser client. The
catalogue loader dynamically imports it only after the page has painted and a
course read is needed; Schedule Builder continues to load it with its own lazy
route. `npm run check:bundle-budget` rejects a future static Supabase dependency
in the initial Home graph.
