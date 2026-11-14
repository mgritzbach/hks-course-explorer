"""Export only the existing anonymous browser contract, without database writes.

Run under the catalogue-sync concurrency lock. A failed or oversized export must
never be deployed. Visitor requests cannot invoke this script or Supabase.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from datetime import datetime, timezone
from collections import Counter
from pathlib import Path

import requests

try:
    from catalogue_http import get_with_retry
except ModuleNotFoundError:
    from scripts.catalogue_http import get_with_retry

from load_to_supabase import prepare_row
from verify_live_hks_catalogue import parse_timestamp

PROJECT_URL = "https://cbtroatixvydpwoviezf.supabase.co"
HISTORY_COLUMNS = tuple(prepare_row({}).keys())
LIVE_COLUMNS = tuple("id,course_code,course_code_base,title,term,credits,instructors,meetings,meeting_days,time_start,time_end,school,is_hks,session_code,session_description,cross_reg_eligible,source,source_course_id,course_offer_nbr,section_code,source_url,active".split(","))
CREDIT_COLUMNS = tuple("id,course_code,course_code_base,credits,term,session_description".split(","))
SECTION_COLUMNS = tuple("id,course_code_base,meetings,title,instructors,credits,term".split(","))
MAX_EXPORT_BYTES = 32 * 1024 * 1024
MAX_ROWS = 20000
PAGE_SIZE = 1000


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")


class PublicReader:
    def __init__(self, url, key, request_get=requests.get):
        if url.rstrip("/") != PROJECT_URL or not key:
            raise ValueError("A configured production URL and anonymous public key are required")
        self.key, self.request_get, self.bytes = key, request_get, 0

    def _count_response_bytes(self, response):
        # Transient-error response bodies also consume the source egress budget.
        self.bytes += len(response.content)
        if self.bytes > MAX_EXPORT_BYTES:
            raise ValueError("Export exceeded the 32 MiB daily source budget")

    def rows(self, table, columns, filters=None, order="id.asc"):
        rows, total = [], None
        for offset in range(0, MAX_ROWS, PAGE_SIZE):
            response = get_with_retry(
                f"{PROJECT_URL}/rest/v1/{table}",
                request_get=self.request_get,
                observe_response=self._count_response_bytes,
                params={"select": ",".join(columns), **({"order": order} if order else {}),
                        "limit": PAGE_SIZE, "offset": offset, **(filters or {})},
                headers={"apikey": self.key, "Authorization": f"Bearer {self.key}",
                         "Prefer": "count=exact", "Accept": "application/json"},
                timeout=30, allow_redirects=False,
            )
            response.raise_for_status()
            if response.status_code not in (200, 206):
                raise ValueError("Unexpected database response")
            count = response.headers.get("Content-Range", "").rsplit("/", 1)[-1]
            if not count.isdigit() or int(count) >= MAX_ROWS:
                raise ValueError("Missing exact count or catalogue exceeds row budget")
            if total is not None and total != int(count):
                raise ValueError("Catalogue changed during export; retain previous snapshot")
            total = int(count)
            page = response.json()
            if not isinstance(page, list) or any(not isinstance(r, dict) for r in page):
                raise ValueError("Malformed catalogue page")
            if any(set(r) != set(columns) for r in page):
                raise ValueError("Public field contract changed")
            rows.extend(page)
            if len(rows) >= total:
                if len(rows) != total or len({r["id"] for r in rows}) != total:
                    raise ValueError("Incomplete or duplicate catalogue rows")
                return rows
            if not page:
                raise ValueError("Truncated catalogue")
        raise ValueError("Catalogue exceeds row budget")


def build_datasets(history, live, credits, sections):
    # Preserve existing filters, ordering, row identities, values and nulls.
    if len(history) < 5000 or len(live) < 5000:
        raise ValueError("Unexpectedly small historical or active catalogue")
    hks = [r for r in live if r["is_hks"] is True]
    if len(hks) < 285 or not credits:
        raise ValueError("Missing authoritative HKS offerings or credits")
    datasets = {"history": history, "credits": credits,
                "terms": [{k: r[k] for k in ("id", "term", "is_hks")} for r in sorted(hks, key=lambda r: (r["term"], r["id"]))]}
    for term in sorted({r["term"] for r in live}):
        datasets[f"live/{term}"] = [r for r in live if r["term"] == term]
    for term in sorted({r["term"] for r in sections}):
        datasets[f"sections/{term}"] = [{k: v for k, v in r.items() if k != "term"} for r in sections if r["term"] == term]
    return datasets


def source_observations(reader, live, *, now=None, max_age_hours=48):
    """Prove freshness of BOTH exported sources using existing anonymous reads.

    ATS source_last_seen_at is set once per atomic source sync by Postgres;
    synced_at/export time are not substitutes. Keep private run IDs out of the
    public provenance and include these reads in the existing egress budget.
    """
    current = now or datetime.now(timezone.utc)
    result = {}
    ats = [r for r in live if r["source"] == "ats" and r["is_hks"] is False]
    # Observation metadata is read in the SAME response as the exported fields,
    # then stripped from public datasets. It cannot accidentally attest a newer
    # generation than the one whose content was actually exported.
    evidence = ats
    if (len(ats) < 5000 or len({r["id"] for r in ats}) != len(ats)
            or any(not isinstance(r["id"], str) or not r["id"] for r in ats)):
        raise ValueError("ATS observation inventory has invalid identities or is below the production floor")
    run_ids = {r.get("sync_run_id") for r in evidence}
    observed_times = {r.get("source_last_seen_at") for r in evidence}
    if (len(run_ids) != 1 or any(not isinstance(v, str) or not v for v in run_ids)
            or len(observed_times) != 1):
        raise ValueError("ATS export spans unproven or mixed source generations")
    observed = parse_timestamp(next(iter(observed_times)), "ATS source_last_seen_at")
    result["ats"] = {"observedAt": observed.isoformat(), "offeringCount": len(ats),
                     "identitySha256": hashlib.sha256("\n".join(sorted(r["id"] for r in ats)).encode()).hexdigest()}

    manifests = reader.rows(
        "live_catalogue_runs",
        ("id", "source_snapshot_at", "offering_count", "identity_sha256", "term_counts"),
        {"source": "eq.myharvard", "status": "eq.active"},
    )
    if len(manifests) != 1:
        raise ValueError("Expected one active HKS source manifest")
    manifest = manifests[0]
    hks = [r for r in live if r["source"] == "myharvard" and r["is_hks"] is True]
    if len(ats) + len(hks) != len(live):
        raise ValueError("Export includes an unverified source ownership row")
    identities = [r["source_offering_id"] for r in hks]
    if any(not isinstance(v, str) or not v for v in identities):
        raise ValueError("HKS export has an invalid source identity")
    digest = hashlib.sha256("\n".join(sorted(identities)).encode()).hexdigest()
    if (any(r.get("sync_run_id") != manifest["id"] for r in hks)
            or len(hks) < 285 or len(set(identities)) != len(hks)
            or len(hks) != manifest["offering_count"] or digest != manifest["identity_sha256"]
            or dict(Counter(r["term"] for r in hks)) != manifest["term_counts"]):
        raise ValueError("HKS source manifest differs from exported catalogue")
    observed = parse_timestamp(manifest["source_snapshot_at"], "HKS source_snapshot_at")
    result["myharvard"] = {"observedAt": observed.isoformat(), "offeringCount": len(hks),
                          "identitySha256": digest}
    for source, entry in result.items():
        age = (current - parse_timestamp(entry["observedAt"], source)).total_seconds() / 3600
        if age < -1 or age > max_age_hours:
            raise ValueError(f"{source} source age {age:.1f}h exceeds freshness limit; retain previous snapshot")
    return result


def write_snapshot(destination, datasets, source_bytes=0, now=None, sources=None):
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    blobs = destination / "snapshots"
    blobs.mkdir(exist_ok=True)
    manifest = {"schema": 1, "exportedAt": (now or datetime.now(timezone.utc)).isoformat(),
                "sourceBytes": source_bytes, "datasets": {}}
    for name, rows in datasets.items():
        content = encode(rows)
        digest = hashlib.sha256(content).hexdigest()
        if len(content) > 24 * 1024 * 1024:
            raise ValueError("Snapshot file exceeds Pages asset budget")
        (blobs / f"{digest}.json").write_bytes(content)
        manifest["datasets"][name] = {"path": f"snapshots/{digest}.json", "sha256": digest,
                                      "count": len(rows), "bytes": len(content)}
    if sources is not None:
        manifest["sources"] = sources
    manifest["version"] = hashlib.sha256(encode(manifest["datasets"])).hexdigest()
    (destination / "manifest.json").write_bytes(encode(manifest))
    # A real 404 prevents SPA HTML from being cached as an immutable data file.
    (destination / "404.html").write_text("<!doctype html><title>Not found</title>Not found", encoding="utf-8")
    (destination / "_headers").write_text(
        "/*\n  Access-Control-Allow-Origin: *\n  X-Content-Type-Options: nosniff\n"
        "/manifest.json\n  Cache-Control: public, max-age=0, must-revalidate\n"
        "/snapshots/*\n  Cache-Control: public, max-age=31536000, immutable\n", encoding="utf-8")
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    reader = PublicReader(os.environ.get("SUPABASE_URL", ""), os.environ.get("SUPABASE_ANON_KEY", ""))
    # Match the existing historical reader, including its database return order.
    history = reader.rows("courses", HISTORY_COLUMNS, order=None)
    live_evidence = reader.rows("live_courses", LIVE_COLUMNS + ("sync_run_id", "source_last_seen_at", "source_offering_id"),
                                {"active": "eq.true"}, "term.desc,id.asc")
    credits = reader.rows("live_courses", CREDIT_COLUMNS, {"credits": "not.is.null"}, "term.desc,id.asc")
    sections = reader.rows("course_sections", SECTION_COLUMNS, order="course_code_base.asc,id.asc")
    sources = source_observations(reader, live_evidence)
    live = [{key: row[key] for key in LIVE_COLUMNS} for row in live_evidence]
    manifest = write_snapshot(args.output, build_datasets(history, live, credits, sections), reader.bytes, sources=sources)
    print(json.dumps({"version": manifest["version"], "source_bytes": reader.bytes,
                      "monthly_bytes_at_daily_refresh": reader.bytes * 31, "sources": sources,
                      "rows": {name: entry["count"] for name, entry in manifest["datasets"].items()}}))


if __name__ == "__main__":
    main()
