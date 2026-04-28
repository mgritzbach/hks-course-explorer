"""
sync_live_courses.py
====================
Fetches the current semester's course offerings from the Harvard ATS API
for ALL schools and upserts them into the Supabase `live_courses` table.

Run manually:
    python scripts/sync_live_courses.py

Or via GitHub Actions (see .github/workflows/sync-live-courses.yml).

Required env vars:
    HARVARD_API_KEY   – Harvard ATS API key
    SUPABASE_URL      – https://cbtroatixvydpwoviezf.supabase.co
    SUPABASE_KEY      – service_role key (not anon)

Optional:
    TERM              – e.g. "2026Spring" (defaults to current/next semester)
"""

import os
import sys
import time
import json
import re
import logging
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

HARVARD_API_BASE = "https://go.apis.huit.harvard.edu/ats/course/v2/search"
SUPABASE_URL     = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY     = os.environ["SUPABASE_KEY"]
HARVARD_API_KEY  = os.environ["HARVARD_API_KEY"]

# All valid catalogSchool values per Harvard ATS API docs
ALL_SCHOOLS = [
    "FAS", "GSAS", "GSD", "HBSD", "HBSM",
    "HDS", "HGSE", "HKS", "HLS", "HMS",
    "HSDM", "HSPH", "NONH",
]
HKS_SCHOOL = "HKS"

# The proxy uses 'a' as a broad seed — we use common letters to get broad coverage
SEED_QUERIES = ["a", "e", "i", "o", "the", "in", "pol", "eco"]

BATCH_SIZE   = 500   # Supabase upsert batch size
API_LIMIT    = 50    # Harvard API max per request
WORKERS      = 6     # parallel school fetches


def current_term() -> str:
    """Return the upcoming/current term string, e.g. '2026Spring'."""
    if "TERM" in os.environ:
        return os.environ["TERM"]
    now = datetime.utcnow()
    year = now.year
    month = now.month
    if month <= 5:
        return f"{year}Spring"
    elif month <= 8:
        return f"{year}Fall"
    else:
        return f"{year + 1}Spring"


# ── Harvard API helpers ────────────────────────────────────────────────────────

DAY_MAP = {
    "M": "MON", "MON": "MON", "MONDAY": "MON",
    "T": "TUE", "TUE": "TUE", "TUESDAY": "TUE",
    "W": "WED", "WED": "WED", "WEDNESDAY": "WED",
    "R": "THU", "TH": "THU", "THU": "THU", "THURSDAY": "THU",
    "F": "FRI", "FRI": "FRI", "FRIDAY": "FRI",
    "S": "SAT", "SA": "SAT", "SAT": "SAT", "SATURDAY": "SAT",
    "SU": "SUN", "SUN": "SUN", "SUNDAY": "SUN",
}


def norm_day(d: str) -> str:
    return DAY_MAP.get(str(d).upper().strip(), str(d).upper().strip())


def norm_time(t: str) -> str:
    if not t:
        return ""
    s = str(t).strip().lower()
    m = re.match(r"^(\d{1,2}):(\d{2})\s*(am|pm)?$", s)
    if not m:
        return s
    h, mn = int(m.group(1)), int(m.group(2))
    if m.group(3) == "am" and h == 12:
        h = 0
    if m.group(3) == "pm" and h != 12:
        h += 12
    return f"{h:02d}:{mn:02d}"


def parse_meetings(raw):
    """Return list of {day, start, end, location} from API meetings field."""
    if not raw or raw == "TBA":
        return []
    items = raw if isinstance(raw, list) else [raw]
    result = []
    for m in items:
        if not isinstance(m, dict):
            continue
        days = m.get("daysOfWeek", [])
        start = norm_time(m.get("startTime") or m.get("start", ""))
        end   = norm_time(m.get("endTime")   or m.get("end",   ""))
        loc   = (m.get("location") or "").strip()
        for day in days:
            d = norm_day(day)
            if d and start:
                result.append({"day": d, "start": start, "end": end, "location": loc})
        if not days and (m.get("day") or m.get("meetingDay")):
            d = norm_day(m.get("day") or m.get("meetingDay") or "")
            s = norm_time(m.get("startTime") or m.get("start", ""))
            if d and s:
                result.append({"day": d, "start": s,
                                "end": norm_time(m.get("endTime") or m.get("end", "")),
                                "location": loc})
    return result


