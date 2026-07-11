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
    SUPABASE_URL      – https://your-project-ref.supabase.co
    SUPABASE_KEY      – service_role / secret key (not anon)
"""

import os
import sys
import re
import time
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

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

API_PAGE_SIZE = 1000  # Harvard ATS Course API documented maximum page size
MAX_PAGES_PER_QUERY = 1000  # Fail closed if the provider's scroll cursor loops
WORKERS      = 3     # Low parallelism to avoid 429s
REQUEST_DELAY = 0.2  # seconds between requests per worker
HTTP_MAX_ATTEMPTS = 3
RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}

# A sync can safely add/update records after every planned source request has
# succeeded.  It cannot, however, prove that an upstream search returned the
# entire catalogue: a valid HTTP 200 with a truncated result set is
# indistinguishable from a complete response without a documented upstream
# completeness contract.  Retain historical rows by default instead of
# risking destructive cleanup.  Operators may enable cleanup only after
# verifying their API coverage and database `synced_at` trigger.
ALLOW_STALE_DELETION = os.environ.get("SYNC_ALLOW_STALE_DELETE", "false").lower() == "true"
MIN_UNIQUE_COURSES = int(os.environ.get("SYNC_MIN_UNIQUE_COURSES", "1"))


@dataclass
class FetchResult:
    """Outcome for one school/query fetch; success is independent of row count."""
    school: str
    query: str
    rows: list[dict]
    success: bool
    error: str = ""


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


# ── Sync safety helpers ───────────────────────────────────────────────────────

def _valid_scroll_url(value: object) -> bool:
    """Accept only provider-issued HTTPS scroll URLs before sending the API key."""
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    base = urlparse(HARVARD_API_BASE)
    return (
        parsed.scheme == "https"
        and parsed.netloc == base.netloc
        and parsed.path.startswith("/ats/course/v2/search/scroll/")
    )


def _decode_course_page(raw: object) -> tuple[list[dict], str | None]:
    """Extract one documented Course API page and its optional next cursor."""
    if isinstance(raw, list):
        return raw, None
    if not isinstance(raw, dict):
        raise ValueError("response was not a JSON object or list")
    items = raw.get("results") or raw.get("courses") or []
    if not isinstance(items, list):
        raise ValueError("response did not contain a course list")
    next_url = raw.get("next")
    if next_url in (None, ""):
        return items, None
    if not _valid_scroll_url(next_url):
        raise ValueError("response contained an invalid Harvard scroll URL")
    return items, next_url


def _fetch_course_page(
    session: requests.Session,
    url: str,
    *,
    params: dict | None,
    school: str,
    query: str,
) -> tuple[list[dict] | None, str | None, str]:
    """Fetch and decode one page with bounded retries."""
    headers = {
        "x-api-key": HARVARD_API_KEY,
        "Accept": "application/json",
        "User-Agent": "HKS-Course-Explorer-Sync/1.0",
    }
    last_error = "unknown error"
    for attempt in range(HTTP_MAX_ATTEMPTS):
        try:
            response = session.get(url, params=params, timeout=25, headers=headers)
            if response.ok:
                items, next_url = _decode_course_page(response.json())
                return items, next_url, ""

            last_error = f"HTTP {response.status_code}"
            if response.status_code not in RETRYABLE_STATUS_CODES:
                break
        except (requests.RequestException, ValueError) as exc:
            last_error = str(exc)

        if attempt < HTTP_MAX_ATTEMPTS - 1:
            delay = min(5, 2 ** attempt)
            log.warning("  %s q=%-6s failed (%s); retrying in %ss (%d/%d)", school, query, last_error, delay, attempt + 1, HTTP_MAX_ATTEMPTS)
            time.sleep(delay)

    return None, None, last_error


def fetch_school(school: str, query: str, session: requests.Session) -> FetchResult:
    """Fetch every documented scroll page for one school/query safely.

    A failed or malformed page must never look like an empty result: main
    aborts before any writes or stale-row deletion if even one source request
    is incomplete.
    """
    time.sleep(REQUEST_DELAY)
    params = {
        "q": query,
        "catalogSchool": school,
        "size": API_PAGE_SIZE,
        "scroll": "true",
    }
    page_url = HARVARD_API_BASE
    seen_scroll_urls = set()
    raw_rows: list[dict] = []

    for page_number in range(1, MAX_PAGES_PER_QUERY + 1):
        items, next_url, error = _fetch_course_page(
            session,
            page_url,
            params=params,
            school=school,
            query=query,
        )
        if items is None:
            log.error(
                "  %s q=%-6s page %d failed after %d attempts: %s",
                school,
                query,
                page_number,
                HTTP_MAX_ATTEMPTS,
                error,
            )
            return FetchResult(school, query, [], False, error)

        raw_rows.extend(items)
        if not next_url:
            return FetchResult(school, query, [normalise_course(course, school) for course in raw_rows], True)
        if next_url in seen_scroll_urls:
            return FetchResult(school, query, [], False, "Harvard scroll cursor loop detected")

        seen_scroll_urls.add(next_url)
        page_url = next_url
        params = None
        time.sleep(REQUEST_DELAY)

    return FetchResult(
        school,
        query,
        [],
        False,
        f"Harvard pagination exceeded {MAX_PAGES_PER_QUERY} pages",
    )
# ── Supabase helpers ──────────────────────────────────────────────────────────

def _sb_headers():
    return {
        "apikey":        SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type":  "application/json",
        "Prefer":        "resolution=merge-duplicates",
    }


def supabase_upsert(rows: list[dict]) -> None:
    """Apply the complete fetched catalogue in one database transaction.

    The service-only RPC validates the payload and executes its upsert inside
    Postgres. Unlike REST batches, a database failure cannot expose a partly
    refreshed catalogue to the website.
    """
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/rpc/sync_live_courses_atomically",
        headers=_sb_headers(),
        json={"p_rows": rows},
        timeout=120,
    )
    if not response.ok:
        raise RuntimeError(f"Atomic live-course sync failed: HTTP {response.status_code} {response.text[:400]}")

    try:
        updated_rows = response.json()
    except ValueError as exc:
        raise RuntimeError("Atomic live-course sync returned invalid JSON.") from exc
    if updated_rows != len(rows):
        raise RuntimeError(
            f"Atomic live-course sync reported {updated_rows!r} rows; expected {len(rows)}."
        )
    log.info("  atomically upserted %d rows", updated_rows)


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

    all_rows: dict[str, dict] = {}  # id → row

    failures: list[FetchResult] = []
    tasks = [(school, q) for school in ALL_SCHOOLS for q in SEED_QUERIES]
    log.info("Total API calls planned: %d", len(tasks))

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        futures = {
            # requests.Session is not documented as thread-safe; use an
            # isolated session per request rather than sharing connection state.
            pool.submit(fetch_school, school, q, requests.Session()): (school, q)
            for school, q in tasks
        }
        for fut in as_completed(futures):
            school, q = futures[fut]
            try:
                result = fut.result()
            except Exception as exc:
                result = FetchResult(school, q, [], False, f"worker crashed: {exc}")
            if not result.success:
                failures.append(result)
                continue
            rows = result.rows
            new = 0
            for row in rows:
                if row["id"] not in all_rows:
                    all_rows[row["id"]] = row
                    new += 1
            log.info("  %-6s q=%-6s → %d returned, %d new (total unique: %d)",
                     school, q, len(rows), new, len(all_rows))

    if failures:
        failed_calls = ", ".join(f"{result.school}/{result.query} ({result.error})" for result in failures)
        log.error("Aborting sync: %d of %d Harvard requests failed. No Supabase writes or stale-row deletion will run. Failed calls: %s", len(failures), len(tasks), failed_calls)
        sys.exit(1)

    if len(all_rows) < MIN_UNIQUE_COURSES:
        log.error(
            "Only %d unique courses were fetched (minimum required: %d) — aborting to protect existing data",
            len(all_rows),
            MIN_UNIQUE_COURSES,
        )
        sys.exit(1)

    rows_list = list(all_rows.values())
    terms = sorted({r["term"] for r in rows_list if r["term"]})
    log.info("Upserting %d unique courses (terms: %s)…", len(rows_list), terms)
    supabase_upsert(rows_list)

    if ALLOW_STALE_DELETION:
        log.warning(
            "SYNC_ALLOW_STALE_DELETE=true: removing rows not refreshed in this run. "
            "This requires verified complete upstream coverage and a working synced_at database trigger."
        )
        supabase_delete_stale(sync_start)
    else:
        log.info(
            "Stale-row deletion is disabled. Set SYNC_ALLOW_STALE_DELETE=true only after "
            "verifying complete upstream coverage and the live_courses synced_at trigger."
        )
    log.info("Done. %d courses in live_courses.", len(rows_list))


if __name__ == "__main__":
    main()
