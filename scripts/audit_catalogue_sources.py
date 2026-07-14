"""Read-only parity audit for the future unified catalogue.

This utility never writes to Supabase. It paginates the existing current and
historical tables, materialises the proposed catalogue in memory, and reports
the evidence needed before a later snapshot promotion.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter
from pathlib import Path

import requests

from build_catalogue_snapshot import (
    materialize_catalogue_snapshot,
    normalise_course_code,
    normalise_course_title,
    normalise_instructor_name,
)

ROOT = Path(__file__).resolve().parent.parent
PAGE_SIZE = 1000
MAX_ROWS = 10000
CANONICAL_HISTORY_JSON = ROOT / "public" / "courses.json"


def supabase_headers(key):
    return {"apikey": key, "Authorization": f"Bearer {key}", "Accept": "application/json"}


def fetch_all_supabase_rows(base_url, key, table, request_get=requests.get):
    """Read every row in a deterministically ordered table, without truncation."""
    rows = []
    endpoint = f"{base_url.rstrip('/')}/rest/v1/{table}"

    for start in range(0, MAX_ROWS, PAGE_SIZE):
        response = request_get(
            endpoint,
            headers={**supabase_headers(key), "Range-Unit": "items", "Range": f"{start}-{start + PAGE_SIZE - 1}"},
            params={"select": "*", "order": "id.asc"},
            timeout=30,
        )
        if not response.ok:
            raise RuntimeError(f"Could not read {table}: HTTP {response.status_code}")
        page = response.json()
        if not isinstance(page, list):
            raise RuntimeError(f"Could not read {table}: expected a JSON list")
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            return rows

    raise RuntimeError(f"{table} exceeds the safe {MAX_ROWS} row audit limit")


def load_canonical_history_rows(path=CANONICAL_HISTORY_JSON):
    """Load the generated history contract that the browser currently serves."""
    with Path(path).open(encoding="utf-8") as handle:
        payload = json.load(handle)
    rows = payload.get("courses") if isinstance(payload, dict) else None
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        raise RuntimeError("Canonical courses.json does not contain a courses array")
    return rows


def historical_source_parity(source_rows, canonical_rows):
    """Compare history by immutable IDs; a count match alone can still hide drift."""
    source_ids = [str(row.get("id")) for row in source_rows if row.get("id")]
    canonical_ids = [str(row.get("id")) for row in canonical_rows if row.get("id")]
    duplicate_source_ids = sorted(
        row_id for row_id, count in Counter(source_ids).items() if count > 1
    )
    duplicate_canonical_ids = sorted(
        row_id for row_id, count in Counter(canonical_ids).items() if count > 1
    )
    source_set = set(source_ids)
    canonical_set = set(canonical_ids)
    return {
        "canonical_history_count": len(canonical_ids),
        "historical_source_matches_canonical": not duplicate_source_ids
        and not duplicate_canonical_ids
        and source_set == canonical_set,
        "historical_source_only_count": len(source_set - canonical_set),
        "canonical_history_only_count": len(canonical_set - source_set),
        "historical_source_duplicate_id_count": len(duplicate_source_ids),
        "canonical_history_duplicate_id_count": len(duplicate_canonical_ids),
    }


def historical_semantic_key(row):
    """Return a conservative historical identity independent of storage ID.

    This is an audit-only fingerprint.  It identifies candidates whose legacy
    and generated IDs differ but whose code, term, year, professor, title, and
    aggregate/individual status agree exactly after presentation
    normalisation.  It never authorises an ID rewrite or evaluation link.
    """
    if not isinstance(row, dict):
        return None
    code = normalise_course_code(row.get("course_code_base") or row.get("course_code"))
    year_value = row.get("year")
    year = str(year_value).strip() if year_value is not None else ""
    term = str(row.get("term") or "").strip().casefold()
    professor = normalise_instructor_name(row.get("professor") or row.get("professor_display"))
    title = normalise_course_title(row.get("course_name"))
    is_average = str(row.get("is_average", False)).strip().casefold()
    if not all((code, year, term, professor, title)):
        return None
    return code, year, term, professor, title, is_average


def semantic_history_reconciliation(source_rows, canonical_rows):
    """Summarise exact non-ID historical matches without mutating either source."""
    source_by_key = {}
    canonical_by_key = {}
    source_without_key = 0
    canonical_without_key = 0

    for row in source_rows:
        key = historical_semantic_key(row)
        if key is None:
            source_without_key += 1
            continue
        source_by_key.setdefault(key, []).append(str(row.get("id")))
    for row in canonical_rows:
        key = historical_semantic_key(row)
        if key is None:
            canonical_without_key += 1
            continue
        canonical_by_key.setdefault(key, []).append(str(row.get("id")))

    shared_keys = set(source_by_key) & set(canonical_by_key)
    one_to_one_keys = [
        key for key in shared_keys
        if len(source_by_key[key]) == 1 and len(canonical_by_key[key]) == 1
    ]
    same_id = sum(
        source_by_key[key][0] == canonical_by_key[key][0]
        for key in one_to_one_keys
    )
    return {
        "semantic_exact_one_to_one_count": len(one_to_one_keys),
        "semantic_same_id_count": same_id,
        "semantic_changed_id_candidate_count": len(one_to_one_keys) - same_id,
        "semantic_ambiguous_shared_key_count": len(shared_keys) - len(one_to_one_keys),
        "semantic_source_only_row_count": sum(
            len(rows) for key, rows in source_by_key.items() if key not in canonical_by_key
        ),
        "semantic_canonical_only_row_count": sum(
            len(rows) for key, rows in canonical_by_key.items() if key not in source_by_key
        ),
        "semantic_source_missing_key_count": source_without_key,
        "semantic_canonical_missing_key_count": canonical_without_key,
    }


def semantic_reconciliation_review_rows(source_rows, canonical_rows):
    """Create operator-review rows; never infer an approved ID mapping.

    The export identifies exact semantic ID-change candidates separately from
    ambiguous and source-only records. It deliberately contains no evaluation
    metrics and is written only when an operator explicitly supplies a local
    path; it is not emitted to GitHub Action logs.
    """
    source_by_key = {}
    canonical_by_key = {}
    source_missing = []
    canonical_missing = []
    for row in source_rows:
        key = historical_semantic_key(row)
        if key:
            source_by_key.setdefault(key, []).append(row)
        else:
            source_missing.append(row)
    for row in canonical_rows:
        key = historical_semantic_key(row)
        if key:
            canonical_by_key.setdefault(key, []).append(row)
        else:
            canonical_missing.append(row)

    def identity(key):
        fields = ("course_code", "year", "term", "professor", "course_name", "is_average")
        return dict(zip(fields, key, strict=True))

    rows = []
    for key in sorted(set(source_by_key) | set(canonical_by_key)):
        source = source_by_key.get(key, [])
        canonical = canonical_by_key.get(key, [])
        source_ids = sorted(str(row.get("id")) for row in source)
        canonical_ids = sorted(str(row.get("id")) for row in canonical)
        if len(source) == len(canonical) == 1:
            status = "exact_semantic_id_change" if source_ids != canonical_ids else "same_id"
        elif source and canonical:
            status = "ambiguous_semantic_key"
        elif source:
            status = "source_only_semantic_key"
        else:
            status = "canonical_only_semantic_key"
        rows.append({
            "status": status,
            "identity": identity(key),
            "source_ids": source_ids,
            "canonical_ids": canonical_ids,
        })

    for row in source_missing:
        rows.append({"status": "source_missing_identity_fields", "source_ids": [str(row.get("id"))], "canonical_ids": []})
    for row in canonical_missing:
        rows.append({"status": "canonical_missing_identity_fields", "source_ids": [], "canonical_ids": [str(row.get("id"))]})
    return sorted(rows, key=lambda row: (row["status"], row.get("source_ids", []), row.get("canonical_ids", [])))


def raw_course_code_from_row_id(row_id):
    """Return the code-sized prefix of a structured history ID, if present.

    This is deliberately only a review aid.  It is not an identity parser and
    must never be used to create an alias or select a historical evaluation.
    """
    value = str(row_id or "")
    code, separator, _ = value.partition("||")
    return code if separator and code else None


def manual_nonaggregate_section_code_change_review_rows(review_rows):
    """Surface exact non-aggregate terminal-section changes for manual review.

    Generated aggregate IDs intentionally add a digest and are verified by
    ``verify_aggregate_provenance.py``.  This narrower queue is for the much
    riskier individual-course cases where one terminal section token was
    removed (for example, a historical A/B section becoming an unsuffixed
    course). It intentionally excludes every other renumbering direction,
    aggregate, and ambiguous case. It only labels rows for manual
    investigation; it does not infer equivalence or permit ratings to cross
    the boundary.
    """
    queue = []
    for row in review_rows:
        if row.get("status") != "exact_semantic_id_change":
            continue
        source_ids = row.get("source_ids", [])
        canonical_ids = row.get("canonical_ids", [])
        if len(source_ids) != 1 or len(canonical_ids) != 1:
            continue
        source_id, canonical_id = source_ids[0], canonical_ids[0]
        if "||aggregate-" in source_id or "||aggregate-" in canonical_id:
            continue
        if str(row.get("identity", {}).get("is_average", "")).casefold() != "false":
            continue
        source_code = raw_course_code_from_row_id(source_id)
        canonical_code = raw_course_code_from_row_id(canonical_id)
        if not source_code or not canonical_code:
            continue
        source_base = re.sub(r"-[A-Z]$", "", source_code, flags=re.IGNORECASE)
        if source_base.casefold() != canonical_code.casefold():
            continue
        queue.append(
            {
                "status": "needs_manual_provenance_review",
                "candidate_kind": "terminal_section_token_removed",
                "identity": row["identity"],
                "source_id": source_id,
                "canonical_id": canonical_id,
                "source_course_code": source_code,
                "canonical_course_code": canonical_code,
            }
        )
    return sorted(queue, key=lambda row: (row["source_course_code"], row["source_id"]))


HISTORICAL_ACCOUNTING_CATEGORIES = (
    "same_id_same_observation",
    "same_id_nonidentity_drift",
    "exact_technical_rekey",
    "section_or_code_change_review",
    "ambiguous_no_shared_id",
    "database_only",
    "canonical_only",
    "professor_unavailable",
    "identity_conflict_review",
)


def _is_average_history_row(row):
    return str(row.get("is_average", False)).strip().casefold() == "true"


def _historical_observation_identity(row):
    if not isinstance(row, dict):
        return None
    code = normalise_course_code(row.get("course_code") or row.get("course_code_base"))
    year_value = row.get("year")
    year = str(year_value).strip() if year_value is not None else ""
    term = str(row.get("term") or "").strip().casefold()
    professor = normalise_instructor_name(
        row.get("professor") or row.get("professor_display")
    )
    if not all((code, year, term, professor)):
        return None
    return code, year, term, professor, _is_average_history_row(row)


def _aggregate_provenance(row):
    return (
        str(row.get("year_range") or "").strip().casefold(),
        str(row.get("n_terms") if row.get("n_terms") is not None else "").strip(),
    )


def _professor_unavailable_key(row):
    if not isinstance(row, dict):
        return None
    if normalise_instructor_name(row.get("professor") or row.get("professor_display")):
        return None
    code = normalise_course_code(row.get("course_code") or row.get("course_code_base"))
    year_value = row.get("year")
    year = str(year_value).strip() if year_value is not None else ""
    term = str(row.get("term") or "").strip().casefold()
    title = normalise_course_title(row.get("course_name"))
    if not all((code, year, term, title)):
        return None
    return (
        code,
        year,
        term,
        title,
        _is_average_history_row(row),
        *_aggregate_provenance(row),
    )


def _unique_history_rows_by_id(rows, label):
    result = {}
    for index, row in enumerate(rows):
        row_id = row.get("id") if isinstance(row, dict) else None
        if not isinstance(row_id, str) or not row_id.strip():
            raise RuntimeError(f"{label} row {index} has no immutable id")
        if row_id in result:
            raise RuntimeError(f"{label} contains duplicate immutable id {row_id}")
        result[row_id] = row
    return result


def deterministic_historical_accounting(source_rows, canonical_rows):
    """Classify every immutable history row without equating or rewriting it."""
    source_by_id = _unique_history_rows_by_id(source_rows, "historical source")
    canonical_by_id = _unique_history_rows_by_id(canonical_rows, "canonical history")
    categories = {
        name: {
            "group_count": 0,
            "source_row_count": 0,
            "canonical_row_count": 0,
        }
        for name in HISTORICAL_ACCOUNTING_CATEGORIES
    }

    def account(name, source=(), canonical=()):
        categories[name]["group_count"] += 1
        categories[name]["source_row_count"] += len(source)
        categories[name]["canonical_row_count"] += len(canonical)

    remaining_source = dict(source_by_id)
    remaining_canonical = dict(canonical_by_id)
    for row_id in sorted(set(source_by_id) & set(canonical_by_id)):
        source = source_by_id[row_id]
        canonical = canonical_by_id[row_id]
        source_key = historical_semantic_key(source)
        canonical_key = historical_semantic_key(canonical)
        if source_key is None or canonical_key is None:
            unavailable_key = _professor_unavailable_key(source)
            if unavailable_key and unavailable_key == _professor_unavailable_key(canonical):
                account("professor_unavailable", [source], [canonical])
            else:
                account("identity_conflict_review", [source], [canonical])
        elif source_key == canonical_key:
            if (
                _historical_observation_identity(source)
                != _historical_observation_identity(canonical)
            ):
                account("identity_conflict_review", [source], [canonical])
            elif (
                _is_average_history_row(source)
                and _aggregate_provenance(source) != _aggregate_provenance(canonical)
            ):
                account("identity_conflict_review", [source], [canonical])
            else:
                account("same_id_same_observation", [source], [canonical])
        elif (
            not _is_average_history_row(source)
            and not _is_average_history_row(canonical)
            and _historical_observation_identity(source)
            == _historical_observation_identity(canonical)
        ):
            account("same_id_nonidentity_drift", [source], [canonical])
        else:
            account("identity_conflict_review", [source], [canonical])
        del remaining_source[row_id]
        del remaining_canonical[row_id]

    source_by_key = {}
    canonical_by_key = {}
    source_without_key = []
    canonical_without_key = []
    for row in remaining_source.values():
        key = historical_semantic_key(row)
        if key:
            source_by_key.setdefault(key, []).append(row)
        else:
            source_without_key.append(row)
    for row in remaining_canonical.values():
        key = historical_semantic_key(row)
        if key:
            canonical_by_key.setdefault(key, []).append(row)
        else:
            canonical_without_key.append(row)

    for key in sorted(set(source_by_key) | set(canonical_by_key)):
        source = source_by_key.get(key, [])
        canonical = canonical_by_key.get(key, [])
        if source and canonical:
            if len(source) == len(canonical) == 1:
                source_row = source[0]
                canonical_row = canonical[0]
                source_code = raw_course_code_from_row_id(source_row["id"])
                canonical_code = raw_course_code_from_row_id(canonical_row["id"])
                if (
                    _is_average_history_row(source_row)
                    and _is_average_history_row(canonical_row)
                    and _aggregate_provenance(source_row)
                    == _aggregate_provenance(canonical_row)
                    and source_code
                    and canonical_code
                    and source_code.casefold() == canonical_code.casefold()
                ):
                    account("exact_technical_rekey", source, canonical)
                elif (
                    source_code
                    and canonical_code
                    and source_code.casefold() != canonical_code.casefold()
                ):
                    account("section_or_code_change_review", source, canonical)
                else:
                    account("ambiguous_no_shared_id", source, canonical)
            else:
                account("ambiguous_no_shared_id", source, canonical)
        elif source:
            account("database_only", source, [])
        else:
            account("canonical_only", [], canonical)

    source_unavailable = {}
    canonical_unavailable = {}
    invalid_source = []
    invalid_canonical = []
    for row in source_without_key:
        key = _professor_unavailable_key(row)
        if key:
            source_unavailable.setdefault(key, []).append(row)
        else:
            invalid_source.append(row)
    for row in canonical_without_key:
        key = _professor_unavailable_key(row)
        if key:
            canonical_unavailable.setdefault(key, []).append(row)
        else:
            invalid_canonical.append(row)

    for key in sorted(set(source_unavailable) | set(canonical_unavailable)):
        source = source_unavailable.get(key, [])
        canonical = canonical_unavailable.get(key, [])
        if source and canonical:
            category = (
                "professor_unavailable"
                if len(source) == len(canonical) == 1
                else "ambiguous_no_shared_id"
            )
            account(category, source, canonical)
        elif source:
            account("database_only", source, [])
        else:
            account("canonical_only", [], canonical)
    for row in invalid_source:
        account("identity_conflict_review", [row], [])
    for row in invalid_canonical:
        account("identity_conflict_review", [], [row])

    classified_source = sum(
        item["source_row_count"] for item in categories.values()
    )
    classified_canonical = sum(
        item["canonical_row_count"] for item in categories.values()
    )
    unclassified_source = len(source_rows) - classified_source
    unclassified_canonical = len(canonical_rows) - classified_canonical
    if unclassified_source or unclassified_canonical:
        raise RuntimeError(
            "Historical accounting did not close "
            f"(source-unclassified={unclassified_source}, "
            f"canonical-unclassified={unclassified_canonical})"
        )
    return {
        "source_row_count": len(source_rows),
        "canonical_row_count": len(canonical_rows),
        "classified_source_row_count": classified_source,
        "classified_canonical_row_count": classified_canonical,
        "unclassified_source_row_count": 0,
        "unclassified_canonical_row_count": 0,
        "zero_unclassified_identities": True,
        "categories": categories,
    }


def write_semantic_reconciliation_review(path, source_rows, canonical_rows):
    """Write a local-only review export; this function never contacts Supabase."""
    destination = Path(path)
    if not destination.is_absolute():
        raise ValueError("Review-report path must be absolute to avoid accidental repository output.")
    review_rows = semantic_reconciliation_review_rows(source_rows, canonical_rows)
    payload = {
        "purpose": "review_only_no_automatic_id_rewrites",
        "rows": review_rows,
        "manual_nonaggregate_section_code_change_reviews": manual_nonaggregate_section_code_change_review_rows(review_rows),
    }
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def require_historical_source_parity(source_rows, canonical_rows):
    """Stop a future promotion before writes when its history differs from the live website."""
    result = historical_source_parity(source_rows, canonical_rows)
    if result["historical_source_matches_canonical"]:
        return result
    raise RuntimeError(
        "Historical source does not exactly match canonical courses.json "
        f"(source-only={result['historical_source_only_count']}, "
        f"canonical-only={result['canonical_history_only_count']}, "
        f"source-duplicates={result['historical_source_duplicate_id_count']}, "
        f"canonical-duplicates={result['canonical_history_duplicate_id_count']}). "
        "Reconcile the historical source before publishing a unified snapshot."
    )


def audit_catalogue(offerings, historical_rows, aliases, canonical_rows=None):
    snapshot = materialize_catalogue_snapshot(offerings, historical_rows, aliases)
    source_ids = [str(row["id"]) for row in offerings]
    snapshot_ids = [row["offering_id"] for row in snapshot]
    if len(set(source_ids)) != len(source_ids):
        raise RuntimeError("live_courses contains duplicate offering IDs")
    if sorted(source_ids) != snapshot_ids:
        raise RuntimeError("snapshot offering IDs do not exactly match live_courses")

    hks_rows = [row for row in snapshot if row.get("school") == "HKS"]
    verified = [row for row in hks_rows if row["match_status"] == "verified"]
    course_only = [row for row in hks_rows if row["match_status"] == "course_only"]
    needs_review = [row for row in hks_rows if row["match_status"] == "needs_review"]
    unmatched = [row for row in hks_rows if row["match_status"] == "unmatched"]
    renumbering_candidates = [
        row for row in needs_review if row.get("renumbering_review_candidates")
    ]
    report = {
        "current_offering_count": len(snapshot),
        "historical_record_count": len(historical_rows),
        "hks_current_offering_count": len(hks_rows),
        "hks_verified_history_count": len(verified),
        "hks_course_only_history_count": len(course_only),
        "hks_needs_review_count": len(needs_review),
        "hks_unmatched_history_count": len(unmatched),
        "hks_renumbering_review_count": len(renumbering_candidates),
        "review_candidate_hks_codes": sorted(
            {
                row["course_code_base"]
                for row in needs_review
                if isinstance(row.get("course_code_base"), str) and row["course_code_base"]
            }
        ),
        "unmatched_hks_codes": sorted(
            {
                row["course_code_base"]
                for row in unmatched
                if isinstance(row.get("course_code_base"), str) and row["course_code_base"]
            }
        ),
        "renumbering_review_hks_codes": sorted(
            {
                row["course_code_base"]
                for row in renumbering_candidates
                if isinstance(row.get("course_code_base"), str) and row["course_code_base"]
            }
        ),
    }
    if canonical_rows is not None:
        report.update(historical_source_parity(historical_rows, canonical_rows))
        report.update(semantic_history_reconciliation(historical_rows, canonical_rows))
        report["deterministic_historical_accounting"] = (
            deterministic_historical_accounting(historical_rows, canonical_rows)
        )
        report["manual_nonaggregate_section_code_change_review_count"] = len(
            manual_nonaggregate_section_code_change_review_rows(
                semantic_reconciliation_review_rows(historical_rows, canonical_rows)
            )
        )
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description="Read-only Supabase catalogue parity audit.")
    parser.add_argument(
        "--review-report",
        help="absolute local JSON path for a non-committed, operator-review reconciliation export",
    )
    args = parser.parse_args(argv)
    url = os.environ.get("SUPABASE_URL", "").strip()
    key = os.environ.get("SUPABASE_KEY", "").strip()
    if not url or not key:
        sys.exit("SUPABASE_URL and SUPABASE_KEY are required for this read-only audit.")

    with (ROOT / "data" / "school_config.json").open(encoding="utf-8") as handle:
        aliases = json.load(handle).get("historical_code_map", {})

    offerings = fetch_all_supabase_rows(url, key, "live_courses")
    historical_rows = fetch_all_supabase_rows(url, key, "courses")
    canonical_rows = load_canonical_history_rows()
    print(
        json.dumps(
            audit_catalogue(offerings, historical_rows, aliases, canonical_rows),
            indent=2,
            sort_keys=True,
        )
    )
    if args.review_report:
        write_semantic_reconciliation_review(args.review_report, historical_rows, canonical_rows)
        print("Wrote local reconciliation review report.")


if __name__ == "__main__":
    main()
