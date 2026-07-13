"""Offline contracts for the local, read-only retained ATS audit."""

import copy
import hashlib
import importlib.util
import io
import os
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import requests


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "audit_retained_ats.py"


def load_module():
    name = "audit_retained_ats_test_subject"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def response(payload, *, status=200, headers=None, redirect=False):
    result = Mock()
    result.ok = 200 <= status < 300
    result.status_code = status
    result.is_redirect = redirect
    result.headers = headers or {}
    result.json.return_value = payload
    return result


def provider_row(course_id="retained-1", **overrides):
    row = {
        "courseID": course_id,
        "catalogSchool": "FAS",
        "termDescription": "2026 Fall",
        "courseNumber": "ECON 101",
        "sessionCode": "1",
    }
    row.update(overrides)
    return row


def stored_row(course_id="retained-1", **overrides):
    row = {
        "id": course_id,
        "school": "FAS",
        "term": "2026 Fall",
        "course_code": "ECON-101",
        "session_code": "1",
        "source": "ats",
        "is_hks": False,
        "sync_run_id": None,
        "active": True,
        "schedule": {"meeting_days": "MON", "time_start": "09:00"},
    }
    row.update(overrides)
    return row


def observation_metadata(audit, results, *, outside_tokens=()):
    tokens = {result.token for result in results}
    reappeared = {
        result.token for result in results if result.current_source_present is True
    }
    still = tokens - reappeared
    outside = set(outside_tokens)
    observed = still | outside
    return {
        "cohort_version": 1,
        "token_domain": "retained-ats/id/v1",
        "project_ref": audit.EXPECTED_SUPABASE_PROJECT_REF,
        "key_id": "a" * 16,
        "cohort_token_set_sha256": audit.queue_digest(tokens),
        "still_actionable_frozen_count": len(still),
        "still_actionable_frozen_token_sha256": audit.queue_digest(still),
        "reappeared_frozen_count": len(reappeared),
        "reappeared_frozen_token_sha256": audit.queue_digest(reappeared),
        "observed_actionable_count": len(observed),
        "observed_actionable_token_sha256": audit.queue_digest(observed),
        "new_actionable_outside_cohort_count": len(outside),
        "new_actionable_outside_cohort_token_sha256": audit.queue_digest(outside),
        "new_actionable_outside_cohort_tokens": sorted(outside),
        "observed_actionable_raw_id_sha256": "b" * 64,
        "outside_cohort_blocks_completion": bool(outside),
    }


class PacerStub:
    def __init__(self):
        self.calls = 0

    def wait(self):
        self.calls += 1


class QueueAndConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.audit = load_module()

    def test_frozen_production_queue_constants(self):
        self.assertEqual(self.audit.EXPECTED_QUEUE_COUNT, 1526)
        self.assertEqual(
            self.audit.EXPECTED_QUEUE_SHA256,
            "fbd0a26cc18c195150f6f8d6e402db69edf28f0227c3ad5911814518c04312a5",
        )

    def test_queue_digest_is_order_independent_and_unambiguous(self):
        self.assertEqual(
            self.audit.queue_digest(["two", "one"]),
            self.audit.queue_digest(["one", "two"]),
        )
        self.assertNotEqual(
            self.audit.queue_digest(["a\nb", "c"]),
            self.audit.queue_digest(["a", "b\nc"]),
        )

    def test_reconstruct_queue_requires_exact_count_digest_and_classifier_agreement(self):
        current = stored_row("current", source="ats")
        current["sync_run_id"] = None
        queue = [stored_row(f"retained-{index}") for index in range(3)]
        digest = self.audit.queue_digest(row["id"] for row in queue)

        class FakeSync:
            MIN_UNIQUE_COURSES = 1
            GENERAL_SYNC_SCHOOLS = ("FAS",)
            supabase_upsert = Mock(side_effect=AssertionError("mutation called"))

            @staticmethod
            def collect_general_source_rows():
                return {"current": current}, [], [("FAS", "a")]

            @staticmethod
            def supabase_active_hks_source_course_ids():
                return {"hks-owned"}

            @staticmethod
            def supabase_inventory_live_courses():
                return [current, *queue]

            @staticmethod
            def supabase_inventory_catalogue_runs():
                return [{"id": "run"}]

            @staticmethod
            def compare_live_course_inventory(source, database, runs):
                return {
                    "actionable_retained_non_hks_ats_count": 3,
                    "actionable_queue_sha256": digest,
                }

        with (
            patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 3),
            patch.object(self.audit, "EXPECTED_QUEUE_SHA256", digest),
        ):
            actual, _report, control = self.audit.reconstruct_locked_queue(FakeSync)
            self.assertEqual([row["id"] for row in actual], [f"retained-{i}" for i in range(3)])
            self.assertEqual(control["id"], "current")
            FakeSync.supabase_upsert.assert_not_called()

            FakeSync.compare_live_course_inventory = staticmethod(
                lambda *_: {
                    "actionable_retained_non_hks_ats_count": 3,
                    "actionable_queue_sha256": "0" * 64,
                }
            )
            with self.assertRaisesRegex(self.audit.AuditFailure, "queue_snapshot_mismatch"):
                self.audit.reconstruct_locked_queue(FakeSync)

    def test_queue_rejects_1525_1527_duplicates_and_ownership_failures(self):
        current = stored_row("current", source="ats")
        baseline = [stored_row(f"retained-{index}") for index in range(3)]
        digest = self.audit.queue_digest(row["id"] for row in baseline)

        class FakeSync:
            MIN_UNIQUE_COURSES = 1
            database = [current, *baseline]
            collect_general_source_rows = staticmethod(
                lambda: ({"current": current}, [], [("FAS", "a")])
            )
            supabase_active_hks_source_course_ids = staticmethod(lambda: {"hks"})
            supabase_inventory_live_courses = classmethod(lambda cls: cls.database)
            supabase_inventory_catalogue_runs = staticmethod(lambda: [{"id": "run"}])
            compare_live_course_inventory = staticmethod(
                lambda source, database, runs: {
                    "actionable_retained_non_hks_ats_count": len(database) - 1,
                    "actionable_queue_sha256": self.audit.queue_digest(
                        row["id"] for row in database[1:]
                    ),
                }
            )

        cases = {
            "1525-equivalent": [current, *baseline[:2]],
            "1527-equivalent": [current, *baseline, stored_row("retained-extra")],
            "duplicate": [current, baseline[0], baseline[0], baseline[1]],
            "hks-school": [
                current,
                baseline[0],
                stored_row("retained-1", school="HKS"),
                baseline[2],
            ],
            "unknown-school": [
                current,
                baseline[0],
                stored_row("retained-1", school="UNKNOWN"),
                baseline[2],
            ],
            "missing-locator": [
                current,
                baseline[0],
                stored_row("retained-1", term=""),
                baseline[2],
            ],
        }
        with (
            patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 3),
            patch.object(self.audit, "EXPECTED_QUEUE_SHA256", digest),
        ):
            for label, database in cases.items():
                with self.subTest(label=label):
                    FakeSync.database = database
                    with self.assertRaisesRegex(
                        self.audit.AuditFailure, "queue_snapshot_mismatch"
                    ):
                        self.audit.reconstruct_locked_queue(FakeSync)

            FakeSync.database = [current, *baseline]
            FakeSync.compare_live_course_inventory = staticmethod(
                lambda *_args: (_ for _ in ()).throw(RuntimeError("ownership overlap"))
            )
            with self.assertRaisesRegex(self.audit.AuditFailure, "queue_snapshot_mismatch"):
                self.audit.reconstruct_locked_queue(FakeSync)

    def test_source_failure_aborts_queue_before_inventory(self):
        inventory = Mock()

        class FakeSync:
            MIN_UNIQUE_COURSES = 1
            collect_general_source_rows = staticmethod(
                lambda: ({}, [Mock()], [("FAS", "a")])
            )
            supabase_inventory_live_courses = inventory

        with self.assertRaisesRegex(self.audit.AuditFailure, "queue_snapshot_mismatch"):
            self.audit.reconstruct_locked_queue(FakeSync)
        inventory.assert_not_called()

    def test_queue_boundary_removes_sensitive_exception_cause_and_context(self):
        sentinel = "RAW-URL-ID-KEY-SENTINEL"

        class FakeSync:
            collect_general_source_rows = staticmethod(
                lambda: (_ for _ in ()).throw(RuntimeError(sentinel))
            )

        try:
            self.audit.reconstruct_locked_queue(FakeSync)
        except self.audit.AuditFailure as exc:
            self.assertEqual(str(exc), "queue_snapshot_mismatch")
            self.assertIsNone(exc.__cause__)
            self.assertIsNone(exc.__context__)
            self.assertNotIn(sentinel, repr(exc))
        else:
            self.fail("queue reconstruction should have failed")

    def test_shared_source_transport_redacts_provider_exception_text(self):
        sentinel_id = "RAW-ID-SENTINEL"
        sentinel_key = "HARVARD-SECRET-SENTINEL"
        environment = {
            "SUPABASE_URL": "https://cbtroatixvydpwoviezf.supabase.co",
            "SUPABASE_KEY": "synthetic-supabase-key",
            "HARVARD_API_KEY": "synthetic-harvard-key",
        }
        with patch.dict(os.environ, environment, clear=False):
            sync = self.audit._load_sync_module()
        session = Mock()
        session.get.side_effect = requests.RequestException(
            f"https://provider.invalid?courseID={sentinel_id}&key={sentinel_key}"
        )
        with (
            patch.object(sync, "REQUEST_DELAY", 0),
            patch.object(sync, "HTTP_MAX_ATTEMPTS", 1),
            self.assertLogs(sync.log, level="ERROR") as captured,
        ):
            result = sync.fetch_school("FAS", "a", session)
        combined = "\n".join(captured.output) + result.error
        self.assertFalse(result.success)
        self.assertEqual(result.error, "request failed")
        self.assertNotIn(sentinel_id, combined)
        self.assertNotIn(sentinel_key, combined)

    def test_supabase_configuration_requires_bare_https_origin(self):
        self.audit._validate_supabase_url("https://cbtroatixvydpwoviezf.supabase.co")
        for value in (
            "https://attacker.example",
            "https://cbtroatixvydpwoviezf.supabase.co.evil.example",
            "https://hks-course-explorer-staging.supabase.co",
            "http://cbtroatixvydpwoviezf.supabase.co",
            "https://cbtroatixvydpwoviezf.supabase.co/rest/v1",
            "https://user@cbtroatixvydpwoviezf.supabase.co",
            "https://cbtroatixvydpwoviezf.supabase.co?key=secret",
            "https://cbtroatixvydpwoviezf.supabase.co:notaport",
        ):
            with self.subTest(value=value):
                with self.assertRaises(self.audit.AuditFailure):
                    self.audit._validate_supabase_url(value)

    def test_wrong_supabase_target_is_rejected_before_import_or_network(self):
        load_sync = Mock()
        environment = {
            "HARVARD_API_KEY": "synthetic-harvard-key",
            "SUPABASE_URL": "https://cbtroatixvydpwoviezf.supabase.co.evil.example",
            "SUPABASE_KEY": "must-not-leave-process",
            "RETAINED_ATS_AUDIT_HMAC_KEY": "x" * 40,
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(self.audit, "_load_sync_module", load_sync),
            tempfile.TemporaryDirectory() as directory,
        ):
            with self.assertRaisesRegex(self.audit.AuditFailure, "invalid_configuration"):
                self.audit.run_audit(history_path=Path(directory) / "history.jsonl")
        load_sync.assert_not_called()

    def test_runtime_transport_guard_allows_only_reviewed_get_targets(self):
        transport = Mock(return_value=response([]))
        with patch.object(requests.sessions.Session, "request", transport):
            with self.audit.read_only_network_guard():
                session = requests.Session()
                session.get(
                    "https://cbtroatixvydpwoviezf.supabase.co/rest/v1/live_courses"
                )
                session.get(
                    "https://go.apis.huit.harvard.edu/ats/course/v2/search"
                )
                session.get(
                    "https://go.prod.apis.huit.harvard.edu/ats/course/v2/search/scroll/cursor"
                )
                for method, url in (
                    (
                        "POST",
                        "https://cbtroatixvydpwoviezf.supabase.co/rest/v1/live_courses",
                    ),
                    ("GET", "https://attacker.example/rest/v1/live_courses"),
                    (
                        "GET",
                        "https://cbtroatixvydpwoviezf.supabase.co/auth/v1/admin/users",
                    ),
                ):
                    with self.subTest(method=method, url=url):
                        with self.assertRaisesRegex(
                            self.audit.AuditFailure, "read_only_transport_violation"
                        ):
                            session.request(method, url)
        self.assertEqual(transport.call_count, 3)

    def test_help_works_without_any_credentials(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaises(SystemExit) as exit_context:
                with redirect_stdout(io.StringIO()):
                    self.audit.parse_args(["--help"])
        self.assertEqual(exit_context.exception.code, 0)

    def test_failed_positive_control_stops_lookups_and_records_bounded_attempt(self):
        control = stored_row("known-current")
        retained = stored_row("retained-1")
        snapshot = Mock(control=control)
        exact_fetch = Mock(return_value=self.audit.ExactRead(False, reason="http_error"))
        append = Mock(return_value=[{"chain_hmac": "c" * 64}])
        environment = {
            "HARVARD_API_KEY": "synthetic-harvard-key",
            "SUPABASE_URL": "https://cbtroatixvydpwoviezf.supabase.co",
            "SUPABASE_KEY": "synthetic-supabase-key",
            "RETAINED_ATS_AUDIT_HMAC_KEY": "x" * 40,
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(self.audit, "_provenance", return_value="a" * 40),
            patch.object(
                self.audit,
                "select_locked_cohort",
                return_value=([retained], snapshot),
            ),
            patch.object(self.audit, "inventory_snapshot_digest", return_value="b" * 64),
            patch.object(self.audit, "fetch_exact_instances", exact_fetch),
            patch.object(self.audit, "append_history", append),
        ):
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(self.audit.AuditFailure, "positive_control_failed"):
                    self.audit.run_audit(history_path=Path(directory) / "history.jsonl")
        self.assertEqual(exact_fetch.call_count, 1)
        append.assert_called_once()
        self.assertFalse(append.call_args.args[1]["valid"])
        self.assertEqual(
            append.call_args.args[1]["failure_reason"], "positive_control_failed"
        )

    def test_inventory_change_after_lookups_invalidates_the_run(self):
        control = stored_row("known-current")
        retained = stored_row("retained-1")
        snapshot = Mock(control=control, source_ids=frozenset())
        append = Mock(return_value=[{"chain_hmac": "c" * 64}])
        exact_fetch = Mock(
            side_effect=(
                self.audit.ExactRead(True, (provider_row("known-current"),)),
                self.audit.ExactRead(True, (provider_row("retained-1"),)),
            )
        )
        environment = {
            "HARVARD_API_KEY": "synthetic-harvard-key",
            "SUPABASE_URL": "https://cbtroatixvydpwoviezf.supabase.co",
            "SUPABASE_KEY": "synthetic-supabase-key",
            "RETAINED_ATS_AUDIT_HMAC_KEY": "x" * 40,
        }
        with (
            patch.dict(os.environ, environment, clear=True),
            patch.object(self.audit, "_provenance", return_value="a" * 40),
            patch.object(
                self.audit,
                "select_locked_cohort",
                return_value=([retained], snapshot),
            ),
            patch.object(self.audit, "_reconstruct_inventory", return_value=snapshot),
            patch.object(
                self.audit,
                "inventory_snapshot_digest",
                side_effect=("a" * 64, "b" * 64),
            ),
            patch.object(self.audit, "fetch_exact_instances", exact_fetch),
            patch.object(self.audit, "append_history", append),
        ):
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaisesRegex(
                    self.audit.AuditFailure, "inventory_changed_during_audit"
                ):
                    self.audit.run_audit(history_path=Path(directory) / "history.jsonl")
        self.assertEqual(exact_fetch.call_count, 2)
        append.assert_called_once()
        self.assertEqual(
            append.call_args.args[1]["failure_reason"],
            "inventory_changed_during_audit",
        )


class FixedCohortTests(unittest.TestCase):
    def setUp(self):
        self.audit = load_module()
        self.secret = b"synthetic-secret-that-is-long-enough-for-cohort"
        self.baseline = [stored_row("retained-a"), stored_row("retained-b")]
        self.digest = self.audit.queue_digest(row["id"] for row in self.baseline)

    def history_record(self):
        results = [
            self.audit.AuditResult(
                self.audit.course_token(row["id"], self.secret),
                "confirmed_absence",
                baseline_hmac=self.audit.ownership_commitment(row, self.secret),
                locator_hmac=self.audit.locator_commitment(row, self.secret),
                baseline_active=row["active"],
                current_source_present=False,
            )
            for row in self.baseline
        ]
        now = datetime(2026, 7, 13, tzinfo=timezone.utc)
        with (
            patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 2),
            patch.object(self.audit, "EXPECTED_QUEUE_SHA256", self.digest),
        ):
            metadata = observation_metadata(self.audit, results)
            metadata["key_id"] = self.audit._audit_key_identifier(self.secret)
            return self.audit.build_run_record(
                started=now,
                completed=now,
                base_commit="a" * 40,
                results=results,
                observation_metadata=metadata,
            )

    def sync(self, *, source_ids=(), database=None):
        control = stored_row("current-control")
        source = {control["id"]: control}
        for course_id in source_ids:
            row = next(row for row in (database or self.baseline) if row["id"] == course_id)
            source[course_id] = row
        rows = list(database or [control, *self.baseline])
        if control["id"] not in {row["id"] for row in rows}:
            rows.insert(0, control)
        audit = self.audit

        class FakeSync:
            MIN_UNIQUE_COURSES = 1
            GENERAL_SYNC_SCHOOLS = ("FAS", "GSAS", "NONH")
            collect_general_source_rows = staticmethod(
                lambda: (source, [], [("FAS", "a")])
            )
            supabase_active_hks_source_course_ids = staticmethod(lambda: {"hks-owned"})
            supabase_inventory_live_courses = staticmethod(lambda: rows)
            supabase_inventory_catalogue_runs = staticmethod(lambda: [{"id": "run"}])

            @staticmethod
            def compare_live_course_inventory(source_rows, database_rows, _runs):
                current_ids = {row["id"] for row in source_rows}
                queue = [
                    row
                    for row in database_rows
                    if row.get("source") == "ats"
                    and row.get("is_hks") is False
                    and not row.get("sync_run_id")
                    and row["id"] not in current_ids
                ]
                return {
                    "actionable_retained_non_hks_ats_count": len(queue),
                    "actionable_queue_sha256": audit.queue_digest(
                        row["id"] for row in queue
                    ),
                }

        return FakeSync

    def test_reappeared_member_stays_in_frozen_cohort_and_outside_rows_are_separate(self):
        new_retained = stored_row("retained-new")
        database = [stored_row("current-control"), *self.baseline, new_retained]
        sync = self.sync(source_ids=("retained-a",), database=database)
        history = [self.history_record()]
        with (
            patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 2),
            patch.object(self.audit, "EXPECTED_QUEUE_SHA256", self.digest),
        ):
            cohort, snapshot = self.audit.select_locked_cohort(
                history, self.secret, sync
            )
            metadata = self.audit.build_observation_metadata(
                cohort,
                snapshot,
                secret=self.secret,
                supabase_url="https://cbtroatixvydpwoviezf.supabase.co",
            )
        self.assertEqual({row["id"] for row in cohort}, {"retained-a", "retained-b"})
        self.assertEqual(metadata["reappeared_frozen_count"], 1)
        self.assertEqual(metadata["still_actionable_frozen_count"], 1)
        self.assertEqual(metadata["new_actionable_outside_cohort_count"], 1)
        self.assertTrue(metadata["outside_cohort_blocks_completion"])

    def test_missing_duplicate_or_ownership_changed_cohort_member_fails(self):
        changed_rows = {
            "missing": [stored_row("current-control"), self.baseline[0]],
            "duplicate": [
                stored_row("current-control"),
                self.baseline[0],
                self.baseline[0],
                self.baseline[1],
            ],
            "hks-flag": [
                stored_row("current-control"),
                self.baseline[0],
                stored_row("retained-b", is_hks=True),
            ],
            "myharvard": [
                stored_row("current-control"),
                self.baseline[0],
                stored_row("retained-b", source="myharvard"),
            ],
            "run-owned": [
                stored_row("current-control"),
                self.baseline[0],
                stored_row("retained-b", sync_run_id="run"),
            ],
            "hks-school": [
                stored_row("current-control"),
                self.baseline[0],
                stored_row("retained-b", school="HKS"),
            ],
        }
        history = [self.history_record()]
        with (
            patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 2),
            patch.object(self.audit, "EXPECTED_QUEUE_SHA256", self.digest),
        ):
            for label, database in changed_rows.items():
                with self.subTest(label=label):
                    with self.assertRaises(self.audit.AuditFailure):
                        self.audit.select_locked_cohort(
                            history,
                            self.secret,
                            self.sync(database=database),
                        )

    def test_reappeared_member_must_be_active(self):
        history = [self.history_record()]
        changed = stored_row("retained-a", active=False)
        with (
            patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 2),
            patch.object(self.audit, "EXPECTED_QUEUE_SHA256", self.digest),
        ):
            database = [stored_row("current-control"), changed, self.baseline[1]]
            with self.assertRaisesRegex(
                self.audit.AuditFailure, "cohort_snapshot_mismatch"
            ):
                self.audit.select_locked_cohort(
                    history,
                    self.secret,
                    self.sync(source_ids=("retained-a",), database=database),
                )

    def test_verified_reappearance_may_update_locator_without_losing_cohort(self):
        first = self.history_record()
        changed = stored_row("retained-a", term="2027 Spring", session_code="2")
        database = [stored_row("current-control"), changed, self.baseline[1]]
        with (
            patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 2),
            patch.object(self.audit, "EXPECTED_QUEUE_SHA256", self.digest),
        ):
            cohort, snapshot = self.audit.select_locked_cohort(
                [first],
                self.secret,
                self.sync(source_ids=("retained-a",), database=database),
            )
            results = [
                self.audit.AuditResult(
                    self.audit.course_token(row["id"], self.secret),
                    "exact_instance" if row["id"] == "retained-a" else "confirmed_absence",
                    baseline_hmac=self.audit.ownership_commitment(row, self.secret),
                    locator_hmac=self.audit.locator_commitment(row, self.secret),
                    baseline_active=row["active"],
                    current_source_present=row["id"] == "retained-a",
                )
                for row in cohort
            ]
            second = self.audit.build_run_record(
                started=datetime(2026, 7, 14, tzinfo=timezone.utc),
                completed=datetime(2026, 7, 14, tzinfo=timezone.utc),
                base_commit="b" * 40,
                results=results,
                observation_metadata=self.audit.build_observation_metadata(
                    cohort,
                    snapshot,
                    secret=self.secret,
                    supabase_url="https://cbtroatixvydpwoviezf.supabase.co",
                ),
            )
            state = self.audit.history_cohort_state([first, second])
        token = self.audit.course_token("retained-a", self.secret)
        self.assertEqual(
            state.members[token][1], self.audit.locator_commitment(changed, self.secret)
        )


