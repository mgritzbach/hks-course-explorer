"""Validate and round-trip an encrypted-workflow ``live_courses`` backup.

The caller decrypts the artifact into a private runner file. This utility
validates the signed manifest, prepares a CSV for an ephemeral PostgreSQL
restore probe, and verifies the rows exported back from that scratch database.
It never connects to production or staging services.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from pathlib import Path

from export_live_courses_backup import BACKUP_FORMAT, canonical_payload_bytes

LIVE_COURSES_COLUMNS = frozenset(
    {
        "id",
        "course_code",
        "course_code_base",
        "title",
        "term",
        "credits",
        "instructors",
        "description",
        "location",
        "meeting_days",
        "time_start",
        "time_end",
        "school",
        "is_hks",
        "synced_at",
        "session_code",
        "session_description",
        "cross_reg_eligible",
        "source",
        "source_course_id",
        "course_offer_nbr",
        "section_code",
        "source_url",
        "sync_run_id",
        "active",
        "source_offering_id",
    }
)


def load_backup(
    path: str | Path,
    expected_project_url: str,
    minimum_rows: int = 1,
) -> dict:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("format") != BACKUP_FORMAT:
        raise ValueError("Unsupported live_courses backup format")
    if not expected_project_url or payload.get("project_url", "").rstrip("/") != expected_project_url.rstrip("/"):
        raise ValueError("Backup project URL does not match the reviewed production project")
    if not isinstance(minimum_rows, int) or isinstance(minimum_rows, bool) or minimum_rows < 1:
        raise ValueError("Minimum live_courses row count must be a positive integer")
    rows = payload.get("rows")
    if not isinstance(rows, list) or any(not isinstance(row, dict) for row in rows):
        raise ValueError("Backup rows must be a list of objects")
    if payload.get("row_count") != len(rows) or len(rows) < minimum_rows:
        raise ValueError("Backup row count does not match its manifest")
    for row in rows:
        if set(row) != LIVE_COURSES_COLUMNS:
            raise ValueError("Backup row does not match the reviewed live_courses column contract")
    ids = [row.get("id") for row in rows]
    if any(not isinstance(row_id, str) or not row_id for row_id in ids):
        raise ValueError("Backup contains a blank live_courses identity")
    if len(set(ids)) != len(ids):
        raise ValueError("Backup contains duplicate live_courses identities")
    digest = hashlib.sha256(canonical_payload_bytes(rows)).hexdigest()
    if payload.get("payload_sha256") != digest:
        raise ValueError("Backup payload digest does not match its manifest")
    return payload


def write_restore_csv(backup: dict, destination: str | Path) -> None:
    output = Path(destination)
    with output.open("x", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, lineterminator="\n")
        for ordinal, row in enumerate(backup["rows"]):
            writer.writerow(
                [
                    ordinal,
                    row["id"],
                    json.dumps(row, ensure_ascii=False, separators=(",", ":"), sort_keys=True),
                ]
            )


def read_restored_rows(path: str | Path) -> list[dict]:
    rows = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line:
            row = json.loads(line)
            if not isinstance(row, dict):
                raise ValueError("Restored payload contains a non-object row")
            rows.append(row)
    return rows


def verify_restored_rows(backup: dict, restored_rows: list[dict]) -> dict:
    expected_rows = backup["rows"]
    if restored_rows != expected_rows:
        raise ValueError("PostgreSQL restore does not exactly match the backup payload")
    digest = hashlib.sha256(canonical_payload_bytes(restored_rows)).hexdigest()
    if digest != backup["payload_sha256"]:
        raise ValueError("PostgreSQL restore digest does not match the backup manifest")
    return {"row_count": len(restored_rows), "payload_sha256": digest}


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Verify a live_courses backup restore round trip")
    subparsers = parser.add_subparsers(dest="command", required=True)

    prepare = subparsers.add_parser("prepare", help="validate backup and emit restore CSV")
    prepare.add_argument("--backup", required=True)
    prepare.add_argument("--expected-project-url", required=True)
    prepare.add_argument("--minimum-rows", type=int, default=1)
    prepare.add_argument("--csv", required=True)

    verify = subparsers.add_parser("verify", help="verify rows exported from scratch PostgreSQL")
    verify.add_argument("--backup", required=True)
    verify.add_argument("--expected-project-url", required=True)
    verify.add_argument("--minimum-rows", type=int, default=1)
    verify.add_argument("--restored", required=True)

    args = parser.parse_args(argv)
    backup = load_backup(args.backup, args.expected_project_url, args.minimum_rows)
    if args.command == "prepare":
        write_restore_csv(backup, args.csv)
        print(
            f"Prepared PostgreSQL restore probe: rows={backup['row_count']}, "
            f"sha256={backup['payload_sha256']}"
        )
        return

    result = verify_restored_rows(backup, read_restored_rows(args.restored))
    print(
        f"Verified PostgreSQL restore round trip: rows={result['row_count']}, "
        f"sha256={result['payload_sha256']}"
    )


if __name__ == "__main__":
    main()
