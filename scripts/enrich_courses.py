"""
enrich_courses.py
-----------------
Enriches courses.json with official Harvard API data from 3 CSVs:
  - hks_base_courses.csv   → descriptions, academic_area, prereqs, credits, cross-reg
  - hks_sections.csv       → enrollment caps, meeting times, course URLs (latest term)
  - hks_instructors.csv    → faculty profile URLs

Usage:
    python scripts/enrich_courses.py

Inputs (hardcoded paths, adjust if needed):
    public/courses.json
    C:/Users/micgr/OneDrive/Desktop/CODEX/hks_exports/hks_base_courses.csv
    C:/Users/micgr/OneDrive/Desktop/CODEX/hks_exports/hks_sections.csv
    C:/Users/micgr/OneDrive/Desktop/CODEX/hks_exports/hks_instructors.csv

Output:
    public/courses.json       ← enriched (overwrites)
    public/courses_backup.json ← untouched backup of original
"""

import json, re, shutil, sys, os
from pathlib import Path

import pandas as pd

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT        = Path(__file__).resolve().parent.parent
COURSES_IN  = ROOT / "public" / "courses.json"
COURSES_BAK = ROOT / "public" / "courses_backup.json"
COURSES_OUT = ROOT / "public" / "courses.json"

CSV_DIR   = Path(r"C:/Users/micgr/OneDrive/Desktop/CODEX/hks_exports")
CSV_BASE  = CSV_DIR / "hks_base_courses.csv"
CSV_SEC   = CSV_DIR / "hks_sections.csv"
CSV_INST  = CSV_DIR / "hks_instructors.csv"

# ── Load CSVs ─────────────────────────────────────────────────────────────────
print("Loading CSVs...")
df_base = pd.read_csv(CSV_BASE, encoding="utf-8-sig")
df_sec  = pd.read_csv(CSV_SEC,  encoding="utf-8-sig")
df_inst = pd.read_csv(CSV_INST, encoding="utf-8-sig")

# ── Build lookup: base_course_code → base course info ─────────────────────────
def clean_text(s):
    if pd.isna(s): return None
    s = str(s).strip()
    return s if s else None

def cross_reg_bool(s):
    if pd.isna(s): return None
    return "available" in str(s).lower()

base_lookup = {}
for _, row in df_base.iterrows():
    code = clean_text(row["base_course_code"])
    if not code: continue
    base_lookup[code] = {
        "description":        clean_text(row.get("course_description_text")),
        "academic_area":      clean_text(row.get("academic_area")),
        "prerequisites":      clean_text(row.get("course_prereq")),
        "course_requirements":clean_text(row.get("course_requirements")),
        "cross_registration": cross_reg_bool(row.get("cross_registration")),
        "grading_basis":      clean_text(row.get("grading_basis")),
        "credits_min":        float(row["units_min"]) if pd.notna(row.get("units_min")) else None,
        "credits_max":        float(row["units_max"]) if pd.notna(row.get("units_max")) else None,
    }

print(f"  Base course records: {len(base_lookup)}")

# ── Build lookup: base_course_code → latest-term section summary ──────────────
# Term priority: 2026 Spring > 2025 Fall  (higher strm = more recent)
df_sec["strm"] = pd.to_numeric(df_sec["strm"], errors="coerce")

# Per base_course_code: aggregate sections from latest term only
# enrolled_cap=999 means effectively unlimited, treat as None for display
def agg_sections(group):
    # Take latest strm
    latest_strm = group["strm"].max()
    latest = group[group["strm"] == latest_strm].copy()

    caps = latest["enrolled_cap"].replace(999, pd.NA).dropna()
    totals = latest["enrolled_total"].dropna()
    waits  = latest["waitlist_total"].fillna(0)

    # Combine meeting patterns (deduplicate)
    patterns = latest["meeting_pattern"].dropna().unique().tolist()
    times_start = latest["time_start"].dropna().unique().tolist()
    times_end   = latest["time_end"].dropna().unique().tolist()

    # Pick best course_site_url (prefer non-null, most recent section)
    urls = latest["course_site_url"].dropna().tolist()

    # Course notes (section-specific, combine unique)
    notes = latest["course_notes_text"].dropna().unique().tolist()
    notes_clean = [str(n).strip() for n in notes if str(n).strip()]

    return {
        "current_term":      clean_text(latest["term_label"].iloc[0]) if len(latest) else None,
        "enrolled_cap":      int(caps.sum()) if len(caps) > 0 else None,
        "enrolled_total":    int(totals.sum()) if len(totals) > 0 else None,
        "waitlist_total":    int(waits.sum()) if len(waits) > 0 else None,
        "meeting_days":      patterns[0] if patterns else None,
        "time_start":        times_start[0] if times_start else None,
        "time_end":          times_end[0] if times_end else None,
        "course_site_url_new": urls[0] if urls else None,
        "section_notes":     notes_clean if notes_clean else None,
    }

sec_lookup = {}
for code, group in df_sec.groupby("base_course_code"):
    sec_lookup[code] = agg_sections(group)

