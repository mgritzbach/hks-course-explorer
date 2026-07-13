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


def reconciliation_report(**overrides):
    report = {
        "database_row_count": 4,
        "classified_row_count": 4,
        "current_non_hks_ats_count": 1,
        "protected_active_myharvard_count": 1,
        "protected_myharvard_rollback_count": 1,
        "protected_legacy_hks_fallback_count": 0,
        "actionable_retained_non_hks_ats_count": 1,
        "actionable_queue_sha256": "a" * 64,
        "actionable_by_active_state": {"active": 1},
        "actionable_by_age": {"8_to_30_days": 1},
        "actionable_by_school": {"FAS": 1},
        "actionable_by_term": {"2025 Fall": 1},
        "current_source_missing_from_database_count": 0,
    }
    report.update(overrides)
    return report


class FetchSchoolTests(unittest.TestCase):
    def setUp(self):
        self.sync = load_sync_module()
        self.sync.REQUEST_DELAY = 0

    def test_general_sync_never_queries_authoritative_hks_source(self):
        self.assertEqual(
            self.sync.GENERAL_SYNC_SCHOOLS,
            (
                "FAS", "GSAS", "GSD", "HBSD", "HBSM",
                "HDS", "HGSE", "HLS", "HMS",
                "HSDM", "HSPH", "NONH",
            ),
        )
        self.assertNotIn(self.sync.HKS_SCHOOL, self.sync.GENERAL_SYNC_SCHOOLS)

    def test_shared_source_collection_preserves_grid_sessions_failures_and_merge(self):
        sessions = []

        def session_factory():
            value = object()
            sessions.append(value)
            return value

        def fetcher(school, query, session):
            self.assertIn(session, sessions)
            if query == "a":
                return self.sync.FetchResult(
                    school, query, [{"id": "shared", "title": "first"}], True
                )
            if query == "e":
                return self.sync.FetchResult(
                    school, query, [{"id": "shared", "description": "second"}], True
                )
            if query == "i":
                return self.sync.FetchResult(school, query, [], False, "bounded failure")
            raise RuntimeError("worker failure")

        with (
            patch.object(self.sync, "GENERAL_SYNC_SCHOOLS", ["FAS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a", "e", "i", "o"]),
            patch.object(self.sync, "WORKERS", 1),
        ):
            rows, failures, tasks = self.sync.collect_general_source_rows(
                fetcher=fetcher, session_factory=session_factory
            )

        self.assertEqual(tasks, [("FAS", "a"), ("FAS", "e"), ("FAS", "i"), ("FAS", "o")])
        self.assertEqual(len(sessions), 4)
        self.assertEqual(len({id(session) for session in sessions}), 4)
        self.assertEqual(rows["shared"]["title"], "first")
        self.assertEqual(rows["shared"]["description"], "second")
        self.assertEqual(len(failures), 2)
        self.assertEqual({failure.query for failure in failures}, {"i", "o"})

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

    def test_cross_listed_hks_representation_wins_without_losing_source_fields(self):
        fas = {
            "id": "shared-id",
            "course_code": "GOV-100",
            "school": "FAS",
            "is_hks": False,
            "description": "Shared description",
        }
        hks = {
            "id": "shared-id",
            "course_code": "DPI-100",
            "school": "HKS",
            "is_hks": True,
            "description": "",
        }

        merged = self.sync.merge_duplicate_course(fas, hks)

        self.assertEqual(merged["school"], "HKS")
        self.assertTrue(merged["is_hks"])
        self.assertEqual(merged["course_code"], "DPI-100")
        self.assertEqual(merged["description"], "Shared description")

    def test_partial_failure_performs_no_database_writes_or_deletes(self):
        success = self.sync.FetchResult("HKS", "a", [], True)
        failure = self.sync.FetchResult("HKS", "e", [], False, "HTTP 503")

        with (
            patch.object(self.sync, "GENERAL_SYNC_SCHOOLS", ["HKS"]),
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
            patch.object(self.sync, "GENERAL_SYNC_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(
                self.sync, "supabase_active_hks_source_course_ids", return_value={"hks-owned"}
            ),
            patch.object(self.sync, "supabase_upsert", side_effect=RuntimeError("database unavailable")),
            patch.object(self.sync, "supabase_inventory_live_courses") as inventory,
            patch.object(self.sync, "write_github_summary") as write_summary,
        ):
            with self.assertRaisesRegex(RuntimeError, "database unavailable"):
                self.sync.main()

        self.assertIn("atomic database promotion failed", write_summary.call_args.args[0])
        inventory.assert_not_called()

    def test_successful_sync_reports_source_aware_inventory_without_mutating_retained_rows(self):
        success = self.sync.FetchResult("HKS", "a", [{"id": "course-1", "term": "2026 Fall"}], True)

        with (
            patch.object(self.sync, "GENERAL_SYNC_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(
                self.sync, "supabase_active_hks_source_course_ids", return_value={"hks-owned"}
            ),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(self.sync, "supabase_inventory_live_courses", return_value=[success.rows[0]]),
            patch.object(self.sync, "supabase_inventory_catalogue_runs", return_value=[{"id": "run"}]),
            patch.object(
                self.sync,
                "compare_live_course_inventory",
                return_value=reconciliation_report(),
            ) as compare_inventory,
            patch.object(self.sync, "write_github_summary") as write_summary,
        ):
            self.sync.main()

        upsert.assert_called_once_with([success.rows[0]])
        compare_inventory.assert_called_once_with(
            [success.rows[0]], [success.rows[0]], [{"id": "run"}]
        )
        self.assertIn("promoted atomically", write_summary.call_args.args[0])
        self.assertIn("Actionable retained non-HKS ATS rows:** 1", write_summary.call_args.args[0])
        self.assertIn("Actionable queue SHA-256:** `" + "a" * 64, write_summary.call_args.args[0])

    def test_minimum_unique_course_guard_prevents_writes_and_deletes(self):
        empty_success = self.sync.FetchResult("HKS", "a", [], True)

        with (
            patch.object(self.sync, "GENERAL_SYNC_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "MIN_UNIQUE_COURSES", 1),
            patch.object(self.sync, "fetch_school", return_value=empty_success),
            patch.object(
                self.sync, "supabase_active_hks_source_course_ids", return_value={"hks-owned"}
            ),
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

        def request_get(url, headers, params, timeout, allow_redirects):
            self.assertEqual(headers["Prefer"], "count=exact")
            self.assertFalse(allow_redirects)
            requests_seen.append((headers["Range"], params))
            start = int(headers["Range"].split("-")[0])
            response = Mock(ok=True)
            page = records[start : start + self.sync.INVENTORY_PAGE_SIZE]
            response.json.return_value = page
            response.headers = {
                "Content-Range": f"{start}-{start + len(page) - 1}/{len(records)}"
            }
            return response

        inventory = self.sync.supabase_inventory_live_courses(request_get)

        self.assertEqual(inventory, records)
        self.assertEqual(
            requests_seen,
            [
                (
                    "0-999",
                    {
                        "select": (
                            "id,school,term,course_code,session_code,source,active,is_hks,"
                            "sync_run_id,source_course_id,source_offering_id,synced_at"
                        ),
                        "order": "id.asc",
                    },
                ),
                (
                    "1000-1999",
                    {
                        "select": (
                            "id,school,term,course_code,session_code,source,active,is_hks,"
                            "sync_run_id,source_course_id,source_offering_id,synced_at"
                        ),
                        "order": "id.asc",
                    },
                ),
            ],
        )

    def test_catalogue_run_inventory_is_complete_and_myharvard_only(self):
        records = [
            {"id": "run-a", "source": "myharvard"},
            {"id": "run-b", "source": "myharvard"},
        ]
        requests_seen = []

        def request_get(url, headers, params, timeout, allow_redirects):
            self.assertFalse(allow_redirects)
            self.assertEqual(headers["Prefer"], "count=exact")
            requests_seen.append((url, headers["Range"], params))
            start = int(headers["Range"].split("-")[0])
            response = Mock(ok=True)
            response.json.return_value = records[start : start + 1]
            response.headers = {"Content-Range": f"{start}-{start}/{len(records)}"}
            return response

        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 1),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 3),
        ):
            inventory = self.sync.supabase_inventory_catalogue_runs(request_get)

        self.assertEqual(inventory, records)
        self.assertEqual([item[1] for item in requests_seen], ["0-0", "1-1"])
        self.assertEqual(requests_seen[0][0], "https://example.supabase.co/rest/v1/live_catalogue_runs")
        self.assertEqual(requests_seen[0][2]["source"], "eq.myharvard")
        self.assertEqual(
            requests_seen[0][2]["select"],
            "id,source,status,offering_count,identity_sha256,term_counts",
        )

    def test_catalogue_run_inventory_fails_closed_on_empty_or_duplicate_rows(self):
        empty = Mock(ok=True)
        empty.json.return_value = []
        empty.headers = {"Content-Range": "*/0"}
        with self.assertRaisesRegex(RuntimeError, "inventory is empty"):
            self.sync.supabase_inventory_catalogue_runs(Mock(return_value=empty))

        repeated_first = Mock(ok=True)
        repeated_first.json.return_value = [{"id": "same"}]
        repeated_first.headers = {"Content-Range": "0-0/2"}
        repeated_second = Mock(ok=True)
        repeated_second.json.return_value = [{"id": "same"}]
        repeated_second.headers = {"Content-Range": "1-1/2"}
        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 1),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 2),
        ):
            with self.assertRaisesRegex(RuntimeError, "duplicate IDs"):
                self.sync.supabase_inventory_catalogue_runs(
                    Mock(side_effect=[repeated_first, repeated_second])
                )

    def test_inventory_rejects_an_advertised_total_with_a_missing_page_row(self):
        first = Mock(ok=True)
        first.json.return_value = [{"id": "a"}, {"id": "b"}]
        first.headers = {"Content-Range": "0-1/4"}
        second = Mock(ok=True)
        second.json.return_value = [{"id": "d"}]
        second.headers = {"Content-Range": "2-2/4"}

        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 2),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 4),
        ):
            with self.assertRaisesRegex(RuntimeError, "ended before its advertised total"):
                self.sync.supabase_inventory_live_courses(Mock(side_effect=[first, second]))

    def test_inventory_requires_an_exact_numeric_total(self):
        missing = Mock(ok=True)
        missing.json.return_value = [{"id": "a"}]
        missing.headers = {}
        with self.assertRaisesRegex(RuntimeError, "exact Content-Range"):
            self.sync.supabase_inventory_live_courses(Mock(return_value=missing))

        wildcard = Mock(ok=True)
        wildcard.json.return_value = [{"id": "a"}]
        wildcard.headers = {"Content-Range": "0-0/*"}
        with self.assertRaisesRegex(RuntimeError, "exact total"):
            self.sync.supabase_inventory_live_courses(Mock(return_value=wildcard))

    def test_authoritative_hks_identity_read_rejects_discontinuous_ranges(self):
        response = Mock(ok=True)
        response.json.return_value = [{"id": "row-1", "source_course_id": "170000"}]
        response.headers = {"Content-Range": "1-1/1"}

        with self.assertRaisesRegex(RuntimeError, "discontinuous Content-Range"):
            self.sync.supabase_active_hks_source_course_ids(Mock(return_value=response))

    def test_reads_and_deduplicates_authoritative_hks_course_ids(self):
        records = [
            {"id": "row-a", "source_course_id": "170000"},
            {"id": "row-b", "source_course_id": "170001"},
            {"id": "row-c", "source_course_id": "170000"},
        ]
        requests_seen = []

        def request_get(url, headers, params, timeout, allow_redirects):
            self.assertFalse(allow_redirects)
            self.assertEqual(headers["Prefer"], "count=exact")
            requests_seen.append((headers["Range"], params))
            start = int(headers["Range"].split("-")[0])
            response = Mock(ok=True)
            page = records[start : start + 2]
            response.json.return_value = page
            response.headers = {
                "Content-Range": f"{start}-{start + len(page) - 1}/{len(records)}"
            }
            return response

        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 2),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 4),
        ):
            ids = self.sync.supabase_active_hks_source_course_ids(request_get)

        self.assertEqual(ids, {"170000", "170001"})
        self.assertEqual([request[0] for request in requests_seen], ["0-1", "2-3"])
        self.assertEqual(requests_seen[0][1]["source"], "eq.myharvard")
        self.assertEqual(requests_seen[0][1]["active"], "eq.true")
        self.assertEqual(requests_seen[0][1]["is_hks"], "eq.true")
        self.assertEqual(requests_seen[0][1]["select"], "id,source_course_id")
        self.assertEqual(requests_seen[0][1]["order"], "id.asc")

    def test_rejects_an_empty_authoritative_hks_identity_set(self):
        empty = Mock(ok=True)
        empty.json.return_value = []
        empty.headers = {"Content-Range": "*/0"}
        with self.assertRaisesRegex(RuntimeError, "identity set is empty"):
            self.sync.supabase_active_hks_source_course_ids(Mock(return_value=empty))

    def test_authoritative_hks_identity_read_rejects_duplicate_row_ids(self):
        first = Mock(ok=True)
        first.json.return_value = [{"id": "same", "source_course_id": "170000"}]
        first.headers = {"Content-Range": "0-0/2"}
        second = Mock(ok=True)
        second.json.return_value = [{"id": "same", "source_course_id": "170001"}]
        second.headers = {"Content-Range": "1-1/2"}

        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 1),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 2),
        ):
            with self.assertRaisesRegex(RuntimeError, "duplicate row IDs"):
                self.sync.supabase_active_hks_source_course_ids(
                    Mock(side_effect=[first, second])
                )

    def test_filters_authoritative_hks_cross_lists_before_upsert(self):
        success = self.sync.FetchResult(
            "FAS",
            "policy",
            [
                {"id": "170000", "school": "FAS", "is_hks": False, "term": "2026 Fall"},
                {"id": "fas-owned", "school": "FAS", "is_hks": False, "term": "2026 Fall"},
            ],
            True,
        )

        with (
            patch.object(self.sync, "GENERAL_SYNC_SCHOOLS", ["FAS"]),
            patch.object(self.sync, "SEED_QUERIES", ["policy"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "MIN_UNIQUE_COURSES", 1),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(
                self.sync, "supabase_active_hks_source_course_ids", return_value={"170000"}
            ),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(
                self.sync,
                "supabase_inventory_live_courses",
                return_value=[{"id": "fas-owned", "school": "FAS", "term": "2026 Fall"}],
            ),
            patch.object(self.sync, "supabase_inventory_catalogue_runs", return_value=[{"id": "run"}]),
            patch.object(
                self.sync,
                "compare_live_course_inventory",
                return_value=reconciliation_report(),
            ),
            patch.object(self.sync, "write_github_summary"),
        ):
            self.sync.main()

        upsert.assert_called_once_with(
            [{"id": "fas-owned", "school": "FAS", "is_hks": False, "term": "2026 Fall"}]
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
        first.headers = {"Content-Range": "0-0/2"}
        second = Mock(ok=True)
        second.json.return_value = [{"id": "same", "school": "HKS", "term": "2026 Fall"}]
        second.headers = {"Content-Range": "1-1/2"}
        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 1),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 2),
        ):
            with self.assertRaisesRegex(RuntimeError, "duplicate IDs"):
                self.sync.supabase_inventory_live_courses(Mock(side_effect=[first, second]))

    def test_inventory_rejects_a_result_that_reaches_the_safe_page_cap(self):
        full_page = Mock(ok=True)
        full_page.json.return_value = [{"id": "one", "school": "HKS", "term": "2026 Fall"}]
        full_page.headers = {"Content-Range": "0-0/2"}
        with (
            patch.object(self.sync, "INVENTORY_PAGE_SIZE", 1),
            patch.object(self.sync, "MAX_INVENTORY_ROWS", 1),
        ):
            with self.assertRaisesRegex(RuntimeError, "safe 1 row inventory limit"):
                self.sync.supabase_inventory_live_courses(Mock(return_value=full_page))

    def test_inventory_comparison_delegates_to_source_aware_classifier(self):
        source_rows = [{"id": "current"}]
        database_rows = [{"id": "current"}]
        catalogue_runs = [{"id": "run"}]
        expected = reconciliation_report()

        with patch.object(
            self.sync, "classify_live_course_inventory", return_value=expected
        ) as classify:
            comparison = self.sync.compare_live_course_inventory(
                source_rows, database_rows, catalogue_runs
            )

        self.assertEqual(comparison, expected)
        classify.assert_called_once_with(source_rows, database_rows, catalogue_runs)

    def test_inventory_failure_is_reported_after_atomic_promotion_without_cleanup(self):
        success = self.sync.FetchResult("HKS", "a", [{"id": "course-1", "term": "2026 Fall"}], True)

        with (
            patch.object(self.sync, "GENERAL_SYNC_SCHOOLS", ["HKS"]),
            patch.object(self.sync, "SEED_QUERIES", ["a"]),
            patch.object(self.sync, "WORKERS", 1),
            patch.object(self.sync, "fetch_school", return_value=success),
            patch.object(
                self.sync, "supabase_active_hks_source_course_ids", return_value={"hks-owned"}
            ),
            patch.object(self.sync, "supabase_upsert") as upsert,
            patch.object(self.sync, "supabase_inventory_live_courses", side_effect=RuntimeError("inventory unavailable")),
            patch.object(self.sync, "write_github_summary") as write_summary,
        ):
            with self.assertRaisesRegex(RuntimeError, "inventory unavailable"):
                self.sync.main()

        upsert.assert_called_once_with([success.rows[0]])
        self.assertIn(
            "atomic promotion succeeded; source-aware reconciliation audit failed; no cleanup attempted",
            write_summary.call_args.args[0],
        )

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
            inventory=reconciliation_report(),
        )

        self.assertIn("**Outcome:** promoted atomically", summary)
        self.assertIn("**Planned Harvard requests:** 2", summary)
        self.assertIn("**Offerings by school:** FAS: 1, HKS: 1", summary)
        self.assertIn("**Offerings by term:** 2026 Fall: 1, 2026 Fall malformed continuation: 1", summary)
        self.assertNotIn("Sensitive", summary)
        self.assertNotIn("SUPABASE_KEY", summary)
        self.assertNotIn("\nmalformed continuation", summary)
        self.assertIn("**Database rows classified exactly once:** 4", summary)
        self.assertIn("**Actionable retained non-HKS ATS rows:** 1", summary)
        self.assertIn("**Actionable queue SHA-256:** `" + "a" * 64 + "`", summary)
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
