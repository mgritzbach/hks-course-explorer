"""Usage: python scripts/seed_mock_schedule.py

Seed mock meeting schedule data into public/courses.json for local filter testing.
"""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
COURSES_JSON = ROOT / "public" / "courses.json"

PATTERNS = [
    {"meeting_days": ["Mon", "Wed"], "meeting_time": "10:15", "meeting_time_end": "11:45"},
    {"meeting_days": ["Tue", "Thu"], "meeting_time": "13:00", "meeting_time_end": "14:30"},
    {"meeting_days": ["Mon", "Wed", "Fri"], "meeting_time": "09:00", "meeting_time_end": "10:00"},
    {"meeting_days": ["Thu"], "meeting_time": "18:15", "meeting_time_end": "20:45"},
    {"meeting_days": ["Tue", "Thu"], "meeting_time": "10:15", "meeting_time_end": "11:45"},
    {"meeting_days": ["Mon", "Wed"], "meeting_time": "14:30", "meeting_time_end": "16:00"},
    {"meeting_days": ["Fri"], "meeting_time": "09:00", "meeting_time_end": "12:00"},
]


def main() -> None:
    payload = json.loads(COURSES_JSON.read_text(encoding="utf-8"))
    courses = payload.get("courses", [])

    seeded = 0
    for course in courses:
        if seeded >= 30:
            break
        if course.get("year") != 2024:
            continue
        if not course.get("has_eval"):
            continue
        if course.get("is_average"):
            continue

        pattern = PATTERNS[seeded % len(PATTERNS)]
        course["meeting_days"] = pattern["meeting_days"]
        course["meeting_time"] = pattern["meeting_time"]
        course["meeting_time_end"] = pattern["meeting_time_end"]
        seeded += 1

    COURSES_JSON.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"seeded count: {seeded}")


if __name__ == "__main__":
    main()
