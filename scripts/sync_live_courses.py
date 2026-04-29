"""
sync_live_courses.py
====================
Fetches current course offerings from the Harvard ATS API for ALL schools
and upserts them into the Supabase `live_courses` table.

Run manually:
    python scripts/sync_live_courses.py

Or via GitHub Actions (see .github/workflows/sync-live-courses.yml).

Required env vars:
    HARVARD_API_KEY   – Harvard ATS API key
    SUPABASE_URL      – https://cbtroatixvydpwoviezf.supabase.co
    SUPABASE_KEY      – service_role / secret key (not anon)
"""

import os
import sys
import re
import time
import logging
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed

import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

HARVARD_API_BASE = "https://go.apis.huit.harvard.edu/ats/course/v2/search"
SUPABASE_URL     = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY     = os.environ["SUPABASE_KEY"]
HARVARD_API_KEY  = os.environ["HARVARD_API_KEY"]

ALL_SCHOOLS = [
    "FAS", "GSAS", "GSD", "HBSD", "HBSM",
    "HDS", "HGSE", "HKS", "HLS", "HMS",
    "HSDM", "HSPH", "NONH",
]
HKS_SCHOOL = "HKS"

# Seed queries — broad enough to cover most course titles/codes.
# No term filter: we let the API return whatever is currently active,
# then read the term field from each returned course.
SEED_QUERIES = ["a", "e", "i", "o", "s", "the", "pol", "eco", "law", "med"]

API_LIMIT    = 50    # Harvard ATS API max per request
BATCH_SIZE   = 500   # Supabase upsert batch size
WORKERS      = 3     # Low parallelism to avoid 429s
REQUEST_DELAY = 0.2  # seconds between requests per worker


# ── Harvard API helpers ───────────────────────────────────────────────────────

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


def normalise_course(c: dict, school: str) -> dict:
    course_num = str(c.get("courseNumber") or c.get("catalog") or "").strip()
    parts      = course_num.split() if course_num else []
    subject    = str(c.get("catalogSubject") or c.get("subject") or (parts[0] if parts else "")).strip()
    catalog    = str(c.get("classCatalogNumber") or c.get("catalogNumber") or (parts[1] if len(parts) > 1 else "")).strip()

    code_base = f"{subject}-{catalog}" if subject and catalog else course_num.replace(" ", "-")
    meetings  = parse_meetings(c.get("meetings") or c.get("sections") or c.get("classes"))
    all_days  = "/".join(dict.fromkeys(m["day"] for m in meetings))

    instructors = [
        str(i.get("instructorName") or i.get("displayName") or i.get("name") or
            f"{i.get('firstName', '')} {i.get('lastName', '')}".strip())
        for i in (c.get("publishedInstructors") or c.get("instructors") or [])
    ]
    instructors = [x for x in instructors if x]

    harvard_id = str(c.get("courseID") or c.get("id") or c.get("classNumber") or "")
    term       = str(c.get("termDescription") or c.get("term") or "")

    return {
        "id":                  harvard_id or code_base,
        "course_code":         code_base,
        "course_code_base":    code_base,
        "title":               str(c.get("courseTitle") or c.get("title") or ""),
        "term":                term,
        "credits":             c.get("classMinUnits") or c.get("units"),
        "instructors":         instructors,
        "description":         str(c.get("courseDescription") or c.get("description") or ""),
        "location":            meetings[0]["location"] if meetings else "",
        "meeting_days":        all_days,
        "time_start":          meetings[0]["start"] if meetings else "",
        "time_end":            meetings[0]["end"]   if meetings else "",
        "school":              school,
        "is_hks":              school == HKS_SCHOOL,
        "session_code":        str(c.get("sessionCode") or ""),
        "session_description": str(c.get("sessionDescription") or ""),
        "cross_reg_eligible":  str(c.get("crossRegistrationEligibleAttribute") or ""),
    }