print(f"  Section records (unique base codes): {len(sec_lookup)}")

# ── Build lookup: instructor_name → profile URL ───────────────────────────────
inst_lookup = {}
for _, row in df_inst.iterrows():
    name = clean_text(row.get("instructor_name"))
    url  = clean_text(row.get("profile_url"))
    if name and url:
        inst_lookup[name.lower()] = url

print(f"  Instructor profiles with URL: {len(inst_lookup)}")

# ── Load existing courses.json ────────────────────────────────────────────────
print(f"\nLoading {COURSES_IN}...")
with open(COURSES_IN, encoding="utf-8") as f:
    data = json.load(f)

# Backup original
print(f"Backing up to {COURSES_BAK}...")
shutil.copy(COURSES_IN, COURSES_BAK)

# ── Normalise a code for matching (strip -M suffix, upper) ───────────────────
def normalise(code):
    if not code: return ""
    return re.sub(r"-?M$", "", str(code).strip().upper())

# Also build a normalised base_lookup key map
norm_base = {normalise(k): v for k, v in base_lookup.items()}
norm_base.update(base_lookup)   # keep exact keys too
norm_sec  = {normalise(k): v for k, v in sec_lookup.items()}
norm_sec.update(sec_lookup)

# ── Enrich each course record ─────────────────────────────────────────────────
enriched = 0
url_filled = 0
prof_filled = 0

courses = data["courses"]

for c in courses:
    code_base = c.get("course_code_base") or ""
    norm = normalise(code_base)

    # ── Base course enrichment ────────────────────────────────────────────
    info = norm_base.get(code_base) or norm_base.get(norm)
    if info:
        enriched += 1
        c.setdefault("description",         info["description"])
        c.setdefault("academic_area",       info["academic_area"])
        c.setdefault("prerequisites",       info["prerequisites"])
        c.setdefault("course_requirements", info["course_requirements"])
        c.setdefault("cross_registration",  info["cross_registration"])
        c.setdefault("grading_basis",       info["grading_basis"])
        c.setdefault("credits_min",         info["credits_min"])
        c.setdefault("credits_max",         info["credits_max"])
        # Overwrite if not already set
        if not c.get("description"):
            c["description"] = info["description"]

    # ── Section enrichment ────────────────────────────────────────────────
    sec = norm_sec.get(code_base) or norm_sec.get(norm)
    if sec:
        c.setdefault("enrolled_cap",    sec["enrolled_cap"])
        c.setdefault("enrolled_total",  sec["enrolled_total"])
        c.setdefault("waitlist_total",  sec["waitlist_total"])
        c.setdefault("meeting_days",    sec["meeting_days"])
        c.setdefault("time_start",      sec["time_start"])
        c.setdefault("time_end",        sec["time_end"])
        c.setdefault("section_notes",   sec["section_notes"])
        c.setdefault("current_term",    sec["current_term"])

        # course_site_url: fill if missing
        if not c.get("course_url") and sec.get("course_site_url_new"):
            c["course_url"] = sec["course_site_url_new"]
            url_filled += 1

    # ── Instructor profile URL ─────────────────────────────────────────────
    prof_key = (c.get("professor_display") or c.get("professor") or "").lower()
    prof_url = inst_lookup.get(prof_key)
    if prof_url:
        c.setdefault("instructor_profile_url", prof_url)
        prof_filled += 1

# ── Update meta with new filter options ───────────────────────────────────────
# Collect all unique academic areas
academic_areas = sorted(set(
    c["academic_area"] for c in courses
    if c.get("academic_area")
))
data["meta"]["academic_areas"] = academic_areas
print(f"\nAcademic areas found: {academic_areas}")

# ── Write output ──────────────────────────────────────────────────────────────
print(f"\nWriting enriched data to {COURSES_OUT}...")
with open(COURSES_OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, ensure_ascii=False, separators=(",", ":"))

# ── Summary ───────────────────────────────────────────────────────────────────
total = len(courses)
with_desc   = sum(1 for c in courses if c.get("description"))
with_area   = sum(1 for c in courses if c.get("academic_area"))
with_cap    = sum(1 for c in courses if c.get("enrolled_cap") is not None)
with_url    = sum(1 for c in courses if c.get("course_url"))
with_prereq = sum(1 for c in courses if c.get("prerequisites"))

print(f"\n{'='*50}")
print(f"Total course records:    {total}")
print(f"With description:        {with_desc} ({with_desc/total*100:.1f}%)")
print(f"With academic area:      {with_area} ({with_area/total*100:.1f}%)")
print(f"With enrollment cap:     {with_cap} ({with_cap/total*100:.1f}%)")
print(f"With prerequisites:      {with_prereq} ({with_prereq/total*100:.1f}%)")
print(f"With course URL:         {with_url} ({with_url/total*100:.1f}%)")
print(f"New URLs filled in:      {url_filled}")
print(f"Instructor URLs matched: {prof_filled}")
print(f"{'='*50}")
print("Done! Original backed up to courses_backup.json")
