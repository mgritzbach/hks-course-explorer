"""
fetch_harvard_sections.py
─────────────────────────
Fetches HKS course section + meeting-time data from the Harvard ATS Course v2 API
and upserts it into the Supabase `course_sections` table.

Usage:
    python scripts/fetch_harvard_sections.py

Required env vars:
    HARVARD_API_KEY   — from the Harvard Developer Portal (x-api-key header)
    SUPABASE_URL      — e.g. https://cbtroatixvydpwoviezf.supabase.co
    SUPABASE_KEY      — service-role key (full write access)

Key discovery: use catalogSchool=HKS (not school=HKS).
The API returns up to 50 courses per request; offset is ignored so we
fetch once per subject to maximise coverage.
"""

import os
import sys
import time
import requests
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────
HARVARD_API_KEY = os.environ["HARVARD_API_KEY"]
SUPABASE_URL    = os.environ["SUPABASE_URL"]
SUPABASE_KEY    = os.environ["SUPABASE_KEY"]

UPSTREAM        = "https://go.apis.huit.harvard.edu/ats/course/v2/search"
SUPABASE_UPSERT = f"{SUPABASE_URL}/rest/v1/course_sections"

# HKS subject codes — fetch each separately to maximise coverage
HKS_SUBJECTS = [
    "API", "DPI", "IGA", "MPA", "HLS", "SUP", "BGP", "DEV",
    "PAL", "SCI", "STK", "HKS",
]

DAY_ABBREV = {
    "monday": "MON", "tuesday": "TUE", "wednesday": "WED",
    "thursday": "THU", "friday": "FRI", "saturday": "SAT", "sunday": "SUN",
    "mon": "MON", "tue": "TUE", "wed": "WED", "thu": "THU",
    "fri": "FRI", "sat": "SAT", "sun": "SUN",
}

def parse_meetings(raw_meetings):
    """
    Parse the Harvard API meetings field into our normalised format.
    raw_meetings is either:
      - a string "TBA" / ""
      - a dict  { daysOfWeek: [...], startTime, endTime, location, startDate, endDate }
      - a list  [ { ...same... } ]
    Returns list of { day, start, end, location } or [].
    """
    if not raw_meetings or raw_meetings == "TBA":
        return []

    items = raw_meetings if isinstance(raw_meetings, list) else [raw_meetings]
    result = []
    for m in items:
        if not isinstance(m, dict):
            continue
        days     = m.get("daysOfWeek") or []
        start    = norm_time(m.get("startTime") or "")
        end      = norm_time(m.get("endTime") or "")
        location = (m.get("location") or "").strip()
        for day_raw in days:
            day = DAY_ABBREV.get(str(day_raw).lower())
            if day and start:
                result.append({"day": day, "start": start, "end": end, "location": location})
    return result

def norm_time(t):
    """Convert '10:30am' / '2:00pm' to 'HH:MM'."""
    if not t:
        return None
    t = str(t).strip().lower()
    import re
    m = re.match(r'^(\d{1,2}):(\d{2})\s*(am|pm)?$', t)
    if not m:
        return t
    h, mn, ampm = int(m.group(1)), int(m.group(2)), m.group(3)
    if ampm == 'am' and h == 12: h = 0
    if ampm == 'pm' and h != 12: h += 12
    return f"{h:02d}:{mn:02d}"

def build_code_base(course_number):
    """'API 101' → 'API-101', 'DPI 100A' → 'DPI-100A'"""
    if not course_number:
        return ""
    parts = str(course_number).strip().split()
    if len(parts) >= 2:
        return f"{parts[0]}-{parts[1]}".upper()
    return parts[0].upper()

