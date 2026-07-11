"""Read-only source-audit contract tests."""

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
MODULE_PATH = SCRIPTS / "audit_catalogue_sources.py"


def load_module():
    name = "audit_catalogue_sources_test_subject"
    sys.modules.pop(name, None)
    sys.path.insert(0, str(SCRIPTS))
    try:
        spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module
    finally:
        sys.path.pop(0)


class FakeResponse:
    def __init__(self, payload, ok=True, status_code=200):
        self.payload = payload
        self.ok = ok
        self.status_code = status_code

    def json(self):
        return self.payload


class CatalogueAuditTests(unittest.TestCase):
    def setUp(self):
        self.audit = load_module()

    def test_paginates_all_rows_instead_of_accepting_the_first_supabase_page(self):
        records = [{"id": str(index)} for index in range(1555)]
        requests_seen = []

        def request_get(url, headers, params, timeout):
            requests_seen.append(headers["Range"])
            start = int(headers["Range"].split("-")[0])
            return FakeResponse(records[start : start + self.audit.PAGE_SIZE])

        self.assertEqual(
            self.audit.fetch_all_supabase_rows("https://example.supabase.co", "key", "live_courses", request_get),
            records,
        )
        self.assertEqual(requests_seen, ["0-999", "1000-1999"])

    def test_reports_verified_and_unmatched_hks_offerings_without_data_loss(self):
        report = self.audit.audit_catalogue(
            [
                {"id": "current-a", "school": "HKS", "course_code_base": "API-101", "instructors": ["Avery Example"]},
                {"id": "current-b", "school": "HKS", "course_code_base": "DPI-802-M-D"},
                {"id": "other", "school": "FAS", "course_code_base": "GEN-1"},
            ],
            [{"id": "history-a", "course_code_base": "API-101", "has_eval": True, "professor": "Example, Avery"}],
            {},
        )
        self.assertEqual(report["current_offering_count"], 3)
        self.assertEqual(report["hks_current_offering_count"], 2)
        self.assertEqual(report["hks_verified_history_count"], 1)
        self.assertEqual(report["hks_unmatched_history_count"], 1)
        self.assertEqual(report["unmatched_hks_codes"], ["DPI-802-M-D"])

    def test_reports_and_rejects_history_id_drift_before_snapshot_promotion(self):
        source = [{"id": "history-a"}, {"id": "stale-history"}]
        canonical = [{"id": "history-a"}, {"id": "canonical-history"}]

        parity = self.audit.historical_source_parity(source, canonical)
        self.assertFalse(parity["historical_source_matches_canonical"])
        self.assertEqual(parity["historical_source_only_count"], 1)
        self.assertEqual(parity["canonical_history_only_count"], 1)
        with self.assertRaisesRegex(RuntimeError, "does not exactly match canonical courses.json"):
            self.audit.require_historical_source_parity(source, canonical)

    def test_accepts_only_exact_unique_history_id_sets(self):
        source = [{"id": "history-b"}, {"id": "history-a"}]
        canonical = [{"id": "history-a"}, {"id": "history-b"}]

        parity = self.audit.require_historical_source_parity(source, canonical)
        self.assertTrue(parity["historical_source_matches_canonical"])

    def test_reports_exact_semantic_id_changes_without_authorising_rewrites(self):
        source = [
            {
                "id": "legacy-id", "course_code_base": "API 101", "year": 2024,
                "term": "Fall", "professor": "Example, Avery", "course_name": "Public Policy", "is_average": False,
            },
            {
                "id": "legacy-ambiguous", "course_code_base": "API 102", "year": 2024,
                "term": "Fall", "professor": "Example, Avery", "course_name": "Policy Analysis", "is_average": False,
            },
            {"id": "missing-fields"},
        ]
        canonical = [
            {
                "id": "generated-id", "course_code": "API-101", "year": "2024",
                "term": "fall", "professor_display": "Avery Example", "course_name": "Public Policy", "is_average": False,
            },
            {
                "id": "ambiguous-a", "course_code": "API-102", "year": "2024",
                "term": "fall", "professor": "Avery Example", "course_name": "Policy Analysis", "is_average": False,
            },
            {
                "id": "ambiguous-b", "course_code": "API-102", "year": "2024",
                "term": "fall", "professor": "Avery Example", "course_name": "Policy Analysis", "is_average": False,
            },
        ]

        report = self.audit.semantic_history_reconciliation(source, canonical)

        self.assertEqual(report["semantic_exact_one_to_one_count"], 1)
        self.assertEqual(report["semantic_ambiguous_shared_key_count"], 1)
        self.assertEqual(report["semantic_source_missing_key_count"], 1)
        self.assertEqual(report["semantic_changed_id_candidate_count"], 1)

    def test_treats_year_zero_as_a_valid_aggregate_identity_component(self):
        row = {
            "id": "average", "course_code": "API-101", "year": 0, "term": "Fall",
            "professor": "Average", "course_name": "Public Policy", "is_average": True,
        }

        key = self.audit.historical_semantic_key(row)

        self.assertIsNotNone(key)
        self.assertEqual(key[1], "0")

    def test_writes_local_review_rows_without_authorising_an_id_rewrite(self):
        source = [{"id": "legacy", "course_code": "API-101", "year": 2024, "term": "Fall", "professor": "Avery Example", "course_name": "Public Policy"}]
        canonical = [{"id": "generated", "course_code": "API-101", "year": 2024, "term": "Fall", "professor": "Avery Example", "course_name": "Public Policy"}]
        with tempfile.TemporaryDirectory() as directory:
            report_path = Path(directory) / "review.json"
            self.audit.write_semantic_reconciliation_review(report_path, source, canonical)
            payload = json.loads(report_path.read_text(encoding="utf-8"))

        self.assertEqual(payload["purpose"], "review_only_no_automatic_id_rewrites")
        self.assertEqual(payload["rows"][0]["status"], "exact_semantic_id_change")
        self.assertEqual(payload["rows"][0]["source_ids"], ["legacy"])
        self.assertEqual(payload["rows"][0]["canonical_ids"], ["generated"])

    def test_rejects_relative_review_report_paths(self):
        with self.assertRaisesRegex(ValueError, "must be absolute"):
            self.audit.write_semantic_reconciliation_review("review.json", [], [])

    def test_surfaces_only_nonaggregate_terminal_section_changes_for_manual_review(self):
        review_rows = [
            {
                "status": "exact_semantic_id_change",
                "identity": {"course_code": "DPI-820-M", "is_average": "false"},
                "source_ids": ["DPI-820-M-A||2025||Fall||Example, Avery"],
                "canonical_ids": ["DPI-820-M||2025||Fall||Example, Avery"],
            },
            {
                "status": "exact_semantic_id_change",
                "identity": {"course_code": "API-101", "is_average": "true"},
                "source_ids": ["API-101||0||Average||Example, Avery"],
                "canonical_ids": ["API-101||0||Average||Example, Avery||aggregate-digest"],
            },
            {
                "status": "same_id",
                "identity": {"course_code": "API-102", "is_average": "false"},
                "source_ids": ["API-102||2025||Fall||Example, Avery"],
                "canonical_ids": ["API-102||2025||Fall||Example, Avery"],
            },
        ]

        queue = self.audit.manual_nonaggregate_section_code_change_review_rows(review_rows)

        self.assertEqual(len(queue), 1)
        self.assertEqual(queue[0]["status"], "needs_manual_provenance_review")
        self.assertEqual(queue[0]["candidate_kind"], "terminal_section_token_removed")
        self.assertEqual(queue[0]["source_course_code"], "DPI-820-M-A")
        self.assertEqual(queue[0]["canonical_course_code"], "DPI-820-M")

    def test_excludes_unrelated_code_changes_from_terminal_section_queue(self):
        review_rows = [{
            "status": "exact_semantic_id_change",
            "identity": {"course_code": "API-101", "is_average": "false"},
            "source_ids": ["API-101||2025||Fall||Example, Avery"],
            "canonical_ids": ["DPI-202||2025||Fall||Example, Avery"],
        }]

        self.assertEqual(
            self.audit.manual_nonaggregate_section_code_change_review_rows(review_rows),
            [],
        )

    def test_includes_manual_code_change_count_without_authorising_a_mapping(self):
        source = [{
            "id": "DPI-820-M-A||2025||Fall||Example, Avery", "course_code_base": "DPI-820-M",
            "year": 2025, "term": "Fall", "professor": "Example, Avery", "course_name": "Policy Memo", "is_average": False,
        }]
        canonical = [{
            "id": "DPI-820-M||2025||Fall||Example, Avery", "course_code": "DPI-820-M",
            "year": 2025, "term": "Fall", "professor": "Example, Avery", "course_name": "Policy Memo", "is_average": False,
        }]

        report = self.audit.audit_catalogue([], source, {}, canonical)

        self.assertEqual(report["manual_nonaggregate_section_code_change_review_count"], 1)


if __name__ == "__main__":
    unittest.main()
