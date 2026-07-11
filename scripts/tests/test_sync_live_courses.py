"""Regression tests for the live-course sync safety contract."""

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "sync_live_courses.py"


def load_sync_module():
    """Load the script with harmless placeholder credentials for isolated tests."""
    name = "sync_live_courses_test_subject"
    sys.modules.pop(name, None)
    with patch.dict(
        os.environ,
        {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_KEY": "test-service-key",
            "HARVARD_API_KEY": "test-harvard-key",
        },
        clear=False,
    ):
        spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module


class FetchSchoolTests(unittest.TestCase):
    def setUp(self):
        self.sync = load_sync_module()
        self.sync.REQUEST_DELAY = 0

    def test_accepts_valid_list_response(self):
        response = Mock(ok=True)
        response.json.return_value = []
        session = Mock()
        session.get.return_value = response

        result = self.sync.fetch_school("HKS", "a", session)

        self.assertTrue(result.success)
        self.assertEqual(result.rows, [])

    def test_uses_proven_limit_based_search_contract(self):
        response = Mock(ok=True)
        response.json.return_value = {
            "results": [{"courseID": "one", "courseNumber": "API 101", "courseTitle": "One"}]
        }
        session = Mock()
        session.get.return_value = response

        result = self.sync.fetch_school("HKS", "api", session)

        self.assertTrue(result.success)
        self.assertEqual([row["id"] for row in result.rows], ["one"])
        call = session.get.call_args
        self.assertEqual(call.args[0], self.sync.HARVARD_API_BASE)
        self.assertEqual(
            call.kwargs["params"],
            {"q": "api", "catalogSchool": "HKS", "limit": 50},
        )

    def test_partial_failure_performs_no_database_writes_or_deletes(self):
        success = self.sync.FetchResult("HKS", "a", [], True)
        failure = self.sync.FetchResult("HKS", "e", [], False, "HTTP 503")

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a", "e"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "fetch_school", side_effect=[success, failure]),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(self.sync, "supabase_delete_stale") as delete_stale,
        ):
            with self.assertRaises(SystemExit) as exit_context:
                self.sync.main()

        self.assertEqual(exit_context.exception.code, 1)
        upsert.assert_not_called()
        delete_stale.assert_not_called()

    def test_successful_sync_does_not_delete_stale_rows_without_explicit_opt_in(self):
        success = self.sync.FetchResult("HKS", "a", [{"id": "course-1", "term": "2026 Fall"}], True)

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "ALLOW_STALE_DELETION", False),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(self.sync, "supabase_delete_stale") as delete_stale,
        ):
            self.sync.main()

        upsert.assert_called_once_with([success.rows[0]])
        delete_stale.assert_not_called()

    def test_minimum_unique_course_guard_prevents_writes_and_deletes(self):
        empty_success = self.sync.FetchResult("HKS", "a", [], True)

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "MIN_UNIQUE_COURSES", 1),
            patch.object(self.sync, "fetch_school", return_value=empty_success),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(self.sync, "supabase_delete_stale") as delete_stale,
        ):
            with self.assertRaises(SystemExit) as exit_context:
                self.sync.main()

        self.assertEqual(exit_context.exception.code, 1)
        upsert.assert_not_called()
        delete_stale.assert_not_called()

    def test_explicit_opt_in_allows_stale_deletion_after_successful_sync(self):
        success = self.sync.FetchResult("HKS", "a", [{"id": "course-1", "term": "2026 Fall"}], True)

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "ALLOW_STALE_DELETION", True),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(self.sync, "supabase_upsert"),
            patch.object(self.sync, "supabase_delete_stale") as delete_stale,
        ):
            self.sync.main()

        delete_stale.assert_called_once()

    def test_atomic_upsert_posts_one_complete_payload_and_verifies_row_count(self):
        response = Mock(ok=True)
        response.json.return_value = 2
        rows = [{"id": "one"}, {"id": "two"}]

        with patch.object(self.sync.requests, "post", return_value=response) as post:
            self.sync.supabase_upsert(rows)

        post.assert_called_once_with(
            "https://example.supabase.co/rest/v1/rpc/sync_live_courses_atomically",
            headers=self.sync._sb_headers(),
            json={"p_rows": rows},
            timeout=120,
        )

    def test_atomic_upsert_rejects_failed_or_incomplete_database_results(self):
        failed = Mock(ok=False, status_code=500, text="database error")
        with patch.object(self.sync.requests, "post", return_value=failed):
            with self.assertRaisesRegex(RuntimeError, "Atomic live-course sync failed"):
                self.sync.supabase_upsert([{"id": "one"}])

        incomplete = Mock(ok=True)
        incomplete.json.return_value = 0
        with patch.object(self.sync.requests, "post", return_value=incomplete):
            with self.assertRaisesRegex(RuntimeError, "expected 1"):
                self.sync.supabase_upsert([{"id": "one"}])


if __name__ == "__main__":
    unittest.main()
