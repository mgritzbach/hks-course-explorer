"""Verify the published public snapshot and bundle it as an outage fallback."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlsplit

import requests


def copy_snapshot(base_url, output, request_get=requests.get, expected_manifest=None):
    url = urlsplit(base_url)
    if url.scheme != "https" or not url.hostname.endswith(".pages.dev") or url.username or url.query or url.fragment or url.path not in ("", "/"):
        raise ValueError("Expected a public HTTPS Pages snapshot origin")
    base_url = base_url.rstrip("/")
    response = request_get(f"{base_url}/manifest.json", timeout=30)
    response.raise_for_status()
    manifest = response.json()
    if expected_manifest is not None and manifest != expected_manifest:
        raise ValueError("Published manifest is not the exact candidate being verified")
    entries = manifest.get("datasets", {})
    if manifest.get("schema") != 1 or not all(name in entries for name in ("history", "credits", "terms")):
        raise ValueError("Invalid snapshot manifest")
    if entries["history"]["count"] < 5000 or entries["terms"]["count"] < 285:
        raise ValueError("Incomplete public snapshot")
    output = Path(output)
    for entry in entries.values():
        if not re.fullmatch(r"snapshots/[a-f0-9]{64}\.json", entry["path"]):
            raise ValueError("Unsafe snapshot path")
        reply = request_get(f"{base_url}/{entry['path']}", timeout=30)
        reply.raise_for_status()
        content = reply.content
        if len(content) != entry["bytes"] or hashlib.sha256(content).hexdigest() != entry["sha256"]:
            raise ValueError("Published snapshot checksum differs from its manifest")
        rows = json.loads(content)
        if not isinstance(rows, list) or len(rows) != entry["count"] or len({row["id"] for row in rows}) != len(rows):
            raise ValueError("Published snapshot has incomplete or duplicate rows")
        destination = output / entry["path"]
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(content)
    output.mkdir(parents=True, exist_ok=True)
    (output / "manifest.json").write_text(json.dumps(manifest, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"verified_version": manifest["version"], "datasets": len(entries)}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--expected-manifest", type=Path)
    arguments = parser.parse_args()
    expected = json.loads(arguments.expected_manifest.read_text(encoding="utf-8")) if arguments.expected_manifest else None
    copy_snapshot(arguments.url, arguments.output, expected_manifest=expected)