class ExactTransportTests(unittest.TestCase):
    def setUp(self):
        self.audit = load_module()

    def test_missing_result_schema_is_not_an_empty_success(self):
        with self.assertRaisesRegex(self.audit.AuditFailure, "invalid_schema"):
            self.audit._decode_exact_page({"total": 0})

    def test_request_is_exact_get_only_without_school_facet_and_follows_all_pages(self):
        cursor = "https://go.prod.apis.huit.harvard.edu/ats/course/v2/search/scroll/cursor"
        session = Mock()
        session.get.side_effect = [
            response({"results": [provider_row("fuzzy")], "next": cursor}),
            response({"results": [provider_row("retained-1")]}),
        ]
        pacer = PacerStub()

        read = self.audit.fetch_exact_instances(
            "retained-1",
            api_key="synthetic-harvard-key",
            session=session,
            pacer=pacer,
            sleep=lambda _delay: None,
        )

        self.assertTrue(read.complete)
        self.assertEqual(len(read.instances), 2)
        self.assertEqual(pacer.calls, 2)
        first, second = session.get.call_args_list
        self.assertEqual(
            first.kwargs["params"],
            {"courseID": "retained-1", "size": 250, "scroll": "true"},
        )
        self.assertNotIn("catalogSchool", first.kwargs["params"])
        self.assertIsNone(second.kwargs["params"])
        self.assertFalse(first.kwargs["allow_redirects"])
        self.assertFalse(second.kwargs["allow_redirects"])

    def test_redirect_and_off_host_cursor_fail_closed(self):
        redirecting = Mock()
        redirecting.get.return_value = response({}, status=302, redirect=True)
        read = self.audit.fetch_exact_instances(
            "sentinel-id",
            api_key="sentinel-key",
            session=redirecting,
            pacer=PacerStub(),
            sleep=lambda _delay: None,
        )
        self.assertEqual((read.complete, read.reason), (False, "redirect"))

        off_host = Mock()
        off_host.get.return_value = response(
            {"results": [], "next": "https://evil.example/ats/course/v2/search/scroll/x"}
        )
        read = self.audit.fetch_exact_instances(
            "sentinel-id",
            api_key="sentinel-key",
            session=off_host,
            pacer=PacerStub(),
            sleep=lambda _delay: None,
        )
        self.assertEqual((read.complete, read.reason), (False, "invalid_cursor"))

    def test_retry_failure_never_exposes_exception_url_id_or_key(self):
        sentinel_id = "RAW-COURSE-ID-MUST-NOT-LEAK"
        sentinel_key = "RAW-KEY-MUST-NOT-LEAK"
        session = Mock()
        session.get.side_effect = requests.RequestException(
            f"https://provider.invalid?courseID={sentinel_id}&key={sentinel_key}"
        )
        output = io.StringIO()
        with redirect_stdout(output), redirect_stderr(output):
            read = self.audit.fetch_exact_instances(
                sentinel_id,
                api_key=sentinel_key,
                session=session,
                pacer=PacerStub(),
                sleep=lambda _delay: None,
            )
        self.assertEqual(read.reason, "request_failed")
        self.assertNotIn(sentinel_id, output.getvalue())
        self.assertNotIn(sentinel_key, output.getvalue())
        self.assertEqual(session.get.call_count, self.audit.MAX_ATTEMPTS)

    def test_429_retry_after_is_bounded_and_retried(self):
        session = Mock()
        session.get.side_effect = [
            response({}, status=429, headers={"Retry-After": "9999"}),
            response({"results": []}),
        ]
        sleeps = []
        read = self.audit.fetch_exact_instances(
            "retained-1",
            api_key="synthetic-key",
            session=session,
            pacer=PacerStub(),
            sleep=sleeps.append,
        )
        self.assertTrue(read.complete)
        self.assertIn(self.audit.MAX_RETRY_AFTER_SECONDS, sleeps)

    def test_undocumented_success_status_cannot_become_absence(self):
        session = Mock()
        session.get.return_value = response({"results": []}, status=206)
        read = self.audit.fetch_exact_instances(
            "retained-1",
            api_key="synthetic-key",
            session=session,
            pacer=PacerStub(),
            sleep=lambda _delay: None,
        )
        self.assertEqual((read.complete, read.reason), (False, "http_error"))

    def test_malformed_json_timeout_and_http_failures_are_unknown(self):
        malformed = Mock(status_code=200, ok=True, is_redirect=False, headers={})
        malformed.json.side_effect = ValueError("sentinel response body")
        cases = (
            (malformed, "invalid_json", 1),
            (requests.Timeout("sentinel prepared URL"), "request_failed", self.audit.MAX_ATTEMPTS),
            (response({}, status=404), "http_error", 1),
            (response({}, status=503), "http_error", self.audit.MAX_ATTEMPTS),
        )
        for effect, expected_reason, expected_calls in cases:
            with self.subTest(reason=expected_reason, effect=effect):
                session = Mock()
                if isinstance(effect, BaseException):
                    session.get.side_effect = effect
                else:
                    session.get.return_value = effect
                read = self.audit.fetch_exact_instances(
                    "retained-1",
                    api_key="synthetic-key",
                    session=session,
                    pacer=PacerStub(),
                    sleep=lambda _delay: None,
                )
                self.assertEqual((read.complete, read.reason), (False, expected_reason))
                self.assertEqual(session.get.call_count, expected_calls)

    def test_retry_after_http_date_and_actual_page_cap_fail_safely(self):
        session = Mock()
        session.get.side_effect = [
            response(
                {},
                status=429,
                headers={"Retry-After": "Wed, 31 Dec 2099 23:59:59 GMT"},
            ),
            response({"results": []}),
        ]
        sleeps = []
        read = self.audit.fetch_exact_instances(
            "retained-1",
            api_key="synthetic-key",
            session=session,
            pacer=PacerStub(),
            sleep=sleeps.append,
        )
        self.assertTrue(read.complete)
        self.assertIn(self.audit.MAX_RETRY_AFTER_SECONDS, sleeps)

        cursor = "https://go.apis.huit.harvard.edu/ats/course/v2/search/scroll/more"
        capped = Mock()
        capped.get.return_value = response({"results": [], "next": cursor})
        with patch.object(self.audit, "MAX_PAGES", 1):
            read = self.audit.fetch_exact_instances(
                "retained-1",
                api_key="synthetic-key",
                session=capped,
                pacer=PacerStub(),
                sleep=lambda _delay: None,
            )
        self.assertEqual((read.complete, read.reason), (False, "page_limit"))

    def test_cursor_loop_and_page_cap_are_unknown_not_absence(self):
        cursor = "https://go.apis.huit.harvard.edu/ats/course/v2/search/scroll/repeat"
        session = Mock()
        session.get.side_effect = [
            response({"results": [], "next": cursor}),
            response({"results": [], "next": cursor}),
        ]
        read = self.audit.fetch_exact_instances(
            "retained-1",
            api_key="key",
            session=session,
            pacer=PacerStub(),
            sleep=lambda _delay: None,
        )
        self.assertEqual(read.reason, "cursor_loop")

    def test_url_allowlist_rejects_lookalikes_ports_fragments_and_wrong_paths(self):
        rejected = (
            "http://go.apis.huit.harvard.edu/ats/course/v2/search/scroll/x",
            "https://go.apis.huit.harvard.edu.evil.test/ats/course/v2/search/scroll/x",
            "https://go.apis.huit.harvard.edu:443/ats/course/v2/search/scroll/x",
            "https://go.apis.huit.harvard.edu/wrong/scroll/x",
            "https://go.apis.huit.harvard.edu/ats/course/v2/search/scroll/x#fragment",
        )
        for url in rejected:
            with self.subTest(url=url):
                self.assertFalse(self.audit._valid_harvard_url(url))


