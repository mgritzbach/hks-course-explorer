"""Read-only exact production verifier for historical catalogue parity."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.parse import urlsplit

import requests

from historical_parity_reconciliation import (
    id_digest,
    load_registry,
    same_id_evaluation_enrichment_target,
    sha256_json,
)
from load_to_supabase import load_courses, prepare_row

ROOT = Path(__file__).resolve().parent.parent
REGISTRY = ROOT / "data" / "historical_parity_registry.json"
PRODUCTION_PROJECT_URL = "https://cbtroatixvydpwoviezf.supabase.co"
PAGE_SIZE = 1_000
MAX_ROWS = 10_000
COURSE_COLUMNS = tuple(prepare_row({}).keys())


def headers(key):
    return {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}


def validate_production_url(value):
    parsed = urlsplit(value)
    expected = urlsplit(PRODUCTION_PROJECT_URL)
    if (
        parsed.scheme != expected.scheme
        or parsed.hostname != expected.hostname
        or parsed.port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise RuntimeError("SUPABASE_URL does not match the reviewed production project")
    return PRODUCTION_PROJECT_URL


def fetch_courses(base_url, key, request_get=requests.get):
    base_url = validate_production_url(base_url)
    endpoint = f"{base_url}/rest/v1/courses"
    rows = []
    for offset in range(0, MAX_ROWS, PAGE_SIZE):
        response = request_get(
            endpoint,
            headers=headers(key),
            params={
                "select": ",".join(COURSE_COLUMNS),
                "order": "id.asc",
                "limit": str(PAGE_SIZE),
                "offset": str(offset),
            },
            timeout=30,
            allow_redirects=False,
        )
        if 300 <= response.status_code < 400:
            raise RuntimeError("Supabase redirect refused")
        response.raise_for_status()
        page = response.json()
        if not isinstance(page, list) or not all(isinstance(row, dict) for row in page):
            raise RuntimeError("Supabase returned an invalid historical catalogue page")
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
    raise RuntimeError(f"Historical catalogue exceeds the safe {MAX_ROWS}-row limit")


def verify_pre_migration_catalogue(database_rows, registry):
    """Prove the complete reviewed 5,812-row preimage before any write."""
    source = registry["source"]
    if len(database_rows) != source["database_row_count"]:
        raise RuntimeError(
            f"Historical preflight has {len(database_rows)} rows; "
            f"expected {source['database_row_count']}"
        )
    ordered = sorted(database_rows, key=lambda row: row["id"])
    if id_digest(ordered) != source["database_id_sha256"]:
        raise RuntimeError("Historical preflight immutable-ID manifest drifted")
    if sha256_json(ordered) != source["database_row_sha256"]:
        raise RuntimeError("Historical preflight full row payload drifted")
    additive_ids = set(registry["additive_canonical_ids"])
    if additive_ids & {row["id"] for row in ordered}:
        raise RuntimeError("Historical preflight already contains an additive ID")
    return {
        "phase": "before",
        "historical_row_count": len(ordered),
        "immutable_id_sha256": source["database_id_sha256"],
        "full_row_sha256": source["database_row_sha256"],
        "additive_ids_absent": True,
    }


def verify_live_catalogue(database_rows, canonical_rows, registry):
    result = registry["result"]
    source = registry["source"]
    additive_ids = set(registry["additive_canonical_ids"])
    enrichment_items = registry.get("same_id_canonical_enrichments", [])
    enrichment_ids = {item["id"] for item in enrichment_items}
    expected_count = result["projected_row_count"]
    if len(database_rows) != expected_count:
        raise RuntimeError(
            f"Historical database has {len(database_rows)} rows; expected {expected_count}"
        )
    if id_digest(database_rows) != result["projected_id_sha256"]:
        raise RuntimeError("Historical database immutable-ID manifest differs from the registry")
    if id_digest(canonical_rows) != result["projected_id_sha256"]:
        raise RuntimeError("Generated catalogue immutable-ID manifest differs from the registry")

    database_by_id = {row["id"]: row for row in database_rows}
    canonical_by_id = {row["id"]: row for row in canonical_rows}
    if len(database_by_id) != len(database_rows) or len(canonical_by_id) != len(canonical_rows):
        raise RuntimeError("Historical catalogue contains duplicate immutable IDs")

    prechange_ids = set(database_by_id) - additive_ids
    if len(prechange_ids) != source["database_row_count"]:
        raise RuntimeError("Historical pre-change population count does not close")
    prechange_rows = [database_by_id[row_id] for row_id in sorted(prechange_ids)]
    if id_digest(prechange_rows) != source["database_id_sha256"]:
        raise RuntimeError("A pre-change historical immutable ID was added, omitted, or rewritten")

    unchanged_rows = [
        database_by_id[row_id]
        for row_id in sorted(prechange_ids - enrichment_ids)
    ]
    if len(unchanged_rows) != source["database_unchanged_after_enrichment_row_count"]:
        raise RuntimeError("Unchanged historical pre-change row count does not close")
    if (
        sha256_json(unchanged_rows)
        != source["database_unchanged_after_enrichment_row_sha256"]
    ):
        raise RuntimeError("A non-enriched historical pre-change row payload changed")

    for item in enrichment_items:
        row_id = item["id"]
        expected = prepare_row(canonical_by_id[row_id])
        if same_id_evaluation_enrichment_target(item["row"], expected) != expected:
            raise RuntimeError(f"Generated enrichment target is invalid for {row_id}")
        if database_by_id.get(row_id) != expected:
            raise RuntimeError(f"Same-ID evaluation enrichment differs for {row_id}")

    for row_id in sorted(additive_ids):
        expected = prepare_row(canonical_by_id[row_id])
        if database_by_id.get(row_id) != expected:
            raise RuntimeError(f"Additive historical row payload differs for {row_id}")

    return {
        "phase": "after",
        "historical_row_count": len(database_rows),
        "immutable_id_sha256": result["projected_id_sha256"],
        "unchanged_prechange_row_count": len(unchanged_rows),
        "unchanged_prechange_row_sha256": source[
            "database_unchanged_after_enrichment_row_sha256"
        ],
        "same_id_evaluation_enrichment_count": len(enrichment_ids),
        "additive_row_count": len(additive_ids),
        "zero_omitted_prechange_rows": True,
        "exact_additive_payloads": True,
    }


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Verify the exact historical catalogue before or after reconciliation."
    )
    parser.add_argument("--phase", choices=("before", "after"), default="after")
    args = parser.parse_args(argv)
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not url or not key:
        raise SystemExit("SUPABASE_URL and SUPABASE_KEY are required for read-only verification.")
    database_rows = fetch_courses(url, key)
    registry = load_registry(REGISTRY)
    if args.phase == "before":
        report = verify_pre_migration_catalogue(database_rows, registry)
    else:
        report = verify_live_catalogue(database_rows, load_courses(), registry)
    print(json.dumps(report, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
