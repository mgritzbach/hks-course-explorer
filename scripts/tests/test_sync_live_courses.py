"""Regression tests for the live-course sync safety contract."""

import importlib.util
import os
import sys
import tempfile
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

    def test_uses_documented_page_size_and_follows_every_scroll_page(self):
        scroll_url = "https://go.prod.apis.huit.harvard.edu/ats/course/v2/search/scroll/test-cursor"
        first = Mock(ok=True)
        first.json.return_value = {
            "results": [{"courseID": "one", "courseNumber": "API 101", "courseTitle": "One"}],
            "next": scroll_url,
        }
        second = Mock(ok=True)
        second.json.return_value = {
            "results": [{"courseID": "two", "courseNumber": "API 102", "courseTitle": "Two"}]
        }
        session = Mock()
        session.get.side_effect = [first, second]

        result = self.sync.fetch_school("HKS", "api", session)

        self.assertTrue(result.success)
        self.assertEqual([row["id"] for row in result.rows], ["one", "two"])
        first_call, second_call = session.get.call_args_list
        self.assertEqual(first_call.args[0], self.sync.HARVARD_API_BASE)
        self.assertEqual(
            first_call.kwargs["params"],
            {"q": "api", "catalogSchool": "HKS", "size": 250, "scroll": "true"},
        )
        self.assertEqual(second_call.args[0], scroll_url)
        self.assertIsNone(second_call.kwargs["params"])
        self.assertFalse(first_call.kwargs["allow_redirects"])
        self.assertFalse(second_call.kwargs["allow_redirects"])

    def test_rejects_redirects_before_a_credentialed_follow_up_request(self):
        redirect = Mock(ok=True, is_redirect=True, status_code=302)
        session = Mock()
        session.get.return_value = redirect

        rows, next_url, error = self.sync._fetch_course_page(
            session,
            self.sync.HARVARD_API_BASE,
            params={"q": "api"},
            school="HKS",
            query="api",
        )

        self.assertIsNone(rows)
        self.assertIsNone(next_url)
        self.assertEqual(error, "unexpected redirect from Harvard API")
        self.assertFalse(session.get.call_args.kwargs["allow_redirects"])

    def test_rejects_untrusted_or_looping_scroll_urls_without_partial_rows(self):
        external = Mock(ok=True)
        external.json.return_value = {"results": [], "next": "https://example.com/scroll"}
        with self.assertRaisesRegex(ValueError, "invalid Harvard scroll URL"):
            self.sync._decode_course_page(external.json())

        scroll_url = f"{self.sync.HARVARD_API_BASE}/scroll/repeated"
        first = Mock(ok=True)
        first.json.return_value = {"results": [], "next": scroll_url}
        repeated = Mock(ok=True)
        repeated.json.return_value = {"results": [], "next": scroll_url}
        session = Mock()
        session.get.side_effect = [first, repeated]

        result = self.sync.fetch_school("HKS", "api", session)

        self.assertFalse(result.success)
        self.assertEqual(result.rows, [])
        self.assertIn("cursor loop", result.error)

    def test_partial_failure_performs_no_database_writes_or_deletes(self):
        success = self.sync.FetchResult("HKS", "a", [], True)
        failure = self.sync.FetchResult("HKS", "e", [], False, "HTTP 503")

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a", "e"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "fetch_school", side_effect=[success, failure]),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(self.sync, "write_github_summary") as write_summary,
        ):
            with self.assertRaises(SystemExit) as exit_context:
                self.sync.main()

        self.assertEqual(exit_context.exception.code, 1)
        upsert.assert_not_called()
        self.assertIn("aborted before database writes", write_summary.call_args.args[0])

    def test_atomic_promotion_failure_writes_a_failure_summary_before_raising(self):
        success = self.sync.FetchResult("HKS", "a", [{"id": "course-1", "term": "2026 Fall"}], True)

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(self.sync, "supabase_upsert", side_effect=RuntimeError("database unavailable")),
            patch.object(self.sync, "supabase_inventory_live_courses") as inventory,
            patch.object(self.sync, "write_github_summary") as write_summary,
        ):
            with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                self.sync.main()

        self.assertIn("atomic database promotion failed", write_summary.call_args.args[0])
        inventory.assert_not_called()

    def test_successful_sync_reports_retained_inventory_without_deleting_rows(self):
        success = self.sync.FetchResult("HKS", "a", [{"id": "course-1", "term": "2026 Fall"}], True)

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(self.sync, "supabase_inventory_live_courses", return_value=[success.rows[0]]),
            patch.object(self.sync, "write_github_summary") as write_summary,
        ):
            self.sync.main()

        upsert.assert_called_once_with([success.rows[0]])
        self.assertIn("promoted atomically", write_summary.call_args.args[0])
        self.assertIn("Retained rows absent from current source:** 0", write_summary.call_args.args[0])

    def test_minimum_unique_course_guard_prevents_writes_and_deletes(self):
        empty_success = self.sync.FetchResult("HKS", "a", [], True)

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "MIN_UNIQUE_COURSES", 1),
            patch.object(self.sync, "fetch_school", return_value=empty_success),
            patch.object(self.sync, "supabase_upsert") as upsert,
        ):
            with self.assertRaises(SystemExit) as exit_context:
                self.sync.main()

        self.assertEqual(exit_context.exception.code, 1)
        upsert.assert_not_called()

    def test_rejects_stale_deletion_request_before_harvard_or_database_activity(self):
        with patch.dict(os.environ, {"SYNC_ALLOW_STALE_DELETE": "true"}, clear=False):
            sync = load_sync_module()
        fetch_school = Mock()
        upsert = Mock()

        with (
            patch.object(sync, "fetch_school", fetch_school),
            patch.object(sync, "supabase_upsert", upsert),
            patch.object(sync, "write_github_summary") as write_summary,
        ):
            with self.assertRaisesRegex(SystemExit, "intentionally unsupported"):
                sync.main()

        fetch_school.assert_not_called()
        upsert.assert_not_called()
        self.assertIn("aborted before API/database activity", write_summary.call_args.args[0])

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

    def test_inventory_paginates_all_rows_and_never_uses_a_delete_request(self):
        records = [
            {"id": str(index), "school": "HKS", "term": "2026 Fall"}
            for index in range(1555)
        ]
        requests_seen = []

        def request_get(url, headers, params, timeout):
            requests_seen.append((headers["Range"], params))
            start = int(headers["Range"].split("-")[0])
            response = Mock(ok=True)
            response.json.return_value = records[start : start + self.sync.INVENTORY_PAGE_SIZE]
            return response

        inventory = self.sync.supabase_inventory_live_courses(request_get)

        self.assertEqual(inventory, records)
        self.assertEqual(
            requests_seen,
            [
                ("0-999", {"select": "id,school,term", "order": "id.asc"}),
                ("1000-1999", {"select": "id,school,term", "order": "id.asc"}),
            ],
        )

    def test_sync_source_has_no_delete_transport_or_cleanup_helper(self):
        source = MODULE_PATH.read_text(encoding="utf-8")

        self.assertNotIn("requests.delete(", source)
        self.assertNotIn("supabase_delete_stale", source)

    def test_inventory_rejects_malformed_and_duplicate_ids(self):
        malformed = Mock(ok=True)
        malformed.json.return_value = [{"school": "HKS", "term": "2026 Fall"}]
        with self.assertRaisesRegex(RuntimeError, "without an ID"):
            self.sync.supabase_inventory_live_courses(Mock(return_value=malformed))

        first = Mock(ok=True)
        first.json.return_value = [{"id": "same", "school": "HKS", "term": "2026 Fall"}]
        second = Mock(ok=True)
        second.json.return_value = [{"id": "same", "school": "HKS", "term": "2026 Fall"}]
        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 1),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 2),
        ):
            with self.assertRaisesRegex(RuntimeError, "duplicate IDs"):
                self.sync.supabase_inventory_live_courses(Mock(side_effect=[first, second]))

    def test_inventory_rejects_a_result_that_reaches_the_safe_page_cap(self):
        full_page = Mock(ok=True)
        full_page.json.return_value = [{"id": "one", "school": "HKS", "term": "2026 Fall"}]
        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 1),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 1),
        ):
            with self.assertRaisesRegex(RuntimeError, "safe 1 row inventory limit"):
                self.sync.supabase_inventory_live_courses(Mock(return_value=full_page))

    def test_inventory_comparison_reports_aggregate_retained_rows_only(self):
        comparison = self.sync.compare_live_course_inventory(
            [{"id": "current", "school": "HKS", "term": "2026 Fall"}],
            [
                {"id": "current", "school": "HKS", "term": "2026 Fall"},
                {"id": "retained-a", "school": "HKS", "term": "2025 Fall"},
                {"id": "retained-b", "school": "FAS", "term": "2024 Spring"},
            ],
        )

        self.assertEqual(comparison["database_row_count"], 3)
        self.assertEqual(comparison["retained_not_in_current_source_count"], 2)
        self.assertEqual(comparison["current_source_missing_from_database_count"], 0)
        self.assertEqual(comparison["retained_not_in_current_source_by_school"], {"FAS": 1, "HKS": 1})
        self.assertEqual(comparison["retained_not_in_current_source_by_term"], {"2024 Spring": 1, "2025 Fall": 1})

    def test_inventory_failure_is_reported_after_atomic_promotion_without_cleanup(self):
        success = self.sync.FetchResult("HKS", "a", [{"id": "course-1", "term": "2026 Fall"}], True)

        with (
            patch.object(self.sync, "ALL_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(self.sync, "supabase_inventory_live_courses", side_effect=RuntimeError("inventory unavailable")),
            patch.object(self.sync, "write_github_summary") as write_summary,
        ):
            with self.assertRaisesRegex(RuntimeError, "inventory unavailable"):
                self.sync.main()

        upsert.assert_called_once_with([success.rows[0]])
        self.assertIn("atomic promotion succeeded; retained-inventory audit failed; no cleanup attempted", write_summary.call_args.args[0])

    def test_summary_reports_coverage_without_course_content_or_credentials(self):
        summary = self.sync.build_sync_summary(
            outcome="promoted atomically",
            sync_start="2026-07-11T00:00:00+00:00",
            planned_request_count=2,
            rows=[
                {"id": "one", "school": "HKS", "term": "2026 Fall", "title": "Sensitive title"},
                {
                    "id": "two",
                    "school": "FAS",
                    "term": "2026 Fall\nmalformed continuation",
                    "description": "Sensitive text",
                },
            ],
        )

        self.assertIn("**Outcome:** promoted atomically", summary)
        self.assertIn("**Planned Harvard requests:** 2", summary)
        self.assertIn("**Offerings by school:** FAS: 1, HKS: 1", summary)
        self.assertIn("**Offerings by term:** 2026 Fall: 1, 2026 Fall malformed continuation: 1", summary)
        self.assertNotIn("Sensitive", summary)
        self.assertNotIn("SUPABASE_KEY", summary)
        self.assertNotIn("\nmalformed continuation", summary)
        failed_summary = self.sync.build_sync_summary(
            outcome="aborted before database writes",
            sync_start="2026-07-11T00:00:00+00:00",
            planned_request_count=1,
            rows=[],
            failures=[self.sync.FetchResult("HKS", "a", [], False, "secret diagnostic detail")],
        )
        self.assertIn("**Failed source requests:** 1", failed_summary)
        self.assertNotIn("secret diagnostic detail", failed_summary)

    def test_summary_writer_is_optional_and_does_not_raise_for_a_missing_path(self):
        with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": ""}, clear=False):
            self.sync.write_github_summary("ignored")

        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "summary.md"
            with patch.dict(os.environ, {"GITHUB_STEP_SUMMARY": str(path)}, clear=False):
                self.sync.write_github_summary("## Live-course sync\n")
            self.assertEqual(path.read_text(encoding="utf-8"), "## Live-course sync\n")


if __name__ == "__main__":
    unittest.main()
