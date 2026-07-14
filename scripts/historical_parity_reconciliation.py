"""Deterministic, non-destructive historical-catalogue reconciliation.

The production ``courses`` table and the reviewed CSV-derived catalogue once
used different storage IDs for many identical observations.  This module keeps
the production IDs for byte-equivalent evaluation observations, preserves
every production-only observation, and retains every genuinely distinct
canonical observation.  It never deletes, rekeys, or transfers ratings between
different observations.
"""

from __future__ import annotations

import copy
import hashlib
import json
from collections import defaultdict
from pathlib import Path

from build_catalogue_snapshot import (
    normalise_course_code,
    normalise_course_title,
    normalise_instructor_name,
)

SCHEMA_VERSION = 1
EVALUATION_ENRICHMENT_FIELDS = (
    "has_eval",
    "n_respondents",
    "total_n_respondents",
    "metrics_raw",
    "metrics_pct",
    "instructor_label",
    "workload_label",
)


def _normalise_scalar(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, dict):
        return {key: _normalise_scalar(value[key]) for key in sorted(value)}
    if isinstance(value, list):
        return [_normalise_scalar(item) for item in value]
    return value


def _parse_bool(value):
    if isinstance(value, bool):
        return value
    return str(value or "").strip().casefold() in {"1", "true", "yes", "y"}


