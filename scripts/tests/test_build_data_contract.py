"""Pure contract tests for generated catalogue identity diagnostics."""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "build_data.py"


def load_module():
    name = "build_data_test_subject"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class BuildDataContractTests(unittest.TestCase):
    def test_duplicate_ids_are_reported_in_stable_order(self):
        build_data = load_module()
        courses = [{"id": "b"}, {"id": "a"}, {"id": "b"}, {"id": "a"}, {"id": "c"}]
        self.assertEqual(build_data.find_duplicate_course_ids(courses), ["a", "b"])

    def test_distinct_aggregate_windows_get_distinct_stable_ids(self):
        build_data = load_module()
        shared = {
            "course_code": "DPI-200-A",
            "year": "0",
            "term": "Average",
            "professor": "Example, Avery",
            "course_name": "Policy Analysis",
        }
        early = {**shared, "year_range": "2021-2022", "n_terms": "2"}
        recent = {**shared, "year_range": "2024-2025", "n_terms": "2"}

        early_id = build_data.stable_course_id(
            early, "DPI-200-A", 0, "Average", "Example, Avery", "Policy Analysis"
        )
        recent_id = build_data.stable_course_id(
            recent, "DPI-200-A", 0, "Average", "Example, Avery", "Policy Analysis"
        )

        self.assertNotEqual(early_id, recent_id)
        self.assertTrue(early_id.startswith("DPI-200-A||0||Average||Example, Avery||aggregate-"))

    def test_non_aggregate_identity_stays_backward_compatible(self):
        build_data = load_module()
        self.assertEqual(
            build_data.stable_course_id({}, "API-101", 2025, "Spring", "Example, Avery", "Policy"),
            "API-101||2025||Spring||Example, Avery",
        )

    def test_complementary_duplicate_rows_merge_without_losing_evaluation_or_bid_fields(self):
        build_data = load_module()
        evaluation = {
            "course_code": "MLD-621",
            "year": "2017",
            "term": "Spring",
            "professor": "Example, Avery",
            "course_name": "Innovation Field Lab: Public Problem Solving",
            "has_eval": "True",
            "has_bidding": "False",
            "Course_Rating": "4.2",
            "bid_clearing_price": "",
        }
        bidding = {
            **evaluation,
            "course_name": "Innovation Field Lab: Public Problem Solving in Massachusetts",
            "has_eval": "False",
            "has_bidding": "True",
            "Course_Rating": "",
            "bid_clearing_price": "100",
        }

        rows, merged_count = build_data._merge_complementary_rows([evaluation, bidding])

        self.assertEqual(merged_count, 1)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["course_name"], bidding["course_name"])
        self.assertEqual(rows[0]["has_eval"], "True")
        self.assertEqual(rows[0]["has_bidding"], "True")
        self.assertEqual(rows[0]["Course_Rating"], "4.2")
        self.assertEqual(rows[0]["bid_clearing_price"], "100")

    def test_conflicting_duplicate_rows_remain_for_operator_review(self):
        build_data = load_module()
        first = {"course_code": "API-101", "year": "2025", "term": "Spring", "professor": "Example", "Course_Rating": "4.1"}
        conflicting = {**first, "Course_Rating": "3.1"}

        rows, merged_count = build_data._merge_complementary_rows([first, conflicting])

        self.assertEqual(merged_count, 0)
        self.assertEqual(rows, [first, conflicting])


if __name__ == "__main__":
    unittest.main()
