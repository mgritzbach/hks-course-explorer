"""Create a read-only, integrity-verifiable ``live_courses`` backup.

The backup is intentionally an operator-run workflow artifact rather than a
database mutation. It is a prerequisite for a separately reviewed recovery or
reconciliation operation; this script never restores, deletes, or updates a
row.
"""

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from audit_catalogue_sources import MAX_ROWS, fetch_all_supabase_rows


BACKUP_FORMAT = "hks-live-courses-backup-v1"


def canonical_payload_bytes(rows):
    """Return stable bytes for the manifest digest without reordering rows."""
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")


def write_backup(destination, base_url, key, fetch_rows=fetch_all_supabase_rows, now=None):
    """Fetch every current course and exclusively create a new JSON backup file."""
    output = Path(destination)
    if not output.is_absolute():
        raise ValueError("Backup output path must be absolute.")
    if output.exists():
        raise FileExistsError("Refusing to overwrite an existing backup artifact.")

    rows = fetch_rows(base_url, key, "live_courses")
    if len(rows) > MAX_ROWS:
        raise RuntimeError(f"live_courses exceeds the safe {MAX_ROWS} row backup limit")
    if not all(isinstance(row, dict) for row in rows):
        raise RuntimeError("live_courses backup expected only object rows")

    created_at = (now or datetime.now(timezone.utc)).isoformat()
    payload = {
        "format": BACKUP_FORMAT,
        "created_at": created_at,
        "project_url": base_url.rstrip("/"),
        "row_count": len(rows),
        "payload_sha256": hashlib.sha256(canonical_payload_bytes(rows)).hexdigest(),
        "rows": rows,
    }

    output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    # ``x`` closes the check/write race: a parallel operator cannot replace an
    # existing artifact after the earlier existence check.
    with output.open("x", encoding="utf-8") as handle:
        handle.write(serialized)
    return {"row_count": len(rows), "payload_sha256": payload["payload_sha256"]}


def main(argv=None):
    parser = argparse.ArgumentParser(description="Create a private read-only live_courses backup artifact.")
    parser.add_argument("--output", required=True, help="Absolute path for a new backup JSON file")
    args = parser.parse_args(argv)
    if not Path(args.output).is_absolute():
        parser.error("--output must be an absolute path")

    base_url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not base_url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required for a read-only backup.")

    result = write_backup(args.output, base_url, key)
    print(f"Created private live_courses backup: rows={result['row_count']}, sha256={result['payload_sha256']}")


if __name__ == "__main__":
    main()
