"""Read-only evidence audit for retained non-HKS Harvard ATS rows.

This manual operator tool reconstructs the exact retained queue from the same
complete source and ownership rules used by the daily sync, then performs a
paced exact-``courseID`` lookup for every row. It never changes Supabase,
publishes data, or authorizes retirement. Results are stored locally as stable
HMAC tokens in an append-only, HMAC-authenticated history. The chain detects
accidental or unauthorized edits by parties that do not hold the secret; an
externally retained chain head is required for independent tamper evidence.

Required environment variables:
    HARVARD_API_KEY
    SUPABASE_URL
    SUPABASE_KEY
    RETAINED_ATS_AUDIT_HMAC_KEY
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import subprocess
import sys
import tempfile
import time
from collections import Counter, defaultdict
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Callable, Iterable
from urllib.parse import urlparse

import requests


ROOT = Path(__file__).resolve().parents[1]
HARVARD_API_BASE = "https://go.apis.huit.harvard.edu/ats/course/v2/search"
HARVARD_ALLOWED_HOSTS = {
    "go.apis.huit.harvard.edu",
    "go.prod.apis.huit.harvard.edu",
}
EXPECTED_SUPABASE_PROJECT_REF = "cbtroatixvydpwoviezf"
EXPECTED_SUPABASE_HOST = f"{EXPECTED_SUPABASE_PROJECT_REF}.supabase.co"
EXPECTED_QUEUE_COUNT = 1_526
EXPECTED_QUEUE_SHA256 = (
    "fbd0a26cc18c195150f6f8d6e402db69edf28f0227c3ad5911814518c04312a5"
)
PAGE_SIZE = 250
MAX_PAGES = 1_000
MAX_ATTEMPTS = 5
REQUEST_INTERVAL_SECONDS = 1.0
REQUEST_TIMEOUT_SECONDS = 25
MAX_RETRY_AFTER_SECONDS = 30.0
MIN_ELIGIBLE_INTERVAL_SECONDS = 18 * 60 * 60
RETRYABLE_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}
OUTCOMES = (
    "exact_instance",
    "moved_instance",
    "confirmed_absence",
    "unknown",
)
LOCATOR_FIELDS = ("school", "term", "course_code", "session_code")
UNKNOWN_REASONS = {
    "request_failed",
    "redirect",
    "http_error",
    "invalid_json",
    "invalid_schema",
    "invalid_cursor",
    "cursor_loop",
    "page_limit",
    "duplicate_exact",
    "missing_locator",
    "source_disagreement",
}
DEFAULT_HISTORY_PATH = ROOT / "artifacts" / "retained-ats-audit-history.jsonl"


class AuditFailure(RuntimeError):
    """A bounded audit failure whose code is safe to show to an operator."""

    def __init__(
        self,
        code: str,
        *,
        history_sequence: int | None = None,
        history_chain_head: str = "",
    ):
        super().__init__(code)
        self.code = code
        self.history_sequence = history_sequence
        self.history_chain_head = history_chain_head


@dataclass(frozen=True)
class ExactRead:
    complete: bool
    instances: tuple[dict, ...] = ()
    reason: str = ""


@dataclass(frozen=True)
class AuditResult:
    token: str
    outcome: str
    moved_fields: tuple[str, ...] = ()
    unknown_reason: str = ""
    # ``baseline_hmac`` binds immutable ownership/identity fields. Locators are
    # tracked separately because a verified current-source reappearance may
    # legitimately update term, code, school, or session.
    baseline_hmac: str = ""
    locator_hmac: str = ""
    baseline_active: bool | None = None
    current_source_present: bool | None = None

    def as_dict(self) -> dict:
        value = {"token": self.token, "outcome": self.outcome}
        if self.moved_fields:
            value["moved_fields"] = list(self.moved_fields)
        if self.unknown_reason:
            value["unknown_reason"] = self.unknown_reason
        if self.baseline_hmac:
            value["baseline_hmac"] = self.baseline_hmac
        if self.locator_hmac:
            value["locator_hmac"] = self.locator_hmac
        if self.baseline_active is not None:
            value["baseline_active"] = self.baseline_active
        if self.current_source_present is not None:
            value["current_source_present"] = self.current_source_present
        return value


@dataclass(frozen=True)
class InventorySnapshot:
    """Complete read-only source/database state used to select an audit cohort."""

    current_queue: tuple[dict, ...]
    source_rows: tuple[dict, ...]
    database_rows: tuple[dict, ...]
    catalogue_runs: tuple[dict, ...]
    report: dict
    control: dict
    source_ids: frozenset[str]
    protected_hks_ids: frozenset[str]
    allowed_non_hks_schools: frozenset[str]


@dataclass(frozen=True)
class HistoryState:
    """Semantically validated cohort, project, and latest member state."""

    tokens: frozenset[str] | None
    members: dict[str, tuple[str, str, bool]] | None
    project_ref: str | None
    key_id: str | None
    has_schema_v2: bool


class RequestPacer:
    """Keep all provider request starts at least one interval apart."""

    def __init__(
        self,
        interval: float = REQUEST_INTERVAL_SECONDS,
        *,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.interval = interval
        self._monotonic = monotonic
        self._sleep = sleep
        self._last_started: float | None = None

    def wait(self) -> None:
        now = self._monotonic()
        if self._last_started is not None:
            remaining = self.interval - (now - self._last_started)
            if remaining > 0:
                self._sleep(remaining)
                now = self._monotonic()
        self._last_started = now


@contextmanager
def read_only_network_guard():
    """Enforce GET-only egress to the exact reviewed provider/database hosts."""
    original = requests.sessions.Session.request

    def guarded(session, method, url, *args, **kwargs):
        parsed = urlparse(str(url))
        method_name = _required_text(method).upper()
        harvard_path = urlparse(HARVARD_API_BASE).path
        allowed = (
            method_name == "GET"
            and parsed.scheme == "https"
            and parsed.username is None
            and parsed.password is None
            and parsed.port is None
            and (
                (
                    parsed.hostname in HARVARD_ALLOWED_HOSTS
                    and (
                        parsed.path == harvard_path
                        or parsed.path.startswith(f"{harvard_path}/scroll/")
                    )
                )
                or (
                    parsed.hostname == EXPECTED_SUPABASE_HOST
                    and parsed.path.startswith("/rest/v1/")
                )
            )
        )
        if not allowed:
            raise AuditFailure("read_only_transport_violation")
        return original(session, method, url, *args, **kwargs)

    requests.sessions.Session.request = guarded
    try:
        yield
    finally:
        requests.sessions.Session.request = original


def _required_text(value: object) -> str:
    return str(value or "").strip()


def queue_digest(values: Iterable[str]) -> str:
    payload = json.dumps(
        sorted(values), ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def course_token(course_id: str, secret: bytes) -> str:
    return hmac.new(
        secret,
        b"hks-course-explorer/retained-ats/id/v1\0" + course_id.strip().encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def ownership_commitment(row: dict, secret: bytes) -> str:
    """Bind immutable source ownership fields without storing their values."""
    baseline = {
        "source": _required_text(row.get("source")).lower(),
        "is_hks": row.get("is_hks"),
        "sync_run_id": _required_text(row.get("sync_run_id")),
        "source_course_id": _required_text(row.get("source_course_id")),
        "source_offering_id": _required_text(row.get("source_offering_id")),
    }
    return hmac.new(
        secret,
        b"hks-course-explorer/retained-ats/ownership/v1\0" + _canonical_json(baseline),
        hashlib.sha256,
    ).hexdigest()


def locator_commitment(row: dict, secret: bytes) -> str:
    """Bind mutable course locators without storing their values."""
    locators = {
        "school": _required_text(row.get("school")).upper(),
        "term": _required_text(row.get("term")),
        "course_code": _required_text(row.get("course_code")),
        "session_code": _required_text(row.get("session_code")),
    }
    return hmac.new(
        secret,
        b"hks-course-explorer/retained-ats/locator/v1\0" + _canonical_json(locators),
        hashlib.sha256,
    ).hexdigest()


def _history_key(secret: bytes) -> bytes:
    return hmac.new(
        secret,
        b"hks-course-explorer/retained-ats/history-key/v1",
        hashlib.sha256,
    ).digest()


def _canonical_json(value: object) -> bytes:
    return json.dumps(
        value, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")


def _valid_harvard_url(url: str, *, initial: bool = False) -> bool:
    parsed = urlparse(url)
    try:
        port = parsed.port
    except ValueError:
        return False
    if (
        parsed.scheme != "https"
        or parsed.hostname not in HARVARD_ALLOWED_HOSTS
        or port is not None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.fragment
    ):
        return False
    if initial:
        return url == HARVARD_API_BASE
    return parsed.path.startswith("/ats/course/v2/search/scroll/")


def _decode_exact_page(raw: object) -> tuple[list[dict], str | None]:
    """Decode a page without interpreting a missing result collection as empty."""
    if isinstance(raw, list):
        items = raw
        next_url = None
    elif isinstance(raw, dict):
        if "results" in raw:
            items = raw["results"]
        elif "courses" in raw:
            items = raw["courses"]
        else:
            raise AuditFailure("invalid_schema")
        next_url = raw.get("next")
    else:
        raise AuditFailure("invalid_schema")

    if not isinstance(items, list) or any(not isinstance(item, dict) for item in items):
        raise AuditFailure("invalid_schema")
    if any(not _required_text(item.get("courseID")) for item in items):
        raise AuditFailure("invalid_schema")
    if next_url in (None, ""):
        return items, None
    if not isinstance(next_url, str) or not _valid_harvard_url(next_url):
        raise AuditFailure("invalid_cursor")
    return items, next_url


def _retry_after_seconds(value: object, *, now: datetime | None = None) -> float:
    raw = _required_text(value)
    if not raw:
        return 0.0
    try:
        delay = float(raw)
    except ValueError:
        try:
            when = parsedate_to_datetime(raw)
            if when.tzinfo is None:
                return 0.0
            delay = (when - (now or datetime.now(timezone.utc))).total_seconds()
        except (TypeError, ValueError, OverflowError):
            return 0.0
    return min(MAX_RETRY_AFTER_SECONDS, max(0.0, delay))


def fetch_exact_instances(
    course_id: str,
    *,
    api_key: str,
    session: requests.Session,
    pacer: RequestPacer,
    sleep: Callable[[float], None] = time.sleep,
) -> ExactRead:
    """Read every exact-ID search page with bounded, redacted failures."""
    if not _valid_harvard_url(HARVARD_API_BASE, initial=True):
        return ExactRead(False, reason="invalid_cursor")

    url = HARVARD_API_BASE
    params: dict | None = {
        "courseID": course_id,
        "size": PAGE_SIZE,
        "scroll": "true",
    }
    seen_cursors: set[str] = set()
    instances: list[dict] = []
    headers = {
        "X-Api-Key": api_key,
        "Accept": "application/json",
        "User-Agent": "HKS-Course-Explorer-Retained-Audit/1.0",
    }

    for _page_number in range(1, MAX_PAGES + 1):
        page_items: list[dict] | None = None
        next_url: str | None = None
        terminal_reason = "request_failed"
        for attempt in range(MAX_ATTEMPTS):
            pacer.wait()
            try:
                response = session.get(
                    url,
                    params=params,
                    headers=headers,
                    timeout=REQUEST_TIMEOUT_SECONDS,
                    allow_redirects=False,
                )
            except requests.RequestException:
                terminal_reason = "request_failed"
            else:
                if response.is_redirect or 300 <= response.status_code < 400:
                    return ExactRead(False, reason="redirect")
                # The official endpoint documents HTTP 200 for a successful
                # search. A different 2xx status is not sufficient evidence of
                # a complete result set and must never become an absence.
                if response.status_code == 200:
                    try:
                        page_items, next_url = _decode_exact_page(response.json())
                    except ValueError:
                        return ExactRead(False, reason="invalid_json")
                    except AuditFailure as exc:
                        return ExactRead(False, reason=exc.code)
                    break
                terminal_reason = "http_error"
                if 200 <= response.status_code < 300:
                    return ExactRead(False, reason=terminal_reason)
                if response.status_code not in RETRYABLE_STATUS_CODES:
                    return ExactRead(False, reason=terminal_reason)
                retry_after = _retry_after_seconds(response.headers.get("Retry-After"))
                if retry_after:
                    sleep(retry_after)

            if attempt < MAX_ATTEMPTS - 1:
                sleep(min(MAX_RETRY_AFTER_SECONDS, float(2**attempt)))

        if page_items is None:
            return ExactRead(False, reason=terminal_reason)
        instances.extend(page_items)
        if not next_url:
            return ExactRead(True, tuple(instances))
        if next_url in seen_cursors:
            return ExactRead(False, reason="cursor_loop")
        seen_cursors.add(next_url)
        url = next_url
        params = None

    return ExactRead(False, reason="page_limit")


def _normalised_course_code(instance: dict) -> str:
    course_number = _required_text(instance.get("courseNumber") or instance.get("catalog"))
    parts = course_number.split()
    subject = _required_text(
        instance.get("catalogSubject")
        or instance.get("subject")
        or (parts[0] if parts else "")
    )
    number = _required_text(
        instance.get("classCatalogNumber")
        or instance.get("catalogNumber")
        or (parts[1] if len(parts) > 1 else "")
    )
    return f"{subject}-{number}" if subject and number else course_number.replace(" ", "-")


def _provider_locator(instance: dict) -> dict[str, str]:
    school = instance.get("catalogSchool")
    if isinstance(school, dict):
        school = school.get("code") or school.get("id") or school.get("name")
    return {
        "school": _required_text(
            school or instance.get("catalogSchoolCode") or instance.get("schoolCode")
        ).upper(),
        "term": _required_text(instance.get("termDescription") or instance.get("term")),
        "course_code": _normalised_course_code(instance),
        "session_code": _required_text(instance.get("sessionCode")),
    }


def classify_exact_read(
    stored: dict,
    read: ExactRead,
    *,
    secret: bytes,
    baseline_hmac: str = "",
    locator_hmac: str = "",
    baseline_active: bool | None = None,
    current_source_present: bool | None = None,
) -> AuditResult:
    course_id = _required_text(stored.get("id"))
    token = course_token(course_id, secret)

    def result(
        outcome: str,
        *,
        moved_fields: tuple[str, ...] = (),
        unknown_reason: str = "",
    ) -> AuditResult:
        return AuditResult(
            token,
            outcome,
            moved_fields=moved_fields,
            unknown_reason=unknown_reason,
            baseline_hmac=baseline_hmac,
            locator_hmac=locator_hmac,
            baseline_active=baseline_active,
            current_source_present=current_source_present,
        )

    if not read.complete:
        reason = read.reason if read.reason in UNKNOWN_REASONS else "request_failed"
        return result("unknown", unknown_reason=reason)

    exact = [
        item for item in read.instances if _required_text(item.get("courseID")) == course_id
    ]
    if not exact:
        if current_source_present is True:
            # The complete source sweep proves presence. A disagreeing exact
            # lookup is insufficient evidence for absence and must block review.
            return result("unknown", unknown_reason="source_disagreement")
        return result("confirmed_absence")
    if len(exact) != 1:
        return result("unknown", unknown_reason="duplicate_exact")

    stored_locator = {
        "school": _required_text(stored.get("school")).upper(),
        "term": _required_text(stored.get("term")),
        "course_code": _required_text(stored.get("course_code")),
        "session_code": _required_text(stored.get("session_code")),
    }
    provider_locator = _provider_locator(exact[0])
    if any(not stored_locator[field] or not provider_locator[field] for field in LOCATOR_FIELDS):
        return result("unknown", unknown_reason="missing_locator")
    moved = tuple(
        sorted(
            field
            for field in LOCATOR_FIELDS
            if stored_locator[field] != provider_locator[field]
        )
    )
    if moved:
        return result("moved_instance", moved_fields=moved)
    return result("exact_instance")


def _load_sync_module():
    try:
        import sync_live_courses as sync  # type: ignore
    except ModuleNotFoundError:
        from scripts import sync_live_courses as sync  # type: ignore
    return sync


def _reconstruct_inventory(sync_module=None) -> InventorySnapshot:
    """Rebuild the complete source/ownership partition behind the audit."""
    sync = sync_module or _load_sync_module()
    try:
        rows_by_id, failures, _tasks = sync.collect_general_source_rows()
        if failures:
            raise AuditFailure("queue_snapshot_mismatch")
        authoritative_hks_ids = sync.supabase_active_hks_source_course_ids()
        source_rows = [
            row for row_id, row in rows_by_id.items() if row_id not in authoritative_hks_ids
        ]
        if len(source_rows) < sync.MIN_UNIQUE_COURSES:
            raise AuditFailure("queue_snapshot_mismatch")

        database_rows = sync.supabase_inventory_live_courses()
        catalogue_runs = sync.supabase_inventory_catalogue_runs()
        report = sync.compare_live_course_inventory(
            source_rows, database_rows, catalogue_runs
        )
        source_ids = {_required_text(row.get("id")) for row in source_rows}
        protected_hks_ids = {
            _required_text(row.get("source_course_id"))
            for row in database_rows
            if _required_text(row.get("source")).lower() == "myharvard"
        }
        queue = [
            row
            for row in database_rows
            if _required_text(row.get("source")).lower() == "ats"
            and row.get("is_hks") is False
            and not _required_text(row.get("sync_run_id"))
            and _required_text(row.get("id")) not in source_ids
            and _required_text(row.get("id")) not in protected_hks_ids
        ]
        ids = [_required_text(row.get("id")) for row in queue]
        digest = queue_digest(ids)
        if (
            not all(ids)
            or len(ids) != len(set(ids))
            or report.get("actionable_retained_non_hks_ats_count") != len(queue)
            or report.get("actionable_queue_sha256") != digest
        ):
            raise AuditFailure("queue_snapshot_mismatch")
        control = min(source_rows, key=lambda row: _required_text(row.get("id")))
        return InventorySnapshot(
            current_queue=tuple(
                sorted(queue, key=lambda row: _required_text(row.get("id")))
            ),
            source_rows=tuple(source_rows),
            database_rows=tuple(database_rows),
            catalogue_runs=tuple(catalogue_runs),
            report=report,
            control=control,
            source_ids=frozenset(source_ids),
            protected_hks_ids=frozenset(protected_hks_ids | authoritative_hks_ids),
            allowed_non_hks_schools=frozenset(
                _required_text(school).upper() for school in sync.GENERAL_SYNC_SCHOOLS
            ),
        )
    except AuditFailure:
        raise
    except Exception:
        # Exit the exception handler before raising the bounded error below.
        # That prevents the source/database exception (which may contain a
        # prepared URL, raw ID, or credential) from surviving as context.
        pass
    raise AuditFailure("queue_snapshot_mismatch")


def _validate_cohort_row(
    row: dict,
    snapshot: InventorySnapshot,
    *,
    current_source_present: bool,
) -> None:
    """Require one row to remain an owned, locatable non-HKS ATS record."""
    course_id = _required_text(row.get("id"))
    school = _required_text(row.get("school")).upper()
    if (
        not course_id
        or _required_text(row.get("source")).lower() != "ats"
        or row.get("is_hks") is not False
        or _required_text(row.get("sync_run_id"))
        or course_id in snapshot.protected_hks_ids
        or school not in snapshot.allowed_non_hks_schools
        or any(not _required_text(row.get(field)) for field in LOCATOR_FIELDS)
        or not isinstance(row.get("active"), bool)
        or (current_source_present and row.get("active") is not True)
    ):
        raise AuditFailure("cohort_snapshot_mismatch")


def _require_initial_queue(snapshot: InventorySnapshot) -> list[dict]:
    ids = [_required_text(row.get("id")) for row in snapshot.current_queue]
    if len(ids) != EXPECTED_QUEUE_COUNT or queue_digest(ids) != EXPECTED_QUEUE_SHA256:
        raise AuditFailure("queue_snapshot_mismatch")
    for row in snapshot.current_queue:
        try:
            _validate_cohort_row(row, snapshot, current_source_present=False)
        except AuditFailure as exc:
            raise AuditFailure("queue_snapshot_mismatch") from exc
    return list(snapshot.current_queue)


def reconstruct_locked_queue(sync_module=None) -> tuple[list[dict], dict, dict]:
    """Rebuild and verify the frozen queue used by the first audit run."""
    snapshot = _reconstruct_inventory(sync_module)
    return _require_initial_queue(snapshot), snapshot.report, snapshot.control


def _validate_supabase_url(value: str) -> None:
    parsed = urlparse(value)
    try:
        port = parsed.port
    except ValueError:
        raise AuditFailure("invalid_configuration") from None
    if (
        parsed.scheme != "https"
        or parsed.hostname != EXPECTED_SUPABASE_HOST
        or parsed.username is not None
        or parsed.password is not None
        or port is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise AuditFailure("invalid_configuration")


def _provenance() -> str:
    try:
        commit = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
        dirty = subprocess.run(
            [
                "git",
                "status",
                "--porcelain",
                "--",
                "scripts/audit_retained_ats.py",
                "scripts/sync_live_courses.py",
                "scripts/live_course_reconciliation.py",
            ],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        ).stdout.strip()
    except (OSError, subprocess.SubprocessError) as exc:
        raise AuditFailure("invalid_provenance") from exc
    if len(commit) != 40 or any(char not in "0123456789abcdef" for char in commit.lower()):
        raise AuditFailure("invalid_provenance")
    if dirty:
        raise AuditFailure("dirty_provenance")
    return commit


def _result_digest(results: list[dict]) -> str:
    return hashlib.sha256(_canonical_json(sorted(results, key=lambda item: item["token"]))).hexdigest()


def _validate_result(result: AuditResult, *, require_baseline: bool = False) -> None:
    token_is_valid = (
        len(result.token) == 64
        and all(character in "0123456789abcdef" for character in result.token)
    )
    moved_is_valid = (
        bool(result.moved_fields)
        and tuple(sorted(set(result.moved_fields))) == result.moved_fields
        and set(result.moved_fields).issubset(LOCATOR_FIELDS)
    )
    if not token_is_valid or result.outcome not in OUTCOMES:
        raise AuditFailure("run_incomplete")
    baseline_is_valid = (
        len(result.baseline_hmac) == 64
        and all(character in "0123456789abcdef" for character in result.baseline_hmac)
        and len(result.locator_hmac) == 64
        and all(character in "0123456789abcdef" for character in result.locator_hmac)
        and isinstance(result.baseline_active, bool)
        and isinstance(result.current_source_present, bool)
    )
    if require_baseline and not baseline_is_valid:
        raise AuditFailure("run_incomplete")
    if not require_baseline and any(
        value not in ("", None)
        for value in (
            result.baseline_hmac,
            result.locator_hmac,
            result.baseline_active,
            result.current_source_present,
        )
    ) and not baseline_is_valid:
        raise AuditFailure("run_incomplete")
    if result.outcome == "exact_instance":
        valid = not result.moved_fields and not result.unknown_reason
    elif result.outcome == "moved_instance":
        valid = moved_is_valid and not result.unknown_reason
    elif result.outcome == "confirmed_absence":
        valid = not result.moved_fields and not result.unknown_reason
    else:
        valid = (
            not result.moved_fields
            and result.unknown_reason in UNKNOWN_REASONS
        )
    if not valid:
        raise AuditFailure("run_incomplete")


def _audit_key_identifier(secret: bytes) -> str:
    return hmac.new(
        secret,
        b"hks-course-explorer/retained-ats/key-id/v1",
        hashlib.sha256,
    ).hexdigest()[:16]


def _audit_context(*, supabase_url: str, secret: bytes) -> dict[str, str]:
    project_ref = _required_text(urlparse(supabase_url).hostname).split(".", 1)[0]
    return {
        "project_ref": project_ref,
        "key_id": _audit_key_identifier(secret),
    }


def build_observation_metadata(
    cohort: list[dict],
    snapshot: InventorySnapshot,
    *,
    secret: bytes,
    supabase_url: str,
) -> dict:
    """Describe the frozen/current set partitions using token-only digests."""
    cohort_tokens = {
        course_token(_required_text(row.get("id")), secret) for row in cohort
    }
    observed_actionable_tokens = {
        course_token(_required_text(row.get("id")), secret)
        for row in snapshot.current_queue
    }
    current_source_tokens = {
        course_token(_required_text(row.get("id")), secret)
        for row in cohort
        if _required_text(row.get("id")) in snapshot.source_ids
    }
    still_actionable_tokens = cohort_tokens - current_source_tokens
    outside_tokens = observed_actionable_tokens - cohort_tokens
    if (
        len(cohort_tokens) != EXPECTED_QUEUE_COUNT
        or not still_actionable_tokens.issubset(observed_actionable_tokens)
    ):
        raise AuditFailure("cohort_snapshot_mismatch")
    context = _audit_context(supabase_url=supabase_url, secret=secret)
    outside_token_list = sorted(outside_tokens)
    raw_actionable_digest = _required_text(
        snapshot.report.get("actionable_queue_sha256")
    )
    return {
        "cohort_version": 1,
        "token_domain": "retained-ats/id/v1",
        **context,
        "cohort_token_set_sha256": queue_digest(cohort_tokens),
        "still_actionable_frozen_count": len(still_actionable_tokens),
        "still_actionable_frozen_token_sha256": queue_digest(still_actionable_tokens),
        "reappeared_frozen_count": len(current_source_tokens),
        "reappeared_frozen_token_sha256": queue_digest(current_source_tokens),
        "observed_actionable_count": len(observed_actionable_tokens),
        "observed_actionable_token_sha256": queue_digest(observed_actionable_tokens),
        "new_actionable_outside_cohort_count": len(outside_tokens),
        "new_actionable_outside_cohort_token_sha256": queue_digest(outside_tokens),
        "new_actionable_outside_cohort_tokens": outside_token_list,
        "observed_actionable_raw_id_sha256": raw_actionable_digest,
        "outside_cohort_blocks_completion": bool(outside_tokens),
    }


def _is_lower_hex(value: object, length: int) -> bool:
    return isinstance(value, str) and len(value) == length and all(
        character in "0123456789abcdef" for character in value
    )


def _validate_observation_metadata(
    metadata: dict,
    results: list[AuditResult],
    *,
    expected_count: int | None = None,
) -> None:
    # Resolve the production constant at call time so tests can use deliberately
    # small cohorts without weakening the production invariant.
    if expected_count is None:
        expected_count = EXPECTED_QUEUE_COUNT
    cohort_tokens = {result.token for result in results}
    reappeared_tokens = {
        result.token for result in results if result.current_source_present is True
    }
    still_tokens = cohort_tokens - reappeared_tokens
    outside_value = metadata.get("new_actionable_outside_cohort_tokens")
    outside_list_is_text = isinstance(outside_value, list) and all(
        isinstance(token, str) for token in outside_value
    )
    outside_tokens = set(outside_value) if outside_list_is_text else set()
    observed_tokens = still_tokens | outside_tokens
    counts = {
        name: metadata.get(name)
        for name in (
            "still_actionable_frozen_count",
            "reappeared_frozen_count",
            "observed_actionable_count",
            "new_actionable_outside_cohort_count",
        )
    }
    digest_fields = (
        "cohort_token_set_sha256",
        "still_actionable_frozen_token_sha256",
        "reappeared_frozen_token_sha256",
        "observed_actionable_token_sha256",
        "new_actionable_outside_cohort_token_sha256",
    )
    project_ref = metadata.get("project_ref")
    if (
        metadata.get("cohort_version") != 1
        or metadata.get("token_domain") != "retained-ats/id/v1"
        or project_ref != EXPECTED_SUPABASE_PROJECT_REF
        or not _is_lower_hex(metadata.get("key_id"), 16)
        or any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in counts.values())
        or any(not _is_lower_hex(metadata.get(field), 64) for field in digest_fields)
        or not _is_lower_hex(metadata.get("observed_actionable_raw_id_sha256"), 64)
        or not outside_list_is_text
        or outside_value != sorted(outside_tokens)
        or len(outside_tokens) != len(outside_value)
        or any(not _is_lower_hex(token, 64) for token in outside_tokens)
        or bool(cohort_tokens & outside_tokens)
        or counts["still_actionable_frozen_count"]
        + counts["reappeared_frozen_count"]
        != expected_count
        or counts["still_actionable_frozen_count"]
        + counts["new_actionable_outside_cohort_count"]
        != counts["observed_actionable_count"]
        or metadata.get("outside_cohort_blocks_completion")
        is not (counts["new_actionable_outside_cohort_count"] > 0)
        or metadata.get("cohort_token_set_sha256")
        != queue_digest(cohort_tokens)
        or metadata.get("still_actionable_frozen_token_sha256")
        != queue_digest(still_tokens)
        or metadata.get("reappeared_frozen_token_sha256")
        != queue_digest(reappeared_tokens)
        or metadata.get("observed_actionable_token_sha256")
        != queue_digest(observed_tokens)
        or metadata.get("new_actionable_outside_cohort_token_sha256")
        != queue_digest(outside_tokens)
        or counts["still_actionable_frozen_count"] != len(still_tokens)
        or counts["reappeared_frozen_count"]
        != len(reappeared_tokens)
        or counts["observed_actionable_count"] != len(observed_tokens)
        or counts["new_actionable_outside_cohort_count"] != len(outside_tokens)
        or any(
            result.current_source_present is True
            and result.outcome == "confirmed_absence"
            for result in results
        )
    ):
        raise AuditFailure("run_incomplete")


def build_run_record(
    *,
    started: datetime,
    completed: datetime,
    base_commit: str,
    results: list[AuditResult],
    observation_metadata: dict,
) -> dict:
    if (
        started.tzinfo is None
        or completed.tzinfo is None
        or completed.astimezone(timezone.utc) < started.astimezone(timezone.utc)
        or len(base_commit) != 40
        or any(character not in "0123456789abcdef" for character in base_commit.lower())
    ):
        raise AuditFailure("invalid_provenance")
    for result in results:
        _validate_result(result, require_baseline=True)
    serialized = [result.as_dict() for result in sorted(results, key=lambda item: item.token)]
    counts = Counter(result.outcome for result in results)
    unknowns = Counter(result.unknown_reason for result in results if result.unknown_reason)
    try:
        _validate_observation_metadata(observation_metadata, results)
    except AuditFailure:
        raise
    if (
        len(results) != EXPECTED_QUEUE_COUNT
        or len({result.token for result in results}) != EXPECTED_QUEUE_COUNT
        or set(counts) - set(OUTCOMES)
        or sum(counts.values()) != EXPECTED_QUEUE_COUNT
        or set(unknowns) - UNKNOWN_REASONS
    ):
        raise AuditFailure("run_incomplete")
    return {
        "schema_version": 2,
        "record_type": "observation",
        "valid": True,
        "started_at": started.astimezone(timezone.utc).isoformat(),
        "completed_at": completed.astimezone(timezone.utc).isoformat(),
        "base_commit": base_commit,
        "queue_count": EXPECTED_QUEUE_COUNT,
        "queue_sha256": EXPECTED_QUEUE_SHA256,
        "endpoint_host": urlparse(HARVARD_API_BASE).hostname,
        "planned_count": EXPECTED_QUEUE_COUNT,
        "completed_count": len(results),
        "outcome_counts": {name: counts.get(name, 0) for name in OUTCOMES},
        "unknown_reasons": dict(sorted(unknowns.items())),
        "result_digest": _result_digest(serialized),
        "results": serialized,
        **observation_metadata,
    }


def build_failed_attempt_record(
    *,
    started: datetime,
    completed: datetime,
    base_commit: str,
    failure_reason: str,
    supabase_url: str,
    secret: bytes,
) -> dict:
    if (
        started.tzinfo is None
        or completed.tzinfo is None
        or completed.astimezone(timezone.utc) < started.astimezone(timezone.utc)
        or len(base_commit) != 40
        or any(character not in "0123456789abcdef" for character in base_commit.lower())
        or not failure_reason
        or len(failure_reason) > 64
        or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_" for character in failure_reason)
    ):
        raise AuditFailure("invalid_provenance")
    return {
        "schema_version": 2,
        "record_type": "attempt",
        "valid": False,
        "failure_reason": failure_reason,
        "started_at": started.astimezone(timezone.utc).isoformat(),
        "completed_at": completed.astimezone(timezone.utc).isoformat(),
        "base_commit": base_commit,
        "queue_count": EXPECTED_QUEUE_COUNT,
        "queue_sha256": EXPECTED_QUEUE_SHA256,
        "endpoint_host": urlparse(HARVARD_API_BASE).hostname,
        **_audit_context(supabase_url=supabase_url, secret=secret),
        "planned_count": EXPECTED_QUEUE_COUNT,
        "completed_count": 0,
        "outcome_counts": {name: 0 for name in OUTCOMES},
        "unknown_reasons": {},
        "result_digest": _result_digest([]),
        "results": [],
    }


def inventory_snapshot_digest(snapshot: InventorySnapshot) -> str:
    """Fingerprint relevant source/database state to detect an overlapping sync."""
    def ordered(rows: Iterable[dict]) -> list[dict]:
        return sorted(
            (dict(row) for row in rows),
            key=lambda row: (
                _required_text(row.get("id")),
                _required_text(row.get("source")),
                _required_text(row.get("sync_run_id")),
            ),
        )

    payload = {
        # Hash stable source/database/manifests directly. Do not include the
        # classifier report because it contains time-derived age buckets that
        # may change during a long audit without any upstream mutation.
        "source_rows": ordered(snapshot.source_rows),
        "database_rows": ordered(snapshot.database_rows),
        "catalogue_runs": ordered(snapshot.catalogue_runs),
        "source_ids": sorted(snapshot.source_ids),
        "protected_hks_ids": sorted(snapshot.protected_hks_ids),
        "current_queue_ids": sorted(
            _required_text(row.get("id")) for row in snapshot.current_queue
        ),
        "control_id": _required_text(snapshot.control.get("id")),
        "allowed_non_hks_schools": sorted(snapshot.allowed_non_hks_schools),
    }
    return hashlib.sha256(_canonical_json(payload)).hexdigest()


def resolve_history_path(value: str | os.PathLike[str]) -> Path:
    requested = Path(value).expanduser()
    root = ROOT.resolve()
    artifacts = (ROOT / "artifacts").resolve()
    if not requested.is_absolute():
        resolved = (ROOT / requested).resolve(strict=False)
        try:
            resolved.relative_to(artifacts)
        except ValueError as exc:
            raise AuditFailure("unsafe_history_path") from exc
        return resolved

    lexical = Path(os.path.abspath(requested))
    resolved = requested.resolve(strict=False)
    try:
        lexical.relative_to(root)
    except ValueError:
        lexical_is_in_repository = False
    else:
        lexical_is_in_repository = True
    if lexical_is_in_repository:
        try:
            lexical.relative_to(artifacts)
            resolved.relative_to(artifacts)
        except ValueError as exc:
            raise AuditFailure("unsafe_history_path") from exc
        return resolved

    try:
        resolved.relative_to(root)
    except ValueError:
        return resolved
    try:
        resolved.relative_to(artifacts)
    except ValueError as exc:
        raise AuditFailure("unsafe_history_path") from exc
    return resolved


@contextmanager
def exclusive_history_lock(path: Path):
    """Prevent two long-running audits from replacing the same history."""
    resolved = resolve_history_path(path)
    resolved.parent.mkdir(parents=True, exist_ok=True)
    lock_path = resolved.with_name(f".{resolved.name}.lock")
    descriptor: int | None = None
    try:
        descriptor = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.write(descriptor, f"pid={os.getpid()}\n".encode("ascii"))
    except FileExistsError as exc:
        raise AuditFailure("audit_in_progress") from exc
    except OSError as exc:
        raise AuditFailure("history_lock_failure") from exc
    try:
        yield resolved
    finally:
        if descriptor is not None:
            os.close(descriptor)
        try:
            os.unlink(lock_path)
        except FileNotFoundError:
            pass


def read_history(path: Path, secret: bytes) -> list[dict]:
    if not path.exists():
        return []
    chain_key = _history_key(secret)
    previous = "0" * 64
    records: list[dict] = []
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
        for expected_sequence, line in enumerate(lines, start=1):
            record = json.loads(line)
            if not isinstance(record, dict):
                raise ValueError
            chain = record.pop("chain_hmac", None)
            if record.get("sequence") != expected_sequence:
                raise ValueError
            expected = hmac.new(
                chain_key,
                previous.encode("ascii") + b"\n" + _canonical_json(record),
                hashlib.sha256,
            ).hexdigest()
            if not isinstance(chain, str) or not hmac.compare_digest(chain, expected):
                raise ValueError
            record["chain_hmac"] = chain
            records.append(record)
            previous = chain
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError) as exc:
        raise AuditFailure("history_integrity_failure") from exc
    return records


def _record_time(value: object) -> datetime:
    raw = _required_text(value)
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as exc:
        raise AuditFailure("history_integrity_failure") from exc
    if parsed.tzinfo is None or parsed.utcoffset() != timezone.utc.utcoffset(parsed):
        raise AuditFailure("history_integrity_failure")
    return parsed.astimezone(timezone.utc)


_COMMON_HISTORY_FIELDS = {
    "schema_version",
    "valid",
    "started_at",
    "completed_at",
    "base_commit",
    "queue_count",
    "queue_sha256",
    "endpoint_host",
    "planned_count",
    "completed_count",
    "outcome_counts",
    "unknown_reasons",
    "result_digest",
    "results",
    "sequence",
    "chain_hmac",
}
_OBSERVATION_METADATA_FIELDS = {
    "cohort_version",
    "token_domain",
    "project_ref",
    "key_id",
    "cohort_token_set_sha256",
    "still_actionable_frozen_count",
    "still_actionable_frozen_token_sha256",
    "reappeared_frozen_count",
    "reappeared_frozen_token_sha256",
    "observed_actionable_count",
    "observed_actionable_token_sha256",
    "observed_actionable_raw_id_sha256",
    "new_actionable_outside_cohort_count",
    "new_actionable_outside_cohort_token_sha256",
    "new_actionable_outside_cohort_tokens",
    "outside_cohort_blocks_completion",
}
_RESULT_FIELDS_V1 = {"token", "outcome", "moved_fields", "unknown_reason"}
_RESULT_FIELDS_V2 = _RESULT_FIELDS_V1 | {
    "baseline_hmac",
    "locator_hmac",
    "baseline_active",
    "current_source_present",
}


def _history_record_tokens(
    record: dict,
    *,
    expected_count: int | None = None,
    expected_digest: str | None = None,
) -> tuple[
    frozenset[str] | None,
    datetime,
    dict[str, tuple[str, str, bool, bool]] | None,
    int,
    str | None,
    str | None,
]:
    """Validate one HMAC-authenticated observation or bounded failed attempt."""
    if expected_count is None:
        expected_count = EXPECTED_QUEUE_COUNT
    if expected_digest is None:
        expected_digest = EXPECTED_QUEUE_SHA256
    schema_version = record.get("schema_version")
    is_valid = record.get("valid") is True
    allowed_fields = set(_COMMON_HISTORY_FIELDS)
    if schema_version == 1:
        if not is_valid:
            allowed_fields.add("failure_reason")
    elif schema_version == 2:
        allowed_fields |= {"record_type", "project_ref", "key_id"}
        if is_valid:
            allowed_fields |= _OBSERVATION_METADATA_FIELDS
        else:
            allowed_fields.add("failure_reason")
    if set(record) - allowed_fields:
        raise AuditFailure("history_integrity_failure")

    results = record.get("results")
    started = _record_time(record.get("started_at"))
    completed = _record_time(record.get("completed_at"))
    base_commit = _required_text(record.get("base_commit"))
    project_ref = _required_text(record.get("project_ref")) if schema_version == 2 else None
    key_id = _required_text(record.get("key_id")) if schema_version == 2 else None
    if (
        schema_version not in (1, 2)
        or completed < started
        or len(base_commit) != 40
        or any(character not in "0123456789abcdef" for character in base_commit.lower())
        or record.get("endpoint_host") != urlparse(HARVARD_API_BASE).hostname
        or record.get("queue_count") != expected_count
        or record.get("queue_sha256") != expected_digest
        or record.get("planned_count") != expected_count
        or (
            schema_version == 2
            and (
                project_ref != EXPECTED_SUPABASE_PROJECT_REF
                or not _is_lower_hex(key_id, 16)
            )
        )
    ):
        raise AuditFailure("history_integrity_failure")

    if not is_valid:
        failure_reason = _required_text(record.get("failure_reason"))
        if (
            record.get("valid") is not False
            or (schema_version == 2 and record.get("record_type") != "attempt")
            or record.get("completed_count") != 0
            or results != []
            or record.get("outcome_counts") != {name: 0 for name in OUTCOMES}
            or record.get("unknown_reasons") != {}
            or record.get("result_digest") != _result_digest([])
            or not failure_reason
            or len(failure_reason) > 64
            or any(character not in "abcdefghijklmnopqrstuvwxyz0123456789_" for character in failure_reason)
        ):
            raise AuditFailure("history_integrity_failure")
        return None, completed, None, schema_version, project_ref, key_id

    if (
        (schema_version == 2 and record.get("record_type") != "observation")
        or record.get("completed_count") != expected_count
        or not isinstance(results, list)
        or len(results) != expected_count
    ):
        raise AuditFailure("history_integrity_failure")

    parsed: list[AuditResult] = []
    allowed_result_fields = _RESULT_FIELDS_V2 if schema_version == 2 else _RESULT_FIELDS_V1
    for result in results:
        if not isinstance(result, dict) or set(result) - allowed_result_fields:
            raise AuditFailure("history_integrity_failure")
        moved_fields = result.get("moved_fields", [])
        if not isinstance(moved_fields, list) or any(
            not isinstance(field, str) for field in moved_fields
        ):
            raise AuditFailure("history_integrity_failure")
        parsed_result = AuditResult(
            token=_required_text(result.get("token")),
            outcome=_required_text(result.get("outcome")),
            moved_fields=tuple(moved_fields),
            unknown_reason=_required_text(result.get("unknown_reason")),
            baseline_hmac=_required_text(result.get("baseline_hmac")),
            locator_hmac=_required_text(result.get("locator_hmac")),
            baseline_active=result.get("baseline_active"),
            current_source_present=result.get("current_source_present"),
        )
        try:
            _validate_result(parsed_result, require_baseline=schema_version == 2)
        except AuditFailure as exc:
            raise AuditFailure("history_integrity_failure") from exc
        parsed.append(parsed_result)

    serialized = [result.as_dict() for result in sorted(parsed, key=lambda item: item.token)]
    tokens = frozenset(result.token for result in parsed)
    counts = Counter(result.outcome for result in parsed)
    unknowns = Counter(result.unknown_reason for result in parsed if result.unknown_reason)
    if (
        len(tokens) != expected_count
        or record.get("result_digest") != _result_digest(serialized)
        or record.get("outcome_counts")
        != {name: counts.get(name, 0) for name in OUTCOMES}
        or record.get("unknown_reasons") != dict(sorted(unknowns.items()))
    ):
        raise AuditFailure("history_integrity_failure")
    if schema_version == 2:
        try:
            _validate_observation_metadata(record, parsed, expected_count=expected_count)
        except AuditFailure as exc:
            raise AuditFailure("history_integrity_failure") from exc
    members = (
        {
            result.token: (
                result.baseline_hmac,
                result.locator_hmac,
                bool(result.baseline_active),
                bool(result.current_source_present),
            )
            for result in parsed
        }
        if schema_version == 2
        else None
    )
    return tokens, completed, members, schema_version, project_ref, key_id


def history_cohort_state(
    records: list[dict],
    *,
    expected_count: int | None = None,
    expected_digest: str | None = None,
) -> HistoryState:
    """Validate project-bound history and evolve locators only on source presence."""
    if expected_count is None:
        expected_count = EXPECTED_QUEUE_COUNT
    if expected_digest is None:
        expected_digest = EXPECTED_QUEUE_SHA256
    expected: frozenset[str] | None = None
    member_state: dict[str, tuple[str, str, bool]] | None = None
    project_ref: str | None = None
    key_id: str | None = None
    previous_completed: datetime | None = None
    seen_v2 = False
    for record in records:
        if not isinstance(record, dict):
            raise AuditFailure("history_integrity_failure")
        tokens, completed, members, schema_version, record_project, record_key = (
            _history_record_tokens(
                record,
                expected_count=expected_count,
                expected_digest=expected_digest,
            )
        )
        if schema_version == 1 and seen_v2:
            raise AuditFailure("history_integrity_failure")
        if schema_version == 2:
            seen_v2 = True
            if project_ref is None:
                project_ref, key_id = record_project, record_key
            elif record_project != project_ref or record_key != key_id:
                raise AuditFailure("history_integrity_failure")
        if previous_completed is not None and completed < previous_completed:
            raise AuditFailure("history_integrity_failure")
        previous_completed = completed
        if tokens is None:
            continue
        if expected is None:
            expected = tokens
        elif tokens != expected:
            raise AuditFailure("history_integrity_failure")
        if members is None:
            continue
        if member_state is None:
            member_state = {
                token: (ownership, locator, active)
                for token, (ownership, locator, active, _present) in members.items()
            }
            continue
        for token, (ownership, locator, active, present) in members.items():
            prior_ownership, prior_locator, prior_active = member_state[token]
            if ownership != prior_ownership:
                raise AuditFailure("history_integrity_failure")
            if present:
                if active is not True:
                    raise AuditFailure("history_integrity_failure")
                member_state[token] = (ownership, locator, active)
            elif locator != prior_locator or active is not prior_active:
                raise AuditFailure("history_integrity_failure")
    return HistoryState(expected, member_state, project_ref, key_id, seen_v2)


def history_cohort_tokens(
    records: list[dict],
    *,
    expected_count: int | None = None,
    expected_digest: str | None = None,
) -> frozenset[str] | None:
    return history_cohort_state(
        records,
        expected_count=expected_count,
        expected_digest=expected_digest,
    ).tokens


def select_locked_cohort(
    history: list[dict], secret: bytes, sync_module=None
) -> tuple[list[dict], InventorySnapshot]:
    """Select the first run's fixed cohort from the current full inventory."""
    snapshot = _reconstruct_inventory(sync_module)
    state = history_cohort_state(history)
    expected_tokens = state.tokens
    if expected_tokens is None:
        return _require_initial_queue(snapshot), snapshot

    matched: dict[str, dict] = {}
    seen_ids: set[str] = set()
    try:
        for row in snapshot.database_rows:
            course_id = _required_text(row.get("id"))
            if not course_id or course_id in seen_ids:
                raise AuditFailure("cohort_snapshot_mismatch")
            seen_ids.add(course_id)
            token = course_token(course_id, secret)
            if token in expected_tokens:
                if token in matched:
                    raise AuditFailure("cohort_snapshot_mismatch")
                matched[token] = row

        if set(matched) != set(expected_tokens):
            raise AuditFailure("cohort_snapshot_mismatch")
        cohort_ids = [_required_text(row.get("id")) for row in matched.values()]
        if queue_digest(cohort_ids) != EXPECTED_QUEUE_SHA256:
            raise AuditFailure("cohort_snapshot_mismatch")
        for token, row in matched.items():
            course_id = _required_text(row.get("id"))
            current_source_present = course_id in snapshot.source_ids
            if course_token(course_id, secret) != token:
                raise AuditFailure("cohort_snapshot_mismatch")
            _validate_cohort_row(
                row,
                snapshot,
                current_source_present=current_source_present,
            )
            if state.members is not None:
                expected_ownership, expected_locator, expected_active = state.members[token]
                if ownership_commitment(row, secret) != expected_ownership or (
                    not current_source_present
                    and (
                        locator_commitment(row, secret) != expected_locator
                        or row.get("active") is not expected_active
                    )
                ):
                    raise AuditFailure("cohort_snapshot_mismatch")
    except AuditFailure:
        raise
    except Exception:
        pass
    else:
        return [matched[token] for token in sorted(expected_tokens)], snapshot
    raise AuditFailure("cohort_snapshot_mismatch")


