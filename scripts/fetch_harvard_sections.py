"""
fetch_harvard_sections.py
─────────────────────────
Fetches course section + meeting-time data from the Harvard ATS Course v2 API
and upserts it into the Supabase `course_sections` table.

Usage:
    python scripts/fetch_harvard_sections.py

Required env vars:
    HARVARD_API_KEY   — from the Harvard Developer Portal (x-api-key header)
    SUPABASE_URL      — e.g. https://cbtroatixvydpwoviezf.supabase.co
    SUPABASE_KEY      — service-role key (full write access)

Optional env vars:
    TERMS             — comma-separated list, default: "2026Spring,2025Fall,2025January"
    SCHOOL            — default: HKS
    PAGE_SIZE         — default: 50 (max allowed by Harvard API)
"""

import os
import sys
import time
import json
import requests
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────
HARVARD_API_KEY = os.environ["HARVARD_API_KEY"]
SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_KEY"]
SCHOOL          = os.environ.get("SCHOOL", "HKS")
PAGE_SIZE       = int(os.environ.get("PAGE_SIZE", "50"))
TERMS           = os.environ.get("TERMS", "2026Spring,2025Fall,2025January").split(",")

UPSTREAM = "https://go.apis.huit.harvard.edu/ats/course/v2/search"
SUPABASE_UPSERT = f"{SUPABASE_URL}/rest/v1/course_sections"

DAY_MAP = {
    "M": "MON", "MON": "MON", "MONDAY": "MON",
    "T": "TUE", "TU": "TUE", "TUE": "TUE", "TUES": "TUE", "TUESDAY": "TUE",
    "W": "WED", "WED": "WED", "WEDNESDAY": "WED",
    "R": "THU", "TH": "THU", "THU": "THU", "THUR": "THU", "THURS": "THU", "THURSDAY": "THU",
    "F": "FRI", "FRI": "FRI", "FRIDAY": "FRI",
    "S": "SAT", "SA": "SAT", "SAT": "SAT", "SATURDAY": "SAT",
    "SU": "SUN", "SUN": "SUN", "SUNDAY": "SUN",
}

def norm_day(d):
    return DAY_MAP.get(str(d).strip().upper(), str(d).strip().upper())

def norm_time(t):
    """Normalise time strings to HH:MM format."""
    if not t:
        return None
    t = str(t).strip()
    # Handle "HH:MM:SS" or "HH:MM"
    parts = t.split(":")
    if len(parts) >= 2:
        return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
    return t

def parse_sections(raw_course):
    """Extract normalised section rows from a raw Harvard API course object."""
    sections = (
        raw_course.get("sections")
        or raw_course.get("classes")
        or raw_course.get("meetings")
        or []
    )
    rows = []
    for sec in sections:
        sec_type = sec.get("type") or sec.get("component") or "LEC"
        sec_id   = str(sec.get("sectionId") or sec.get("classNumber") or sec.get("id") or "")
        raw_meetings = (
            sec.get("meetings")
            or sec.get("schedule")
            or []
        )
        meetings = []
        for m in raw_meetings:
            day   = norm_day(m.get("day") or m.get("meetingDay") or "")
            start = norm_time(m.get("startTime") or m.get("meetingStartTime"))
            end   = norm_time(m.get("endTime") or m.get("meetingEndTime"))
            loc   = (m.get("location") or m.get("room") or "").strip()
            if day and start:
                meetings.append({"day": day, "start": start, "end": end, "location": loc})
        rows.append({
            "section_id":   sec_id,
            "section_type": sec_type.upper(),
            "meetings":     meetings,
        })
    # If no sections, create a single placeholder so we still record the course
    if not rows:
        rows.append({"section_id": "", "section_type": "LEC", "meetings": []})
    return rows

def build_code_base(subject, catalog):
    """Build course_code_base like 'API-101'."""
    subject  = str(subject or "").strip()
    catalog  = str(catalog or "").strip()
    if subject and catalog:
        return f"{subject}-{catalog}".replace(" ", "")
    return (subject or catalog or "").replace(" ", "")