def normalise_course(c: dict, school: str, term: str) -> dict:
    """Convert raw Harvard API course object → live_courses row."""
    course_num = str(c.get("courseNumber") or c.get("catalog") or "").strip()
    subject    = str(c.get("catalogSubject") or c.get("subject") or course_num.split()[0] if course_num.split() else "").strip()
    catalog    = str(c.get("classCatalogNumber") or c.get("catalogNumber") or (course_num.split()[1] if len(course_num.split()) > 1 else "")).strip()

    if subject and catalog:
        code_base = f"{subject}-{catalog}"
        code_full = code_base
    else:
        code_base = course_num.replace(" ", "-")
        code_full = code_base

    meetings = parse_meetings(c.get("meetings") or c.get("sections") or c.get("classes"))
    all_days = "/".join(dict.fromkeys(m["day"] for m in meetings))  # deduplicated, insertion-ordered

    instructors = [
        str(i.get("instructorName") or i.get("displayName") or i.get("name") or
            f"{i.get('firstName', '')} {i.get('lastName', '')}".strip())
        for i in (c.get("publishedInstructors") or c.get("instructors") or [])
    ]
    instructors = [x for x in instructors if x]

    harvard_id = str(c.get("courseID") or c.get("id") or c.get("classNumber") or "")

    return {
        "id":              harvard_id or code_full,
        "course_code":     code_full,
        "course_code_base": code_base,
        "title":           str(c.get("courseTitle") or c.get("title") or ""),
        "term":            str(c.get("termDescription") or c.get("term") or term),
        "credits":         c.get("classMinUnits") or c.get("units"),
        "instructors":     instructors,
        "description":     str(c.get("courseDescription") or c.get("description") or ""),
        "location":        meetings[0]["location"] if meetings else "",
        "meeting_days":    all_days,
        "time_start":      meetings[0]["start"] if meetings else "",
        "time_end":        meetings[0]["end"]   if meetings else "",
        "school":          school,
        "is_hks":          school == HKS_SCHOOL,
    }


def fetch_school(school: str, query: str, term: str, session: requests.Session) -> list[dict]:
    """Fetch all courses for one school + query from Harvard ATS API."""
    params = {
        "q":            query,
        "catalogSchool": school,
        "term":         term,
        "limit":        API_LIMIT,
    }
    try:
        resp = session.get(HARVARD_API_BASE, params=params, timeout=20,
                           headers={"x-api-key": HARVARD_API_KEY,
                                    "Accept": "application/json",
                                    "User-Agent": "HKS-Course-Explorer-Sync/1.0"})
        if not resp.ok:
            log.warning("  %s q=%s → HTTP %s", school, query, resp.status_code)
            return []
        raw = resp.json()
        items = raw.get("results") or raw.get("courses") or (raw if isinstance(raw, list) else [])
        return [normalise_course(c, school, term) for c in items]
    except Exception as exc:
        log.warning("  %s q=%s → %s", school, query, exc)
        return []


# ── Supabase upsert ────────────────────────────────────────────────────────────

def supabase_upsert(rows: list[dict]) -> None:
    """Upsert rows into live_courses in batches."""
    headers = {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates",
    }
    url = f"{SUPABASE_URL}/rest/v1/live_courses"
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i:i + BATCH_SIZE]
        resp = requests.post(url, headers=headers, json=batch, timeout=30)
        if not resp.ok:
            log.error("Supabase upsert failed: %s %s", resp.status_code, resp.text[:400])
            sys.exit(1)
        log.info("  upserted rows %d–%d", i + 1, i + len(batch))


def supabase_delete_stale(term: str, synced_before: str) -> None:
    """Remove rows for this term that were NOT touched in this sync run."""
    headers = {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
    }
    url = f"{SUPABASE_URL}/rest/v1/live_courses"
    params = {
        "term":       f"eq.{term}",
        "synced_at":  f"lt.{synced_before}",
    }
    resp = requests.delete(url, headers=headers, params=params, timeout=30)
    if resp.ok:
        log.info("Removed stale rows for term %s (synced before %s)", term, synced_before)
    else:
        log.warning("Stale-row cleanup failed: %s", resp.text[:200])


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    term = current_term()
    log.info("Syncing term: %s", term)
    log.info("Schools: %s", ALL_SCHOOLS)
    log.info("Seed queries: %s", SEED_QUERIES)

    sync_start = datetime.utcnow().isoformat() + "Z"

    session = requests.Session()
    all_rows: dict[str, dict] = {}   # id → row (deduplication)

    tasks = [(school, q) for school in ALL_SCHOOLS for q in SEED_QUERIES]
    log.info("Total API calls: %d (%d schools × %d queries)", len(tasks), len(ALL_SCHOOLS), len(SEED_QUERIES))

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {pool.submit(fetch_school, school, q, term, session): (school, q)
                   for school, q in tasks}
        for fut in as_completed(futures):
            school, q = futures[fut]
            rows = fut.result()
            for row in rows:
                if row["id"] not in all_rows:
                    all_rows[row["id"]] = row
            log.info("  %s q=%-6s → %d courses (total unique: %d)", school, q, len(rows), len(all_rows))

    if not all_rows:
        log.error("No courses fetched — aborting to avoid wiping the table")
        sys.exit(1)

    rows_list = list(all_rows.values())
    log.info("Upserting %d unique courses to Supabase…", len(rows_list))
    supabase_upsert(rows_list)

    # Clean up rows from this term that weren't refreshed (dropped courses)
    supabase_delete_stale(term, sync_start)

    log.info("Done. %d courses synced for %s.", len(rows_list), term)


if __name__ == "__main__":
    main()
