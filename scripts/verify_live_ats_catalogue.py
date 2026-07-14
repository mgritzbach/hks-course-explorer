"""Read-only production proof for the active and retained ATS catalogues.

The active ATS manifest is private because only the service sync should inspect
or promote it. This verifier therefore runs only in the protected GitHub
workflow with the existing service credential. It never writes to Supabase.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import requests

from verify_live_hks_catalogue import (
    fetch_active_hks_rows,
    fetch_active_manifest as fetch_active_hks_manifest,
    parse_timestamp,
    verify_catalogue as verify_hks_catalogue,
)

PAGE_SIZE = 1_000
MAX_ROWS = 12_000
SAFE_SHA256 = re.compile(r"[0-9a-f]{64}")
SCHEDULE_BUILDER_SCHOOLS = {"FAS", "GSD", "HBS", "HDS", "HGSE", "HLS", "HMS", "HSPH", "NONH"}
PRODUCTION_PROJECT_URL = "https://cbtroatixvydpwoviezf.supabase.co"


def headers(key: str) -> dict[str, str]:
    return {"apikey": key, "Authorization": f"Bearer {key}"}


def validate_production_url(value: str) -> str:
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


def validate_rest_url(value: str) -> str:
    parsed = urlsplit(value)
    validate_production_url(f"{parsed.scheme}://{parsed.netloc}")
    if not parsed.path.startswith("/rest/v1/") or parsed.query or parsed.fragment:
        raise RuntimeError("Supabase request URL is outside the reviewed REST boundary")
    return value


def secure_request_get(url: str, **kwargs):
    validate_rest_url(url)
    kwargs["allow_redirects"] = False
    response = requests.get(url, **kwargs)
    if 300 <= response.status_code < 400:
        raise RuntimeError("Supabase redirect refused")
    return response


def fetch_json(url: str, key: str, params: dict[str, str], request_get=requests.get):
    validate_rest_url(url)
    response = request_get(
        url,
        headers=headers(key),
        params=params,
        timeout=30,
        allow_redirects=False,
    )
    if 300 <= response.status_code < 400:
        raise RuntimeError("Supabase redirect refused")
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list):
        raise RuntimeError("Supabase returned a non-list catalogue response")
    return payload


def fetch_active_ats_manifest(base_url: str, key: str, request_get=requests.get) -> dict:
    rows = fetch_json(
        f"{base_url.rstrip('/')}/rest/v1/live_catalogue_runs",
        key,
        {
            "select": "id,offering_count,source_snapshot_at,identity_sha256,term_counts",
            "source": "eq.ats",
            "status": "eq.active",
            "order": "activated_at.desc",
            "limit": "2",
        },
        request_get,
    )
    if len(rows) != 1 or not isinstance(rows[0], dict):
        raise RuntimeError("Expected exactly one active ATS catalogue manifest")
    return rows[0]


def fetch_non_hks_ats_rows(base_url: str, key: str, request_get=requests.get) -> list[dict]:
    rows: list[dict] = []
    for offset in range(0, MAX_ROWS, PAGE_SIZE):
        page = fetch_json(
            f"{base_url.rstrip('/')}/rest/v1/live_courses",
            key,
            {
                "select": (
                    "id,course_code,title,term,school,source,is_hks,sync_run_id,"
                    "active,source_last_seen_at"
                ),
                "source": "eq.ats",
                "is_hks": "eq.false",
                "order": "id.asc",
                "limit": str(PAGE_SIZE),
                "offset": str(offset),
            },
            request_get,
        )
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows
    raise RuntimeError(f"Non-HKS ATS catalogue exceeds the safe {MAX_ROWS}-row limit")


def fetch_ats_owned_hks_rows(
    base_url: str, key: str, run_id: str, request_get=requests.get
) -> list[dict]:
    return fetch_json(
        f"{base_url.rstrip('/')}/rest/v1/live_courses",
        key,
        {
            "select": "id",
            "sync_run_id": f"eq.{run_id}",
            "is_hks": "eq.true",
            "limit": "1",
        },
        request_get,
    )


def _active_candidate(rows: list[dict]) -> dict:
    preferred_terms = {"2026 Fall", "2027 Spring"}
    candidates = []
    for row in rows:
        if row.get("active") is not True or not all(
            isinstance(row.get(field), str) and row.get(field)
            for field in ("id", "course_code", "term", "school", "title")
        ):
            continue
        if row["school"] not in SCHEDULE_BUILDER_SCHOOLS or row["term"] not in preferred_terms:
            continue
        candidates.append(row)
    candidates.sort(
        key=lambda row: (
            row["term"] not in preferred_terms,
            row["term"],
            row["school"],
            row["course_code"],
            row["id"],
        )
    )
    if not candidates:
        raise RuntimeError("No browser-verifiable active ATS course exists")
    return {field: candidates[0][field] for field in ("id", "course_code", "title", "term", "school")}


def verify_ats_catalogue(
    manifest: dict,
    rows: list[dict],
    *,
    ats_owned_hks_rows: list[dict] | None = None,
    now: datetime | None = None,
    max_age_hours: float = 48,
) -> dict:
    run_id = manifest.get("id")
    expected = manifest.get("offering_count")
    expected_digest = manifest.get("identity_sha256")
    expected_terms = manifest.get("term_counts")
    if not isinstance(run_id, str) or not run_id:
        raise RuntimeError("Active ATS manifest has no run identity")
    if not isinstance(expected, int) or isinstance(expected, bool) or expected < 1:
        raise RuntimeError("Active ATS manifest has no valid offering count")
    if not isinstance(expected_digest, str) or not SAFE_SHA256.fullmatch(expected_digest):
        raise RuntimeError("Active ATS manifest has no valid identity digest")
    if not isinstance(expected_terms, dict) or not expected_terms:
        raise RuntimeError("Active ATS manifest has no valid term counts")
    if ats_owned_hks_rows:
        raise RuntimeError("Active ATS run owns an HKS row")

    observed_at = parse_timestamp(manifest.get("source_snapshot_at"), "source_snapshot_at")
    current = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    age_hours = (current - observed_at).total_seconds() / 3_600
    if age_hours < -1 or age_hours > max_age_hours:
        raise RuntimeError(
            f"Active ATS catalogue age {age_hours:.1f}h exceeds the {max_age_hours:.1f}h limit"
        )

    if any(
        row.get("source") != "ats"
        or row.get("is_hks") is not False
        or not isinstance(row.get("id"), str)
        or not row.get("id")
        for row in rows
    ):
        raise RuntimeError("Non-HKS ATS inventory contains an invalid ownership row")
    ids = [row["id"] for row in rows]
    if len(ids) != len(set(ids)):
        raise RuntimeError("Non-HKS ATS inventory contains duplicate identities")
    if any(not isinstance(row.get("active"), bool) for row in rows):
        raise RuntimeError("Non-HKS ATS inventory contains a non-boolean active state")
    if any(not isinstance(row.get("source_last_seen_at"), str) or not row["source_last_seen_at"] for row in rows):
        raise RuntimeError("Non-HKS ATS inventory contains a missing observation timestamp")

    active_rows = [row for row in rows if row["active"]]
    retained_rows = [row for row in rows if not row["active"]]
    if len(active_rows) != expected:
        raise RuntimeError(
            f"Active ATS row count {len(active_rows)} does not match manifest {expected}"
        )
    if any(row.get("sync_run_id") != run_id for row in active_rows):
        raise RuntimeError("Active ATS catalogue contains a row outside the active run")

    digest = hashlib.sha256("\n".join(sorted(row["id"] for row in active_rows)).encode()).hexdigest()
    terms = dict(sorted(Counter(str(row.get("term")) for row in active_rows).items()))
    if digest != expected_digest:
        raise RuntimeError("Active ATS identities do not match the persisted manifest")
    if terms != dict(sorted(expected_terms.items())):
        raise RuntimeError("Active ATS terms do not match the persisted manifest")

    active_candidate = _active_candidate(rows)
    browser_term_ids = sorted(
        row["id"] for row in active_rows if row.get("term") == active_candidate["term"]
    )
    return {
        "run_id": run_id,
        "active_offering_count": len(active_rows),
        "retained_inactive_count": len(retained_rows),
        "missing_observation_count": 0,
        "identity_sha256": digest,
        "term_counts": terms,
        "source_snapshot_at": observed_at.isoformat(),
        "age_hours": round(age_hours, 2),
        "browser_term_count": len(browser_term_ids),
        "browser_term_identity_sha256": hashlib.sha256(
            "\n".join(browser_term_ids).encode()
        ).hexdigest(),
        "active_candidate": active_candidate,
    }


def write_github_env(path: Path, ats_report: dict) -> None:
    values = {
        "ATS_ACTIVE_CODE": ats_report["active_candidate"]["course_code"],
        "ATS_ACTIVE_TERM": ats_report["active_candidate"]["term"],
        "ATS_ACTIVE_SCHOOL": ats_report["active_candidate"]["school"],
        "ATS_ACTIVE_TERM_COUNT": str(ats_report["browser_term_count"]),
        "ATS_ACTIVE_TERM_SHA256": ats_report["browser_term_identity_sha256"],
    }
    if any("\n" in value or "\r" in value for value in values.values()):
        raise RuntimeError("Browser candidate contains an unsafe newline")
    with path.open("a", encoding="utf-8") as handle:
        for name, value in values.items():
            handle.write(f"{name}={value}\n")


def aggregate_report(report: dict) -> dict:
    return {name: value for name, value in report.items() if name != "active_candidate"}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--github-env", type=Path)
    args = parser.parse_args()
    base_url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not base_url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required")
    base_url = validate_production_url(base_url)

    ats_manifest = fetch_active_ats_manifest(base_url, key)
    ats_report = verify_ats_catalogue(
        ats_manifest,
        fetch_non_hks_ats_rows(base_url, key),
        ats_owned_hks_rows=fetch_ats_owned_hks_rows(base_url, key, ats_manifest["id"]),
    )
    hks_report = verify_hks_catalogue(
        fetch_active_hks_manifest(base_url, key, request_get=secure_request_get),
        fetch_active_hks_rows(base_url, key, request_get=secure_request_get),
        max_age_hours=48,
    )
    if args.github_env:
        write_github_env(args.github_env, ats_report)
    print(json.dumps({"ats": aggregate_report(ats_report), "hks": hks_report}, sort_keys=True))


if __name__ == "__main__":
    main()