def fetch_subject(subject):
    """Fetch all courses for a given HKS subject."""
    headers = {
        "x-api-key":  HARVARD_API_KEY,
        "Accept":     "application/json",
        "User-Agent": "HKS-Course-Explorer/2.0",
    }
    params = {
        "catalogSchool": "HKS",
        "subject":       subject,
        "limit":         50,
    }
    try:
        resp = requests.get(UPSTREAM, headers=headers, params=params, timeout=30)
        if resp.status_code == 404:
            return []
        resp.raise_for_status()
        data = resp.json()
        items = data.get("results") or data.get("courses") or (data if isinstance(data, list) else [])
        return items
    except Exception as e:
        print(f"    Warning: {e}")
        return []

def courses_to_rows(raw_courses):
    """Convert raw Harvard API courses to course_sections rows."""
    rows = []
    fetched_at = datetime.now(timezone.utc).isoformat()
    seen_ids = set()

    for c in raw_courses:
        course_number = str(c.get("courseNumber") or "").strip()
        code_base = build_code_base(course_number)
        if not code_base:
            continue

        # Derive term label from termDescription e.g. "2025 Fall" -> "2025Fall"
        term_desc = str(c.get("termDescription") or "")
        term = term_desc.replace(" ", "") if term_desc else str(c.get("term") or "")

        title       = str(c.get("courseTitle") or "").strip()
        harvard_id  = str(c.get("courseID") or c.get("classNumber") or "")
        credits_min = c.get("classMinUnits")
        credits_max = c.get("classMaxUnits")
        credits     = credits_min or credits_max

        instructors = [
            str(i.get("instructorName") or "").strip()
            for i in (c.get("publishedInstructors") or [])
            if i.get("instructorName")
        ]

        meetings = parse_meetings(c.get("meetings"))

        row_id = f"{code_base}__{term}"
        if row_id in seen_ids:
            # de-duplicate — merge meetings
            for row in rows:
                if row["id"] == row_id:
                    existing = {(m["day"], m["start"]) for m in row["meetings"]}
                    for m in meetings:
                        if (m["day"], m["start"]) not in existing:
                            row["meetings"].append(m)
            continue
        seen_ids.add(row_id)

        rows.append({
            "id":               row_id,
            "course_code_base": code_base,
            "course_code":      course_number.replace(" ", "-"),
            "term":             term,
            "harvard_id":       harvard_id,
            "section_type":     "LEC",
            "title":            title,
            "credits":          float(credits) if credits else None,
            "instructors":      instructors,
            "meetings":         meetings,
            "is_active":        True,
            "raw":              c,
            "fetched_at":       fetched_at,
        })
    return rows

def upsert_rows(rows, batch_size=100):
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
            print(f"  Warning: Upsert {resp.status_code}: {resp.text[:300]}")
        else:
            total += len(batch)
        time.sleep(0.05)
    return total

def main():
    print(f"Harvard Sections Fetch -- {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    print(f"Fetching HKS courses by subject: {', '.join(HKS_SUBJECTS)}")
    print()

    all_rows = []
    seen_codes = set()

    for subject in HKS_SUBJECTS:
        print(f"  Subject {subject} ...", end="", flush=True)
        raw = fetch_subject(subject)
        print(f" {len(raw)} courses", end="")
        rows = courses_to_rows(raw)
        # de-dup across subjects
        new_rows = [r for r in rows if r["id"] not in seen_codes]
        seen_codes.update(r["id"] for r in new_rows)
        all_rows.extend(new_rows)
        has_times = sum(1 for r in new_rows if r["meetings"])
        print(f" -> {len(new_rows)} unique rows, {has_times} with meeting times")
        time.sleep(0.3)

    print(f"\nTotal: {len(all_rows)} rows")
    with_times = sum(1 for r in all_rows if r["meetings"])
    print(f"  With meeting times: {with_times}")
    print(f"  TBA / no times:    {len(all_rows) - with_times}")

    if all_rows:
        print(f"\nUpserting to Supabase ...")
        upserted = upsert_rows(all_rows)
        print(f"Done -- {upserted} rows upserted to course_sections")
    else:
        print("Nothing to upsert.")

if __name__ == "__main__":
    main()
