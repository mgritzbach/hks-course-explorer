"""Deterministic, read-only ownership audit for ``live_courses``.

The daily ATS sync owns only current non-HKS offerings.  my.harvard owns the
active HKS catalogue and its retained rollback snapshot.  Older ATS rows are
kept until an operator has enough source evidence to decide whether they are
retired or merely absent from one upstream snapshot.

This module turns the complete database inventory into mutually exclusive
populations.  It never returns raw course IDs: the actionable queue is
represented by a stable SHA-256 digest plus aggregate school, term, state, and
age buckets.  Any row whose ownership cannot be proven aborts the audit.
"""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from datetime import datetime, timedelta, timezone
from typing import Iterable


class ReconciliationError(RuntimeError):
    """Raised when source ownership or persisted manifests are inconsistent."""


def _required_text(row: dict, field: str, context: str) -> str:
    value = str(row.get(field) or "").strip()
    if not value:
        raise ReconciliationError(f"{context} has no {field}")
    return value


def _manifest_identity_digest(values: Iterable[str]) -> str:
    payload = "\n".join(sorted(values)).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _queue_digest(values: Iterable[str]) -> str:
    """Hash an unambiguous canonical array, including unusual ID characters."""
    payload = json.dumps(
        sorted(values), ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def _term_counts(rows: list[dict]) -> dict[str, int]:
    counts = Counter(str(row.get("term") or "") for row in rows)
    if "" in counts:
        raise ReconciliationError("my.harvard manifest row has no term")
    return dict(sorted(counts.items()))


def _parse_timestamp(value: object, *, now: datetime) -> datetime:
    raw = str(value or "").strip()
    if not raw:
        raise ReconciliationError("actionable retained ATS row has no source_last_seen_at")
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ReconciliationError(
            "actionable retained ATS row has invalid source_last_seen_at"
        ) from exc
    if parsed.tzinfo is None:
        raise ReconciliationError(
            "actionable retained ATS row has timezone-free source_last_seen_at"
        )
    parsed = parsed.astimezone(timezone.utc)
    if parsed > now + timedelta(minutes=5):
        raise ReconciliationError("actionable retained ATS row has future source_last_seen_at")
    # Database and Actions runner clocks can differ by a few seconds. Treat a
    # bounded skew as freshly seen instead of turning it into a negative age.
    return min(parsed, now)


def _age_bucket(value: object, *, now: datetime) -> str:
    age_days = (now - _parse_timestamp(value, now=now)).total_seconds() / 86_400
    if age_days < 2:
        return "under_2_days"
    if age_days < 8:
        return "2_to_7_days"
    if age_days < 31:
        return "8_to_30_days"
    return "over_30_days"


def _validate_manifest(
    run: dict,
    rows: list[dict],
    *,
    label: str,
    identity_field: str,
    require_source_course_id: bool = False,
) -> None:
    expected_count = run.get("offering_count")
    if not isinstance(expected_count, int) or expected_count != len(rows):
        raise ReconciliationError(f"{label} row count does not match its persisted manifest")

    offering_ids = [
        _required_text(row, identity_field, f"{label} row") for row in rows
    ]
    if require_source_course_id:
        for row in rows:
            _required_text(row, "source_course_id", f"{label} row")
    if len(offering_ids) != len(set(offering_ids)):
        raise ReconciliationError(
            f"{label} contains duplicate {identity_field} values"
        )

    expected_digest = str(run.get("identity_sha256") or "").strip().lower()
    if expected_digest != _manifest_identity_digest(offering_ids):
        raise ReconciliationError(f"{label} identity digest does not match its persisted manifest")

    expected_terms = run.get("term_counts")
    if not isinstance(expected_terms, dict) or expected_terms != _term_counts(rows):
        raise ReconciliationError(f"{label} term counts do not match its persisted manifest")


def classify_live_course_inventory(
    source_rows: list[dict],
    database_rows: list[dict],
    catalogue_runs: list[dict],
    *,
    now: datetime | None = None,
) -> dict:
    """Partition the complete inventory without deleting or changing a row.

    The result contains only aggregate evidence.  Raw actionable IDs are used
    transiently to compute ``actionable_queue_sha256`` and are not returned.
    """

    audit_now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    source_ids = [_required_text(row, "id", "current ATS source row") for row in source_rows]
    if len(source_ids) != len(set(source_ids)):
        raise ReconciliationError("current ATS source contains duplicate IDs")
    source_id_set = set(source_ids)

    database_ids = [_required_text(row, "id", "database row") for row in database_rows]
    if len(database_ids) != len(set(database_ids)):
        raise ReconciliationError("live_courses contains duplicate IDs")

    run_by_id: dict[str, dict] = {}
    for run in catalogue_runs:
        run_id = _required_text(run, "id", "catalogue run")
        if run_id in run_by_id:
            raise ReconciliationError("live_catalogue_runs contains duplicate IDs")
        if str(run.get("source") or "").strip().lower() not in {"myharvard", "ats"}:
            raise ReconciliationError("catalogue-run audit received an unknown source")
        run_by_id[run_id] = run

    myharvard_runs = [
        run
        for run in catalogue_runs
        if str(run.get("source") or "").strip().lower() == "myharvard"
    ]
    active_runs = [run for run in myharvard_runs if run.get("status") == "active"]
    if len(active_runs) != 1:
        raise ReconciliationError("expected exactly one active my.harvard catalogue run")
    active_run_id = _required_text(active_runs[0], "id", "active catalogue run")

    myharvard_rows_by_run: dict[str, list[dict]] = {}
    for row in database_rows:
        if str(row.get("source") or "").strip().lower() == "myharvard":
            run_id = _required_text(row, "sync_run_id", "my.harvard row")
            myharvard_rows_by_run.setdefault(run_id, []).append(row)

    unknown_run_ids = set(myharvard_rows_by_run) - set(run_by_id)
    if unknown_run_ids:
        raise ReconciliationError("my.harvard row references an unknown catalogue run")
    if active_run_id not in myharvard_rows_by_run:
        raise ReconciliationError("active my.harvard catalogue run retains no rows")

    row_bearing_superseded = [
        run
        for run in myharvard_runs
        if run.get("status") == "superseded"
        and _required_text(run, "id", "superseded catalogue run") in myharvard_rows_by_run
    ]
    if len(row_bearing_superseded) != 1:
        raise ReconciliationError(
            "expected exactly one row-bearing my.harvard rollback snapshot"
        )
    rollback_run_id = _required_text(
        row_bearing_superseded[0], "id", "rollback catalogue run"
    )

    for run_id, rows in myharvard_rows_by_run.items():
        run = run_by_id[run_id]
        status = run.get("status")
        if status == "active":
            if run_id != active_run_id or any(
                row.get("active") is not True or row.get("is_hks") is not True for row in rows
            ):
                raise ReconciliationError("active my.harvard ownership state is inconsistent")
            _validate_manifest(
                run,
                rows,
                label="active my.harvard catalogue",
                identity_field="source_offering_id",
                require_source_course_id=True,
            )
        elif status == "superseded":
            if run_id != rollback_run_id or any(
                row.get("active") is not False or row.get("is_hks") is not True for row in rows
            ):
                raise ReconciliationError("rollback my.harvard ownership state is inconsistent")
            _validate_manifest(
                run,
                rows,
                label="rollback my.harvard catalogue",
                identity_field="source_offering_id",
                require_source_course_id=True,
            )
        else:
            raise ReconciliationError("my.harvard rows belong to a non-retained run state")

    active_hks_source_ids = {
        _required_text(row, "source_course_id", "active my.harvard row")
        for row in myharvard_rows_by_run[active_run_id]
    }
    protected_hks_source_ids = {
        _required_text(row, "source_course_id", "protected my.harvard row")
        for rows in myharvard_rows_by_run.values()
        for row in rows
    }
    if source_id_set & active_hks_source_ids:
        raise ReconciliationError("current ATS source overlaps active my.harvard ownership")

    ats_runs = [
        run
        for run in catalogue_runs
        if str(run.get("source") or "").strip().lower() == "ats"
    ]
    active_ats_runs = [run for run in ats_runs if run.get("status") == "active"]
    if len(active_ats_runs) > 1:
        raise ReconciliationError("expected at most one active ATS catalogue run")
    active_ats_run = active_ats_runs[0] if active_ats_runs else None
    active_ats_run_id = (
        _required_text(active_ats_run, "id", "active ATS catalogue run")
        if active_ats_run
        else None
    )
    superseded_ats_run_ids = {
        _required_text(run, "id", "superseded ATS catalogue run")
        for run in ats_runs
        if run.get("status") == "superseded"
    }

    counts = Counter()
    actionable_rows: list[dict] = []
    classified_current_ats_ids: set[str] = set()
    active_ats_rows: list[dict] = []
    database_id_set = set(database_ids)
    for row in database_rows:
        row_id = _required_text(row, "id", "database row")
        source = str(row.get("source") or "").strip().lower()
        if row.get("is_hks") not in (True, False) or row.get("active") not in (True, False):
            raise ReconciliationError("live_courses row has a non-boolean ownership state")
        is_hks = row.get("is_hks") is True
        active = row.get("active") is True
        sync_run_id = str(row.get("sync_run_id") or "").strip()

        if source == "myharvard":
            if sync_run_id == active_run_id:
                counts["protected_active_myharvard"] += 1
            elif sync_run_id == rollback_run_id:
                counts["protected_myharvard_rollback"] += 1
            else:
                raise ReconciliationError("my.harvard row was not assigned to a protected snapshot")
        elif source == "ats" and row_id in source_id_set:
            expected_run_id = active_ats_run_id or ""
            if not active or is_hks or sync_run_id != expected_run_id:
                raise ReconciliationError("current ATS row has inconsistent ownership or active state")
            counts["current_non_hks_ats"] += 1
            classified_current_ats_ids.add(row_id)
            if active_ats_run_id:
                active_ats_rows.append(row)
        elif source == "ats" and (
            is_hks or row_id in protected_hks_source_ids
        ):
            if active or sync_run_id:
                raise ReconciliationError("legacy HKS fallback is active or run-owned")
            counts["protected_legacy_hks_fallback"] += 1
        elif source == "ats" and not is_hks:
            if active_ats_run_id:
                if active:
                    raise ReconciliationError("retained ATS row is still active")
                if sync_run_id and sync_run_id not in superseded_ats_run_ids:
                    raise ReconciliationError(
                        "retained ATS row is not transition-legacy or superseded-run-owned"
                    )
            elif sync_run_id:
                raise ReconciliationError(
                    "legacy ATS row references a run without an active ATS manifest"
                )
            counts["actionable_retained_non_hks_ats"] += 1
            actionable_rows.append(row)
        else:
            raise ReconciliationError("live_courses contains an unowned row state")

    classified_count = sum(counts.values())
    if classified_count != len(database_rows):
        raise ReconciliationError("live-course ownership partition is not exhaustive")

    if classified_current_ats_ids != source_id_set:
        if source_id_set - database_id_set:
            raise ReconciliationError("current ATS source rows are missing from live_courses")
        raise ReconciliationError("current ATS source row is owned by a different population")

    if active_ats_run:
        _validate_manifest(
            active_ats_run,
            active_ats_rows,
            label="active ATS catalogue",
            identity_field="id",
        )

    actionable_ids = [_required_text(row, "id", "actionable retained ATS row") for row in actionable_rows]
    active_states = Counter("active" if row.get("active") is True else "inactive" for row in actionable_rows)
    age_buckets = Counter(
        _age_bucket(
            row.get("source_last_seen_at") or row.get("synced_at"),
            now=audit_now,
        )
        for row in actionable_rows
    )
    by_school = Counter(str(row.get("school") or "unknown") for row in actionable_rows)
    by_term = Counter(str(row.get("term") or "unknown") for row in actionable_rows)

    return {
        "database_row_count": len(database_rows),
        "classified_row_count": classified_count,
        "current_non_hks_ats_count": counts["current_non_hks_ats"],
        "ats_manifest_enforced": active_ats_run_id is not None,
        "protected_active_myharvard_count": counts["protected_active_myharvard"],
        "protected_myharvard_rollback_count": counts["protected_myharvard_rollback"],
        "protected_legacy_hks_fallback_count": counts["protected_legacy_hks_fallback"],
        "actionable_retained_non_hks_ats_count": counts[
            "actionable_retained_non_hks_ats"
        ],
        "actionable_queue_sha256": _queue_digest(actionable_ids),
        "actionable_by_active_state": dict(sorted(active_states.items())),
        "actionable_by_age": dict(sorted(age_buckets.items())),
        "actionable_by_school": dict(sorted(by_school.items())),
        "actionable_by_term": dict(sorted(by_term.items())),
        "current_source_missing_from_database_count": 0,
    }