def fetch_term(term):
    """Fetch all courses for a given term from the Harvard API (paginated)."""
    headers = {
        "x-api-key": HARVARD_API_KEY,
        "Accept": "application/json",
        "User-Agent": "HKS-Course-Explorer/2.0",
    }
    offset = 0
    all_courses = []
    print(f"  Fetching term={term} …", end="", flush=True)
    while True:
        params = {
            "school": SCHOOL,
            "term":   term,
            "limit":  PAGE_SIZE,
            "offset": offset,
        }
        resp = requests.get(UPSTREAM, headers=headers, params=params, timeout=30)
        if resp.status_code == 404:
            print(f" no courses (404)")
            return []
        resp.raise_for_status()
        data = resp.json()
        items = (
            data.get("results")
            or data.get("courses")
            or (data if isinstance(data, list) else [])
        )
        if not items:
            break
        all_courses.extend(items)
        print(f" {len(all_courses)}", end="", flush=True)
        if len(items) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        time.sleep(0.25)  # be polite to the API
    print(f" → {len(all_courses)} total")
    return all_courses

def courses_to_rows(raw_courses, term):
    """Convert raw Harvard API courses to course_sections rows."""
    rows = []
    fetched_at = datetime.now(timezone.utc).isoformat()
    for c in raw_courses:
        subject  = c.get("subject") or c.get("subjectCode") or ""
        catalog  = c.get("catalogNumber") or c.get("courseNumber") or ""
        code_base = build_code_base(subject, catalog)
        if not code_base:
            continue
        code     = f"{subject}-{catalog}".replace(" ", "") if subject and catalog else code_base
        title    = c.get("title") or c.get("courseTitle") or ""
        credits  = c.get("units") or c.get("credits")
        harvard_id = str(c.get("id") or c.get("classNumber") or c.get("courseId") or "")
        instructors = [
            i.get("displayName") or i.get("name") or f"{i.get('firstName','')} {i.get('lastName','')}".strip()
            for i in (c.get("instructors") or c.get("staff") or [])
            if (i.get("displayName") or i.get("name") or i.get("firstName") or i.get("lastName"))
        ]
        for sec in parse_sections(c):
            row_id = f"{code_base}__{term}__{sec['section_type']}"
            if sec["section_id"]:
                row_id += f"__{sec['section_id']}"
            rows.append({
                "id":               row_id,
                "course_code_base": code_base,
                "course_code":      code,
                "term":             term,
                "harvard_id":       harvard_id,
                "section_type":     sec["section_type"],
                "title":            title,
                "credits":          float(credits) if credits is not None else None,
                "instructors":      instructors,
                "meetings":         sec["meetings"],
                "is_active":        True,
                "raw":              c,
                "fetched_at":       fetched_at,
            })
    return rows

def upsert_rows(rows, batch_size=200):
    """Upsert rows to Supabase course_sections in batches."""
    headers = {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates,return=minimal",
    }
    total = 0
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        resp = requests.post(SUPABASE_UPSERT, headers=headers, json=batch, timeout=30)
        if not resp.ok:
            print(f"  ⚠ Upsert error {resp.status_code}: {resp.text[:200]}")
        else:
            total += len(batch)
        time.sleep(0.05)
    return total

def main():
    print(f"Harvard Sections Fetch — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"School: {SCHOOL}  Terms: {', '.join(TERMS)}")
    print()

    grand_total = 0
    for term in TERMS:
        term = term.strip()
        if not term:
            continue
        print(f"─── {term} ───")
        raw = fetch_term(term)
        if not raw:
            print(f"  Skipped (no data)\n")
            continue
        rows = courses_to_rows(raw, term)
        print(f"  Parsed → {len(rows)} section rows")
        upserted = upsert_rows(rows)
        print(f"  Upserted {upserted} rows to Supabase\n")
        grand_total += upserted

    print(f"✓ Done — {grand_total} total rows upserted")

if __name__ == "__main__":
    main()