class OutcomeAndEvidenceTests(unittest.TestCase):
    def setUp(self):
        self.audit = load_module()
        self.secret = b"synthetic-secret-that-is-long-enough-for-tests"

    def test_four_outcomes_and_no_input_mutation(self):
        stored = stored_row()
        original = copy.deepcopy(stored)
        exact = self.audit.classify_exact_read(
            stored,
            self.audit.ExactRead(True, (provider_row(),)),
            secret=self.secret,
        )
        moved = self.audit.classify_exact_read(
            stored,
            self.audit.ExactRead(
                True,
                (provider_row(termDescription="2027 Spring", sessionCode="2"),),
            ),
            secret=self.secret,
        )
        absent = self.audit.classify_exact_read(
            stored,
            self.audit.ExactRead(True, (provider_row("similar-but-not-exact"),)),
            secret=self.secret,
        )
        unknown = self.audit.classify_exact_read(
            stored,
            self.audit.ExactRead(False, reason="http_error"),
            secret=self.secret,
        )
        self.assertEqual(exact.outcome, "exact_instance")
        self.assertEqual(moved.outcome, "moved_instance")
        self.assertEqual(moved.moved_fields, ("session_code", "term"))
        self.assertEqual(absent.outcome, "confirmed_absence")
        self.assertEqual((unknown.outcome, unknown.unknown_reason), ("unknown", "http_error"))
        self.assertEqual(stored, original)

    def test_trimmed_case_sensitive_exact_id_and_duplicates(self):
        stored = stored_row("Case-ID")
        case_variant = self.audit.classify_exact_read(
            stored,
            self.audit.ExactRead(True, (provider_row("case-id"),)),
            secret=self.secret,
        )
        duplicate = self.audit.classify_exact_read(
            stored,
            self.audit.ExactRead(
                True, (provider_row("Case-ID"), provider_row(" Case-ID "))
            ),
            secret=self.secret,
        )
        self.assertEqual(case_variant.outcome, "confirmed_absence")
        self.assertEqual(duplicate.unknown_reason, "duplicate_exact")

    def test_missing_stored_or_provider_locator_is_unknown(self):
        missing_stored = self.audit.classify_exact_read(
            stored_row(session_code=""),
            self.audit.ExactRead(True, (provider_row(),)),
            secret=self.secret,
        )
        missing_provider = self.audit.classify_exact_read(
            stored_row(),
            self.audit.ExactRead(True, (provider_row(sessionCode=""),)),
            secret=self.secret,
        )
        self.assertEqual(missing_stored.unknown_reason, "missing_locator")
        self.assertEqual(missing_provider.unknown_reason, "missing_locator")

    def test_each_locator_change_is_reported_by_field_name_only(self):
        changes = {
            "school": {"catalogSchool": "GSAS"},
            "term": {"termDescription": "2027 Spring"},
            "course_code": {"courseNumber": "ECON 202"},
            "session_code": {"sessionCode": "2"},
        }
        for expected_field, override in changes.items():
            with self.subTest(field=expected_field):
                result = self.audit.classify_exact_read(
                    stored_row(),
                    self.audit.ExactRead(True, (provider_row(**override),)),
                    secret=self.secret,
                )
                self.assertEqual(result.outcome, "moved_instance")
                self.assertEqual(result.moved_fields, (expected_field,))
                serialized = result.as_dict()
                self.assertNotIn("GSAS", repr(serialized))
                self.assertNotIn("2027 Spring", repr(serialized))
                self.assertNotIn("ECON-202", repr(serialized))

    def test_hmac_token_is_stable_secret_bound_and_not_plain_hash(self):
        token = self.audit.course_token("raw-id", self.secret)
        self.assertEqual(token, self.audit.course_token("raw-id", self.secret))
        self.assertNotEqual(token, self.audit.course_token("other-id", self.secret))
        self.assertNotEqual(token, self.audit.course_token("raw-id", b"different-secret"))
        self.assertNotEqual(token, hashlib.sha256(b"raw-id").hexdigest())
        self.assertNotIn("raw-id", token)

    def test_complete_source_presence_dominates_disagreeing_exact_lookup(self):
        stored = stored_row("present-in-source")
        result = self.audit.classify_exact_read(
            stored,
            self.audit.ExactRead(True, ()),
            secret=self.secret,
            baseline_hmac=self.audit.ownership_commitment(stored, self.secret),
            locator_hmac=self.audit.locator_commitment(stored, self.secret),
            baseline_active=True,
            current_source_present=True,
        )
        self.assertEqual(result.outcome, "unknown")
        self.assertEqual(result.unknown_reason, "source_disagreement")

    def test_run_record_is_exhaustive_and_digest_deterministic(self):
        results = [
            self.audit.AuditResult(
                "c" * 64,
                "unknown",
                unknown_reason="http_error",
                baseline_hmac="d" * 64,
                locator_hmac="1" * 64,
                baseline_active=True,
                current_source_present=False,
            ),
            self.audit.AuditResult(
                "a" * 64,
                "confirmed_absence",
                baseline_hmac="e" * 64,
                locator_hmac="2" * 64,
                baseline_active=True,
                current_source_present=False,
            ),
            self.audit.AuditResult(
                "b" * 64,
                "exact_instance",
                baseline_hmac="f" * 64,
                locator_hmac="3" * 64,
                baseline_active=True,
                current_source_present=True,
            ),
        ]
        now = datetime(2026, 7, 13, tzinfo=timezone.utc)
        with patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 3):
            first = self.audit.build_run_record(
                started=now,
                completed=now,
                base_commit="a" * 40,
                results=results,
                observation_metadata=observation_metadata(self.audit, results),
            )
            second = self.audit.build_run_record(
                started=now,
                completed=now,
                base_commit="a" * 40,
                results=list(reversed(results)),
                observation_metadata=observation_metadata(self.audit, results),
            )
        self.assertEqual(first["result_digest"], second["result_digest"])
        self.assertEqual(sum(first["outcome_counts"].values()), 3)
        self.assertEqual(first["unknown_reasons"], {"http_error": 1})

    def test_contradictory_result_metadata_cannot_enter_authenticated_evidence(self):
        token = "a" * 64
        invalid = (
            self.audit.AuditResult(token, "exact_instance", unknown_reason="http_error"),
            self.audit.AuditResult(token, "moved_instance"),
            self.audit.AuditResult(
                token, "moved_instance", moved_fields=("not_a_locator",)
            ),
            self.audit.AuditResult(
                token, "confirmed_absence", moved_fields=("term",)
            ),
            self.audit.AuditResult(token, "unknown"),
        )
        now = datetime(2026, 7, 13, tzinfo=timezone.utc)
        for result in invalid:
            with self.subTest(result=result):
                with patch.object(self.audit, "EXPECTED_QUEUE_COUNT", 1):
                    with self.assertRaisesRegex(self.audit.AuditFailure, "run_incomplete"):
                        self.audit.build_run_record(
                            started=now,
                            completed=now,
                            base_commit="b" * 40,
                            results=[result],
                            observation_metadata=observation_metadata(
                                self.audit, [result]
                            ),
                        )


