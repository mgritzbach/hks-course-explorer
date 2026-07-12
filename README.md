# HKS Course Explorer

**A full-stack course exploration, scheduling, and evaluation tool for Harvard Kennedy School students — built independently by a student, for students.**

[![Live App](https://img.shields.io/badge/Live%20App-hks--course--explorer.pages.dev-blue?style=flat-square)](https://hks-course-explorer.pages.dev)
[![CI](https://img.shields.io/github/actions/workflow/status/mgritzbach/hks-course-explorer/ci.yml?style=flat-square&label=CI)](https://github.com/mgritzbach/hks-course-explorer/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

---

## What It Does

HKS Course Explorer gives students a single place to:

- **Browse & compare courses** — filter by concentration, STEM, workload, instructor rating, and year. See percentile rankings across every HKS evaluation metric.
- **Explore faculty** — view teaching history, weighted ratings, and course portfolios for every HKS instructor.
- **Build your schedule** — drag and drop courses into a visual weekly grid, detect conflicts automatically, and browse cross-registration options from all Harvard schools (HLS, GSD, HGSE, HMS, FAS, and more).
- **Filter by session** — Spring 1 / Spring 2 / Fall 1 / Fall 2 / Full Term / January
- **Track requirements** — map your courses against HKS degree program requirements
- **Similarity map** — find courses similar to ones you already like via a PCA-based scatter plot
- **AI advisor** — ask a chatbot trained on the course catalog to find the right course for your interests

Data covers **5,581 HKS Q-guide evaluation records** across multiple years, plus current course listings synchronised daily from two disjoint sources: my.harvard for the complete student-facing HKS catalogue and the Harvard ATS API for non-HKS schools. The browser searches that last verified catalogue; it does not call either upstream source while a student is using the site.

---

## Stack

| Layer | Tech |
|-------|------|
| Frontend | React 18 + Vite, deployed on Cloudflare Pages |
| Database | Supabase (PostgreSQL) |
| Live data | my.harvard (authoritative HKS offerings) + Harvard ATS API (non-HKS offerings) |
| CI/CD | GitHub Actions quality gate and exact-commit Wrangler deployment to Cloudflare Pages |
| Monitoring | Sentry (error tracking, optional) |

---

## Using the App

**Anyone can use the live app for free:** [hks-course-explorer.pages.dev](https://hks-course-explorer.pages.dev)

No account needed. Built for HKS students, but cross-registration browsing works for all Harvard schools.

---

## Forking for Your School

This project is designed to be forked by students at other Harvard schools (or any university). **Full forking guide: [FORK.md](FORK.md)**

### Three tracks

| Track | Time | What you get |
|-------|------|-------------|
| **A — Schedule builder only** | ~2 hours | Working schedule builder powered by the daily-synced course catalogue. No evaluation data needed. |
| **B — Add your eval data** | 1–3 days | Full app with your school's historical course evaluations, faculty explorer, and similarity map. |
| **C — Full replica** | Days–weeks | Build your own scraping pipeline for your school's evaluation portal. |

### Quick start (Track A)

```bash
# 1. Fork this repository on GitHub

# 2. Clone your fork
git clone https://github.com/YOUR-USERNAME/hks-course-explorer
cd hks-course-explorer

# 3. Install dependencies
npm ci --legacy-peer-deps
python -m pip install requests supabase pandas numpy scikit-learn

# 4. Set environment variables (copy .env.example to .env)
# macOS / Linux
cp .env.example .env
# Windows PowerShell
Copy-Item .env.example .env
# See docs/CONFIGURATION.md for browser, script, and Cloudflare Function settings.

# 5. Edit the two config files for your school:
#    src/school.config.js    <- branding (name, code, creator credit)
#    data/school_config.json <- course codes, core requirements

# 6. Populate non-HKS live course data from the Harvard ATS API.
#    HKS production data is promoted separately by sync_myharvard_hks.py.
python scripts/sync_live_courses.py

# 7. Run locally
npm run dev

# 8. Deploy: configure DEPLOY_VITE_SUPABASE_URL (GitHub variable) and
#    DEPLOY_VITE_SUPABASE_ANON_KEY (GitHub secret), then push to master.
#    The GitHub workflow validates configuration and deploys the exact tested artifact.
```

See [FORK.md](FORK.md) for the complete guide including the Supabase schema, CSV format for evaluation data, and deployment checklist.

---

## Attribution (Required for Forks)

This project is MIT licensed — **free to use, modify, and deploy** — with one condition:

**Any public deployment must include a visible credit line in the app footer.** Required wording:

> Built on [HKS Course Explorer](https://github.com/mgritzbach/hks-course-explorer) by [Michael Gritzbach](https://www.linkedin.com/in/michael-gritzbach/), MPA '26 · Harvard Kennedy School

A footer link is sufficient. Removing attribution entirely is not permitted.

Why: a student built this from scratch in their spare time. Credit costs nothing and helps the project reach more people.

---

## Data Pipeline

```
Harvard Q-guide PDFs
       |  (Chrome extension scraper + AI cleaning pipeline)
       v
data/canonical_courses_enriched.csv   <- ground truth
       |  python scripts/build_data.py
       v
public/courses.json  +  public/sim_coords.json
       |  GitHub CI -> validated Wrangler deployment
       v
Static files served from CDN globally

my.harvard       -->  scheduled scripts/sync_myharvard_hks.py  -- authoritative HKS --+
Harvard ATS API  -->  scheduled scripts/sync_live_courses.py   -- non-HKS schools -----+--> Supabase live_courses
Harvard sections ---------------------------------------------------------------> Supabase course_sections
                                                                                          |
                                                                                          v
                                                                      Browser Schedule Builder reads
                                                                      the selected synced term only

Both upstream catalogues are ingestion sources, not browser search
dependencies. A failed daily sync leaves the prior verified catalogue in
place; a student search never falls back to an on-demand upstream request.
```

Full pipeline documentation: [docs/data-pipeline-overview.txt](docs/data-pipeline-overview.txt)

---

## Local Development

```bash
npm install
npm run dev          # start dev server on localhost:5173
npm test             # run unit tests (Vitest)
npm run test:e2e:build # build, then run deterministic Playwright E2E tests locally
npm run lint         # ESLint (0 warnings enforced)
npm run build        # production build (also runs build_data.py)
```

The pre-commit hook runs `npm run lint` automatically. GitHub Actions runs lint,
unit tests, sync-safety tests, a production build, and deterministic local E2E
tests before the downstream deployment workflow is eligible to run.

### Environment variables

Copy `.env.example` to `.env`:

```
VITE_SUPABASE_URL=        # your Supabase project URL
VITE_SUPABASE_ANON_KEY=   # public anon key (safe to expose in frontend)
SUPABASE_KEY=             # service role key (scripts only — never commit this)
HARVARD_API_KEY=          # Harvard ATS API key
VITE_SENTRY_DSN=          # optional — Sentry error tracking DSN
```

---

## Project Structure

```
hks-course-explorer/
├── src/
│   ├── school.config.js        <- fork here: branding & attribution
│   ├── pages/
│   │   ├── ScheduleBuilder.jsx    schedule builder
│   │   ├── Courses.jsx            course explorer + similarity map
│   │   ├── Faculty.jsx            faculty explorer
│   │   └── Compare.jsx            side-by-side comparison
│   ├── hooks/
│   │   └── useScheduleData.js     Supabase data fetching hook
│   ├── components/
│   └── lib/
│       ├── supabase.js            Supabase client
│       └── harvardApi.js          Legacy Harvard proxy client (not imported by the deployed browser)
├── scripts/
│   ├── build_data.py              CSV -> courses.json + sim_coords.json
│   ├── sync_myharvard_hks.py      authoritative HKS -> Supabase live_courses
│   ├── sync_live_courses.py       non-HKS ATS -> Supabase live_courses
│   └── load_to_supabase.py        courses.json -> Supabase courses table
├── data/
│   ├── school_config.json      <- fork here: course codes & core requirements
│   └── canonical_courses_enriched.csv
├── docs/decisions/             <- Architecture Decision Records (ADR-001-006)
├── tests/e2e/                  <- Playwright E2E tests
├── .github/workflows/ci.yml   <- lint + build CI on every push
└── FORK.md                     <- complete forking guide
```

---

## Architecture Decisions

Key decisions that are easy to get wrong — documented so forks don't repeat the same debugging:

| ADR | Decision |
|-----|---------|
| [001](docs/decisions/ADR-001-no-import-meta-env-in-schedule-builder.md) | Supabase browser configuration is centralized, target-specific, and has no project fallback |
| [002](docs/decisions/ADR-002-live-courses-isolated-useeffect.md) | `live_courses` fetched in isolated `useEffect([])` — never inside semester effect |
| [003](docs/decisions/ADR-003-filtered-search-results-usememo.md) | `filteredSearchResults` useMemo is single source of truth for browse mode |
| [004](docs/decisions/ADR-004-term-format-differences.md) | `live_courses` uses `"2026 Spring"` (space); `course_sections` uses `"2026Spring"` (no space) |
| [005](docs/decisions/ADR-005-agent-workflow-build-must-pass.md) | Lint enforced locally; full build gate enforced by GitHub Actions CI |
| [006](docs/decisions/ADR-006-formatter-normalized-architecture-ratchet.md) | Prettier is canonical; architecture limits ratchet from the reviewed formatted baseline |

For handover and operations, see [architecture](docs/ARCHITECTURE.md),
[configuration](docs/CONFIGURATION.md), [service ownership](docs/OWNERSHIP.md),
and the [operations runbook](docs/OPERATIONS.md).

---

## Built By

**Michael Gritzbach** — Harvard Kennedy School, MPA '26
[LinkedIn](https://www.linkedin.com/in/michael-gritzbach/) · [GitHub](https://github.com/mgritzbach)

Built as a student council member in the final semester of the MPA program. The idea: stop discussing things and ship them instead.

> *"Don't just think about ideas — ship something and improve it once it's live."* — Sundai Club

---

*Data from HKS QReports. Not affiliated with or endorsed by Harvard University.*