def reconstruct_locked_cohort(
    history: list[dict], secret: bytes, sync_module=None
) -> tuple[list[dict], dict, dict]:
    """Compatibility wrapper returning the selected rows and inventory report."""
    cohort, snapshot = select_locked_cohort(history, secret, sync_module)
    return cohort, snapshot.report, snapshot.control


def _history_head(records: list[dict]) -> tuple[int, str]:
    return (
        len(records),
        _required_text(records[-1].get("chain_hmac")) if records else "0" * 64,
    )


def append_history(
    path: Path,
    record: dict,
    secret: bytes,
    *,
    expected_history: list[dict] | None = None,
    expected_count: int | None = None,
    expected_digest: str | None = None,
) -> list[dict]:
    path = resolve_history_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    records = read_history(path, secret)
    if expected_history is not None and _history_head(records) != _history_head(
        expected_history
    ):
        raise AuditFailure("history_concurrent_modification")
    previous = records[-1]["chain_hmac"] if records else "0" * 64
    stored = dict(record)
    stored["sequence"] = len(records) + 1
    stored["chain_hmac"] = hmac.new(
        _history_key(secret),
        previous.encode("ascii") + b"\n" + _canonical_json(stored),
        hashlib.sha256,
    ).hexdigest()
    output = records + [stored]
    history_cohort_state(
        output,
        expected_count=expected_count,
        expected_digest=expected_digest,
    )
    payload = b"".join(_canonical_json(item) + b"\n" for item in output)
    temp_name: str | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", dir=path.parent, prefix=f".{path.name}.", delete=False
        ) as handle:
            temp_name = handle.name
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_name, path)
        temp_name = None
    finally:
        if temp_name:
            try:
                os.unlink(temp_name)
            except FileNotFoundError:
                pass
    verified = read_history(path, secret)
    if _history_head(verified) != _history_head(output):
        raise AuditFailure("history_integrity_failure")
    history_cohort_state(
        verified,
        expected_count=expected_count,
        expected_digest=expected_digest,
    )
    return verified