class HistoryAndBarrierTests(unittest.TestCase):
    def setUp(self):
        self.audit = load_module()
        self.secret = b"synthetic-secret-that-is-long-enough-for-history"

    def record(
        self,
        day,
        outcome="confirmed_absence",
        *,
        valid=True,
        current_source_present=None,
        outside_tokens=(),
    ):
        common = {
            "schema_version": 2,
            "started_at": f"{day}T11:00:00+00:00",
            "completed_at": f"{day}T12:00:00+00:00",
            "base_commit": "b" * 40,
            "project_ref": self.audit.EXPECTED_SUPABASE_PROJECT_REF,
            "key_id": "a" * 16,
            "queue_count": 1,
            "queue_sha256": "fixture-digest",
            "endpoint_host": "go.apis.huit.harvard.edu",
            "planned_count": 1,
        }
        if not valid:
            return {
                **common,
                "record_type": "attempt",
                "valid": False,
                "failure_reason": "run_incomplete",
                "completed_count": 0,
                "outcome_counts": {name: 0 for name in self.audit.OUTCOMES},
                "unknown_reasons": {},
                "result_digest": self.audit._result_digest([]),
                "results": [],
            }
        source_present = (
            outcome in ("exact_instance", "moved_instance")
            if current_source_present is None
            else current_source_present
        )
        kwargs = {
            "baseline_hmac": "c" * 64,
            "locator_hmac": "d" * 64,
            "baseline_active": True,
            "current_source_present": source_present,
        }
        if outcome == "moved_instance":
            kwargs["moved_fields"] = ("term",)
        if outcome == "unknown":
            kwargs["unknown_reason"] = "http_error"
        result = self.audit.AuditResult("a" * 64, outcome, **kwargs)
        metadata = observation_metadata(
            self.audit, [result], outside_tokens=outside_tokens
        )
        return {
            **common,
            "record_type": "observation",
            "valid": True,
            "completed_count": 1,
            "outcome_counts": {
                name: int(name == outcome) for name in self.audit.OUTCOMES
            },
            "unknown_reasons": {"http_error": 1} if outcome == "unknown" else {},
            "result_digest": self.audit._result_digest([result.as_dict()]),
            "results": [result.as_dict()],
            **metadata,
        }

    def candidates(self, records):
        return self.audit.future_review_candidates(
            records, expected_count=1, expected_digest="fixture-digest"
        )

    def append(self, path, record, *, expected_history=None, secret=None):
        return self.audit.append_history(
            path,
            record,
            secret or self.secret,
            expected_history=expected_history,
            expected_count=1,
            expected_digest="fixture-digest",
        )

    def test_history_is_atomic_chained_and_tamper_evident(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            first = self.append(path, self.record("2026-07-10"))
            second = self.append(path, self.record("2026-07-11"))
            self.assertEqual(len(first), 1)
            self.assertEqual(len(second), 2)
            self.assertEqual(len(self.audit.read_history(path, self.secret)), 2)
            original = path.read_text(encoding="utf-8")
            path.write_text(original.replace("confirmed_absence", "unknown", 1), encoding="utf-8")
            with self.assertRaisesRegex(self.audit.AuditFailure, "history_integrity_failure"):
                self.audit.read_history(path, self.secret)

    def test_semantically_invalid_record_is_rejected_before_history_write(self):
        invalid = self.record("2026-07-10")
        invalid["completed_count"] = 0
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            with self.assertRaisesRegex(
                self.audit.AuditFailure, "history_integrity_failure"
            ):
                self.append(path, invalid)
            self.assertFalse(path.exists())

    def test_wrong_hmac_key_stops_before_source_or_database_access(self):
        inventory = Mock()
        environment = {
            "HARVARD_API_KEY": "synthetic-harvard-key",
            "SUPABASE_URL": "https://cbtroatixvydpwoviezf.supabase.co",
            "SUPABASE_KEY": "synthetic-supabase-key",
            "RETAINED_ATS_AUDIT_HMAC_KEY": "different-secret-that-is-at-least-32-bytes",
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            self.append(path, self.record("2026-07-10"))
            with (
                patch.dict(os.environ, environment, clear=True),
                patch.object(self.audit, "_reconstruct_inventory", inventory),
            ):
                with self.assertRaisesRegex(
                    self.audit.AuditFailure, "history_integrity_failure"
                ):
                    self.audit.run_audit(history_path=path)
        inventory.assert_not_called()

    def test_history_key_identity_must_match_current_secret_before_network(self):
        inventory = Mock()
        environment = {
            "HARVARD_API_KEY": "synthetic-harvard-key",
            "SUPABASE_URL": "https://cbtroatixvydpwoviezf.supabase.co",
            "SUPABASE_KEY": "synthetic-supabase-key",
            "RETAINED_ATS_AUDIT_HMAC_KEY": self.secret.decode("utf-8"),
        }
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            wrong_context = self.record("2026-07-10")
            wrong_context["key_id"] = "f" * 16
            self.append(path, wrong_context)
            with (
                patch.dict(os.environ, environment, clear=True),
                patch.object(self.audit, "_reconstruct_inventory", inventory),
            ):
                with self.assertRaisesRegex(
                    self.audit.AuditFailure, "history_integrity_failure"
                ):
                    self.audit.run_audit(history_path=path)
        inventory.assert_not_called()

    def test_exclusive_lock_and_stale_expected_history_prevent_lost_updates(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            with self.audit.exclusive_history_lock(path):
                with self.assertRaisesRegex(self.audit.AuditFailure, "audit_in_progress"):
                    with self.audit.exclusive_history_lock(path):
                        self.fail("a second audit acquired the same history lock")

            first = self.append(path, self.record("2026-07-10"))
            second = self.append(
                path,
                self.record("2026-07-11"),
                expected_history=first,
            )
            with self.assertRaisesRegex(
                self.audit.AuditFailure, "history_concurrent_modification"
            ):
                self.append(
                    path,
                    self.record("2026-07-12"),
                    expected_history=first,
                )
            self.assertEqual(self.audit.read_history(path, self.secret), second)

    def test_failed_atomic_replace_preserves_original_and_removes_temp(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "history.jsonl"
            self.append(path, self.record("2026-07-10"))
            original = path.read_bytes()
            with patch.object(self.audit.os, "replace", side_effect=OSError("injected")):
                with self.assertRaises(OSError):
                    self.append(path, self.record("2026-07-11"))
            self.assertEqual(path.read_bytes(), original)
            self.assertEqual(list(path.parent.glob(f".{path.name}.*")), [])

    def test_repo_output_is_restricted_to_ignored_artifacts(self):
        accepted = self.audit.resolve_history_path("artifacts/test-history.jsonl")
        self.assertTrue(str(accepted).startswith(str(ROOT / "artifacts")))
        with self.assertRaisesRegex(self.audit.AuditFailure, "unsafe_history_path"):
            self.audit.resolve_history_path("docs/history.jsonl")
        with self.assertRaisesRegex(self.audit.AuditFailure, "unsafe_history_path"):
            self.audit.resolve_history_path("../escaped-history.jsonl")

    def test_absolute_artifacts_path_cannot_resolve_through_a_link_outside(self):
        with tempfile.TemporaryDirectory() as directory:
            requested = Path(os.path.abspath(ROOT / "artifacts" / "linked" / "history.jsonl"))
            outside = Path(directory).resolve() / "history.jsonl"
            original_resolve = Path.resolve

            def simulated_resolve(path, strict=False):
                if Path(os.path.abspath(path)) == requested:
                    return outside
                return original_resolve(path, strict=strict)

            with patch.object(Path, "resolve", autospec=True, side_effect=simulated_resolve):
                with self.assertRaisesRegex(
                    self.audit.AuditFailure, "unsafe_history_path"
                ):
                    self.audit.resolve_history_path(requested)

    def test_three_distinct_days_required_and_presence_or_unknown_resets(self):
        two = [self.record("2026-07-10"), self.record("2026-07-11")]
        self.assertEqual(self.candidates(two), [])
        three = [*two, self.record("2026-07-12")]
        self.assertEqual(self.candidates(three), ["a" * 64])
        reset = [*three, self.record("2026-07-13", "exact_instance")]
        self.assertEqual(self.candidates(reset), [])
        new_three = [
            *reset,
            self.record("2026-07-14"),
            self.record("2026-07-15"),
            self.record("2026-07-16"),
        ]
        self.assertEqual(self.candidates(new_three), ["a" * 64])

    def test_observations_must_be_at_least_eighteen_hours_apart(self):
        first = self.record("2026-07-10")
        too_soon = self.record("2026-07-11")
        too_soon["started_at"] = "2026-07-11T00:00:00+00:00"
        too_soon["completed_at"] = "2026-07-11T01:00:00+00:00"
        third = self.record("2026-07-12")
        self.assertEqual(self.candidates([first, too_soon, third]), [])

        eligible = copy.deepcopy(too_soon)
        eligible["started_at"] = "2026-07-11T05:00:00+00:00"
        eligible["completed_at"] = "2026-07-11T06:00:00+00:00"
        self.assertEqual(self.candidates([first, eligible, third]), ["a" * 64])

    def test_schema_one_history_is_validated_but_does_not_count_as_v2_evidence(self):
        metadata_fields = {
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

        def as_schema_one(record):
            legacy = copy.deepcopy(record)
            legacy["schema_version"] = 1
            legacy.pop("record_type", None)
            for field in metadata_fields:
                legacy.pop(field, None)
            for result in legacy["results"]:
                result.pop("baseline_hmac", None)
                result.pop("locator_hmac", None)
                result.pop("baseline_active", None)
                result.pop("current_source_present", None)
            legacy["result_digest"] = self.audit._result_digest(legacy["results"])
            return legacy

        legacy = [
            as_schema_one(self.record("2026-07-10")),
            as_schema_one(self.record("2026-07-11")),
            as_schema_one(self.record("2026-07-12")),
        ]
        self.assertEqual(self.candidates(legacy), [])
        v2 = [
            self.record("2026-07-13"),
            self.record("2026-07-14"),
            self.record("2026-07-15"),
        ]
        self.assertEqual(self.candidates([*legacy, *v2]), ["a" * 64])

    def test_same_day_present_or_unknown_beats_absence(self):
        records = [
            self.record("2026-07-10"),
            self.record("2026-07-11"),
            self.record("2026-07-12"),
            self.record("2026-07-12", "unknown"),
        ]
        self.assertEqual(self.candidates(records), [])

    def test_current_source_presence_can_never_be_retirement_evidence(self):
        contradictory = [
            self.record(
                day,
                "confirmed_absence",
                current_source_present=True,
            )
            for day in ("2026-07-10", "2026-07-11", "2026-07-12")
        ]
        with self.assertRaisesRegex(
            self.audit.AuditFailure, "history_integrity_failure"
        ):
            self.candidates(contradictory)

    def test_outside_cohort_row_blocks_the_day_until_three_new_clean_days(self):
        outside = "f" * 64
        blocked = [
            self.record("2026-07-10"),
            self.record("2026-07-11", outside_tokens=(outside,)),
            self.record("2026-07-12"),
        ]
        self.assertEqual(self.candidates(blocked), [])
        recovered = [
            *blocked,
            self.record("2026-07-13"),
            self.record("2026-07-14"),
            self.record("2026-07-15"),
        ]
        self.assertEqual(self.candidates(recovered), ["a" * 64])

    def test_project_key_partition_and_unknown_field_drift_fail_closed(self):
        base = self.record("2026-07-10")
        mutations = {
            "project": ("project_ref", "wrongproject"),
            "partition": (
                "still_actionable_frozen_token_sha256",
                "0" * 64,
            ),
            "unknown_top": ("raw_course_id", "must-never-enter-history"),
        }
        for label, (field, value) in mutations.items():
            with self.subTest(label=label):
                changed = copy.deepcopy(base)
                changed[field] = value
                with self.assertRaisesRegex(
                    self.audit.AuditFailure, "history_integrity_failure"
                ):
                    self.audit.history_cohort_state(
                        [changed],
                        expected_count=1,
                        expected_digest="fixture-digest",
                    )

        changed_key = self.record("2026-07-11")
        changed_key["key_id"] = "b" * 16
        with self.assertRaisesRegex(
            self.audit.AuditFailure, "history_integrity_failure"
        ):
            self.audit.history_cohort_state(
                [base, changed_key],
                expected_count=1,
                expected_digest="fixture-digest",
            )

        nested = copy.deepcopy(base)
        nested["results"][0]["raw_course_id"] = "must-never-enter-history"
        with self.assertRaisesRegex(
            self.audit.AuditFailure, "history_integrity_failure"
        ):
            self.audit.history_cohort_state(
                [nested], expected_count=1, expected_digest="fixture-digest"
            )

    def test_schema_one_record_after_v2_genesis_is_rejected(self):
        v2 = self.record("2026-07-10")
        legacy = copy.deepcopy(v2)
        legacy["schema_version"] = 1
        legacy.pop("record_type")
        for field in self.audit._OBSERVATION_METADATA_FIELDS:
            legacy.pop(field, None)
        for result in legacy["results"]:
            for field in self.audit._RESULT_FIELDS_V2 - self.audit._RESULT_FIELDS_V1:
                result.pop(field, None)
        legacy["result_digest"] = self.audit._result_digest(legacy["results"])
        with self.assertRaisesRegex(
            self.audit.AuditFailure, "history_integrity_failure"
        ):
            self.candidates([v2, legacy])

    def test_invalid_full_audit_blocks_even_if_seen_before_first_valid_token(self):
        records = [
            self.record("2026-07-10", valid=False),
            self.record("2026-07-11"),
            self.record("2026-07-12"),
        ]
        self.assertEqual(self.candidates(records), [])

    def test_moved_unknown_and_invalid_each_require_three_newer_absence_days(self):
        baseline = [
            self.record("2026-07-10"),
            self.record("2026-07-11"),
            self.record("2026-07-12"),
        ]
        blockers = (
            self.record("2026-07-13", "moved_instance"),
            self.record("2026-07-13", "unknown"),
            self.record("2026-07-13", valid=False),
        )
        for blocker in blockers:
            with self.subTest(blocker=blocker):
                blocked = [*baseline, blocker]
                self.assertEqual(self.candidates(blocked), [])
                recovered = [
                    *blocked,
                    self.record("2026-07-14"),
                    self.record("2026-07-15"),
                    self.record("2026-07-16"),
                ]
                self.assertEqual(self.candidates(recovered), ["a" * 64])

    def test_source_contains_no_mutating_http_or_automation_hook(self):
        source = MODULE_PATH.read_text(encoding="utf-8")
        for forbidden in (
            "requests.post(",
            "requests.put(",
            "requests.patch(",
            "requests.delete(",
            "supabase_upsert",
            "sync_live_courses_atomically",
        ):
            self.assertNotIn(forbidden, source)
        workflow_text = "\n".join(
            path.read_text(encoding="utf-8")
            for path in (ROOT / ".github" / "workflows").glob("*.yml")
        )
        self.assertNotIn("audit_retained_ats.py", workflow_text)


if __name__ == "__main__":
    unittest.main()
