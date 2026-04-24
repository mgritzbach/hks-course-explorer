"""
scrape_beta_harvard.py
──────────────────────
Scrapes ALL HKS course schedule data from beta.my.harvard.edu
(no authentication required) and upserts into Supabase course_sections.

This covers IGA, MPA, HLS, PAL, SCI, STK and other subjects that the
Harvard ATS API missed due to its 50-result cap.

Usage:
    python scripts/scrape_beta_harvard.py

Required env vars:
    SUPABASE_URL   — e.g. https://cbtroatixvydpwoviezf.supabase.co
    SUPABASE_KEY   — service-role key (full write access)
"""

import os
import re
import sys
import time
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────────
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
SUPABASE_UPSERT = f"{SUPABASE_URL}/rest/v1/course_sections"

SEARCH_URL = "https://beta.my.harvard.edu/search/"
COURSE_BASE = "https://beta.my.harvard.edu"

SEARCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "HX-Request": "true",
    "HX-Target": "search-results",
    "Accept": "text/html,application/xhtml+xml,*/*;q=0.8",
    "Referer": "https://beta.my.harvard.edu/",
}

# Only include current academic year terms
KEEP_TERMS = {"2025-Fall", "2026-Spring", "2025-January", "2026-January", "2026-Fall"}

# Map from URL term to our DB term format
TERM_MAP = {
    "2025-Fall": "2025Fall",
    "2026-Spring": "2026Spring",
    "2025-January": "2025January",
    "2026-January": "2026January",
    "2026-Fall": "2026Fall",
}

DAY_MAP = {
    "sunday": "SUN", "monday": "MON", "tuesday": "TUE",
    "wednesday": "WED", "thursday": "THU", "friday": "FRI", "saturday": "SAT",
}


def norm_time(t):
    """Convert '10:30am' → '10:30', '2:00pm' → '14:00'."""
    if not t:
        return ""
    t = str(t).strip().lower()
    m = re.match(r"^(\d{1,2}):(\d{2})\s*(am|pm)?$", t)
    if not m:
        return t
    h, mn, ampm = int(m.group(1)), int(m.group(2)), m.group(3)
    if ampm == "am" and h == 12:
        h = 0
    if ampm == "pm" and h != 12:
        h += 12
    return f"{h:02d}:{mn:02d}"


def parse_course_url(href):
    """
    Parse '/course/IGA108/2026-Spring/001' into
    (course_code_base='IGA-108', term_url='2026-Spring', section='001')
    """
    m = re.match(r"/course/([A-Z]+)(\d+[A-Z]?M?Y?)/(\d{4}-\w+)/(\w+)", href, re.I)
    if not m:
        return None
    subj, num, term_url, section = m.group(1), m.group(2), m.group(3), m.group(4)
    code_base = f"{subj.upper()}-{num.upper()}"
    return code_base, term_url, section


def parse_schedule_from_html(html):
    """
    Extract meeting schedule from a beta.my.harvard.edu course detail page.
    Returns list of {day, start, end, location}.
    """
    soup = BeautifulSoup(html, "html.parser")

    # Find all schedule blocks — each group of day-circles + time span
    # The page structure has: a day-group row, then a time span, possibly repeated
    # Selected days have aria-label="Tuesday, selected"

    meetings = []

    # Strategy: find all elements with aria-label containing ", selected"
    # and group them with their nearest time span
    # We find all "schedule blocks" — look for the Week Days group role
    day_groups = soup.find_all(attrs={"role": "group", "aria-label": re.compile(r"Week Days", re.I)})

    for group in day_groups:
        active_days = []
        for el in group.find_all(attrs={"aria-label": re.compile(r", selected", re.I)}):
            label = el.get("aria-label", "").lower()
            day_name = label.split(",")[0].strip()
            abbr = DAY_MAP.get(day_name)
            if abbr:
                active_days.append(abbr)

        if not active_days:
            continue

        # Find the time span — look for the next sibling div containing a time range
        # Walk up to the parent schedule block and find the time span
        parent = group.parent
        # Walk siblings to find a span with time pattern
        time_text = ""
        loc_text = ""

        # Look in the parent and next siblings
        search_area = parent if parent else group
        for span in search_area.find_all("span"):
            txt = span.get_text(strip=True)
            if re.match(r"\d+:\d+[ap]m\s*-\s*\d+:\d+[ap]m", txt, re.I):
                time_text = txt
                break

        # Parse start/end from "9:00am - 10:15am"
        time_parts = re.split(r"\s*-\s*", time_text)
        start = norm_time(time_parts[0]) if len(time_parts) >= 1 else ""
        end = norm_time(time_parts[1]) if len(time_parts) >= 2 else ""

        for day in active_days:
            if day and start:
                meetings.append({
                    "day": day,
                    "start": start,
                    "end": end,
                    "location": loc_text,
                })

    return meetings


