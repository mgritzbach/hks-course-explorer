"""Read-only parity audit for the future unified catalogue.

This utility never writes to Supabase. It paginates the existing current and
historical tables, materialises the proposed catalogue in memory, and reports
the evidence needed before a later snapshot promotion.
"""

import json
import os
import sys
from collections import Counter
from pathlib import Path

import requests

from build_catalogue_snapshot import (
    materialize_catalogue_snapshot,
    normalise_course_code,
    normalise_course_title,
    normalise_instructor_name,
)

ROOT = Path(__file__).resolve().parent.parent
PAGE_SIZE = 1000
MAX_ROWS = 10000
CANONICAL_HISTORY_JSON = ROOT / "public" / "courses.json"


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


def load_canonical_history_rows(path=CANONICAL_HISTORY_JSON):
    """Load the generated history contract that the browser currently serves."""
    with Path(path).open(encoding="utf-8") as handle:
        payload = json.load(handle)
    rows = payload.get("courses") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise RuntimeError("Canonical courses.json does not contain a courses array")
    return rows


def historical_source_parity(source_rows, canonical_rows):
    """Compare history by immutable IDs; a count match alone can still hide drift."""
    source_ids = [str(row.get("id")) for row in source_rows if row.get("id")]
    canonical_ids = [str(row.get("id")) for row in canonical_rows if row.get("id")]
    duplicate_source_ids = sorted(
        row_id for row_id, count in Counter(source_ids).items() if count > 1
    )
    duplicate_canonical_ids = sorted(
        row_id for row_id, count in Counter(canonical_ids).items() if count > 1
    )
    source_set = set(source_ids)
    canonical_set = set(canonical_ids)
    return {
        "canonical_history_count": len(canonical_ids),
        "historical_source_matches_canonical": not duplicate_source_ids
        and not duplicate_canonical_ids
        and source_set == canonical_set,
        "historical_source_only_count": len(source_set - canonical_set),
        "canonical_history_only_count": len(canonical_set - source_set),
        "historical_source_duplicate_id_count": len(duplicate_source_ids),
        "canonical_history_duplicate_id_count": len(duplicate_canonical_ids),
    }


def historical_semantic_key(row):
    """Return a conservative historical identity independent of storage ID.

    This is an audit-only fingerprint.  It identifies candidates whose legacy
    and generated IDs differ but whose code, term, year, professor, title, and
    aggregate/individual status agree exactly after presentation
    normalisation.  It never authorises an ID rewrite or evaluation link.
    """
    if not isinstance(row, dict):
        return None
    code = normalise_course_code(row.get("course_code_base") or row.get("course_code"))
    year = str(row.get("year") or "").strip()
    term = str(row.get("term") or "").strip().casefold()
    professor = normalise_instructor_name(row.get("professor") or row.get("professor_display"))
    title = normalise_course_title(row.get("course_name"))
    is_average = str(row.get("is_average", False)).strip().casefold()
    if not all((code, year, term, professor, title)):
        return None
    return code, year, term, professor, title, is_average


def semantic_history_reconciliation(source_rows, canonical_rows):
    """Summarise exact non-ID historical matches without mutating either source."""
    source_by_key = {}
    canonical_by_key = {}
    source_without_key = 0
    canonical_without_key = 0

    for row in source_rows:
        key = historical_semantic_key(row)
        if key is None:
            source_without_key += 1
            continue
        source_by_key.setdefault(key, []).append(str(row.get("id")))
    for row in canonical_rows:
        key = historical_semantic_key(row)
        if key is None:
            canonical_without_key += 1
            continue
        canonical_by_key.setdefault(key, []).append(str(row.get("id")))

    shared_keys = set(source_by_key) & set(canonical_by_key)
    one_to_one_keys = [
        key for key in shared_keys
        if len(source_by_key[key]) == 1 and len(canonical_by_key[key]) == 1
    ]
    same_id = sum(
        source_by_key[key][0] == canonical_by_key[key][0]
        for key in one_to_one_keys
    )
    return {
        "semantic_exact_one_to_one_count": len(one_to_one_keys),
        "semantic_same_id_count": same_id,
        "semantic_changed_id_candidate_count": len(one_to_one_keys) - same_id,
        "semantic_ambiguous_shared_key_count": len(shared_keys) - len(one_to_one_keys),
        "semantic_source_only_row_count": sum(
            len(rows) for key, rows in source_by_key.items() if key not in canonical_by_key
        ),
        "semantic_canonical_only_row_count": sum(
            len(rows) for key, rows in canonical_by_key.items() if key not in source_by_key
        ),
        "semantic_source_missing_key_count": source_without_key,
        "semantic_canonical_missing_key_count": canonical_without_key,
    }


