"""Opt-in publisher for the additive unified catalogue snapshot.

Set CATALOGUE_SNAPSHOT_ENABLED=true only after the database migration, source
parity audit, and staging rollback test have been approved. Disabled is the
default and performs no database write.
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

from audit_catalogue_sources import audit_catalogue, fetch_all_supabase_rows, supabase_headers
from build_catalogue_snapshot import materialize_catalogue_snapshot

ROOT = Path(__file__).resolve().parent.parent
BATCH_SIZE = 250


def enabled():
    return os.environ.get("CATALOGUE_SNAPSHOT_ENABLED", "false").lower() == "true"


def snapshot_database_rows(sync_run_id, snapshot, offerings_by_id):
    """Transform pure snapshot records into the private database contract."""
    return [
        {
            "sync_run_id": sync_run_id,
            "offering_id": row["offering_id"],
            "course_code": row["course_code"],
            "course_code_base": row["course_code_base"],
            "term": row["term"],
            "school": row["school"],
            "title": row["title"],
            "instructors": row["instructors"],
            "current_offering": offerings_by_id[row["offering_id"]],
            "canonical_course_code": row["canonical_course_code"],
            "current_instructor_keys": row["current_instructor_keys"],
            "match_status": row["match_status"],
            "match_method": row["match_method"],
            "historical_course_codes": row["historical_course_codes"],
            "evaluation_summary": row["evaluation_summary"],
            "course_history_summary": row["course_history_summary"],
            "historical_records": row["historical_records"],
            "course_history_records": row["course_history_records"],
            "review_candidates": row["review_candidates"],
            "renumbering_review_candidates": row["renumbering_review_candidates"],
        }
        for row in snapshot
    ]


def post_json(endpoint, key, payload, *, prefer=None):
    headers = {**supabase_headers(key), "Content-Type": "application/json"}
    if prefer:
        headers["Prefer"] = prefer
    response = requests.post(endpoint, headers=headers, json=payload, timeout=30)
    if not response.ok:
        raise RuntimeError(f"Supabase POST failed: HTTP {response.status_code} {response.text[:300]}")
    return response


def fail_run(base_url, key, sync_run_id, reason):
    requests.patch(
        f"{base_url.rstrip('/')}/rest/v1/catalogue_sync_runs",
        headers={**supabase_headers(key), "Content-Type": "application/json"},
        params={"id": f"eq.{sync_run_id}"},
        json={"status": "failed", "failure_reason": reason[:2000]},
        timeout=30,
    )


def main():
    if not enabled():
        print("Catalogue snapshot publisher is disabled; no database write performed.")
        return

    base_url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not base_url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required when snapshot publishing is enabled.")

    with (ROOT / "data" / "school_config.json").open(encoding="utf-8") as handle:
        aliases = json.load(handle).get("historical_code_map", {})

    offerings = fetch_all_supabase_rows(base_url, key, "live_courses")
    historical_rows = fetch_all_supabase_rows(base_url, key, "courses")
    report = audit_catalogue(offerings, historical_rows, aliases)
    snapshot = materialize_catalogue_snapshot(offerings, historical_rows, aliases)
    source_snapshot_at = datetime.now(timezone.utc).isoformat()

    run_response = post_json(
        f"{base_url.rstrip('/')}/rest/v1/catalogue_sync_runs",
        key,
        {
            "status": "staging",
            "source_snapshot_at": source_snapshot_at,
            "current_offering_count": report["current_offering_count"],
            "historical_record_count": report["historical_record_count"],
            "snapshot_offering_count": len(snapshot),
            "hks_verified_history_count": report["hks_verified_history_count"],
            "hks_course_only_history_count": report["hks_course_only_history_count"],
            "hks_needs_review_count": report["hks_needs_review_count"],
            "hks_unmatched_history_count": report["hks_unmatched_history_count"],
            "alias_registry_version": "data/school_config.json",
        },
        prefer="return=representation",
    )
    run_rows = run_response.json()
    if not isinstance(run_rows, list) or len(run_rows) != 1 or not run_rows[0].get("id"):
        raise RuntimeError("Supabase did not return a valid catalogue staging run id.")
    sync_run_id = run_rows[0]["id"]

    offerings_by_id = {str(row["id"]): row for row in offerings}

    try:
        rows = snapshot_database_rows(sync_run_id, snapshot, offerings_by_id)
        endpoint = f"{base_url.rstrip('/')}/rest/v1/catalogue_snapshot_v1"
        for start in range(0, len(rows), BATCH_SIZE):
            post_json(endpoint, key, rows[start : start + BATCH_SIZE], prefer="resolution=merge-duplicates")
        post_json(
            f"{base_url.rstrip('/')}/rest/v1/rpc/promote_catalogue_snapshot",
            key,
            {"p_sync_run_id": sync_run_id},
        )
    except Exception as exc:
        fail_run(base_url, key, sync_run_id, str(exc))
        raise

    print(json.dumps({"sync_run_id": sync_run_id, **report}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