def fetch_school(school: str, query: str, session: requests.Session) -> list[dict]:
    """Fetch courses for one school + seed query. No term filter — API returns active courses."""
    time.sleep(REQUEST_DELAY)
    params = {
        "q":             query,
        "catalogSchool": school,
        "limit":         API_LIMIT,
    }
    try:
        resp = session.get(
            HARVARD_API_BASE, params=params, timeout=25,
            headers={
                "x-api-key":  HARVARD_API_KEY,
                "Accept":     "application/json",
                "User-Agent": "HKS-Course-Explorer-Sync/1.0",
            }
        )
        if resp.status_code == 429:
            log.warning("  %s q=%-6s → 429 rate-limited, retrying after 5s", school, query)
            time.sleep(5)
            resp = session.get(HARVARD_API_BASE, params=params, timeout=25,
                               headers={"x-api-key": HARVARD_API_KEY, "Accept": "application/json"})
        if not resp.ok:
            log.warning("  %s q=%-6s → HTTP %s", school, query, resp.status_code)
            return []
        raw   = resp.json()
        items = raw.get("results") or raw.get("courses") or (raw if isinstance(raw, list) else [])
        return [normalise_course(c, school) for c in items]
    except Exception as exc:
        log.warning("  %s q=%-6s → %s", school, query, exc)
        return []


# ── Supabase helpers ──────────────────────────────────────────────────────────

def _sb_headers():
    return {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates",
    }


def supabase_upsert(rows: list[dict]) -> None:
    url = f"{SUPABASE_URL}/rest/v1/live_courses"
    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        resp  = requests.post(url, headers=_sb_headers(), json=batch, timeout=30)
        if not resp.ok:
            log.error("Supabase upsert failed: %s %s", resp.status_code, resp.text[:400])
            sys.exit(1)
        log.info("  upserted rows %d–%d", i + 1, i + len(batch))


def supabase_delete_stale(synced_before: str) -> None:
    """Delete rows NOT updated in this run (dropped / expired courses)."""
    headers = {**_sb_headers(), "Prefer": ""}
    resp = requests.delete(
        f"{SUPABASE_URL}/rest/v1/live_courses",
        headers=headers,
        params={"synced_at": f"lt.{synced_before}"},
        timeout=30,
    )
    if resp.ok:
        log.info("Removed stale rows (synced_at < %s)", synced_before)
    else:
        log.warning("Stale-row cleanup failed: %s %s", resp.status_code, resp.text[:200])


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    sync_start = datetime.now(timezone.utc).isoformat()
    log.info("Sync started at %s", sync_start)
    log.info("Schools: %s", ALL_SCHOOLS)
    log.info("Seed queries: %s  Workers: %d", SEED_QUERIES, WORKERS)

    session   = requests.Session()
    all_rows: dict[str, dict] = {}  # id → row

    tasks = [(school, q) for school in ALL_SCHOOLS for q in SEED_QUERIES]
    log.info("Total API calls planned: %d", len(tasks))

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            pool.submit(fetch_school, school, q, session): (school, q)
            for school, q in tasks
        }
        for fut in as_completed(futures):
            school, q = futures[fut]
            rows = fut.result()
            new = 0
            for row in rows:
                if row["id"] not in all_rows:
                    all_rows[row["id"]] = row
                    new += 1
            log.info("  %-6s q=%-6s → %d returned, %d new (total unique: %d)",
                     school, q, len(rows), new, len(all_rows))

    if not all_rows:
        log.error("No courses fetched from any school — aborting to protect existing data")
        sys.exit(1)

    rows_list = list(all_rows.values())
    terms = sorted({r["term"] for r in rows_list if r["term"]})
    log.info("Upserting %d unique courses (terms: %s)…", len(rows_list), terms)
    supabase_upsert(rows_list)

    supabase_delete_stale(sync_start)
    log.info("Done. %d courses in live_courses.", len(rows_list))


if __name__ == "__main__":
    main()