def fetch_course_schedule(url):
    """Fetch a course detail page and return parsed meetings."""
    try:
        resp = requests.get(
            COURSE_BASE + url,
            headers={"User-Agent": SEARCH_HEADERS["User-Agent"]},
            timeout=20,
        )
        if not resp.ok:
            return []
        return parse_schedule_from_html(resp.text)
    except Exception as e:
        print(f"    Warning fetching {url}: {e}")
        return []


def fetch_all_course_urls():
    """
    Paginate through the HKS search to get all course URLs.
    Returns dict: {(course_code_base, term_url): first_section_url}
    """
    seen = {}  # (code_base, term_url) → href
    page = 1

    while True:
        print(f"  Fetching search page {page}...", end="", flush=True)
        try:
            resp = requests.get(
                SEARCH_URL,
                params={"q": "", "school": "HKS", "term": "All",
                        "sort": "subject_catalog", "page": page},
                headers=SEARCH_HEADERS,
                timeout=20,
            )
            data = resp.json()
        except Exception as e:
            print(f" ERROR: {e}")
            break

        html = data.get("hits", "")
        soup = BeautifulSoup(html, "html.parser")
        cards = soup.find_all("div", class_="course-card")

        if not cards:
            print(f" no more cards, stopping at page {page}")
            break

        found = 0
        for card in cards:
            link = card.find("a", href=re.compile(r"/course/"))
            if not link:
                continue
            href = link["href"]
            parsed = parse_course_url(href)
            if not parsed:
                continue
            code_base, term_url, section = parsed

            # Skip terms we don't care about
            if term_url not in KEEP_TERMS:
                continue

            key = (code_base, term_url)
            if key not in seen:
                seen[key] = href
                found += 1

        print(f" {len(cards)} cards, {found} new unique courses (total: {len(seen)})")
        page += 1
        time.sleep(0.3)  # be polite

    return seen


def build_rows(course_urls):
    """
    For each unique (code_base, term), fetch the detail page and build a DB row.
    """
    rows = []
    fetched_at = datetime.now(timezone.utc).isoformat()
    total = len(course_urls)

    for i, ((code_base, term_url), href) in enumerate(course_urls.items(), 1):
        term_db = TERM_MAP.get(term_url, term_url.replace("-", ""))
        row_id = f"{code_base}__{term_db}"

        print(f"  [{i}/{total}] {code_base} {term_url} ...", end="", flush=True)
        meetings = fetch_course_schedule(href)

        if meetings:
            print(f" OK {len(meetings)} meetings ({', '.join(m['day'] for m in meetings)})")
        else:
            print(" (no times)")

        rows.append({
            "id": row_id,
            "course_code_base": code_base,
            "course_code": code_base,
            "term": term_db,
            "harvard_id": "",
            "section_type": "LEC",
            "title": "",          # we don't have title from search, that's OK
            "credits": None,
            "instructors": [],
            "meetings": meetings,
            "is_active": True,
            "raw": {"source": "beta.my.harvard.edu", "url": href},
            "fetched_at": fetched_at,
        })

        time.sleep(0.4)  # polite delay between course page fetches

    return rows


def upsert_rows(rows, batch_size=50):
    """Upsert rows to Supabase course_sections. Skips rows without meeting times."""
    # Only upsert rows that have meeting times (don't overwrite good data with empty)
    rows_with_times = [r for r in rows if r["meetings"]]
    rows_without = len(rows) - len(rows_with_times)
    print(f"  Rows with times: {len(rows_with_times)} | Without: {rows_without}")

    if not rows_with_times:
        return 0

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    total = 0
    for i in range(0, len(rows_with_times), batch_size):
        batch = rows_with_times[i:i + batch_size]
        resp = requests.post(SUPABASE_UPSERT, headers=headers, json=batch, timeout=30)
        if not resp.ok:
            print(f"  Warning: Upsert {resp.status_code}: {resp.text[:300]}")
        else:
            total += len(batch)
        time.sleep(0.1)
    return total


def main():
    import json as _json
    dry_run = "--dry-run" in sys.argv

    print(f"beta.my.harvard.edu Scraper — {datetime.now().strftime('%Y-%m-%d %H:%M')}")
    if dry_run:
        print("(DRY RUN — will save JSON but skip Supabase upsert)")
    print()

    print("Step 1: Collecting all HKS course URLs from search...")
    course_urls = fetch_all_course_urls()
    print(f"Found {len(course_urls)} unique (course, term) combinations")
    print()

    print("Step 2: Fetching schedule for each course...")
    rows = build_rows(course_urls)
    print()

    with_times = sum(1 for r in rows if r["meetings"])
    print(f"Summary: {len(rows)} courses, {with_times} with meeting times")

    # Always save to JSON for inspection / backup
    out_path = os.path.join(os.path.dirname(__file__), "beta_harvard_sections.json")
    with open(out_path, "w") as f:
        _json.dump(rows, f, indent=2)
    print(f"Saved to {out_path}")
    print()

    if dry_run:
        print("Dry run complete — skipping Supabase upsert.")
        return

    print("Step 3: Upserting to Supabase...")
    upserted = upsert_rows(rows)
    print(f"Done — {upserted} rows upserted to course_sections")


if __name__ == "__main__":
    main()
