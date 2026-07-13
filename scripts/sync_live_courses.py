"""
sync_live_courses.py
====================
Fetches current non-HKS course offerings from the Harvard ATS API and upserts
them into the Supabase `live_courses` table.

HKS is intentionally excluded. The public my.harvard catalogue is the
authoritative student-facing HKS source and is promoted separately by
``sync_myharvard_hks.py``. Keeping the source ownership disjoint prevents the
general sync from briefly replacing or duplicating the complete HKS catalogue.

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
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib.parse import urlparse

import requests

try:
    from live_course_reconciliation import classify_live_course_inventory
except ModuleNotFoundError:  # Loaded as a module by repository-root tests.
    from scripts.live_course_reconciliation import classify_live_course_inventory

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)

# ── Config ────────────────────────────────────────────────────────────────────

HARVARD_API_BASE = "https://go.apis.huit.harvard.edu/ats/course/v2/search"
# The public gateway issues cursors from its production API hostname. Both
# exact hosts are documented Harvard endpoints; accept neither arbitrary
# redirects nor look-alike subdomains when following a cursor with the key.
HARVARD_CURSOR_HOSTS = {
    "go.apis.huit.harvard.edu",
    "go.prod.apis.huit.harvard.edu",
}
SUPABASE_URL     = os.environ["SUPABASE_URL"].rstrip("/")
SUPABASE_KEY     = os.environ["SUPABASE_KEY"]
HARVARD_API_KEY  = os.environ["HARVARD_API_KEY"]

GENERAL_SYNC_SCHOOLS = (
    "FAS", "GSAS", "GSD", "HBSD", "HBSM",
    "HDS", "HGSE", "HLS", "HMS",
    "HSDM", "HSPH", "NONH",
)
HKS_SCHOOL = "HKS"

# Seed queries — broad enough to cover most course titles/codes.
# No term filter: we let the API return whatever is currently active,
# then read the term field from each returned course.
SEED_QUERIES = ["a", "e", "i", "o", "s", "the", "pol", "eco", "law", "med"]

# Harvard documents a maximum of 1,000 rows, but broad FAS queries produced
# upstream 502s at that size.  Use a conservative page size with pagination;
# this trades a few cursor requests for a complete, provider-tolerable sync.
API_PAGE_SIZE = 250
MAX_PAGES_PER_QUERY = 1000  # Fail closed if the provider's scroll cursor loops
# A previous three-worker burst hit the provider's 429 limit after partial
# collection. One request per second stays comfortably below that observed
# ceiling while the 15-minute workflow timeout still covers all queries.
WORKERS      = 1
REQUEST_DELAY = 1.0
HTTP_MAX_ATTEMPTS = 5
RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}

# A sync can safely add/update records after every planned source request has
# succeeded. It cannot prove that an upstream search was exhaustive, so this
# workflow never deletes rows. A separately approved, backed-up reconciliation
# is required before any production removal is contemplated.
STALE_DELETE_REQUESTED = os.environ.get("SYNC_ALLOW_STALE_DELETE", "false").lower() == "true"
MIN_UNIQUE_COURSES = int(os.environ.get("SYNC_MIN_UNIQUE_COURSES", "1"))
INVENTORY_PAGE_SIZE = 1000
MAX_INVENTORY_ROWS = 10000


@dataclass
class FetchResult:
    """Outcome for one school/query fetch; success is independent of row count."""
    school: str
    query: str
    rows: list[dict]
    success: bool
    error: str = ""


def summary_label(value: object) -> str:
    """Keep upstream labels to one bounded, single-line Actions-summary value."""
    label = " ".join(str(value or "unknown").split())
    return label[:80] or "unknown"


def build_sync_summary(
    *,
    outcome: str,
    sync_start: str,
    planned_request_count: int,
    rows: list[dict],
    failures: list[FetchResult] | None = None,
    inventory: dict | None = None,
) -> str:
    """Build a non-sensitive daily-sync audit summary for GitHub Actions.

    This is observability only: it records source coverage and the attempted
    outcome without copying course descriptions, API keys, or database
    credentials into the workflow summary.
    """
    rows = rows or []
    failures = failures or []
    by_school = Counter(summary_label(row.get("school")) for row in rows)
    by_term = Counter(summary_label(row.get("term")) for row in rows)
    lines = [
        "## Live-course sync",
        "",
        f"- **Outcome:** {outcome}",
        f"- **Started:** {sync_start}",
        f"- **Planned Harvard requests:** {planned_request_count}",
        f"- **Unique offerings collected:** {len(rows)} (minimum: {MIN_UNIQUE_COURSES})",
        f"- **Failed source requests:** {len(failures)}",
    ]
    if by_school:
        lines.append(
            "- **Offerings by school:** "
            + ", ".join(f"{school}: {count}" for school, count in sorted(by_school.items()))
        )
    if by_term:
        lines.append(
            "- **Offerings by term:** "
            + ", ".join(f"{term}: {count}" for term, count in sorted(by_term.items()))
        )
    if inventory is not None:
        lines.extend(
            [
                f"- **Database rows inventoried after upsert:** {inventory['database_row_count']}",
                f"- **Database rows classified exactly once:** {inventory['classified_row_count']}",
                f"- **Current non-HKS ATS rows:** {inventory['current_non_hks_ats_count']}",
                f"- **Protected active my.harvard rows:** {inventory['protected_active_myharvard_count']}",
                f"- **Protected my.harvard rollback rows:** {inventory['protected_myharvard_rollback_count']}",
                f"- **Protected legacy HKS fallback rows:** {inventory['protected_legacy_hks_fallback_count']}",
                f"- **Actionable retained non-HKS ATS rows:** {inventory['actionable_retained_non_hks_ats_count']}",
                f"- **Actionable queue SHA-256:** `{inventory['actionable_queue_sha256']}`",
                f"- **Current-source rows missing from database:** {inventory['current_source_missing_from_database_count']}",
            ]
        )
        actionable_by_state = inventory["actionable_by_active_state"]
        actionable_by_age = inventory["actionable_by_age"]
        actionable_by_school = inventory["actionable_by_school"]
        actionable_by_term = inventory["actionable_by_term"]
        if actionable_by_state:
            lines.append(
                "- **Actionable ATS rows by active state:** "
                + ", ".join(
                    f"{summary_label(state)}: {count}"
                    for state, count in actionable_by_state.items()
                )
            )
        if actionable_by_age:
            lines.append(
                "- **Actionable ATS rows by last-seen age:** "
                + ", ".join(
                    f"{summary_label(bucket)}: {count}"
                    for bucket, count in actionable_by_age.items()
                )
            )
        if actionable_by_school:
            lines.append(
                "- **Actionable ATS rows by school:** "
                + ", ".join(
                    f"{summary_label(school)}: {count}"
                    for school, count in actionable_by_school.items()
                )
            )
        if actionable_by_term:
            lines.append(
                "- **Actionable ATS rows by term:** "
                + ", ".join(
                    f"{summary_label(term)}: {count}"
                    for term, count in actionable_by_term.items()
                )
            )
    lines.append("")
    return "\n".join(lines)


def write_github_summary(summary: str) -> None:
    """Append an audit summary when running inside GitHub Actions.

    A summary-write failure must not hide the sync's actual result or cause an
    otherwise complete catalogue promotion to be treated as failed.
    """
    destination = os.environ.get("GITHUB_STEP_SUMMARY", "").strip()
    if not destination:
        return
    try:
        with open(destination, "a", encoding="utf-8") as handle:
            handle.write(summary)
    except OSError as exc:
        log.warning("Could not write GitHub Actions sync summary: %s", exc)


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


def merge_duplicate_course(existing: dict, incoming: dict) -> dict:
    """Merge one Harvard courseID returned by multiple catalog schools.

    The API can return a cross-listed HKS offering under an earlier school too.
    HKS must remain discoverable in that case; missing fields are filled from
    the alternate representation without changing the stable source ID.
    """
    if existing.get("id") != incoming.get("id"):
        raise ValueError("Cannot merge live-course rows with different ids")

    prefer_incoming = bool(incoming.get("is_hks")) and not bool(existing.get("is_hks"))
    preferred, alternate = (incoming, existing) if prefer_incoming else (existing, incoming)
    merged = dict(preferred)
    for key, value in alternate.items():
        if merged.get(key) in (None, "", [], {}) and value not in (None, "", [], {}):
            merged[key] = value

    if existing.get("is_hks") or incoming.get("is_hks"):
        merged["is_hks"] = True
        merged["school"] = HKS_SCHOOL
    return merged


# ── Sync safety helpers ───────────────────────────────────────────────────────

def _valid_scroll_url(value: object) -> bool:
    """Accept only provider-issued HTTPS scroll URLs before sending the API key."""
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return (
        parsed.scheme == "https"
        and parsed.netloc in HARVARD_CURSOR_HOSTS
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
            response = session.get(
                url,
                params=params,
                timeout=25,
                headers=headers,
                allow_redirects=False,
            )
            if response.is_redirect is True:
                last_error = "unexpected redirect from Harvard API"
                break
            if response.ok:
                items, next_url = _decode_course_page(response.json())
                return items, next_url, ""

            last_error = f"HTTP {response.status_code}"
            if response.status_code not in RETRYABLE_STATUS_CODES:
                break
        except (requests.RequestException, ValueError) as exc:
            last_error = str(exc)

        if attempt < HTTP_MAX_ATTEMPTS - 1:
            delay = min(30, 2 ** attempt)
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


def _sb_read_headers():
    """Return service-only headers for an inventory read, never a write."""
    return {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Accept": "application/json",
        "Prefer": "count=exact",
    }


_CONTENT_RANGE_RE = re.compile(r"^(?:(\d+)-(\d+)|\*)/(\d+|\*)$")


def _inventory_page_complete(
    response,
    page: list,
    *,
    start: int,
    observed_rows: int,
    expected_total: int | None,
    label: str,
) -> tuple[int | None, bool]:
    """Validate PostgREST range continuity when an exact total is advertised."""
    headers = getattr(response, "headers", {})
    content_range = (
        str(headers.get("Content-Range") or "").strip()
        if isinstance(headers, Mapping)
        else ""
    )
    if not content_range:
        raise RuntimeError(f"{label} did not return an exact Content-Range")

    match = _CONTENT_RANGE_RE.fullmatch(content_range)
    if not match:
        raise RuntimeError(f"{label} returned an invalid Content-Range")
    range_start, range_end, raw_total = match.groups()
    if raw_total == "*":
        raise RuntimeError(f"{label} did not return an exact total")
    advertised_total = int(raw_total)
    if expected_total is not None and advertised_total != expected_total:
        raise RuntimeError(f"{label} changed its advertised total during pagination")
    expected_total = advertised_total

    if range_start is None:
        if page or advertised_total != 0:
            raise RuntimeError(f"{label} returned an inconsistent empty Content-Range")
    else:
        lower, upper = int(range_start), int(range_end)
        if lower != start or upper - lower + 1 != len(page):
            raise RuntimeError(f"{label} returned a discontinuous Content-Range")

    if observed_rows > expected_total:
        raise RuntimeError(f"{label} returned more rows than its advertised total")
    if observed_rows == expected_total:
        return expected_total, True
    if len(page) < INVENTORY_PAGE_SIZE:
        raise RuntimeError(f"{label} ended before its advertised total")
    return expected_total, False


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


def supabase_inventory_live_courses(request_get=requests.get):
    """Read the complete live table for source-aware reconciliation evidence.

    This intentionally uses full pagination rather than a client-clock
    ``synced_at`` predicate. It returns only ownership, manifest, and aggregate
    fields required by the classifier; it never deletes or logs an ID.
    """
    rows = []
    seen_ids = set()
    expected_total = None
    endpoint = f"{SUPABASE_URL}/rest/v1/live_courses"
    for start in range(0, MAX_INVENTORY_ROWS, INVENTORY_PAGE_SIZE):
        response = request_get(
            endpoint,
            headers={
                **_sb_read_headers(),
                "Range-Unit": "items",
                "Range": f"{start}-{start + INVENTORY_PAGE_SIZE - 1}",
            },
            params={
                "select": (
                    "id,school,term,source,active,is_hks,sync_run_id,"
                    "source_course_id,source_offering_id,synced_at"
                ),
                "order": "id.asc",
            },
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(f"Live-course inventory failed: HTTP {response.status_code}")
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError("Live-course inventory returned a non-list response")
        for row in page:
            if not isinstance(row, dict) or not str(row.get("id") or "").strip():
                raise RuntimeError("Live-course inventory returned a row without an ID")
            row_id = str(row["id"])
            if row_id in seen_ids:
                raise RuntimeError("Live-course inventory returned duplicate IDs")
            seen_ids.add(row_id)
            rows.append(row)
        expected_total, complete = _inventory_page_complete(
            response,
            page,
            start=start,
            observed_rows=len(rows),
            expected_total=expected_total,
            label="Live-course inventory",
        )
        if complete:
            return rows
    raise RuntimeError(f"live_courses exceeds the safe {MAX_INVENTORY_ROWS} row inventory limit")


def supabase_inventory_catalogue_runs(request_get=requests.get):
    """Read every my.harvard run needed to prove protected HKS ownership."""
    rows = []
    seen_ids = set()
    expected_total = None
    endpoint = f"{SUPABASE_URL}/rest/v1/live_catalogue_runs"
    params = {
        "select": "id,source,status,offering_count,identity_sha256,term_counts",
        "source": "eq.myharvard",
        "order": "id.asc",
    }
    for start in range(0, MAX_INVENTORY_ROWS, INVENTORY_PAGE_SIZE):
        response = request_get(
            endpoint,
            headers={
                **_sb_read_headers(),
                "Range-Unit": "items",
                "Range": f"{start}-{start + INVENTORY_PAGE_SIZE - 1}",
            },
            params=params,
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(f"Catalogue-run inventory failed: HTTP {response.status_code}")
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError("Catalogue-run inventory returned a non-list response")
        for row in page:
            if not isinstance(row, dict) or not str(row.get("id") or "").strip():
                raise RuntimeError("Catalogue-run inventory returned a row without an ID")
            run_id = str(row["id"])
            if run_id in seen_ids:
                raise RuntimeError("Catalogue-run inventory returned duplicate IDs")
            seen_ids.add(run_id)
            rows.append(row)
        expected_total, complete = _inventory_page_complete(
            response,
            page,
            start=start,
            observed_rows=len(rows),
            expected_total=expected_total,
            label="Catalogue-run inventory",
        )
        if complete:
            if not rows:
                raise RuntimeError("Catalogue-run inventory is empty")
            return rows
    raise RuntimeError(
        f"live_catalogue_runs exceeds the safe {MAX_INVENTORY_ROWS} row inventory limit"
    )


def supabase_active_hks_source_course_ids(request_get=requests.get):
    """Return authoritative active-HKS course IDs before the ATS write.

    ``catalogSchool`` is a search facet, not a trustworthy ownership field: an
    HKS cross-list can also appear in a non-HKS query. my.harvard's stable
    ``source_course_id`` is the authoritative ownership boundary, and it maps
    to the ATS ``courseID`` stored in ``live_courses.id``.
    """
    ids = set()
    seen_row_ids = set()
    observed_rows = 0
    expected_total = None
    endpoint = f"{SUPABASE_URL}/rest/v1/live_courses"
    params = {
        "select": "id,source_course_id",
        "source": "eq.myharvard",
        "active": "eq.true",
        "is_hks": "eq.true",
        "source_course_id": "not.is.null",
        "order": "id.asc",
    }
    for start in range(0, MAX_INVENTORY_ROWS, INVENTORY_PAGE_SIZE):
        response = request_get(
            endpoint,
            headers={
                **_sb_read_headers(),
                "Range-Unit": "items",
                "Range": f"{start}-{start + INVENTORY_PAGE_SIZE - 1}",
            },
            params=params,
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(
                f"Authoritative HKS identity read failed: HTTP {response.status_code}"
            )
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError("Authoritative HKS identity read returned a non-list response")
        observed_rows += len(page)
        for row in page:
            row_id = str(row.get("id") or "").strip() if isinstance(row, dict) else ""
            source_course_id = (
                str(row.get("source_course_id") or "").strip()
                if isinstance(row, dict)
                else ""
            )
            if not row_id:
                raise RuntimeError("Authoritative HKS identity read returned an empty row ID")
            if row_id in seen_row_ids:
                raise RuntimeError("Authoritative HKS identity read returned duplicate row IDs")
            if not source_course_id:
                raise RuntimeError("Authoritative HKS identity read returned an empty ID")
            seen_row_ids.add(row_id)
            ids.add(source_course_id)
        expected_total, complete = _inventory_page_complete(
            response,
            page,
            start=start,
            observed_rows=observed_rows,
            expected_total=expected_total,
            label="Authoritative HKS identity read",
        )
        if complete:
            if not ids:
                raise RuntimeError("Authoritative HKS identity set is empty")
            return ids
    raise RuntimeError(
        f"Authoritative HKS identity read exceeds the safe {MAX_INVENTORY_ROWS} row limit"
    )


def compare_live_course_inventory(source_rows, database_rows, catalogue_runs):
    """Compatibility wrapper for the source-aware, read-only classifier."""
    return classify_live_course_inventory(source_rows, database_rows, catalogue_runs)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    sync_start = datetime.now(timezone.utc).isoformat()
    if STALE_DELETE_REQUESTED:
        write_github_summary(
            build_sync_summary(
                outcome="aborted before API/database activity: stale deletion is not supported",
                sync_start=sync_start,
                planned_request_count=0,
                rows=[],
            )
        )
        sys.exit(
            "SYNC_ALLOW_STALE_DELETE is intentionally unsupported. Run a separately approved, "
            "backed-up reconciliation instead."
        )
    log.info("Sync started at %s", sync_start)
    log.info("Non-HKS schools: %s", GENERAL_SYNC_SCHOOLS)
    log.info("Seed queries: %s  Workers: %d", SEED_QUERIES, WORKERS)

    all_rows: dict[str, dict] = {}  # id → row

    failures: list[FetchResult] = []
    tasks = [(school, q) for school in GENERAL_SYNC_SCHOOLS for q in SEED_QUERIES]
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
                else:
                    all_rows[row["id"]] = merge_duplicate_course(all_rows[row["id"]], row)
            log.info("  %-6s q=%-6s → %d returned, %d new (total unique: %d)",
                     school, q, len(rows), new, len(all_rows))

    if failures:
        failed_calls = ", ".join(f"{result.school}/{result.query} ({result.error})" for result in failures)
        write_github_summary(
            build_sync_summary(
                outcome="aborted before database writes",
                sync_start=sync_start,
                planned_request_count=len(tasks),
                rows=list(all_rows.values()),
                failures=failures,
            )
        )
        log.error("Aborting sync: %d of %d Harvard requests failed. No Supabase write or inventory read will run. Failed calls: %s", len(failures), len(tasks), failed_calls)
        sys.exit(1)

    try:
        authoritative_hks_ids = supabase_active_hks_source_course_ids()
    except Exception:
        write_github_summary(
            build_sync_summary(
                outcome="aborted before database writes: authoritative HKS identity read failed",
                sync_start=sync_start,
                planned_request_count=len(tasks),
                rows=list(all_rows.values()),
            )
        )
        raise

    excluded_hks_cross_lists = authoritative_hks_ids.intersection(all_rows)
    if excluded_hks_cross_lists:
        all_rows = {
            row_id: row
            for row_id, row in all_rows.items()
            if row_id not in authoritative_hks_ids
        }
        log.info(
            "Excluded %d ATS cross-list identities owned by the authoritative HKS catalogue.",
            len(excluded_hks_cross_lists),
        )

    if len(all_rows) < MIN_UNIQUE_COURSES:
        write_github_summary(
            build_sync_summary(
                outcome="aborted before database writes: minimum unique-course guard",
                sync_start=sync_start,
                planned_request_count=len(tasks),
                rows=list(all_rows.values()),
            )
        )
        log.error(
            "Only %d unique courses were fetched (minimum required: %d) — aborting to protect existing data",
            len(all_rows),
            MIN_UNIQUE_COURSES,
        )
        sys.exit(1)

    rows_list = list(all_rows.values())
    terms = sorted({r["term"] for r in rows_list if r["term"]})
    log.info("Upserting %d unique courses (terms: %s)…", len(rows_list), terms)
    try:
        supabase_upsert(rows_list)
    except Exception:
        write_github_summary(
            build_sync_summary(
                outcome="atomic database promotion failed",
                sync_start=sync_start,
                planned_request_count=len(tasks),
                rows=rows_list,
            )
        )
        raise

    try:
        inventory = compare_live_course_inventory(
            rows_list,
            supabase_inventory_live_courses(),
            supabase_inventory_catalogue_runs(),
        )
    except Exception:
        write_github_summary(
            build_sync_summary(
                outcome="atomic promotion succeeded; source-aware reconciliation audit failed; no cleanup attempted",
                sync_start=sync_start,
                planned_request_count=len(tasks),
                rows=rows_list,
            )
        )
        raise
    write_github_summary(
        build_sync_summary(
            outcome="promoted atomically",
            sync_start=sync_start,
            planned_request_count=len(tasks),
            rows=rows_list,
            inventory=inventory,
        )
    )
    log.info(
        "Done. %d current-source courses promoted; %d actionable retained ATS rows; queue sha256=%s.",
        len(rows_list),
        inventory["actionable_retained_non_hks_ats_count"],
        inventory["actionable_queue_sha256"],
    )


if __name__ == "__main__":
    main()
