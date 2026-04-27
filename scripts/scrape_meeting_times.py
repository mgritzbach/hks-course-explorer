"""Usage: python scripts/scrape_meeting_times.py

Scrape public HKS course pages for meeting day/time data and write
normalized results to scripts/meeting_times_output.json.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parent.parent
COURSES_JSON = ROOT / "public" / "courses.json"
OUTPUT_JSON = ROOT / "scripts" / "meeting_times_output.json"

REQUEST_TIMEOUT = 10
RATE_LIMIT_SECONDS = 1.0
RETRY_STATUS_CODES = {429, 503}
MAX_RETRIES = 3

DAY_MAP = {
    "monday": "Mon",
    "mon": "Mon",
    "tuesday": "Tue",
    "tue": "Tue",
    "tues": "Tue",
    "wednesday": "Wed",
    "wed": "Wed",
    "thursday": "Thu",
    "thu": "Thu",
    "thur": "Thu",
    "thurs": "Thu",
    "friday": "Fri",
    "fri": "Fri",
}

DAY_PATTERN = r"(?:Mon(?:day)?|Tue(?:s|sday)?|Wed(?:nesday)?|Thu(?:rs|rsday|r|rday)?|Fri(?:day)?)"
TIME_PATTERN = r"(\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)?)"
SCHEDULE_REGEX = re.compile(
    rf"(?P<days>{DAY_PATTERN}(?:\s*(?:,|/|&|and)\s*{DAY_PATTERN})*)"
    rf"[^\d]{{0,20}}"
    rf"(?P<start>{TIME_PATTERN})\s*(?:-|–|—|to)\s*(?P<end>{TIME_PATTERN})",
    re.IGNORECASE,
)

SELECTORS = [
    ".course-schedule",
    ".meeting-times",
    ".field--name-field-meeting-time",
]


def load_course_urls() -> list[str]:
    with COURSES_JSON.open(encoding="utf-8") as fh:
        payload = json.load(fh)

    unique_urls = []
    seen = set()
    for course in payload.get("courses", []):
        url = (course.get("course_url") or "").strip()
        if not url or url in seen:
            continue
        seen.add(url)
        unique_urls.append(url)
    return unique_urls


def parse_time_str(raw: str, meridiem_hint: str | None = None) -> str | None:
    cleaned = raw.strip().lower().replace(".", "")
    match = re.match(r"(?P<hour>\d{1,2})(?::(?P<minute>\d{2}))?\s*(?P<meridiem>am|pm)?", cleaned)
    if not match:
        return None

    hour = int(match.group("hour"))
    minute = int(match.group("minute") or "00")
    meridiem = match.group("meridiem") or meridiem_hint
    if meridiem not in {"am", "pm"}:
        return None

    if meridiem == "am":
        hour = 0 if hour == 12 else hour
    else:
        hour = hour if hour == 12 else hour + 12

    return f"{hour:02d}:{minute:02d}"


def normalize_days(raw_days: str) -> list[str]:
    day_tokens = re.findall(DAY_PATTERN, raw_days, flags=re.IGNORECASE)
    normalized = []
    seen = set()
    for token in day_tokens:
        key = token.lower().rstrip(".")
        day = DAY_MAP.get(key)
        if day and day not in seen:
            seen.add(day)
            normalized.append(day)
    return normalized


def extract_schedule(html: str) -> dict[str, object] | None:
    soup = BeautifulSoup(html, "html.parser")

    candidate_texts = []
    for selector in SELECTORS:
        for node in soup.select(selector):
            text = node.get_text(" ", strip=True)
            if text:
                candidate_texts.append(text)

    for node in soup.find_all(string=re.compile(DAY_PATTERN, re.IGNORECASE)):
        text = " ".join(node.parent.stripped_strings) if getattr(node, "parent", None) else str(node).strip()
        if text:
            candidate_texts.append(text)

    seen_texts = set()
    for text in candidate_texts:
        compact = " ".join(text.split())
        if compact in seen_texts:
            continue
        seen_texts.add(compact)

        match = SCHEDULE_REGEX.search(compact)
        if not match:
            continue

        start_raw = match.group("start")
        end_raw = match.group("end")
        meridiem_hint_match = re.search(r"(am|pm)", end_raw.lower().replace(".", ""))
        meridiem_hint = meridiem_hint_match.group(1) if meridiem_hint_match else None

        meeting_days = normalize_days(match.group("days"))
        meeting_time = parse_time_str(start_raw, meridiem_hint=meridiem_hint)
        meeting_time_end = parse_time_str(end_raw, meridiem_hint=meridiem_hint)

        if meeting_days and meeting_time and meeting_time_end:
            return {
                "meeting_days": meeting_days,
                "meeting_time": meeting_time,
                "meeting_time_end": meeting_time_end,
            }

    return None


def fetch_html(url: str, session: requests.Session) -> str | None:
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = session.get(url, timeout=REQUEST_TIMEOUT)
        except requests.RequestException:
            return None

        if response.status_code == 404:
            return None
        if response.status_code in RETRY_STATUS_CODES:
            if attempt == MAX_RETRIES:
                return None
            time.sleep(RATE_LIMIT_SECONDS * attempt)
            continue
        if not response.ok:
            return None
        return response.text

    return None


def main() -> None:
    urls = load_course_urls()
    results: dict[str, dict[str, object]] = {}

    with requests.Session() as session:
        session.headers.update(
            {
                "User-Agent": "hks-course-explorer-meeting-scraper/1.0",
            }
        )

        for index, url in enumerate(urls, start=1):
            html = fetch_html(url, session)
            if html:
                schedule = extract_schedule(html)
                if schedule:
                    results[url] = schedule

            if index % 50 == 0:
                print(f"Processed {index}/{len(urls)} URLs")

            time.sleep(RATE_LIMIT_SECONDS)

    with OUTPUT_JSON.open("w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)

    print(f"Wrote {len(results)} schedule records to {OUTPUT_JSON}")


if __name__ == "__main__":
    main()
