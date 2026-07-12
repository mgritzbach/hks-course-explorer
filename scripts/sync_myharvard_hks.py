"""Synchronize every current HKS offering and section from my.harvard.

The public my.harvard search response is authoritative for student-visible
offerings. Rows are staged inactive, verified against the advertised result
count, and optionally promoted in one database transaction. No rows are
deleted; the previous ATS catalogue remains available for rollback.
"""

from __future__ import annotations

import html
import json
import os
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from html.parser import HTMLParser
from urllib.parse import urljoin

import requests

MYHARVARD_BASE = "https://my.harvard.edu/"
MYHARVARD_SEARCH = urljoin(MYHARVARD_BASE, "search/")
PAGE_SIZE = 15
DETAIL_WORKERS = 4
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


def plain_text(fragment: str) -> str:
    parser = TextExtractor()
    parser.feed(fragment)
    return parser.text()


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
            }
        )
    return cards


def parse_course_details(detail_html: str) -> dict:
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
    return {"credits": credits, "cross_reg_eligible": cross_reg}


def enrich_offering_details(rows: list[dict]) -> list[dict]:
    groups: dict[tuple[str, str, str], list[dict]] = {}
    for row in rows:
        key = (row["term"], row["source_course_id"], row["course_offer_nbr"])
        groups.setdefault(key, []).append(row)

    def fetch_detail(group_rows: list[dict]) -> dict:
        response = requests.get(
            group_rows[0]["source_url"],
            headers={"User-Agent": REQUEST_HEADERS["User-Agent"], "Accept": "text/html"},
            timeout=30,
        )
        response.raise_for_status()
        details = parse_course_details(response.text)
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
    return rows


def fetch_all_hks_offerings(session: requests.Session | None = None) -> list[dict]:
    client = session or requests.Session()
    rows: list[dict] = []
    expected_total: int | None = None
    page = 1
    while expected_total is None or len(rows) < expected_total:
        response = client.get(
            MYHARVARD_SEARCH,
            params={
                "q": "",
                "school": "HKS",
                "term": "All",
                "sort": "subject_catalog",
                "page": page,
                "browseSchool": "true",
            },
            headers=REQUEST_HEADERS,
            timeout=30,
        )
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("hits"), str):
            raise RuntimeError("my.harvard returned an invalid search response")
        total = payload.get("total_hits")
        if not isinstance(total, int) or total < MIN_HKS_OFFERINGS:
            raise RuntimeError(
                f"my.harvard advertised {total!r} HKS offerings; minimum is {MIN_HKS_OFFERINGS}"
            )
        if expected_total is None:
            expected_total = total
        elif total != expected_total:
            raise RuntimeError("my.harvard result count changed during pagination")

        page_rows = parse_cards(payload["hits"])
        if not page_rows:
            raise RuntimeError(f"my.harvard page {page} was empty before all offerings were read")
        rows.extend(page_rows)
        page += 1
        if page > (expected_total + PAGE_SIZE - 1) // PAGE_SIZE + 2:
            raise RuntimeError("my.harvard pagination exceeded the advertised result count")

    if len(rows) != expected_total:
        raise RuntimeError(f"Parsed {len(rows)} offerings; my.harvard advertised {expected_total}")
    identities = {row["id"] for row in rows}
    if len(identities) != expected_total:
        raise RuntimeError("my.harvard returned duplicate offering identities")
    if any(not row["title"] for row in rows):
        raise RuntimeError("my.harvard returned an offering without a title")
    return rows


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


def stage(rows: list[dict]) -> tuple[str, int]:
    run_rows = post_json(
        "live_catalogue_runs?select=id",
        {
            "source": "myharvard",
            "status": "staged",
            "offering_count": len(rows),
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


def main() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required")
    rows = enrich_offering_details(fetch_all_hks_offerings())
    counts = Counter(row["term"] for row in rows)
    run_id, staged = stage(rows)
    print(f"Staged {staged} HKS offerings in run {run_id}; terms: {dict(sorted(counts.items()))}")
    if PROMOTE:
        activated = promote(run_id)
        print(f"Promoted {activated} HKS offerings atomically")
    else:
        print("Run remains staged and invisible; set MYHARVARD_PROMOTE=true after reader verification")


if __name__ == "__main__":
    main()
