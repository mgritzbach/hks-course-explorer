"""Synchronize every current HKS offering and section from my.harvard.

The public my.harvard search response is authoritative for student-visible
offerings. Rows are staged inactive, verified against the advertised result
count, and optionally promoted in one database transaction. No rows are
deleted; the previous ATS catalogue remains available for rollback.
"""

from __future__ import annotations

import hashlib
import html
import json
import os
import re
import sys
import time
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from urllib.parse import parse_qsl, urljoin, urlparse

import requests

MYHARVARD_BASE = "https://my.harvard.edu/"
MYHARVARD_SEARCH = urljoin(MYHARVARD_BASE, "search/")
PAGE_SIZE = 15
SUPABASE_PAGE_SIZE = 1_000
MAX_ACTIVE_HKS_ROWS = 10_000
DETAIL_WORKERS = 4
DETAIL_MAX_ATTEMPTS = 3
DETAIL_RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}
SEARCH_MAX_ATTEMPTS = 3
MIN_HKS_OFFERINGS = int(os.environ.get("MYHARVARD_MIN_HKS_OFFERINGS", "250"))
PROMOTE = os.environ.get("MYHARVARD_PROMOTE", "false").lower() == "true"
SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

REQUEST_HEADERS = {
    "User-Agent": "HKS-Course-Explorer-Sync/1.0",
    "HX-Request": "true",
    "HX-Target": "search-results",
    "Accept": "application/json",
    "Referer": MYHARVARD_BASE,
}


class TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        value = " ".join(data.split())
        if value:
            self.parts.append(value)

    def text(self) -> str:
        return " ".join(self.parts)


