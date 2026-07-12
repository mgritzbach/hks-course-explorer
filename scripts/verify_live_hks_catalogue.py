"""Fail closed unless the active production HKS catalogue matches its sync manifest."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone

import requests

PAGE_SIZE = 1_000
MAX_ROWS = 10_000


def headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def fetch_json(url: str, key: str, params: dict[str, str], request_get=requests.get):
    response = request_get(url, headers=headers(key), params=params, timeout=30)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("Supabase returned a non-list catalogue response")
    return payload


def fetch_active_manifest(base_url: str, key: str, request_get=requests.get) -> dict:
    rows = fetch_json(
        f"{base_url.rstrip('/')}/rest/v1/live_catalogue_runs",
        key,
        {
            "select": (
                "id,offering_count,source_snapshot_at,activated_at,identity_sha256,term_counts"
            ),
            "source": "eq.myharvard",
            "status": "eq.active",
            "order": "activated_at.desc",
            "limit": "2",
        },
        request_get,
    )
    if len(rows) != 1 or not isinstance(rows[0], dict):
        raise RuntimeError("Expected exactly one active my.harvard catalogue manifest")
    return rows[0]


def fetch_active_hks_rows(base_url: str, key: str, request_get=requests.get) -> list[dict]:
    rows: list[dict] = []
    for offset in range(0, MAX_ROWS, PAGE_SIZE):
        page = fetch_json(
            f"{base_url.rstrip('/')}/rest/v1/live_courses",
            key,
            {
                "select": (
                    "id,source_offering_id,course_code,title,term,source,sync_run_id"
                ),
                "active": "eq.true",
                "is_hks": "eq.true",
                "order": "id.asc",
                "limit": str(PAGE_SIZE),
                "offset": str(offset),
            },
            request_get,
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
    raise RuntimeError(f"Active HKS catalogue exceeds the safe {MAX_ROWS}-row limit")


def parse_timestamp(value: object, field: str) -> datetime:
    if not isinstance(value, str) or not value:
        raise RuntimeError(f"Active catalogue manifest has no valid {field}")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise RuntimeError(f"Active catalogue manifest has invalid {field}") from exc
    if parsed.tzinfo is None:
        raise RuntimeError(f"Active catalogue manifest {field} has no timezone")
    return parsed.astimezone(timezone.utc)


def verify_catalogue(
    manifest: dict,
    rows: list[dict],
    *,
    now: datetime | None = None,
    max_age_hours: float = 48,
) -> dict:
    expected = manifest.get("offering_count")
    run_id = manifest.get("id")
    manifest_digest = manifest.get("identity_sha256")
    manifest_terms = manifest.get("term_counts")
    if not isinstance(expected, int) or expected < 1 or not isinstance(run_id, str) or not run_id:
        raise RuntimeError("Active catalogue manifest is incomplete")
    if not isinstance(manifest_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", manifest_digest):
        raise RuntimeError("Active catalogue manifest has no valid identity digest")
    if not isinstance(manifest_terms, dict) or any(
        not isinstance(term, str)
        or not term
        or not isinstance(count, int)
        or isinstance(count, bool)
        or count < 1
        for term, count in manifest_terms.items()
    ):
        raise RuntimeError("Active catalogue manifest has no valid term counts")
    if len(rows) != expected:
        raise RuntimeError(f"Active HKS row count {len(rows)} does not match manifest {expected}")

    ids = [row.get("id") for row in rows]
    if any(not isinstance(value, str) or not value for value in ids) or len(set(ids)) != expected:
        raise RuntimeError("Active HKS catalogue has blank or duplicate offering identities")
    source_ids = [row.get("source_offering_id") for row in rows]
    if any(not isinstance(value, str) or not value for value in source_ids) or len(
        set(source_ids)
    ) != expected:
        raise RuntimeError("Active HKS catalogue has blank or duplicate upstream identities")
    if any(row.get("source") != "myharvard" or row.get("sync_run_id") != run_id for row in rows):
        raise RuntimeError("Active HKS catalogue contains a row outside the active my.harvard run")
    if any(not row.get("course_code") or not row.get("title") or not row.get("term") for row in rows):
        raise RuntimeError("Active HKS catalogue contains a blank student-visible field")

    observed_at = parse_timestamp(manifest.get("source_snapshot_at"), "source_snapshot_at")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    age_hours = (current - observed_at).total_seconds() / 3_600
    if age_hours < -1 or age_hours > max_age_hours:
        raise RuntimeError(
            f"Active HKS catalogue age {age_hours:.1f}h exceeds the {max_age_hours:.1f}h limit"
        )

    terms = dict(sorted(Counter(str(row["term"]) for row in rows).items()))
    digest = hashlib.sha256("\n".join(sorted(source_ids)).encode("utf-8")).hexdigest()
    if digest != manifest_digest:
        raise RuntimeError("Active HKS identities do not match the persisted upstream digest")
    if terms != dict(sorted(manifest_terms.items())):
        raise RuntimeError("Active HKS terms do not match the persisted upstream term counts")
    return {
        "offering_count": expected,
        "distinct_ids": len(set(ids)),
        "distinct_source_ids": len(set(source_ids)),
        "terms": terms,
        "source_snapshot_at": observed_at.isoformat(),
        "age_hours": round(age_hours, 2),
        "identity_sha256": digest,
    }


def main() -> None:
    base_url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_ANON_KEY", "").strip()
    max_age_hours = float(os.environ.get("MAX_HKS_CATALOGUE_AGE_HOURS", "48"))
    if not base_url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_ANON_KEY are required")
    report = verify_catalogue(
        fetch_active_manifest(base_url, key),
        fetch_active_hks_rows(base_url, key),
        max_age_hours=max_age_hours,
    )
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
