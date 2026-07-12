"""Standard-library-only format contract for ``live_courses`` backups."""

import json


BACKUP_FORMAT = "hks-live-courses-backup-v1"


def canonical_payload_bytes(rows):
    """Return stable bytes for the manifest digest without reordering rows."""
    return json.dumps(rows, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )
