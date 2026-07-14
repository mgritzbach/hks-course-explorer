"""Generate a local historical reconciliation registry from public reads.

The generator is read-only with respect to Supabase. It writes only the
explicit local output path and prints aggregate counts; row-level review data
is never emitted to CI logs.
"""

import argparse
import csv
import hashlib
import json
import os
from collections import defaultdict
from pathlib import Path

from audit_catalogue_sources import fetch_all_supabase_rows
from build_data import (
    SOURCE_CSV,
    _merge_complementary_rows,
    bid_sort_key,
    build_course,
    clean_text,
    fill_average_bid_fields,
    nullable_text,
    parse_float,
    parse_int,
    validate_rows,
)
from historical_parity_reconciliation import build_registry

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUTPUT = ROOT / "data" / "historical_parity_registry.json"
CANONICAL_SOURCE = SOURCE_CSV


def normalized_file_sha256(path):
    content = Path(path).read_bytes().replace(b"\r\n", b"\n").replace(b"\r", b"\n")
    return hashlib.sha256(content).hexdigest()


def load_generated_canonical_rows():
    """Build the pre-reconciliation CSV contract without reading courses.json."""
    with CANONICAL_SOURCE.open(encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.DictReader(handle, delimiter=";"))
    validate_rows(rows)
    rows, _ = _merge_complementary_rows(rows)
    fill_average_bid_fields(rows)

    bid_rows_by_course = defaultdict(list)
    for row in rows:
        course_code = clean_text(row.get("course_code"))
        if course_code and any(
            clean_text(row.get(field))
            for field in (
                "bid_academic_year",
                "bid_clearing_price",
                "bid_capacity",
                "bid_n_bids",
            )
        ):
            bid_rows_by_course[course_code].append(row)

    latest_bid_lookup = {}
    for course_code, bid_rows in bid_rows_by_course.items():
        latest = max(bid_rows, key=bid_sort_key)
        latest_bid_lookup[course_code] = {
            "last_bid_price": parse_float(latest.get("bid_clearing_price")),
            "last_bid_acad": nullable_text(latest.get("bid_academic_year")),
            "last_bid_term": clean_text(latest.get("term")),
            "last_bid_capacity": parse_int(latest.get("bid_capacity")),
            "last_bid_n_bids": parse_int(latest.get("bid_n_bids")),
        }
    return [build_course(row, latest_bid_lookup) for row in rows]


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Build the non-destructive historical parity registry from public Supabase reads."
    )
    parser.add_argument("--output", default=str(DEFAULT_OUTPUT))
    parser.add_argument("--expected-database-rows", type=int)
    args = parser.parse_args(argv)

    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not url or not key:
        raise SystemExit("SUPABASE_URL and a read-only SUPABASE_KEY are required.")

    database_rows = fetch_all_supabase_rows(url, key, "courses")
    if args.expected_database_rows is not None and len(database_rows) != args.expected_database_rows:
        raise SystemExit(
            f"Database row count drifted: expected {args.expected_database_rows}, got {len(database_rows)}."
        )
    canonical_rows = load_generated_canonical_rows()
    registry = build_registry(
        database_rows,
        canonical_rows,
        normalized_file_sha256(CANONICAL_SOURCE),
    )

    destination = Path(args.output).resolve()
    if destination != DEFAULT_OUTPUT.resolve():
        raise SystemExit(f"Registry output must be {DEFAULT_OUTPUT}.")
    destination.write_text(
        json.dumps(registry, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    result = registry["result"]
    print(
        "Historical parity registry written: "
        f"same-id={result['same_id_count']}, "
        f"same-id-source-preserved={result['same_id_source_preservation_count']}, "
        f"same-id-canonical-enriched={result['same_id_canonical_enrichment_count']}, "
        f"exact-observation-overrides={result['exact_observation_id_override_count']}, "
        f"preserved-database-only={result['preserved_database_only_count']}, "
        f"additive-canonical-only={result['additive_canonical_only_count']}, "
        f"projected={result['projected_row_count']}."
    )


if __name__ == "__main__":
    main()
