"""
load_to_supabase.py — HKS Course Explorer canonical data loader
================================================================
Reads courses.json (already built by build_data.py) and upserts all
course records into the Supabase `courses` table.

Usage:
    python scripts/load_to_supabase.py

Prerequisites:
    pip install supabase

Environment variables (or .env file):
    SUPABASE_URL  — your project URL, e.g. https://xxx.supabase.co
    SUPABASE_KEY  — service-role key (NOT the anon key) for write access
                    Find it in: Supabase → Project Settings → API → service_role

The table is upserted (insert or replace) on the `id` column, so
re-running this script is safe and idempotent.

To add new academic year data:
    1. Update data/canonical_courses_enriched.csv with the new rows
    2. Run: python scripts/build_data.py         (rebuilds courses.json)
    3. Run: python scripts/load_to_supabase.py   (syncs to Supabase)
"""

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
COURSES_JSON = ROOT / "public" / "courses.json"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://cbtroatixvydpwoviezf.supabase.co")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")  # set your service-role key here or via env


BATCH_SIZE = 200  # rows per upsert call


def load_courses():
    if not COURSES_JSON.exists():
        sys.exit(f"ERROR: {COURSES_JSON} not found. Run `python scripts/build_data.py` first.")

    with COURSES_JSON.open(encoding="utf-8") as fh:
        payload = json.load(fh)

    return payload.get("courses", [])


def prepare_row(course):
    """Strip frontend-only computed fields and keep only DB columns."""
    return {
        "id":                  course.get("id"),
        "course_code":         course.get("course_code"),
        "course_code_base":    course.get("course_code_base"),
        "concentration":       course.get("concentration"),
        "year":                course.get("year"),
        "term":                course.get("term"),
        "is_average":          course.get("is_average", False),
        "year_range":          course.get("year_range"),
        "n_terms":             course.get("n_terms"),
        "professor":           course.get("professor"),
        "professor_display":   course.get("professor_display"),
        "faculty_title":       course.get("faculty_title"),
        "faculty_category":    course.get("faculty_category"),
        "course_name":         course.get("course_name"),
        "description":         course.get("description"),
        "course_url":          course.get("course_url"),
        "meeting_days":        course.get("meeting_days", None),
        "meeting_time":        course.get("meeting_time", None),
        "meeting_time_end":    course.get("meeting_time_end", None),
        "is_stem":             course.get("is_stem", False),
        "stem_group":          course.get("stem_group"),
        "stem_school":         course.get("stem_school"),
        "is_core":             course.get("is_core", False),
        "has_eval":            course.get("has_eval", False),
        "n_respondents":       course.get("n_respondents"),
        "total_n_respondents": course.get("total_n_respondents"),
        "metrics_raw":         course.get("metrics_raw"),
        "metrics_pct":         course.get("metrics_pct"),
        "instructor_label":    course.get("instructor_label"),
        "workload_label":      course.get("workload_label"),
        "has_bidding":         course.get("has_bidding", False),
        "ever_bidding":        course.get("ever_bidding", False),
        "last_bid_price":      course.get("last_bid_price"),
        "last_bid_acad":       course.get("last_bid_acad"),
        "last_bid_term":       course.get("last_bid_term"),
        "last_bid_capacity":   course.get("last_bid_capacity"),
        "last_bid_n_bids":     course.get("last_bid_n_bids"),
        "bid_clearing_price":  course.get("bid_clearing_price"),
        "bid_academic_year":   course.get("bid_academic_year"),
        "bid_capacity":        course.get("bid_capacity"),
        "bid_n_bids":          course.get("bid_n_bids"),
    }


def main():
    if not SUPABASE_KEY:
        sys.exit(
            "ERROR: SUPABASE_KEY is not set.\n"
            "Set it via environment variable or edit this script.\n"
            "Use the service_role key (Project Settings → API → service_role)."
        )

    try:
        from supabase import create_client  # noqa: PLC0415
    except ImportError:
        sys.exit("ERROR: supabase-py not installed. Run: pip install supabase")

    client = create_client(SUPABASE_URL, SUPABASE_KEY)
    courses = load_courses()

    if not courses:
        sys.exit("ERROR: No courses found in courses.json")

    # Sanity check: warn if course count looks unexpectedly low
    EXPECTED_MIN = 5000
    if len(courses) < EXPECTED_MIN:
        print(f"WARNING: Only {len(courses)} courses loaded — expected at least {EXPECTED_MIN}.")
        print("         Verify courses.json is up-to-date before continuing.")
        answer = input("Continue anyway? [y/N] ").strip().lower()
        if answer != "y":
            sys.exit("Aborted.")

    print(f"Loaded {len(courses)} courses from {COURSES_JSON}")
    print(f"Upserting to Supabase ({SUPABASE_URL}) in batches of {BATCH_SIZE}…")

    rows = [prepare_row(c) for c in courses]
    total_upserted = 0
    failed_batches = []

    for start in range(0, len(rows), BATCH_SIZE):
        batch = rows[start : start + BATCH_SIZE]
        batch_num = start // BATCH_SIZE + 1
        try:
            client.table("courses").upsert(batch, on_conflict="id").execute()
            total_upserted += len(batch)
            pct = int(total_upserted / len(rows) * 100)
            print(f"  {total_upserted}/{len(rows)} ({pct}%)", end="\r", flush=True)
        except Exception as exc:
            failed_batches.append((batch_num, start, str(exc)))
            print(f"\n  ERROR in batch {batch_num} (rows {start}–{start + len(batch)}): {exc}")

    print(f"\nDone. {total_upserted}/{len(rows)} rows upserted.")

    if failed_batches:
        print(f"\n⚠ {len(failed_batches)} batch(es) failed:")
        for num, start_row, err in failed_batches:
            print(f"  Batch {num} (starting row {start_row}): {err}")
        sys.exit(f"ERROR: {len(failed_batches)} batch(es) failed — check errors above.")

    # Verify final count in Supabase matches what we sent
    try:
        result = client.table("courses").select("id", count="exact").execute()
        db_count = result.count
        if db_count is not None and abs(db_count - len(rows)) > 10:
            print(f"WARNING: Supabase reports {db_count} rows but we upserted {len(rows)}.")
            print("         There may be stale rows from a previous dataset version.")
        else:
            print(f"Verified: {db_count} rows in Supabase.")
    except Exception as exc:
        print(f"Could not verify row count: {exc}")

    print(f"Supabase project: {SUPABASE_URL}")


if __name__ == "__main__":
    main()