def require_historical_source_parity(source_rows, canonical_rows):
    """Stop a future promotion before writes when its history differs from the live website."""
    result = historical_source_parity(source_rows, canonical_rows)
    if result["historical_source_matches_canonical"]:
        return result
    raise RuntimeError(
        "Historical source does not exactly match canonical courses.json "
        f"(source-only={result['historical_source_only_count']}, "
        f"canonical-only={result['canonical_history_only_count']}, "
        f"source-duplicates={result['historical_source_duplicate_id_count']}, "
        f"canonical-duplicates={result['canonical_history_duplicate_id_count']}). "
        "Reconcile the historical source before publishing a unified snapshot."
    )


def audit_catalogue(offerings, historical_rows, aliases, canonical_rows=None):
    snapshot = materialize_catalogue_snapshot(offerings, historical_rows, aliases)
    source_ids = [str(row["id"]) for row in offerings]
    snapshot_ids = [row["offering_id"] for row in snapshot]
    if len(set(source_ids)) != len(source_ids):
        raise RuntimeError("live_courses contains duplicate offering IDs")
    if sorted(source_ids) != snapshot_ids:
        raise RuntimeError("snapshot offering IDs do not exactly match live_courses")

    hks_rows = [row for row in snapshot if row.get("school") == "HKS"]
    verified = [row for row in hks_rows if row["match_status"] == "verified"]
    course_only = [row for row in hks_rows if row["match_status"] == "course_only"]
    needs_review = [row for row in hks_rows if row["match_status"] == "needs_review"]
    unmatched = [row for row in hks_rows if row["match_status"] == "unmatched"]
    renumbering_candidates = [
        row for row in needs_review if row.get("renumbering_review_candidates")
    ]
    report = {
        "current_offering_count": len(snapshot),
        "historical_record_count": len(historical_rows),
        "hks_current_offering_count": len(hks_rows),
        "hks_verified_history_count": len(verified),
        "hks_course_only_history_count": len(course_only),
        "hks_needs_review_count": len(needs_review),
        "hks_unmatched_history_count": len(unmatched),
        "hks_renumbering_review_count": len(renumbering_candidates),
        "review_candidate_hks_codes": sorted(
            {
                row["course_code_base"]
                for row in needs_review
                if isinstance(row.get("course_code_base"), str) and row["course_code_base"]
            }
        ),
        "unmatched_hks_codes": sorted(
            {
                row["course_code_base"]
                for row in unmatched
                if isinstance(row.get("course_code_base"), str) and row["course_code_base"]
            }
        ),
        "renumbering_review_hks_codes": sorted(
            {
                row["course_code_base"]
                for row in renumbering_candidates
                if isinstance(row.get("course_code_base"), str) and row["course_code_base"]
            }
        ),
    }
    if canonical_rows is not None:
        report.update(historical_source_parity(historical_rows, canonical_rows))
        report.update(semantic_history_reconciliation(historical_rows, canonical_rows))
    return report


def main():
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required for this read-only audit.")

    with (ROOT / "data" / "school_config.json").open(encoding="utf-8") as handle:
        aliases = json.load(handle).get("historical_code_map", {})

    offerings = fetch_all_supabase_rows(url, key, "live_courses")
    historical_rows = fetch_all_supabase_rows(url, key, "courses")
    canonical_rows = load_canonical_history_rows()
    print(
        json.dumps(
            audit_catalogue(offerings, historical_rows, aliases, canonical_rows),
            indent=2,
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    main()