def future_review_candidates(
    records: list[dict],
    *,
    expected_count: int | None = None,
    expected_digest: str | None = None,
) -> list[str]:
    """Return candidates after three clean, sufficiently spaced absence dates."""
    if expected_count is None:
        expected_count = EXPECTED_QUEUE_COUNT
    if expected_digest is None:
        expected_digest = EXPECTED_QUEUE_SHA256
    if expected_count <= 0 or not expected_digest:
        raise AuditFailure("history_integrity_failure")
    state = history_cohort_state(
        records,
        expected_count=expected_count,
        expected_digest=expected_digest,
    )
    known_tokens = state.tokens
    baseline_index = next(
        (
            index
            for index, record in enumerate(records)
            if record.get("schema_version") == 2
            and record.get("record_type") == "observation"
            and record.get("valid") is True
        ),
        None,
    )
    if known_tokens is None or baseline_index is None:
        return []
    by_token_day: dict[str, dict[str, list[tuple[str, datetime]]]] = defaultdict(
        lambda: defaultdict(list)
    )
    for record in records[baseline_index:]:
        completed = _record_time(record.get("completed_at"))
        day = completed.date().isoformat()
        results = record.get("results")
        record_is_complete = (
            record.get("schema_version") == 2
            and record.get("record_type") == "observation"
            and record.get("valid") is True
            and record.get("queue_count") == expected_count
            and record.get("queue_sha256") == expected_digest
            and record.get("planned_count") == expected_count
            and record.get("completed_count") == expected_count
            and isinstance(results, list)
            and len(results) == expected_count
            and record.get("outside_cohort_blocks_completion") is False
        )
        if not record_is_complete:
            for token in known_tokens:
                by_token_day[token][day].append(("invalid", completed))
            continue
        for token in known_tokens:
            matches = [
                result
                for result in results
                if isinstance(result, dict) and result.get("token") == token
            ]
            if len(matches) != 1:
                by_token_day[token][day].append(("invalid", completed))
            else:
                outcome = matches[0].get("outcome")
                if matches[0].get("current_source_present") is True:
                    by_token_day[token][day].append(("present", completed))
                elif outcome in ("exact_instance", "moved_instance"):
                    by_token_day[token][day].append(("present", completed))
                elif outcome == "unknown":
                    by_token_day[token][day].append(("unknown", completed))
                elif outcome == "confirmed_absence":
                    by_token_day[token][day].append(("absence", completed))
                else:
                    by_token_day[token][day].append(("invalid", completed))

    precedence = {"absence": 1, "unknown": 2, "present": 3, "invalid": 4}
    candidates = []
    for token, days in by_token_day.items():
        observations: list[tuple[str, datetime]] = []
        for _day, entries in sorted(days.items()):
            state = max((entry[0] for entry in entries), key=lambda value: precedence[value])
            completed = max(entry[1] for entry in entries)
            observations.append((state, completed))
        recent = observations[-3:]
        if (
            len(recent) == 3
            and [state for state, _completed in recent] == ["absence"] * 3
            and all(
                (recent[index][1] - recent[index - 1][1]).total_seconds()
                >= MIN_ELIGIBLE_INTERVAL_SECONDS
                for index in (1, 2)
            )
        ):
            candidates.append(token)
    return sorted(candidates)