def canonical_json_bytes(value) -> bytes:
    """Return the stable JSON representation used by all registry digests."""
    return json.dumps(
        _normalise_scalar(value),
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256_json(value) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def id_digest(rows) -> str:
    ids = sorted(str(row.get("id") or "") for row in rows)
    if not all(ids):
        raise RuntimeError("Historical reconciliation encountered a row without an immutable id")
    if len(ids) != len(set(ids)):
        raise RuntimeError("Historical reconciliation encountered duplicate immutable ids")
    return sha256_json(ids)


def observation_payload(row) -> dict:
    """Return fields that identify one evaluation/bidding observation.

    Presentation metadata such as descriptions and URLs is deliberately not an
    identity field.  Ratings, respondent counts, aggregate provenance, and the
    evaluation/bidding flags are identity fields so a section evaluation can
    never be collapsed into an unsuffixed bidding-only record.
    """
    year = row.get("year")
    if isinstance(year, float) and year.is_integer():
        year = int(year)
    metrics_raw = row.get("metrics_raw") if isinstance(row.get("metrics_raw"), dict) else {}
    metrics_pct = row.get("metrics_pct") if isinstance(row.get("metrics_pct"), dict) else {}
    return {
        "course_code": normalise_course_code(
            row.get("course_code_base") or row.get("course_code")
        ),
        "year": str(year).strip() if year is not None else "",
        "term": str(row.get("term") or "").strip().casefold(),
        "professor": normalise_instructor_name(
            row.get("professor") or row.get("professor_display")
        ),
        "course_name": normalise_course_title(row.get("course_name")),
        "is_average": _parse_bool(row.get("is_average")),
        "year_range": str(row.get("year_range") or "").strip(),
        "n_terms": _normalise_scalar(row.get("n_terms")),
        "n_respondents": _normalise_scalar(row.get("n_respondents")),
        "metrics_raw": _normalise_scalar(metrics_raw),
        "metrics_pct": _normalise_scalar(metrics_pct),
        "has_eval": _parse_bool(row.get("has_eval")),
        "has_bidding": _parse_bool(row.get("has_bidding")),
    }


def observation_digest(row) -> str:
    return sha256_json(observation_payload(row))


def same_id_evaluation_enrichment_target(source_row, canonical_row):
    """Add canonical evaluation fields to the exact same immutable source row.

    The function deliberately retains every non-evaluation source field. It is
    valid only for one same-ID bidding observation that lacks an evaluation in
    production and carries one in the canonical input.
    """
    if source_row.get("id") != canonical_row.get("id"):
        raise RuntimeError("Same-ID evaluation enrichment cannot cross immutable IDs")
    if _parse_bool(source_row.get("has_eval")) or not _parse_bool(
        canonical_row.get("has_eval")
    ):
        raise RuntimeError("Same-ID evaluation enrichment has an invalid direction")
    for field in ("course_code", "course_code_base", "year", "term", "professor"):
        source_value = str(source_row.get(field) or "").strip().casefold()
        canonical_value = str(canonical_row.get(field) or "").strip().casefold()
        if source_value != canonical_value:
            raise RuntimeError(
                f"Same-ID evaluation enrichment identity drifted in {field}"
            )
    enriched = copy.deepcopy(source_row)
    for field in EVALUATION_ENRICHMENT_FIELDS:
        enriched[field] = copy.deepcopy(canonical_row.get(field))
    return enriched


def _rows_by_id(rows, label):
    result = {}
    for index, row in enumerate(rows):
        row_id = row.get("id") if isinstance(row, dict) else None
        if not isinstance(row_id, str) or not row_id.strip():
            raise RuntimeError(f"{label} row {index} has no immutable id")
        if row_id in result:
            raise RuntimeError(f"{label} contains duplicate immutable id {row_id}")
        result[row_id] = row
    return result


def build_registry(source_rows, canonical_rows, canonical_source_sha256):
    """Build a closed reconciliation registry without mutating either input."""
    source_by_id = _rows_by_id(source_rows, "database source")
    canonical_by_id = _rows_by_id(canonical_rows, "canonical source")
    shared_ids = set(source_by_id) & set(canonical_by_id)

    # An immutable ID is the strongest reviewed identity boundary, but equal
    # IDs do not guarantee equal payloads.  Production contains a small set of
    # same-ID evaluation observations that the CSV-derived row no longer
    # carries.  Preserve those source rows explicitly so rebuilding the static
    # catalogue can never hide an existing evaluation merely because its ID is
    # also present in the canonical input.
    shared_source_preservations = []
    shared_canonical_enrichments = []
    shared_exact_observation_count = 0
    for row_id in sorted(shared_ids):
        source_row = source_by_id[row_id]
        canonical_row = canonical_by_id[row_id]
        source_digest = observation_digest(source_row)
        canonical_digest = observation_digest(canonical_row)
        if source_digest == canonical_digest:
            shared_exact_observation_count += 1
            continue
        source_has_eval = _parse_bool(source_row.get("has_eval"))
        canonical_has_eval = _parse_bool(canonical_row.get("has_eval"))
        if source_has_eval and not canonical_has_eval:
            shared_source_preservations.append(
                {
                    "id": row_id,
                    "row": source_row,
                    "row_sha256": sha256_json(source_row),
                    "source_observation_sha256": source_digest,
                    "canonical_observation_sha256": canonical_digest,
                }
            )
            continue
        if canonical_has_eval and not source_has_eval:
            shared_canonical_enrichments.append(
                {
                    "id": row_id,
                    "row": source_row,
                    "row_sha256": sha256_json(source_row),
                    "source_observation_sha256": source_digest,
                    "canonical_observation_sha256": canonical_digest,
                }
            )
            continue
        raise RuntimeError(
            f"Shared immutable id {row_id} has unexplained observation drift"
        )

    source_by_observation = defaultdict(list)
    canonical_by_observation = defaultdict(list)
    for row_id, row in source_by_id.items():
        if row_id not in shared_ids:
            source_by_observation[observation_digest(row)].append(row)
    for row_id, row in canonical_by_id.items():
        if row_id not in shared_ids:
            canonical_by_observation[observation_digest(row)].append(row)

    overrides = []
    matched_source_ids = set()
    matched_canonical_ids = set()
    for digest in sorted(set(source_by_observation) & set(canonical_by_observation)):
        source = source_by_observation[digest]
        canonical = canonical_by_observation[digest]
        # Multiplicity is intentionally not guessed. Only a unique pair can
        # retain one existing storage ID without conflating observations.
        if len(source) != 1 or len(canonical) != 1:
            continue
        source_row = source[0]
        canonical_row = canonical[0]
        overrides.append(
            {
                "generated_id": canonical_row["id"],
                "preserved_id": source_row["id"],
                "observation_sha256": digest,
            }
        )
        matched_source_ids.add(source_row["id"])
        matched_canonical_ids.add(canonical_row["id"])

    preserved_rows = []
    for row_id in sorted(set(source_by_id) - shared_ids - matched_source_ids):
        row = source_by_id[row_id]
        preserved_rows.append({"row": row, "row_sha256": sha256_json(row)})

    override_by_generated = {item["generated_id"]: item for item in overrides}
    shared_preservation_by_id = {
        item["id"]: item for item in shared_source_preservations
    }
    projected = []
    for row in canonical_rows:
        shared_preservation = shared_preservation_by_id.get(row["id"])
        projected_row = copy.deepcopy(
            shared_preservation["row"] if shared_preservation else row
        )
        override = override_by_generated.get(row["id"])
        if override:
            projected_row["id"] = override["preserved_id"]
        projected.append(projected_row)
    projected.extend(copy.deepcopy(item["row"]) for item in preserved_rows)

    source_ids = set(source_by_id)
    projected_ids = {row["id"] for row in projected}
    new_canonical_ids = sorted(projected_ids - source_ids)
    retained_source_ids = sorted(source_ids - {row["id"] for row in canonical_rows})
    if len(projected_ids) != len(projected):
        raise RuntimeError("Reconciled catalogue contains duplicate immutable ids")
    if source_ids - projected_ids:
        raise RuntimeError("Reconciled catalogue would omit existing database observations")

    return {
        "schema_version": SCHEMA_VERSION,
        "purpose": "preserve_distinct_observations_without_delete_rekey_or_rating_transfer",
        "source": {
            "database_row_count": len(source_rows),
            "database_id_sha256": id_digest(source_rows),
            "database_row_sha256": sha256_json(sorted(source_rows, key=lambda row: row["id"])),
            "database_unchanged_after_enrichment_row_count": len(source_rows)
            - len(shared_canonical_enrichments),
            "database_unchanged_after_enrichment_row_sha256": sha256_json(
                sorted(
                    (
                        row
                        for row in source_rows
                        if row["id"]
                        not in {item["id"] for item in shared_canonical_enrichments}
                    ),
                    key=lambda row: row["id"],
                )
            ),
            "canonical_row_count": len(canonical_rows),
            "canonical_id_sha256": id_digest(canonical_rows),
            "canonical_source_sha256": canonical_source_sha256,
        },
        "result": {
            "same_id_count": len(shared_ids),
            "same_id_exact_observation_count": shared_exact_observation_count,
            "same_id_source_preservation_count": len(shared_source_preservations),
            "same_id_canonical_enrichment_count": len(shared_canonical_enrichments),
            "exact_observation_id_override_count": len(overrides),
            "preserved_database_only_count": len(preserved_rows),
            "additive_canonical_only_count": len(new_canonical_ids),
            "projected_row_count": len(projected),
            "projected_id_sha256": id_digest(projected),
            "zero_omitted_database_rows": True,
        },
        "id_overrides": sorted(overrides, key=lambda item: item["generated_id"]),
        "same_id_source_preservations": shared_source_preservations,
        "same_id_canonical_enrichments": shared_canonical_enrichments,
        "preserved_rows": preserved_rows,
        "additive_canonical_ids": new_canonical_ids,
        "retained_source_ids": retained_source_ids,
    }


def load_registry(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if payload.get("schema_version") != SCHEMA_VERSION:
        raise RuntimeError("Unsupported historical reconciliation registry version")
    return payload


def apply_registry(canonical_rows, registry, convert_preserved_row=lambda row: row):
    """Apply a reviewed registry and fail closed on any source drift."""
    source = registry.get("source", {})
    result = registry.get("result", {})
    if len(canonical_rows) != source.get("canonical_row_count"):
        raise RuntimeError("Canonical row count drifted from the reconciliation registry")
    if id_digest(canonical_rows) != source.get("canonical_id_sha256"):
        raise RuntimeError("Canonical immutable IDs drifted from the reconciliation registry")

    canonical_by_id = _rows_by_id(canonical_rows, "canonical source")
    shared_source_rows = {}
    for item in registry.get("same_id_source_preservations", []):
        row_id = item.get("id")
        row = item.get("row")
        if row_id not in canonical_by_id or not isinstance(row, dict):
            raise RuntimeError("Same-ID source preservation references an unknown row")
        if row.get("id") != row_id or sha256_json(row) != item.get("row_sha256"):
            raise RuntimeError(f"Same-ID source row failed its registry digest for {row_id}")
        if observation_digest(row) != item.get("source_observation_sha256"):
            raise RuntimeError(f"Same-ID source observation drifted for {row_id}")
        if (
            observation_digest(canonical_by_id[row_id])
            != item.get("canonical_observation_sha256")
        ):
            raise RuntimeError(f"Same-ID canonical observation drifted for {row_id}")
        if (
            item.get("source_observation_sha256")
            == item.get("canonical_observation_sha256")
        ):
            raise RuntimeError(f"Same-ID preservation is unnecessary for {row_id}")
        if row_id in shared_source_rows:
            raise RuntimeError(f"Duplicate same-ID source preservation for {row_id}")
        shared_source_rows[row_id] = row

    canonical_enrichment_source_rows = {}
    for item in registry.get("same_id_canonical_enrichments", []):
        row_id = item.get("id")
        source_row = item.get("row")
        if row_id not in canonical_by_id or not isinstance(source_row, dict):
            raise RuntimeError("Same-ID canonical enrichment references an unknown row")
        if (
            source_row.get("id") != row_id
            or sha256_json(source_row) != item.get("row_sha256")
            or observation_digest(source_row) != item.get("source_observation_sha256")
        ):
            raise RuntimeError(f"Same-ID canonical enrichment source drifted for {row_id}")
        if (
            observation_digest(canonical_by_id[row_id])
            != item.get("canonical_observation_sha256")
        ):
            raise RuntimeError(f"Same-ID canonical enrichment drifted for {row_id}")
        if (
            not item.get("source_observation_sha256")
            or item.get("source_observation_sha256")
            == item.get("canonical_observation_sha256")
        ):
            raise RuntimeError(f"Same-ID canonical enrichment is invalid for {row_id}")
        if row_id in canonical_enrichment_source_rows or row_id in shared_source_rows:
            raise RuntimeError(f"Duplicate same-ID drift disposition for {row_id}")
        same_id_evaluation_enrichment_target(source_row, canonical_by_id[row_id])
        canonical_enrichment_source_rows[row_id] = source_row

    if len(shared_source_rows) != result.get("same_id_source_preservation_count"):
        raise RuntimeError("Same-ID source-preservation count differs from the registry")
    if len(canonical_enrichment_source_rows) != result.get(
        "same_id_canonical_enrichment_count"
    ):
        raise RuntimeError("Same-ID canonical-enrichment count differs from the registry")
    if (
        result.get("same_id_exact_observation_count", 0)
        + len(shared_source_rows)
        + len(canonical_enrichment_source_rows)
        != result.get("same_id_count")
    ):
        raise RuntimeError("Same-ID observation dispositions do not close")

    reconciled = []
    used_preserved_ids = set()
    for item in registry.get("id_overrides", []):
        generated_id = item.get("generated_id")
        preserved_id = item.get("preserved_id")
        if generated_id not in canonical_by_id:
            raise RuntimeError(f"Reconciliation override references unknown id {generated_id}")
        if not isinstance(preserved_id, str) or not preserved_id:
            raise RuntimeError("Reconciliation override has no preserved id")
        if observation_digest(canonical_by_id[generated_id]) != item.get("observation_sha256"):
            raise RuntimeError(f"Observation drifted for reconciliation override {generated_id}")
        if preserved_id in used_preserved_ids:
            raise RuntimeError(f"Reconciliation reuses preserved id {preserved_id}")
        used_preserved_ids.add(preserved_id)

    if len(used_preserved_ids) != result.get("exact_observation_id_override_count"):
        raise RuntimeError("Exact-observation override count differs from the registry")

    overrides = {item["generated_id"]: item["preserved_id"] for item in registry["id_overrides"]}
    for row in canonical_rows:
        if row["id"] in shared_source_rows:
            reconciled.append(
                convert_preserved_row(copy.deepcopy(shared_source_rows[row["id"]]))
            )
            continue
        if row["id"] in canonical_enrichment_source_rows:
            enriched = same_id_evaluation_enrichment_target(
                canonical_enrichment_source_rows[row["id"]], row
            )
            reconciled.append(convert_preserved_row(enriched))
            continue
        reconciled_row = copy.deepcopy(row)
        if row["id"] in overrides:
            reconciled_row["id"] = overrides[row["id"]]
        reconciled.append(reconciled_row)

    preserved_rows = registry.get("preserved_rows", [])
    if len(preserved_rows) != result.get("preserved_database_only_count"):
        raise RuntimeError("Preserved database-only count differs from the registry")
    for item in preserved_rows:
        row = item.get("row")
        if not isinstance(row, dict) or sha256_json(row) != item.get("row_sha256"):
            raise RuntimeError("Preserved historical row failed its registry digest")
        reconciled.append(convert_preserved_row(copy.deepcopy(row)))

    if len(reconciled) != result.get("projected_row_count"):
        raise RuntimeError("Reconciled row count differs from the reviewed projection")
    if id_digest(reconciled) != result.get("projected_id_sha256"):
        raise RuntimeError("Reconciled immutable-ID manifest differs from the reviewed projection")
    return reconciled
