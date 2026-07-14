"""Create a read-only, encrypted-workflow Course Explorer recovery package."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from course_explorer_recovery_format import (
    MAXIMUM_ROWS,
    MAXIMUM_TOTAL_ROWS,
    MINIMUM_ROWS,
    PRE_MIGRATION_NULLABLE_COLUMNS,
    RECOVERY_FORMAT,
    SOURCE_COMMIT_PATTERN,
    TABLE_COLUMNS,
    TABLE_ORDER,
    package_sha256,
    recovery_contract_sha256,
    rows_sha256,
    schema_sha256,
)

ROOT = SCRIPT_DIR.parent
DEFAULT_SCHEMA = ROOT / "supabase" / "recovery" / "course_explorer_base.sql"
PAGE_SIZE = 1_000
PROJECT_REF_PATTERN = re.compile(r"^[a-z0-9]{20}$")
CONTENT_RANGE_PATTERN = re.compile(r"^(\d+)-(\d+)/(\d+)$")


def validate_project_url(base_url: str, expected_project_ref: str) -> str:
    if not PROJECT_REF_PATTERN.fullmatch(expected_project_ref or ""):
        raise ValueError("Expected Supabase project ref must be exactly 20 lowercase letters/digits")
    parsed = urlparse(base_url)
    expected_host = f"{expected_project_ref}.supabase.co"
    if (
        parsed.scheme != "https"
        or parsed.hostname != expected_host
        or parsed.port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.params
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Supabase URL does not match the exact reviewed HTTPS project endpoint")
    return f"https://{expected_host}"


def fetch_table_snapshot(base_url, key, table, request_get=requests.get):
    if table not in TABLE_ORDER:
        raise ValueError("Recovery export table is not allowlisted")
    endpoint = f"{base_url}/rest/v1/{table}"
    rows = []
    expected_total = None
    for start in range(0, MAXIMUM_ROWS[table] + PAGE_SIZE, PAGE_SIZE):
        response = request_get(
            endpoint,
            headers={
                "apikey": key,
                "Authorization": f"Bearer {key}",
                "Accept": "application/json",
                "Prefer": "count=exact",
                "Range-Unit": "items",
                "Range": f"{start}-{start + PAGE_SIZE - 1}",
            },
            params={"select": "*", "order": "id.asc"},
            timeout=30,
            allow_redirects=False,
        )
        if response.status_code not in (200, 206):
            raise RuntimeError(f"Could not read {table}: HTTP {response.status_code}")
        content_range = response.headers.get("Content-Range", "")
        if content_range == "*/0":
            page_start, page_end, total = 0, -1, 0
        else:
            match = CONTENT_RANGE_PATTERN.fullmatch(content_range)
            if not match:
                raise RuntimeError(f"Could not read {table}: missing exact Content-Range")
            page_start, page_end, total = map(int, match.groups())
        if expected_total is None:
            expected_total = total
            if total > MAXIMUM_ROWS[table]:
                raise RuntimeError(f"{table} exceeds the reviewed row limit")
        if total != expected_total or (total and page_start != start):
            raise RuntimeError(f"{table} changed or returned an overlapping range during backup")
        page = response.json()
        if not isinstance(page, list) or len(page) != max(0, page_end - page_start + 1):
            raise RuntimeError(f"Could not read {table}: response length does not match range")
        rows.extend(page)
        if len(rows) == expected_total:
            return rows
        if len(rows) > expected_total or not page:
            raise RuntimeError(f"Could not read all {table} rows exactly")
    raise RuntimeError(f"Could not read all {table} rows within the reviewed limit")


def _validate_rows(table: str, rows: list[dict]) -> list[dict]:
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise RuntimeError(f"{table} backup expected only object rows")
    if not MINIMUM_ROWS[table] <= len(rows) <= MAXIMUM_ROWS[table]:
        raise RuntimeError(
            f"{table} row count {len(rows)} is outside the reviewed "
            f"{MINIMUM_ROWS[table]}..{MAXIMUM_ROWS[table]} range"
        )
    expected_columns = TABLE_COLUMNS[table]
    row_shapes = {frozenset(row) for row in rows}
    if not rows:
        normalized_rows = rows
    elif row_shapes == {expected_columns}:
        normalized_rows = rows
    else:
        nullable_columns = PRE_MIGRATION_NULLABLE_COLUMNS.get(table, frozenset())
        pre_migration_columns = expected_columns - nullable_columns
        if nullable_columns and row_shapes == {pre_migration_columns}:
            normalized_rows = [
                {**row, **{column: None for column in nullable_columns}}
                for row in rows
            ]
        else:
            raise RuntimeError(f"{table} does not match the reviewed column contract")
    if any(set(row) != expected_columns for row in normalized_rows):
        raise RuntimeError(f"{table} does not match the reviewed column contract")
    identities = [str(row.get("id") or "") for row in normalized_rows]
    if any(not identity for identity in identities):
        raise RuntimeError(f"{table} contains a blank identity")
    if len(set(identities)) != len(identities):
        raise RuntimeError(f"{table} contains duplicate identities")

    # Postgres applies the database collation to `order=id.asc`, while Python's
    # string ordering follows Unicode code points. Both are deterministic but
    # can disagree for punctuation or non-ASCII course identities. Canonicalize
    # the completed, uniqueness-checked capture locally so package hashes are
    # stable without treating a safe database collation as data corruption.
    return sorted(normalized_rows, key=lambda row: str(row["id"]))


def write_recovery_package(
    destination,
    base_url,
    key,
    *,
    expected_project_ref,
    source_commit,
    schema_path=DEFAULT_SCHEMA,
    fetch_rows=fetch_table_snapshot,
    now=None,
    contract_digest=None,
):
    output = Path(destination)
    if not output.is_absolute():
        raise ValueError("Recovery output path must be absolute.")
    if output.exists():
        raise FileExistsError("Refusing to overwrite an existing recovery artifact.")

    base_url = validate_project_url(base_url, expected_project_ref)
    if not SOURCE_COMMIT_PATTERN.fullmatch(source_commit or ""):
        raise ValueError("Recovery source commit must be a full lowercase Git SHA")
    schema_digest = schema_sha256(schema_path)
    contract_digest = contract_digest or recovery_contract_sha256(ROOT)

    def capture():
        captured = {}
        for table in TABLE_ORDER:
            rows = _validate_rows(table, fetch_rows(base_url, key, table))
            captured[table] = {
                "row_count": len(rows),
                "payload_sha256": rows_sha256(rows),
                "rows": rows,
            }
        return captured

    tables = capture()
    second_capture = capture()
    if tables != second_capture:
        raise RuntimeError("Course Explorer tables changed between complete backup captures")
    total_rows = sum(table["row_count"] for table in tables.values())
    if total_rows > MAXIMUM_TOTAL_ROWS:
        raise RuntimeError(
            f"Recovery package exceeds the reviewed {MAXIMUM_TOTAL_ROWS}-row total limit"
        )

    payload = {
        "format": RECOVERY_FORMAT,
        "created_at": (now or datetime.now(timezone.utc)).isoformat(),
        "project_url": base_url.rstrip("/"),
        "source_commit": source_commit,
        "schema_sha256": schema_digest,
        "recovery_contract_sha256": contract_digest,
        "total_row_count": total_rows,
        "tables": tables,
    }
    payload["package_sha256"] = package_sha256(
        schema_digest, contract_digest, source_commit, tables
    )

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("x", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2, sort_keys=True)
        handle.write("\n")
    return {
        "total_row_count": total_rows,
        "package_sha256": payload["package_sha256"],
        "tables": {
            table: {
                "row_count": tables[table]["row_count"],
                "payload_sha256": tables[table]["payload_sha256"],
            }
            for table in TABLE_ORDER
        },
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create a private Course Explorer recovery package")
    parser.add_argument("--output", required=True)
    parser.add_argument("--schema", default=str(DEFAULT_SCHEMA))
    parser.add_argument("--expected-project-ref", required=True)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args(argv)
    if not Path(args.output).is_absolute():
        parser.error("--output must be an absolute path")

    base_url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not base_url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required for a read-only recovery export.")

    result = write_recovery_package(
        args.output,
        base_url,
        key,
        expected_project_ref=args.expected_project_ref,
        source_commit=args.source_commit,
        schema_path=args.schema,
    )
    print(
        f"Created private Course Explorer recovery package: rows={result['total_row_count']}, "
        f"sha256={result['package_sha256']}"
    )
    for table in TABLE_ORDER:
        table_result = result["tables"][table]
        print(
            f"  {table}: rows={table_result['row_count']}, "
            f"sha256={table_result['payload_sha256']}"
        )


if __name__ == "__main__":
    main()
