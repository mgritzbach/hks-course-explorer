"""Read-only evidence audit for retained non-HKS Harvard ATS rows.

This manual operator tool reconstructs the exact retained queue from the same
complete source and ownership rules used by the daily sync, then performs a
paced exact-``courseID`` lookup for every row. It never changes Supabase,
publishes data, or authorizes retirement. Results are stored locally as stable
HMAC tokens in an append-only, tamper-evident history.

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
}
DEFAULT_HISTORY_PATH = ROOT / "artifacts" / "retained-ats-audit-history.jsonl"


class AuditFailure(RuntimeError):
    """A bounded audit failure whose code is safe to show to an operator."""

    def __init__(self, code: str):
        super().__init__(code)
        self.code = code


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

    def as_dict(self) -> dict:
        value = {"token": self.token, "outcome": self.outcome}
        if self.moved_fields:
            value["moved_fields"] = list(self.moved_fields)
        if self.unknown_reason:
            value["unknown_reason"] = self.unknown_reason
        return value


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


def classify_exact_read(stored: dict, read: ExactRead, *, secret: bytes) -> AuditResult:
    course_id = _required_text(stored.get("id"))
    token = course_token(course_id, secret)
    if not read.complete:
        reason = read.reason if read.reason in UNKNOWN_REASONS else "request_failed"
        return AuditResult(token, "unknown", unknown_reason=reason)

    exact = [
        item for item in read.instances if _required_text(item.get("courseID")) == course_id
    ]
    if not exact:
        return AuditResult(token, "confirmed_absence")
    if len(exact) != 1:
        return AuditResult(token, "unknown", unknown_reason="duplicate_exact")

    stored_locator = {
        "school": _required_text(stored.get("school")).upper(),
        "term": _required_text(stored.get("term")),
        "course_code": _required_text(stored.get("course_code")),
        "session_code": _required_text(stored.get("session_code")),
    }
    provider_locator = _provider_locator(exact[0])
    if any(not stored_locator[field] or not provider_locator[field] for field in LOCATOR_FIELDS):
        return AuditResult(token, "unknown", unknown_reason="missing_locator")
    moved = tuple(
        sorted(
            field
            for field in LOCATOR_FIELDS
            if stored_locator[field] != provider_locator[field]
        )
    )
    if moved:
        return AuditResult(token, "moved_instance", moved_fields=moved)
    return AuditResult(token, "exact_instance")


def _load_sync_module():
    try:
        import sync_live_courses as sync  # type: ignore
    except ModuleNotFoundError:
        from scripts import sync_live_courses as sync  # type: ignore
    return sync


def reconstruct_locked_queue(sync_module=None) -> tuple[list[dict], dict, dict]:
    """Rebuild and verify the one authoritative full queue in memory."""
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
            or len(queue) != EXPECTED_QUEUE_COUNT
            or digest != EXPECTED_QUEUE_SHA256
            or report.get("actionable_retained_non_hks_ats_count") != len(queue)
            or report.get("actionable_queue_sha256") != digest
        ):
            raise AuditFailure("queue_snapshot_mismatch")
        control = min(source_rows, key=lambda row: _required_text(row.get("id")))
        return sorted(queue, key=lambda row: _required_text(row.get("id"))), report, control
    except AuditFailure:
        raise
    except Exception:
        # Exit the exception handler before raising the bounded error below.
        # That prevents the source/database exception (which may contain a
        # prepared URL, raw ID, or credential) from surviving as context.
        pass
    raise AuditFailure("queue_snapshot_mismatch")


def _validate_supabase_url(value: str) -> None:
    parsed = urlparse(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.port is not None
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


def _validate_result(result: AuditResult) -> None:
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


def build_run_record(
    *,
    started: datetime,
    completed: datetime,
    base_commit: str,
    results: list[AuditResult],
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
        _validate_result(result)
    serialized = [result.as_dict() for result in sorted(results, key=lambda item: item.token)]
    counts = Counter(result.outcome for result in results)
    unknowns = Counter(result.unknown_reason for result in results if result.unknown_reason)
    if (
        len(results) != EXPECTED_QUEUE_COUNT
        or len({result.token for result in results}) != EXPECTED_QUEUE_COUNT
        or set(counts) - set(OUTCOMES)
        or sum(counts.values()) != EXPECTED_QUEUE_COUNT
        or set(unknowns) - UNKNOWN_REASONS
    ):
        raise AuditFailure("run_incomplete")
    return {
        "schema_version": 1,
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
    }


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


def append_history(path: Path, record: dict, secret: bytes) -> list[dict]:
    path = resolve_history_path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    records = read_history(path, secret)
    previous = records[-1]["chain_hmac"] if records else "0" * 64
    stored = dict(record)
    stored["sequence"] = len(records) + 1
    stored["chain_hmac"] = hmac.new(
        _history_key(secret),
        previous.encode("ascii") + b"\n" + _canonical_json(stored),
        hashlib.sha256,
    ).hexdigest()
    output = records + [stored]
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
    return output


def future_review_candidates(
    records: list[dict],
    *,
    expected_count: int = EXPECTED_QUEUE_COUNT,
    expected_digest: str = EXPECTED_QUEUE_SHA256,
) -> list[str]:
    """Return token-only candidates after three newer clean absence dates."""
    by_token_day: dict[str, dict[str, set[str]]] = defaultdict(lambda: defaultdict(set))
    known_tokens = {
        _required_text(result.get("token"))
        for record in records
        if isinstance(record.get("results"), list)
        for result in record["results"]
        if isinstance(result, dict) and _required_text(result.get("token"))
    }
    for record in records:
        day = _required_text(record.get("completed_at"))[:10]
        if not day:
            continue
        results = record.get("results")
        record_is_complete = (
            record.get("valid") is True
            and record.get("queue_count") == expected_count
            and record.get("queue_sha256") == expected_digest
            and record.get("planned_count") == expected_count
            and record.get("completed_count") == expected_count
            and isinstance(results, list)
            and len(results) == expected_count
        )
        if not record_is_complete:
            for token in known_tokens:
                by_token_day[token][day].add("invalid")
            continue
        for token in known_tokens:
            matches = [
                result
                for result in results
                if isinstance(result, dict) and result.get("token") == token
            ]
            if len(matches) != 1:
                by_token_day[token][day].add("invalid")
            else:
                outcome = matches[0].get("outcome")
                if outcome in ("exact_instance", "moved_instance"):
                    by_token_day[token][day].add("present")
                elif outcome == "unknown":
                    by_token_day[token][day].add("unknown")
                elif outcome == "confirmed_absence":
                    by_token_day[token][day].add("absence")
                else:
                    by_token_day[token][day].add("invalid")

    precedence = {"absence": 1, "unknown": 2, "present": 3, "invalid": 4}
    candidates = []
    for token, days in by_token_day.items():
        observations = [
            max(states, key=lambda state: precedence[state])
            for _day, states in sorted(days.items())
        ]
        if len(observations) >= 3 and observations[-3:] == ["absence"] * 3:
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
    started = datetime.now(timezone.utc)
    base_commit = _provenance()
    queue, _report, control = reconstruct_locked_queue()
    secret = secret_value.encode("utf-8")
    session = requests.Session()
    pacer = RequestPacer()

    control_id = _required_text(control.get("id"))
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
        read = fetch_exact_instances(
            _required_text(row.get("id")),
            api_key=api_key,
            session=session,
            pacer=pacer,
        )
        results.append(classify_exact_read(row, read, secret=secret))
    completed = datetime.now(timezone.utc)
    record = build_run_record(
        started=started,
        completed=completed,
        base_commit=base_commit,
        results=results,
    )
    history = append_history(history_path, record, secret)
    record["future_retirement_review_candidate_count"] = len(
        future_review_candidates(history)
    )
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
        print(f"Retained ATS audit failed safely: {exc.code}", file=sys.stderr)
        return 1
    counts = record["outcome_counts"]
    print(
        "Retained ATS audit recorded locally: "
        + ", ".join(f"{name}={counts[name]}" for name in OUTCOMES)
        + f", future_review_candidates={record['future_retirement_review_candidate_count']}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