def run_audit(*, history_path: Path = DEFAULT_HISTORY_PATH) -> dict:
    api_key = os.environ.get("HARVARD_API_KEY", "")
    supabase_url = os.environ.get("SUPABASE_URL", "")
    supabase_key = os.environ.get("SUPABASE_KEY", "")
    secret_value = os.environ.get("RETAINED_ATS_AUDIT_HMAC_KEY", "")
    if not api_key or not supabase_url or not supabase_key or len(secret_value.encode("utf-8")) < 32:
        raise AuditFailure("invalid_configuration")
    _validate_supabase_url(supabase_url)
    secret = secret_value.encode("utf-8")
    resolved_history = resolve_history_path(history_path)
    with (
        exclusive_history_lock(resolved_history) as locked_history,
        read_only_network_guard(),
    ):
        history = read_history(locked_history, secret)
        history_state = history_cohort_state(history)
        current_context = _audit_context(supabase_url=supabase_url, secret=secret)
        if history_state.has_schema_v2 and (
            history_state.project_ref != current_context["project_ref"]
            or history_state.key_id != current_context["key_id"]
        ):
            raise AuditFailure("history_integrity_failure")
        started = datetime.now(timezone.utc)
        base_commit = _provenance()
        try:
            queue, snapshot = select_locked_cohort(history, secret)
            initial_snapshot_digest = inventory_snapshot_digest(snapshot)
            session = requests.Session()
            pacer = RequestPacer()

            control_id = _required_text(snapshot.control.get("id"))
            control_read = fetch_exact_instances(
                control_id, api_key=api_key, session=session, pacer=pacer
            )
            if not control_read.complete or not any(
                _required_text(item.get("courseID")) == control_id
                for item in control_read.instances
            ):
                raise AuditFailure("positive_control_failed")

            results = []
            for row in queue:
                course_id = _required_text(row.get("id"))
                token = course_token(course_id, secret)
                baseline_hmac = ownership_commitment(row, secret)
                locator_hmac = locator_commitment(row, secret)
                baseline_active = row.get("active")
                if not isinstance(baseline_active, bool):
                    raise AuditFailure("cohort_snapshot_mismatch")
                read = fetch_exact_instances(
                    course_id,
                    api_key=api_key,
                    session=session,
                    pacer=pacer,
                )
                results.append(
                    classify_exact_read(
                        row,
                        read,
                        secret=secret,
                        baseline_hmac=baseline_hmac,
                        locator_hmac=locator_hmac,
                        baseline_active=baseline_active,
                        current_source_present=course_id in snapshot.source_ids,
                    )
                )

            final_snapshot = _reconstruct_inventory()
            if inventory_snapshot_digest(final_snapshot) != initial_snapshot_digest:
                raise AuditFailure("inventory_changed_during_audit")
            metadata = build_observation_metadata(
                queue,
                snapshot,
                secret=secret,
                supabase_url=supabase_url,
            )
            completed = datetime.now(timezone.utc)
            record = build_run_record(
                started=started,
                completed=completed,
                base_commit=base_commit,
                results=results,
                observation_metadata=metadata,
            )
        except AuditFailure as exc:
            attempt = build_failed_attempt_record(
                started=started,
                completed=datetime.now(timezone.utc),
                base_commit=base_commit,
                failure_reason=exc.code,
                supabase_url=supabase_url,
                secret=secret,
            )
            failed_history = append_history(
                locked_history,
                attempt,
                secret,
                expected_history=history,
            )
            raise AuditFailure(
                exc.code,
                history_sequence=len(failed_history),
                history_chain_head=failed_history[-1]["chain_hmac"],
            ) from None
        except Exception:
            attempt = build_failed_attempt_record(
                started=started,
                completed=datetime.now(timezone.utc),
                base_commit=base_commit,
                failure_reason="run_incomplete",
                supabase_url=supabase_url,
                secret=secret,
            )
            failed_history = append_history(
                locked_history,
                attempt,
                secret,
                expected_history=history,
            )
            raise AuditFailure(
                "run_incomplete",
                history_sequence=len(failed_history),
                history_chain_head=failed_history[-1]["chain_hmac"],
            ) from None

        updated_history = append_history(
            locked_history,
            record,
            secret,
            expected_history=history,
        )
        record["future_retirement_review_candidate_count"] = len(
            future_review_candidates(updated_history)
        )
        record["history_chain_head"] = updated_history[-1]["chain_hmac"]
        return record


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run a local read-only exact-ID audit of the frozen retained ATS queue."
    )
    parser.add_argument(
        "--history",
        default=str(DEFAULT_HISTORY_PATH),
        help="Ignored artifacts path or an absolute path outside the repository.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        record = run_audit(history_path=resolve_history_path(args.history))
    except AuditFailure as exc:
        receipt = ""
        if exc.history_sequence is not None and exc.history_chain_head:
            receipt = (
                f", history_sequence={exc.history_sequence}"
                f", history_chain_head={exc.history_chain_head}"
            )
        print(f"Retained ATS audit failed safely: {exc.code}{receipt}", file=sys.stderr)
        return 1
    counts = record["outcome_counts"]
    print(
        "Retained ATS audit recorded locally: "
        + ", ".join(f"{name}={counts[name]}" for name in OUTCOMES)
        + f", still_actionable_frozen={record['still_actionable_frozen_count']}"
        + f", reappeared_frozen={record['reappeared_frozen_count']}"
        + f", new_outside_cohort={record['new_actionable_outside_cohort_count']}"
        + f", future_review_candidates={record['future_retirement_review_candidate_count']}"
        + f", history_chain_head={record['history_chain_head']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
