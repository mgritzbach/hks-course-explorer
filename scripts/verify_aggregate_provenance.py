"""Verify deterministic aggregate IDs without rewriting historical sources.

Aggregate rows in the browser catalogue add a digest of their visible review
window so two averages for the same course and professor cannot collide. The
legacy Supabase row retains its original undigested ID. This utility proves the
relationship only when it can recompute the generated ID from the complete
legacy source row. It never creates aliases, changes IDs, or authorizes a
rating link.
"""

import json
import os
import sys
from pathlib import Path

# This script also runs as an isolated test subject, where Python has not
# automatically placed the repository's scripts directory on sys.path.
SCRIPTS_DIR = Path(__file__).resolve().parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from audit_catalogue_sources import fetch_all_supabase_rows, load_canonical_history_rows
from build_data import clean_text, parse_bool, parse_year, stable_course_id


def generated_aggregate_id(row):
    """Recompute a generated aggregate ID, or return None for every other row."""
    year = parse_year(row.get("year"))
    term = clean_text(row.get("term"))
    if not parse_bool(row.get("is_average")) or year != 0 or term != "Average":
        return None
    course_code = clean_text(row.get("course_code"))
    professor = clean_text(row.get("professor"))
    course_name = clean_text(row.get("course_name"))
    if not all((course_code, professor, course_name)):
        return None
    return stable_course_id(row, course_code, year, term, professor, course_name)


def verify_aggregate_provenance(source_rows, canonical_rows):
    """Return a conservative aggregate-only provenance classification."""
    canonical_by_id = {}
    duplicate_canonical_ids = set()
    for row in canonical_rows:
        canonical_id = str(row.get("id") or "")
        if not canonical_id:
            continue
        if canonical_id in canonical_by_id:
            duplicate_canonical_ids.add(canonical_id)
            continue
        canonical_by_id[canonical_id] = row
    source_ids = set()
    verified = []
    missing = []
    invalid = []

    for row in source_rows:
        source_id = str(row.get("id") or "")
        generated_id = generated_aggregate_id(row)
        if not generated_id:
            continue
        if not source_id:
            invalid.append({"reason": "missing_source_id"})
            continue
        if source_id in source_ids:
            invalid.append({"reason": "duplicate_source_id", "source_id": source_id})
            continue
        source_ids.add(source_id)
        undigested_id = generated_id.rsplit("||aggregate-", 1)[0]
        if source_id != undigested_id:
            invalid.append({"reason": "source_id_does_not_match_aggregate_base", "source_id": source_id})
            continue
        if generated_id in duplicate_canonical_ids:
            invalid.append({"reason": "duplicate_generated_id", "source_id": source_id})
            continue
        canonical = canonical_by_id.get(generated_id)
        if not canonical:
            missing.append({"source_id": source_id, "generated_id": generated_id})
            continue
        if not parse_bool(canonical.get("is_average")):
            invalid.append({"reason": "generated_id_is_not_aggregate", "source_id": source_id})
            continue
        verified.append({"source_id": source_id, "generated_id": generated_id})

    verified_ids = [row["generated_id"] for row in verified]
    if len(set(verified_ids)) != len(verified_ids):
        invalid.append({"reason": "generated_id_collision"})
    return {
        "aggregate_source_count": len(source_ids),
        "verified_generated_aggregate_count": len(verified),
        "missing_generated_aggregate_count": len(missing),
        "invalid_generated_aggregate_count": len(invalid),
        "verified": verified,
        "missing": missing,
        "invalid": invalid,
    }


def main():
    base_url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not base_url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required for this read-only verification.")
    source_rows = fetch_all_supabase_rows(base_url, key, "courses")
    result = verify_aggregate_provenance(source_rows, load_canonical_history_rows())
    # This utility may run in CI. Keep record identities in the in-memory
    # result for a controlled operator, but never emit them into public logs.
    print(
        json.dumps(
            {
                key: value
                for key, value in result.items()
                if key not in {"verified", "missing", "invalid"}
            },
            indent=2,
            sort_keys=True,
        )
    )
    if result["missing_generated_aggregate_count"] or result["invalid_generated_aggregate_count"]:
        sys.exit("Aggregate provenance verification did not prove every aggregate source row.")


if __name__ == "__main__":
    main()
