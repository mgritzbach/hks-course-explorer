"""Read-only parity audit for the future unified catalogue.

This utility never writes to Supabase. It paginates the existing current and
historical tables, materialises the proposed catalogue in memory, and reports
the evidence needed before a later snapshot promotion.
"""

import json
import os
import sys
from pathlib import Path

import requests

from build_catalogue_snapshot import materialize_catalogue_snapshot

ROOT = Path(__file__).resolve().parent.parent
PAGE_SIZE = 1000
MAX_ROWS = 10000


def supabase_headers(key):
    return {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}


def fetch_all_supabase_rows(base_url, key, table, request_get=requests.get):
    """Read every row in a deterministically ordered table, without truncation."""
    rows = []
    endpoint = f"{base_url.rstrip('/')}/rest/v1/{table}"

    for start in range(0, MAX_ROWS, PAGE_SIZE):
        response = request_get(
            endpoint,
            headers={**supabase_headers(key), "Range-Unit": "items", "Range": f"{start}-{start + PAGE_SIZE - 1}"},
            params={"select": "*", "order": "id.asc"},
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(f"Could not read {table}: HTTP {response.status_code}")
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError(f"Could not read {table}: expected a JSON list")
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows

    raise RuntimeError(f"{table} exceeds the safe {MAX_ROWS} row audit limit")


def audit_catalogue(offerings, historical_rows, aliases):
    snapshot = materialize_catalogue_snapshot(offerings, historical_rows, aliases)
    source_ids = [str(row["id"]) for row in offerings]
    snapshot_ids = [row["offering_id"] for row in snapshot]
    if len(set(source_ids)) != len(source_ids):
        raise RuntimeError("live_courses contains duplicate offering IDs")
    if sorted(source_ids) != snapshot_ids:
        raise RuntimeError("snapshot offering IDs do not exactly match live_courses")

    hks_rows = [row for row in snapshot if row.get("school") == "HKS"]
    verified = [row for row in hks_rows if row["match_status"] == "verified"]
    unmatched = [row for row in hks_rows if row["match_status"] == "unmatched"]
    return {
        "current_offering_count": len(snapshot),
        "historical_record_count": len(historical_rows),
        "hks_current_offering_count": len(hks_rows),
        "hks_verified_history_count": len(verified),
        "hks_unmatched_history_count": len(unmatched),
        "unmatched_hks_codes": sorted(
            {
                row["course_code_base"]
                for row in unmatched
                if isinstance(row.get("course_code_base"), str) and row["course_code_base"]
            }
        ),
    }


def main():
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required for this read-only audit.")

    with (ROOT / "data" / "school_config.json").open(encoding="utf-8") as handle:
        aliases = json.load(handle).get("historical_code_map", {})

    offerings = fetch_all_supabase_rows(url, key, "live_courses")
    historical_rows = fetch_all_supabase_rows(url, key, "courses")
    print(json.dumps(audit_catalogue(offerings, historical_rows, aliases), indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
