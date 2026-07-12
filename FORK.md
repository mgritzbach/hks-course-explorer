# Forking This Project

This tool was built by a student, for students. You're welcome to fork and adapt it for your own school — with one condition: **attribution is required** (see below).

---

## Attribution (Required)

Any public deployment of a fork must include a visible credit line in the app footer and in the repository README. Exact wording:

> Built on [HKS Course Explorer](https://github.com/michaelgritzbach/hks-course-explorer) by [Michael Gritzbach](https://www.linkedin.com/in/michael-gritzbach/), MPA '26 · Harvard Kennedy School

A link in the footer is sufficient. Removing attribution entirely is not permitted under the license.

---

## Three Tracks

Choose the track that matches how much data you have.

---

### Track A — Schedule Builder Only
**What you get:** A working schedule builder showing current Harvard course listings for your school, with conflict detection and a visual grid.

**Time to deploy:** Not yet turnkey. No evaluation data is required, but a new
fork must first provide and verify a complete Supabase catalogue-schema
baseline. Until that baseline is versioned here, do not estimate this track as
a two-hour deployment.

**Steps:**

1. Fork this repository on GitHub.

2. Create a free [Supabase](https://supabase.com) project and establish the
   catalogue schema first. This repository does not yet include a complete
   clean-project schema baseline. The administrative-import migration at
   `supabase/migrations/20260710003218_corporate_admin_import.sql` is
   forward-only and must be applied only after its documented prerequisites
   are present.

3. Get a Harvard ATS API key from [Harvard's API portal](https://go.apis.huit.harvard.edu).

4. Set environment variables — in a `.env` file locally and in Cloudflare Pages settings for production:
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=your-service-role-key
   HARVARD_API_KEY=your-harvard-api-key
   ```

5. Edit `src/school.config.js` — the only file you need to change for branding:
   ```js
   const schoolConfig = {
     schoolCode:    'GSD',                        // your school abbreviation
     schoolName:    'Harvard Graduate School of Design',
     appTitle:      'GSD Course Explorer',
     appTagline:    'Browse and schedule GSD courses.',
     dataSource:    'GSD evaluations',
     // Keep the attribution fields — required:
     creatorName:   'Michael Gritzbach',
     creatorUrl:    'https://www.linkedin.com/in/michael-gritzbach/',
     creatorDegrees: "VUS'18, MPA'26",
     // Update the chatbot copy to match your school:
     chatWelcome:   "Hi! I'm your GSD course advisor...",
     chatFootnote:  'AI · GSD course data · free',
     tutorialSourceHint: 'GSD courses are shown by default...',
   }
   ```

6. Run the live courses sync to populate your database:
   ```bash
   pip install requests supabase
   python scripts/sync_live_courses.py
   ```
   This fetches non-HKS course listings from the Harvard ATS API. This
   repository's HKS deployment separately runs `sync_myharvard_hks.py` because
   my.harvard is the authoritative student-facing HKS catalogue. A fork should
   define one authoritative source for its own school and keep source ownership
   disjoint.

7. Deploy through the versioned GitHub Actions workflow. Before pushing to
   `master`, configure `DEPLOY_VITE_SUPABASE_URL` as a GitHub variable and
   `DEPLOY_VITE_SUPABASE_ANON_KEY` as a GitHub secret. The workflow validates
   them, builds the verified commit, and deploys that exact artifact to
   Cloudflare Pages.

8. *(Optional)* Set up the daily sync via GitHub Actions — create a repository secret for each env var listed above, then the workflow at `.github/workflows/sync-live-courses.yml` runs automatically.

---

### Track B — Schedule Builder + Your Own Evaluation Data
**What you get:** Everything in Track A plus the historical course explorer, faculty page, similarity map, and percentile comparisons — powered by your school's own evaluation data.

**Additional time:** 1–3 days, depending on how clean your data export is.

**Steps:**

1. Complete Track A first.

2. Export your school's course evaluation data. It must be a semicolon-delimited CSV (`.csv`) matching this schema:

   | Column | Type | Required | Notes |
   |--------|------|----------|-------|
   | `course_code` | string | ✓ | e.g. `GSD-2101` |
   | `course_name` | string | ✓ | |
   | `professor` | string | ✓ | Format: `Last, First` |
   | `year` | integer | ✓ | e.g. `2024` (or `2024.0`) |
   | `term` | string | ✓ | `Fall`, `Spring`, or `January` |
   | `Instructor_Rating` | float | | 1.0–5.0 scale |
   | `Course_Rating` | float | | 1.0–5.0 scale |
   | `Workload` | float | | 1.0–5.0 scale |
   | `n_respondents` | integer | | |
   | `has_eval` | boolean | | `True` / `False` |
   | `description` | string | | Course description text |
   | `course_url` | string | | Link to course page |
   | `is_stem` | boolean | | |
   | `is_core` | boolean | | Required/core curriculum flag |

   Additional optional metric columns: `Assignments`, `Availability`, `Discussions`, `Diverse Perspectives`, `Feedback`, `Discussion Diversity`, `Rigor`, `Readings`, `Insights`.

   Save the file as `data/canonical_courses_enriched.csv`.

3. Edit `data/school_config.json` — replace the HKS-specific lists with your school's:
   ```json
   {
     "school_code": "GSD",
     "school_name": "Harvard Graduate School of Design",
     "core_course_codes": ["GSD-2101", "GSD-3201"],
     "historical_code_map": {}
   }
   ```

4. Run the build:
   ```bash
   pip install pandas numpy scikit-learn
   python scripts/build_data.py
   ```
   This validates your data, computes the similarity map, and writes `public/courses.json`.

5. Load the data into Supabase:
   ```bash
   python scripts/load_to_supabase.py
   ```

6. Deploy.

---

### Track C — Full Replica (Including Scraping Pipeline)
**What you get:** The full system including automated data collection from your school's evaluation portal.

**Additional time:** Days to weeks, depending on your portal's structure.

The scraping pipeline used for HKS was built specifically for the HKS Q-guide portal using a Chrome extension and a multi-pass AI cleaning pipeline. It is not generalizable out of the box. You would need to:

- Build a scraper for your own portal
- Export raw PDFs or structured data
- Run an equivalent cleaning pipeline

Contact the original author if you want to discuss this — see attribution section above.

---

## What Stays the Same Across All Forks

- React + Vite frontend
- Cloudflare Pages deployment
- Supabase backend
- GitHub Actions CI (lint + build gate)
- Schedule builder (current HKS via my.harvard; other Harvard schools via the ATS API)
- Similarity map (PCA-based, computed from your evaluation data)
- All engineering improvements (caching, validation, hooks architecture)

---

## Repository Structure Reference

```
hks-course-explorer/
├── src/
│   ├── school.config.js        ← CHANGE THIS for branding
│   ├── pages/
│   ├── components/
│   └── hooks/
├── data/
│   ├── school_config.json      ← CHANGE THIS for course code lists
│   └── canonical_courses_enriched.csv  ← REPLACE with your eval data
├── scripts/
│   ├── build_data.py           ← reads school_config.json, no changes needed
│   ├── sync_live_courses.py    ← Harvard ATS API sync, no changes needed
│   └── load_to_supabase.py     ← loads courses.json into Supabase
├── .github/workflows/
│   └── ci.yml                  ← lint + build gate on every push
└── FORK.md                     ← this file
```

---

## License

MIT License — free to use, modify, and deploy, with attribution as described above.

Original repository: https://github.com/michaelgritzbach/hks-course-explorer  
Original author: Michael Gritzbach — [LinkedIn](https://www.linkedin.com/in/michael-gritzbach/) · Harvard Kennedy School MPA '26
