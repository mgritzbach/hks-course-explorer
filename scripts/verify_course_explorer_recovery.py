"""Validate and round-trip a Course Explorer recovery package in scratch PostgreSQL."""

from __future__ import annotations

import argparse
import csv
from datetime import datetime
import json
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from course_explorer_recovery_format import (
    MAXIMUM_ROWS,
    MAXIMUM_TOTAL_ROWS,
    MINIMUM_ROWS,
    RECOVERY_FORMAT,
    SOURCE_COMMIT_PATTERN,
    TABLE_COLUMNS,
    TABLE_ORDER,
    package_sha256,
    recovery_contract_sha256,
    rows_sha256,
    schema_sha256,
)

MAX_RESTORED_PAYLOAD_CHARS = 1_048_576
ROOT = SCRIPT_DIR.parent


def load_recovery_package(
    path,
    expected_project_url,
    schema_path,
    expected_source_commit,
    *,
    expected_contract_digest=None,
):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("format") != RECOVERY_FORMAT:
        raise ValueError("Unsupported Course Explorer recovery format")
    if payload.get("project_url", "").rstrip("/") != expected_project_url.rstrip("/"):
        raise ValueError("Recovery project URL does not match the reviewed production project")
    if set(payload) != {
        "format", "created_at", "project_url", "source_commit", "schema_sha256",
        "recovery_contract_sha256", "total_row_count", "tables", "package_sha256",
    }:
        raise ValueError("Recovery package contains an unknown or missing top-level field")
    try:
        created_at = datetime.fromisoformat(payload["created_at"])
    except (TypeError, ValueError) as exc:
        raise ValueError("Recovery created_at must be an ISO-8601 timestamp") from exc
    if created_at.tzinfo is None:
        raise ValueError("Recovery created_at must include a timezone")
    if not SOURCE_COMMIT_PATTERN.fullmatch(expected_source_commit or ""):
        raise ValueError("Expected recovery source commit must be a full lowercase Git SHA")
    if payload.get("source_commit") != expected_source_commit:
        raise ValueError("Recovery package is not bound to the backup workflow commit")

    expected_schema_digest = schema_sha256(schema_path)
    if payload.get("schema_sha256") != expected_schema_digest:
        raise ValueError("Recovery schema digest does not match the reviewed baseline")
    expected_contract_digest = (
        expected_contract_digest or recovery_contract_sha256(ROOT)
    )
    if payload.get("recovery_contract_sha256") != expected_contract_digest:
        raise ValueError("Recovery package does not match the reviewed recovery contract")
    tables = payload.get("tables")
    if not isinstance(tables, dict):
        raise ValueError("Recovery tables manifest must be an object")
    if set(tables) != set(TABLE_ORDER):
        raise ValueError("Recovery package does not contain the exact reviewed table set")

    total_rows = 0
    for table in TABLE_ORDER:
        table_payload = tables[table]
        if not isinstance(table_payload, dict):
            raise ValueError(f"Recovery table {table} manifest must be an object")
        if set(table_payload) != {"row_count", "payload_sha256", "rows"}:
            raise ValueError(f"Recovery table {table} manifest has unknown or missing fields")
        rows = table_payload.get("rows")
        if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
            raise ValueError(f"Recovery table {table} rows must be objects")
        if table_payload.get("row_count") != len(rows):
            raise ValueError(f"Recovery table {table} row count does not match its manifest")
        if not MINIMUM_ROWS[table] <= len(rows) <= MAXIMUM_ROWS[table]:
            raise ValueError(f"Recovery table {table} row count is outside the reviewed range")
        if any(set(row) != TABLE_COLUMNS[table] for row in rows):
            raise ValueError(f"Recovery table {table} does not match the reviewed column contract")
        identities = [str(row.get("id") or "") for row in rows]
        if any(not identity for identity in identities):
            raise ValueError(f"Recovery table {table} contains a blank identity")
        if len(set(identities)) != len(identities):
            raise ValueError(f"Recovery table {table} contains duplicate identities")
        if identities != sorted(identities):
            raise ValueError(f"Recovery table {table} is not deterministically ordered")
        if table_payload.get("payload_sha256") != rows_sha256(rows):
            raise ValueError(f"Recovery table {table} digest does not match its manifest")
        total_rows += len(rows)

    if total_rows > MAXIMUM_TOTAL_ROWS or payload.get("total_row_count") != total_rows:
        raise ValueError("Recovery total row count does not match its manifest")
    if payload.get("package_sha256") != package_sha256(
        expected_schema_digest,
        expected_contract_digest,
        expected_source_commit,
        tables,
    ):
        raise ValueError("Recovery package digest does not match its manifest")
    return payload


def write_restore_csv(package, destination):
    output = Path(destination)
    with output.open("x", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        for table in TABLE_ORDER:
            for ordinal, row in enumerate(package["tables"][table]["rows"]):
                writer.writerow(
                    [
                        table,
                        ordinal,
                        str(row["id"]),
                        json.dumps(row, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                    ]
                )


def read_restored_rows(path):
    csv.field_size_limit(MAX_RESTORED_PAYLOAD_CHARS)
    restored = {table: [] for table in TABLE_ORDER}
    with Path(path).open(encoding="utf-8", newline="") as handle:
        try:
            for record in csv.reader(handle):
                if len(record) != 2 or record[0] not in restored:
                    raise ValueError("Restored CSV must contain a reviewed table and JSON payload")
                row = json.loads(record[1])
                if not isinstance(row, dict):
                    raise ValueError("Restored payload contains a non-object row")
                restored[record[0]].append(row)
        except csv.Error as exc:
            raise ValueError(
                f"Restored JSON payload exceeds the {MAX_RESTORED_PAYLOAD_CHARS}-character limit"
            ) from exc
    return restored


def verify_restored_rows(package, restored):
    if set(restored) != set(TABLE_ORDER):
        raise ValueError("Restored output does not contain the reviewed table set")
    results = {}
    for table in TABLE_ORDER:
        expected = package["tables"][table]["rows"]
        actual = restored[table]
        if actual != expected:
            raise ValueError(f"Restored {table} rows do not exactly match the recovery package")
        digest = rows_sha256(actual)
        if digest != package["tables"][table]["payload_sha256"]:
            raise ValueError(f"Restored {table} digest does not match the recovery package")
        results[table] = {"row_count": len(actual), "payload_sha256": digest}
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description="Verify Course Explorer recovery in scratch PostgreSQL")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("prepare", "verify"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--package", required=True)
        subparser.add_argument("--expected-project-url", required=True)
        subparser.add_argument("--schema", required=True)
        subparser.add_argument("--csv", required=True)
        subparser.add_argument("--expected-source-commit", required=True)
    args = parser.parse_args(argv)

    package = load_recovery_package(
        args.package,
        args.expected_project_url,
        args.schema,
        args.expected_source_commit,
    )
    if args.command == "prepare":
        write_restore_csv(package, args.csv)
        print(
            f"Prepared Course Explorer recovery: rows={package['total_row_count']}, "
            f"sha256={package['package_sha256']}"
        )
        return

    results = verify_restored_rows(package, read_restored_rows(args.csv))
    print(f"Verified Course Explorer recovery package sha256={package['package_sha256']}")
    for table in TABLE_ORDER:
        print(
            f"  {table}: rows={results[table]['row_count']}, "
            f"sha256={results[table]['payload_sha256']}"
        )


if __name__ == "__main__":
    main()
