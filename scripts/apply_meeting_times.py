"""Usage: python scripts/apply_meeting_times.py

Merge scraped meeting day/time data from scripts/meeting_times_output.json
back into public/courses.json using course_url as the join key.
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSES_JSON = ROOT / "public" / "courses.json"
MEETING_TIMES_JSON = ROOT / "scripts" / "meeting_times_output.json"


def main() -> None:
    with COURSES_JSON.open(encoding="utf-8") as fh:
        payload = json.load(fh)

    with MEETING_TIMES_JSON.open(encoding="utf-8") as fh:
        meeting_times = json.load(fh)

    updated = 0
    for course in payload.get("courses", []):
        url = (course.get("course_url") or "").strip()
        if not url:
            continue

        schedule = meeting_times.get(url)
        if not schedule:
            continue

        course["meeting_days"] = schedule.get("meeting_days")
        course["meeting_time"] = schedule.get("meeting_time")
        course["meeting_time_end"] = schedule.get("meeting_time_end")
        updated += 1

    with COURSES_JSON.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"Updated {updated} courses in {COURSES_JSON}")


if __name__ == "__main__":
    main()