class MeetingGroupExtractor(HTMLParser):
    """Associate each my.harvard weekday group with its following time range."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.group_depth = 0
        self.current_days: list[str] = []
        self.pending_days: list[str] | None = None
        self.pending_text: list[str] = []
        self.groups: list[tuple[list[str], str]] = []

    def _finish_pending(self) -> None:
        if self.pending_days is None:
            return
        self.groups.append((self.pending_days, " ".join(self.pending_text)))
        self.pending_days = None
        self.pending_text = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "div":
            return
        attributes = {key.lower(): value or "" for key, value in attrs}
        is_weekday_group = (
            attributes.get("role", "").lower() == "group"
            and attributes.get("aria-label", "").strip().lower() == "week days"
        )
        if is_weekday_group:
            self._finish_pending()
            self.group_depth = 1
            self.current_days = []
            return
        if self.group_depth:
            self.group_depth += 1
            label = attributes.get("aria-label", "")
            selected = re.fullmatch(r"\s*([A-Za-z]+)\s*,\s*selected\s*", label, re.I)
            if selected:
                day = DAY_LABELS.get(selected.group(1).lower())
                if not day:
                    raise ScheduleParseError(
                        f"Unknown selected my.harvard weekday: {selected.group(1)!r}"
                    )
                if day not in self.current_days:
                    self.current_days.append(day)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "div" or not self.group_depth:
            return
        self.group_depth -= 1
        if self.group_depth == 0:
            self.current_days.sort(key=DAY_ORDER.index)
            self.pending_days = self.current_days
            self.pending_text = []

    def handle_data(self, data: str) -> None:
        if self.pending_days is not None and self.group_depth == 0:
            value = " ".join(data.split())
            if value:
                self.pending_text.append(value)

    def finish(self) -> list[tuple[list[str], str]]:
        self._finish_pending()
        return self.groups


def plain_text(fragment: str) -> str:
    parser = TextExtractor()
    parser.feed(fragment)
    return parser.text()


class ScheduleParseError(RuntimeError):
    """Raised when a published meeting pattern cannot be represented safely."""


class SearchSnapshotRetry(RuntimeError):
    """Requests a clean page-one restart without retaining partial search rows."""


DAY_LABELS = {
    "sunday": "SUN",
    "monday": "MON",
    "tuesday": "TUE",
    "wednesday": "WED",
    "thursday": "THU",
    "friday": "FRI",
    "saturday": "SAT",
}
DAY_ORDER = tuple(DAY_LABELS.values())
TIME_RANGE_PATTERN = re.compile(
    r"(\d{1,2}:\d{2}\s*(?:am|pm))\s*[-\N{EN DASH}\N{EM DASH}]\s*"
    r"(\d{1,2}:\d{2}\s*(?:am|pm))",
    re.I,
)


def normalize_schedule_time(value: str) -> str:
    """Normalize one explicit my.harvard 12-hour time to ``HH:MM``."""
    match = re.fullmatch(r"\s*(\d{1,2}):(\d{2})\s*(am|pm)\s*", value, re.I)
    if not match:
        raise ScheduleParseError(f"Unsupported my.harvard meeting time: {value!r}")
    hour = int(match.group(1))
    minute = int(match.group(2))
    if not 1 <= hour <= 12 or not 0 <= minute <= 59:
        raise ScheduleParseError(f"Invalid my.harvard meeting time: {value!r}")
    if match.group(3).lower() == "am":
        hour = 0 if hour == 12 else hour
    elif hour != 12:
        hour += 12
    return f"{hour:02d}:{minute:02d}"


def parse_course_schedule(detail_html: str, *, pending_advertised: bool = False) -> dict:
    """Parse one exact offering's public meeting pattern without guessing.

    An offering with no selected weekdays and no time range is legitimately
    schedule-pending. Each published weekday group is paired with its own time
    range so multi-interval offerings remain lossless.
    """
    block = re.search(
        r'<div\b[^>]*\bid="course-time"[^>]*>(.*?)<!--\s*End Time\s*-->',
        detail_html,
        re.I | re.S,
    )
    if not block:
        raise ScheduleParseError("my.harvard detail page is missing #course-time")

    extractor = MeetingGroupExtractor()
    extractor.feed(block.group(1))
    groups = extractor.finish()
    raw_ranges = TIME_RANGE_PATTERN.findall(plain_text(block.group(1)))

    if (
        pending_advertised
        and not raw_ranges
        and (not groups or all(not selected_days for selected_days, _ in groups))
    ):
        return {
            "state": "pending",
            "meetings": [],
            "meeting_days": "",
            "time_start": "",
            "time_end": "",
            "location": "",
        }
    if not raw_ranges and (not groups or all(not days for days, _ in groups)):
        raise ScheduleParseError(
            "my.harvard detail meeting block is empty without an explicit TBA source signal"
        )

    meetings: list[dict[str, str]] = []
    for selected_days, trailing_text in groups:
        group_ranges = TIME_RANGE_PATTERN.findall(trailing_text)
        if not selected_days or len(group_ranges) != 1:
            raise ScheduleParseError(
                "my.harvard published a partial meeting group "
                "(selected days and exactly one time range must both exist)"
            )
        start = normalize_schedule_time(group_ranges[0][0])
        end = normalize_schedule_time(group_ranges[0][1])
        start_minutes = int(start[:2]) * 60 + int(start[3:])
        end_minutes = int(end[:2]) * 60 + int(end[3:])
        if end_minutes <= start_minutes:
            raise ScheduleParseError("my.harvard meeting end time must be after its start time")
        for day in selected_days:
            meeting = {"day": day, "start": start, "end": end, "location": ""}
            if meeting not in meetings:
                meetings.append(meeting)

    if not meetings or len(raw_ranges) != len(groups):
        raise ScheduleParseError("my.harvard meeting groups could not be represented completely")

    selected_days = sorted({meeting["day"] for meeting in meetings}, key=DAY_ORDER.index)
    intervals = {(meeting["start"], meeting["end"]) for meeting in meetings}
    legacy_start, legacy_end = next(iter(intervals)) if len(intervals) == 1 else ("", "")
    return {
        "state": "scheduled",
        "meetings": meetings,
        "meeting_days": "/".join(selected_days),
        "time_start": legacy_start,
        "time_end": legacy_end,
        "location": "",
    }


def format_base_code(raw_code: str) -> str:
    match = re.fullmatch(r"([A-Za-z]+)([A-Za-z0-9.]+)", raw_code.strip())
    if not match:
        raise ValueError(f"Unexpected my.harvard course code: {raw_code!r}")
    catalog = match.group(2).upper()
    # Legacy evaluation data writes modular/year-long suffixes as a distinct
    # code segment (DPI-810-M, SUP-150-Y). Preserve that canonical identity.
    suffix = re.fullmatch(r"(.+?)([A-CMY])", catalog)
    if suffix:
        catalog = f"{suffix.group(1)}-{suffix.group(2)}"
    return f"{match.group(1).upper()}-{catalog}"


def format_history_base_code(raw_code: str) -> str:
    """Return the legacy course identity without demand-split A/B/C additions."""
    match = re.fullmatch(r"([A-Za-z]+)([A-Za-z0-9.]+)", raw_code.strip())
    if not match:
        raise ValueError(f"Unexpected my.harvard course code: {raw_code!r}")
    catalog = match.group(2).upper()
    demand_split = re.fullmatch(r"(.+?)([A-C])", catalog)
    if demand_split:
        catalog = demand_split.group(1)
    return format_base_code(f"{match.group(1)}{catalog}")


def parse_cards(hits_html: str) -> list[dict]:
    starts = [
        match
        for match in re.finditer(r'<div\b[^>]*class="([^"]*)"[^>]*>', hits_html, re.I)
        if "course-card" in match.group(1).split()
    ]
    cards: list[dict] = []
    for index, start in enumerate(starts):
        end = starts[index + 1].start() if index + 1 < len(starts) else len(hits_html)
        fragment = hits_html[start.start():end]
        opening = start.group(0)
        course_id = re.search(r'data-course-id="([^"]+)"', opening, re.I)
        offer_nbr = re.search(r'data-crse-offer-nbr="([^"]+)"', opening, re.I)
        link = re.search(
            r'<a\b[^>]*href="(/course/([^/]+)/([0-9]{4}-(?:Fall|Spring|Summer|January))/([^/?#"]+))"[^>]*>(.*?)</a>',
            fragment,
            re.I | re.S,
        )
        if not course_id or not offer_nbr or not link:
            raise ValueError("my.harvard course card is missing its stable identity")

        source_url, raw_code, raw_term, raw_section_code, title_html = link.groups()
        title = plain_text(title_html)
        term = raw_term.replace("-", " ")
        source_code = format_base_code(raw_code)
        history_base_code = format_history_base_code(raw_code)
        raw_section_code = raw_section_code.upper()
        section_code = raw_section_code.lstrip("-")
        if not section_code:
            raise ValueError("my.harvard course card has an empty section identity")
        # A/B/C encoded in the registrar catalogue number is already the
        # student-facing addition; its internal section 001 is redundant.
        catalog_has_demand_split = history_base_code != source_code
        display_code = (
            source_code
            if catalog_has_demand_split and section_code == "001"
            else f"{source_code}-{section_code}"
        )
        all_text = plain_text(fragment)
        session = next(
            (
                value
                for value in (
                    "Full Term",
                    "Fall 1",
                    "Fall 2",
                    "Spring 1",
                    "Spring 2",
                    "January",
                )
                if value in all_text
            ),
            "",
        )
        instructors = []
        for value in re.findall(
            r'<a\b[^>]*href="/instructor/[^"]+"[^>]*>(.*?)</a>',
            fragment,
            re.I | re.S,
        ):
            labelled = re.search(
                r'<span\b[^>]*class="[^"]*\blink-body\b[^"]*"[^>]*>(.*?)</span>',
                value,
                re.I | re.S,
            )
            name = plain_text(labelled.group(1) if labelled else value)
            if name:
                instructors.append(name)
        description_match = re.search(
            r'<div\b[^>]*class="[^"]*\bcourse-description\b[^"]*"[^>]*>(.*?)</div>',
            fragment,
            re.I | re.S,
        )
        description = plain_text(description_match.group(1)) if description_match else ""
        identity = "|".join(
            ["myh", "HKS", raw_term, course_id.group(1), offer_nbr.group(1), raw_section_code]
        )
        cards.append(
            {
                "id": identity,
                "course_code": display_code,
                "course_code_base": history_base_code,
                "title": html.unescape(title),
                "term": term,
                "credits": None,
                "instructors": list(dict.fromkeys(instructors)),
                "description": html.unescape(description),
                "location": "",
                "meeting_days": "",
                "time_start": "",
                "time_end": "",
                "school": "HKS",
                "is_hks": True,
                "session_code": session.upper().replace(" ", ""),
                "session_description": session,
                "cross_reg_eligible": "",
                "source_course_id": course_id.group(1),
                "course_offer_nbr": offer_nbr.group(1),
                "section_code": section_code,
                "source_url": urljoin(MYHARVARD_BASE, source_url),
                # This evidence is internal to the ingestion process and is
                # removed before staging. An empty detail block is accepted as
                # pending only when the offering card explicitly says TBA.
                "_schedule_pending_advertised": bool(
                    re.search(
                        r"<!--\s*Week Days:\s*To Be Announced\s*-->",
                        fragment,
                        re.I,
                    )
                ),
            }
        )
    return cards


def parse_course_details(detail_html: str, *, pending_advertised: bool = False) -> dict:
    credits_match = re.search(
        r">Credits</strong>\s*<span>([^<]+)</span>", detail_html, re.I | re.S
    )
    credits = None
    if credits_match:
        number = re.search(r"\d+(?:\.\d+)?", plain_text(credits_match.group(1)))
        credits = float(number.group(0)) if number else None

    cross_reg_block = re.search(
        r">Cross Reg</strong>(.*?)(?:</div>\s*</div>|<strong)",
        detail_html,
        re.I | re.S,
    )
    cross_reg_text = plain_text(cross_reg_block.group(1)) if cross_reg_block else ""
    if re.search(r"not available|not eligible|no cross", cross_reg_text, re.I):
        cross_reg = "NOXREG"
    elif cross_reg_text:
        cross_reg = "YESXREG"
    else:
        cross_reg = ""
    schedule = parse_course_schedule(
        detail_html,
        pending_advertised=pending_advertised,
    )
    return {
        "credits": credits,
        "cross_reg_eligible": cross_reg,
        "location": schedule["location"],
        "meetings": schedule["meetings"],
        "meeting_days": schedule["meeting_days"],
        "time_start": schedule["time_start"],
        "time_end": schedule["time_end"],
    }


def fetch_detail_html(source_url: str) -> str:
    """Fetch one exact offering detail with bounded retry and fail-closed errors."""
    last_error: Exception | None = None
    for attempt in range(DETAIL_MAX_ATTEMPTS):
        try:
            response = requests.get(
                source_url,
                headers={"User-Agent": REQUEST_HEADERS["User-Agent"], "Accept": "text/html"},
                timeout=30,
                allow_redirects=False,
            )
            if 300 <= response.status_code < 400:
                raise RuntimeError("my.harvard offering detail redirect was refused")
            if response.ok:
                final_url = getattr(response, "url", source_url)
                if isinstance(final_url, str) and final_url.rstrip("/") != source_url.rstrip("/"):
                    raise RuntimeError("my.harvard offering detail response URL changed")
                return response.text
            if response.status_code not in DETAIL_RETRYABLE_STATUS_CODES:
                response.raise_for_status()
            last_error = RuntimeError(
                f"my.harvard detail request returned retryable HTTP {response.status_code}"
            )
        except requests.HTTPError:
            # Authentication, authorization, or a changed exact source URL is
            # not transient; retrying would only delay the fail-closed result.
            raise
        except (requests.RequestException, ValueError) as exc:
            last_error = exc
        if attempt + 1 < DETAIL_MAX_ATTEMPTS:
            time.sleep(0.25 * (2**attempt))
    raise RuntimeError(
        f"Could not verify my.harvard offering detail after {DETAIL_MAX_ATTEMPTS} attempts: "
        f"{source_url}"
    ) from last_error


def enrich_offering_details(rows: list[dict]) -> list[dict]:
    # Meeting schedules are section-specific.  Reuse a response only when the
    # exact public source URL is identical; grouping by course identity can
    # silently copy one section's time onto another section.
    groups: dict[str, list[dict]] = {}
    for row in rows:
        source_url = row.get("source_url")
        offering_id = row.get("id")
        if not isinstance(source_url, str) or not source_url:
            raise ScheduleParseError("HKS offering is missing its exact source URL")
        if not isinstance(offering_id, str) or not offering_id:
            raise ScheduleParseError("HKS offering is missing its exact identity")
        group = groups.setdefault(source_url, [])
        if group and any(existing.get("id") != offering_id for existing in group):
            raise ScheduleParseError(
                "Distinct HKS offering identities share one source URL; refusing schedule reuse"
            )
        group.append(row)

    def fetch_detail(group_rows: list[dict]) -> dict:
        pending_signals = {
            bool(row.get("_schedule_pending_advertised")) for row in group_rows
        }
        if len(pending_signals) != 1:
            raise ScheduleParseError("Identical HKS offering rows disagree on their TBA signal")
        details = parse_course_details(
            fetch_detail_html(group_rows[0]["source_url"]),
            pending_advertised=pending_signals.pop(),
        )
        if details["credits"] is None:
            raise RuntimeError(f"Credits missing from {group_rows[0]['source_url']}")
        return details

    with ThreadPoolExecutor(max_workers=DETAIL_WORKERS) as pool:
        futures = {pool.submit(fetch_detail, group_rows): group_rows for group_rows in groups.values()}
        for future in as_completed(futures):
            group_rows = futures[future]
            details = future.result()
            for row in group_rows:
                row.update(details)
                row.pop("_schedule_pending_advertised", None)
    return rows


def count_schedule_states(rows: list[dict]) -> tuple[int, int]:
    """Prove every offering is either fully scheduled or fully pending."""
    scheduled = 0
    pending = 0
    for row in rows:
        meetings = row.get("meetings", [])
        if not isinstance(meetings, list):
            raise ScheduleParseError(
                f"Offering {row.get('id')!r} has an invalid normalized meeting list"
            )
        fields = [row.get("meeting_days"), row.get("time_start"), row.get("time_end")]
        if meetings:
            if not row.get("meeting_days"):
                raise ScheduleParseError(
                    f"Offering {row.get('id')!r} has meetings without normalized weekdays"
                )
            scheduled += 1
        elif not any(fields):
            pending += 1
        else:
            raise ScheduleParseError(
                f"Offering {row.get('id')!r} contains a partial normalized meeting pattern"
            )
    if scheduled + pending != len(rows):
        raise RuntimeError("Schedule-state partition did not cover every HKS offering")
    return scheduled, pending


def fetch_search_page(
    client: requests.Session,
    page: int,
    expected_total: int | None,
) -> tuple[int, list[dict]]:
    """Fetch one page; retryable failures require a whole-snapshot restart."""
    params = {
        "q": "",
        "school": "HKS",
        "term": "All",
        "sort": "subject_catalog",
        "page": page,
        "browseSchool": "true",
    }
    try:
        response = client.get(
            MYHARVARD_SEARCH,
            params=params,
            headers=REQUEST_HEADERS,
            timeout=30,
            allow_redirects=False,
        )
        status_code = getattr(response, "status_code", 0)
        if isinstance(status_code, int) and 300 <= status_code < 400:
            raise RuntimeError("my.harvard search redirect was refused")
        if not response.ok:
            if status_code not in DETAIL_RETRYABLE_STATUS_CODES:
                response.raise_for_status()
            raise SearchSnapshotRetry(
                f"my.harvard search returned retryable HTTP {status_code}"
            )

        final_url = getattr(response, "url", MYHARVARD_SEARCH)
        if isinstance(final_url, str):
            expected_url = urlparse(MYHARVARD_SEARCH)
            actual_url = urlparse(final_url)
            expected_query = sorted((key, str(value)) for key, value in params.items())
            actual_query = sorted(parse_qsl(actual_url.query, keep_blank_values=True))
            if (
                actual_url.scheme != expected_url.scheme
                or actual_url.netloc != expected_url.netloc
                or actual_url.path.rstrip("/") != expected_url.path.rstrip("/")
                or actual_query != expected_query
            ):
                raise RuntimeError("my.harvard search response URL changed")
        payload = response.json()
    except requests.HTTPError:
        raise
    except requests.RequestException as exc:
        raise SearchSnapshotRetry("my.harvard search request failed") from exc
    except ValueError as exc:
        raise SearchSnapshotRetry("my.harvard search returned invalid JSON") from exc

    if not isinstance(payload, dict) or not isinstance(payload.get("hits"), str):
        raise SearchSnapshotRetry("my.harvard returned an invalid search response")
    total = payload.get("total_hits")
    if not isinstance(total, int) or total < MIN_HKS_OFFERINGS:
        raise SearchSnapshotRetry(
            "my.harvard advertised an invalid or incomplete HKS result count"
        )
    if expected_total is not None and total != expected_total:
        raise SearchSnapshotRetry("my.harvard result count changed during pagination")
    try:
        page_rows = parse_cards(payload["hits"])
    except ValueError as exc:
        raise SearchSnapshotRetry("my.harvard search-card contract was incomplete") from exc
    if not page_rows:
        raise SearchSnapshotRetry(
            "my.harvard returned an empty page before all offerings were read"
        )
    return total, page_rows


def fetch_hks_snapshot(client: requests.Session) -> list[dict]:
    """Read one internally consistent candidate without cross-attempt row reuse."""
    rows: list[dict] = []
    expected_total: int | None = None
    page = 1
    while expected_total is None or len(rows) < expected_total:
        total, page_rows = fetch_search_page(client, page, expected_total)
        if expected_total is None:
            expected_total = total
        rows.extend(page_rows)
        page += 1
        if page > (expected_total + PAGE_SIZE - 1) // PAGE_SIZE + 2:
            raise SearchSnapshotRetry("my.harvard pagination exceeded the advertised result count")

    if len(rows) != expected_total:
        raise SearchSnapshotRetry(
            f"Parsed {len(rows)} offerings; my.harvard advertised {expected_total}"
        )
    identities = {row["id"] for row in rows}
    if len(identities) != expected_total:
        raise SearchSnapshotRetry("my.harvard returned duplicate offering identities")
    if any(not row["title"] for row in rows):
        raise SearchSnapshotRetry("my.harvard returned an offering without a title")
    return rows


def fetch_all_hks_offerings(session: requests.Session | None = None) -> list[dict]:
    client = session or requests.Session()
    last_error: SearchSnapshotRetry | None = None
    for attempt in range(SEARCH_MAX_ATTEMPTS):
        try:
            return fetch_hks_snapshot(client)
        except SearchSnapshotRetry as exc:
            last_error = exc
            if attempt + 1 < SEARCH_MAX_ATTEMPTS:
                time.sleep(0.5 * (2**attempt))
    raise RuntimeError(
        f"Could not verify a complete my.harvard snapshot after "
        f"{SEARCH_MAX_ATTEMPTS} attempts"
    ) from last_error


def supabase_headers(prefer: str | None = None) -> dict[str, str]:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


def post_json(path: str, payload: dict, prefer: str | None = None):
    response = requests.post(
        f"{SUPABASE_URL}/rest/v1/{path}",
        headers=supabase_headers(prefer),
        json=payload,
        timeout=120,
    )
    if not response.ok:
        raise RuntimeError(f"Supabase request failed ({response.status_code}): {response.text[:500]}")
    return response.json() if response.content else None


def fetch_active_hks_inventory(request_get=requests.get) -> dict[str, str]:
    """Read every active upstream HKS identity after promotion for exact verification."""
    inventory: dict[str, str] = {}
    offset = 0
    while True:
        response = request_get(
            f"{SUPABASE_URL}/rest/v1/live_courses",
            headers=supabase_headers(),
            params={
                "select": "source_offering_id,source",
                "active": "eq.true",
                "is_hks": "eq.true",
                "order": "id.asc",
                "limit": str(SUPABASE_PAGE_SIZE),
                "offset": str(offset),
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
            raise RuntimeError("Supabase returned an invalid active HKS inventory")
        for row in payload:
            offering_id = row.get("source_offering_id")
            source = row.get("source")
            if not isinstance(offering_id, str) or not offering_id:
                raise RuntimeError("Supabase returned an active HKS row without a source identity")
            if offering_id in inventory:
                raise RuntimeError("Supabase returned a duplicate active HKS identity")
            inventory[offering_id] = source if isinstance(source, str) else ""
        if len(inventory) > MAX_ACTIVE_HKS_ROWS:
            raise RuntimeError("Active HKS inventory exceeds the safe verification limit")
        if len(payload) < SUPABASE_PAGE_SIZE:
            return inventory
        offset += SUPABASE_PAGE_SIZE


def fetch_active_hks_storage_inventory(request_get=requests.get) -> dict[str, str]:
    """Read the exact stored active set, including a legacy ATS rollback baseline."""
    inventory: dict[str, str] = {}
    offset = 0
    while True:
        response = request_get(
            f"{SUPABASE_URL}/rest/v1/live_courses",
            headers=supabase_headers(),
            params={
                "select": "id,source",
                "active": "eq.true",
                "is_hks": "eq.true",
                "order": "id.asc",
                "limit": str(SUPABASE_PAGE_SIZE),
                "offset": str(offset),
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
            raise RuntimeError("Supabase returned an invalid active HKS storage inventory")
        for row in payload:
            stored_id = row.get("id")
            source = row.get("source")
            if not isinstance(stored_id, str) or not stored_id:
                raise RuntimeError("Supabase returned an active HKS row without a stored identity")
            if stored_id in inventory:
                raise RuntimeError("Supabase returned a duplicate active HKS stored identity")
            inventory[stored_id] = source if isinstance(source, str) else ""
        if len(inventory) > MAX_ACTIVE_HKS_ROWS:
            raise RuntimeError("Active HKS storage inventory exceeds the safe verification limit")
        if len(payload) < SUPABASE_PAGE_SIZE:
            return inventory
        offset += SUPABASE_PAGE_SIZE


def fetch_active_hks_schedule_inventory(request_get=requests.get) -> dict[str, bool]:
    """Read the persisted schedule state for each active authoritative offering."""
    inventory: dict[str, bool] = {}
    offset = 0
    while True:
        response = request_get(
            f"{SUPABASE_URL}/rest/v1/live_courses",
            headers=supabase_headers(),
            params={
                "select": "id,source_offering_id,source,meetings,meeting_days,time_start,time_end",
                "active": "eq.true",
                "is_hks": "eq.true",
                "order": "id.asc",
                "limit": str(SUPABASE_PAGE_SIZE),
                "offset": str(offset),
            },
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, list) or any(not isinstance(row, dict) for row in payload):
            raise RuntimeError("Supabase returned an invalid active HKS schedule inventory")
        for row in payload:
            # A legacy ATS rollback baseline has no authoritative my.harvard
            # identity and therefore supplies no schedule-regression baseline.
            if row.get("source") != "myharvard":
                continue
            offering_id = row.get("source_offering_id")
            if not isinstance(offering_id, str) or not offering_id:
                raise RuntimeError(
                    "Supabase returned an active my.harvard schedule without a source identity"
                )
            if offering_id in inventory:
                raise RuntimeError("Supabase returned a duplicate active HKS schedule identity")
            meetings = row.get("meetings")
            fields = [row.get("meeting_days"), row.get("time_start"), row.get("time_end")]
            if (isinstance(meetings, list) and meetings) or (meetings is None and all(fields)):
                inventory[offering_id] = True
            elif meetings in (None, []) and not any(fields):
                inventory[offering_id] = False
            else:
                raise RuntimeError(
                    "Supabase returned a partial active HKS schedule representation"
                )
        if len(inventory) > MAX_ACTIVE_HKS_ROWS:
            raise RuntimeError("Active HKS schedule inventory exceeds the safe verification limit")
        if len(payload) < SUPABASE_PAGE_SIZE:
            return inventory
        offset += SUPABASE_PAGE_SIZE


def verify_schedule_non_regression(rows: list[dict], previous: dict[str, bool]) -> None:
    """Refuse to blank a published schedule for the same active offering."""
    current: dict[str, bool] = {}
    for row in rows:
        offering_id = row.get("id")
        if not isinstance(offering_id, str) or not offering_id or offering_id in current:
            raise ScheduleParseError("Current HKS schedule inventory has an invalid identity")
        meetings = row.get("meetings")
        fields = [row.get("meeting_days"), row.get("time_start"), row.get("time_end")]
        if (isinstance(meetings, list) and meetings and row.get("meeting_days")) or (
            meetings is None and all(fields)
        ):
            current[offering_id] = True
        elif meetings in (None, []) and not any(fields):
            current[offering_id] = False
        else:
            raise ScheduleParseError("Current HKS schedule inventory contains a partial pattern")

    lost_schedules = sum(
        1
        for offering_id, was_scheduled in previous.items()
        if was_scheduled and offering_id in current and not current[offering_id]
    )
    if lost_schedules:
        raise ScheduleParseError(
            f"Refusing to blank {lost_schedules} previously scheduled active HKS offering(s)"
        )


def verify_promoted_inventory(rows: list[dict], inventory: dict[str, str]) -> str:
    """Require exact upstream-to-production identity equality and return its audit digest."""
    expected_ids = {row.get("id") for row in rows}
    if None in expected_ids or any(not isinstance(offering_id, str) for offering_id in expected_ids):
        raise RuntimeError("Upstream HKS rows contain an invalid offering identity")
    if len(expected_ids) != len(rows):
        raise RuntimeError("Upstream HKS rows contain duplicate offering identities")

    actual_ids = set(inventory)
    non_authoritative = sum(source != "myharvard" for source in inventory.values())
    if actual_ids != expected_ids or non_authoritative:
        raise RuntimeError(
            "Promoted HKS inventory does not exactly match my.harvard: "
            f"expected={len(expected_ids)}, active={len(actual_ids)}, "
            f"missing={len(expected_ids - actual_ids)}, extra={len(actual_ids - expected_ids)}, "
            f"non_authoritative={non_authoritative}"
        )

    identity_payload = "\n".join(sorted(expected_ids)).encode("utf-8")
    return hashlib.sha256(identity_payload).hexdigest()


def build_manifest(rows: list[dict]) -> tuple[str, dict[str, int]]:
    """Return the exact immutable identity and term manifest for a staged run."""
    identities = [row.get("id") for row in rows]
    if any(not isinstance(value, str) or not value for value in identities):
        raise RuntimeError("Upstream HKS rows contain an invalid offering identity")
    if len(set(identities)) != len(identities):
        raise RuntimeError("Upstream HKS rows contain duplicate offering identities")
    terms = Counter(row.get("term") for row in rows)
    if any(not isinstance(term, str) or not term for term in terms):
        raise RuntimeError("Upstream HKS rows contain an invalid term")
    digest = hashlib.sha256("\n".join(sorted(identities)).encode("utf-8")).hexdigest()
    return digest, dict(sorted(terms.items()))


def stage(rows: list[dict]) -> tuple[str, int]:
    if any("_schedule_pending_advertised" in row for row in rows):
        raise RuntimeError("Internal my.harvard TBA evidence must not be staged")
    digest, term_counts = build_manifest(rows)
    run_rows = post_json(
        "live_catalogue_runs?select=id",
        {
            "source": "myharvard",
            "status": "staged",
            "offering_count": len(rows),
            "identity_sha256": digest,
            "term_counts": term_counts,
        },
        "return=representation",
    )
    run_id = run_rows[0]["id"]
    staged = post_json(
        "rpc/stage_myharvard_hks_offerings",
        {"p_run_id": run_id, "p_rows": rows},
    )
    return run_id, int(staged)


def promote(run_id: str) -> int:
    return int(post_json("rpc/promote_myharvard_hks_run", {"p_run_id": run_id}))


def rollback(run_id: str) -> int:
    return int(post_json("rpc/rollback_myharvard_hks_run", {"p_run_id": run_id}))


def promote_and_verify(rows: list[dict], run_id: str) -> tuple[int, str]:
    """Promote, verify exact identity, and restore the previous run on any mismatch."""
    # The first authoritative promotion may start from legacy ATS rows, which
    # predate source_offering_id. Snapshot physical IDs for rollback proof;
    # after promotion, verify the new my.harvard set by its stable upstream IDs.
    previous_inventory = fetch_active_hks_storage_inventory()
    activated = promote(run_id)
    try:
        if activated != len(rows):
            raise RuntimeError(
                f"Promotion activated {activated} HKS offerings; expected exactly {len(rows)}"
            )
        digest = verify_promoted_inventory(rows, fetch_active_hks_inventory())
        return activated, digest
    except Exception as verification_error:
        try:
            rollback(run_id)
            restored_inventory = fetch_active_hks_storage_inventory()
            if restored_inventory != previous_inventory:
                raise RuntimeError(
                    "Rollback completed but did not restore the exact previous HKS inventory"
                )
        except Exception as rollback_error:
            raise RuntimeError(
                "Promotion verification failed and the previous HKS catalogue could not be "
                "verified after rollback"
            ) from rollback_error
        raise RuntimeError(
            "Promotion verification failed; the exact previous HKS catalogue was restored"
        ) from verification_error


def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required")
    rows = enrich_offering_details(fetch_all_hks_offerings())
    scheduled, pending = count_schedule_states(rows)
    verify_schedule_non_regression(rows, fetch_active_hks_schedule_inventory())
    counts = Counter(row["term"] for row in rows)
    print(
        f"Verified {len(rows)} HKS offering schedules: "
        f"{scheduled} scheduled, {pending} schedule pending"
    )
    run_id, staged = stage(rows)
    print(f"Staged {staged} HKS offerings in run {run_id}; terms: {dict(sorted(counts.items()))}")
    if PROMOTE:
        activated, digest = promote_and_verify(rows, run_id)
        print(f"Promoted {activated} HKS offerings atomically")
        print(f"Verified exact upstream-to-production offering set: sha256={digest}")
    else:
        print("Run remains staged and invisible; set MYHARVARD_PROMOTE=true after reader verification")


if __name__ == "__main__":
    main()
