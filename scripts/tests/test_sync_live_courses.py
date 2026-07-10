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


if __name__ == "__main__":
    unittest.main()
