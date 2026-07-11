"""Regression tests for the additive unified catalogue builder."""

import importlib.util
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "build_catalogue_snapshot.py"


def load_module():
    name = "build_catalogue_snapshot_test_subject"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class CatalogueSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = load_module()
        self.history = [
            {"id": "api-2025", "course_code_base": "API-101", "year": 2025, "has_eval": True, "professor": "Allison, Graham"},
            {"id": "pal-2024", "course_code_base": "PAL-117", "year": 2024, "has_eval": True, "professor": "Allison, Graham"},
            {"id": "mld-average", "course_code_base": "MLD-717-M", "year": 0, "is_average": True, "has_eval": True, "professor": "Allison, Graham"},
            {"id": "related", "course_code_base": "DPI-802", "year": 2024, "has_eval": True, "professor": "Different, Professor"},
            {"id": "section", "course_code_base": "DPI-802-M", "year": 2024, "has_eval": True, "professor": "Allison, Graham"},
        ]
        self.aliases = {"PAL-117": "DPI-802-M", "MLD-717-M": "DPI-802-M"}

    def test_preserves_each_current_offering_id_even_when_codes_repeat(self):
        rows = self.snapshot.materialize_catalogue_snapshot(
            [
                {"id": "one", "school": "HKS", "course_code_base": "API-101", "instructors": ["Graham Allison"]},
                {"id": "two", "school": "HKS", "course_code_base": "API-101", "instructors": ["Graham Allison"]},
            ],
            self.history,
            self.aliases,
        )
        self.assertEqual([row["offering_id"] for row in rows], ["one", "two"])
        self.assertTrue(all(row["match_method"] == "exact_code_same_professor" for row in rows))

    def test_uses_only_the_reviewed_alias_registry_for_renumbered_courses(self):
        row = self.snapshot.materialize_catalogue_snapshot(
            [{"id": "current", "school": "HKS", "course_code_base": "DPI-803-M", "instructors": ["Graham Allison"]}], self.history, {"PAL-117": "DPI-803-M", "MLD-717-M": "DPI-803-M"}
        )[0]
        self.assertEqual(row["match_status"], "verified")
        self.assertEqual(row["match_method"], "approved_alias_same_professor")
        self.assertEqual(row["historical_course_codes"], ["MLD-717-M", "PAL-117"])
        self.assertEqual(row["evaluation_summary"], {
            "observed_offering_count": 1,
            "evaluated_offering_count": 1,
            "evaluation_years": [2024],
        })

    def test_nearby_suffixes_remain_unmatched_instead_of_inheriting_ratings(self):
        row = self.snapshot.materialize_catalogue_snapshot(
            [{"id": "suffix", "school": "HKS", "course_code_base": "DPI-802-M-D", "instructors": ["Graham Allison"]}], self.history, self.aliases
        )[0]
        self.assertEqual(row["match_status"], "needs_review")
        self.assertEqual(row["historical_records"], [])
        self.assertEqual(row["review_candidates"], [self.history[4]])

    def test_keeps_other_professors_as_course_history_without_attaching_their_ratings(self):
        row = self.snapshot.materialize_catalogue_snapshot(
            [{"id": "new-professor", "school": "HKS", "course_code_base": "API-101", "instructors": ["Different Professor"]}],
            self.history,
            self.aliases,
        )[0]
        self.assertEqual(row["match_status"], "course_only")
        self.assertEqual(row["match_method"], "exact_code_other_professor")
        self.assertEqual(row["historical_records"], [])
        self.assertEqual(row["course_history_records"], [self.history[0]])

    def test_non_hks_offerings_remain_current_only_without_legacy_enrichment(self):
        offering = {
            "id": "law-current",
            "school": "HLS",
            "course_code_base": "API-101",
            "title": "A similarly coded non-HKS course",
            "instructors": ["Graham Allison"],
            "credits": 3,
            "meeting_times": [{"day": "Monday", "start": "09:00"}],
        }
        row = self.snapshot.materialize_catalogue_snapshot([offering], self.history, self.aliases)[0]

        self.assertEqual(row["offering_id"], "law-current")
        self.assertEqual(row["match_status"], "not_applicable")
        self.assertEqual(row["match_method"], "non_hks_current_only")
        self.assertIsNone(row["canonical_course_code"])
        self.assertEqual(row["historical_course_codes"], [])
        self.assertEqual(row["historical_records"], [])
        self.assertEqual(row["course_history_records"], [])
        self.assertEqual(row["review_candidates"], [])
        self.assertEqual(row["renumbering_review_candidates"], [])
        self.assertEqual(row["evaluation_summary"]["evaluated_offering_count"], 0)

    def test_offering_without_a_verified_school_remains_current_only(self):
        row = self.snapshot.materialize_catalogue_snapshot(
            [{"id": "unknown-school", "course_code_base": "API-101", "instructors": ["Graham Allison"]}],
            self.history,
            self.aliases,
        )[0]

        self.assertEqual(row["match_status"], "not_applicable")
        self.assertEqual(row["match_method"], "non_hks_current_only")
        self.assertEqual(row["historical_records"], [])

    def test_rejects_missing_current_offering_ids_before_promotion(self):
        with self.assertRaisesRegex(ValueError, "immutable source id"):
            self.snapshot.materialize_catalogue_snapshot([{"course_code_base": "API-101"}], self.history, self.aliases)

    def test_same_professor_and_exact_title_under_new_code_is_review_only(self):
        history = [
            {
                "id": "old-code",
                "course_code_base": "DPI-700",
                "course_name": "Advanced Policy Design",
                "year": 2024,
                "has_eval": True,
                "professor": "Allison, Graham",
            }
        ]
        row = self.snapshot.materialize_catalogue_snapshot(
            [
                {
                    "id": "new-code",
                    "school": "HKS",
                    "course_code_base": "DPI-799",
                    "title": "Advanced Policy Design",
                    "instructors": ["Graham Allison"],
                }
            ],
            history,
            {},
        )[0]

        self.assertEqual(row["match_status"], "needs_review")
        self.assertEqual(row["match_method"], "suspected_renumbering_same_professor_title")
        self.assertEqual(row["historical_records"], [])
        self.assertEqual(row["evaluation_summary"]["evaluated_offering_count"], 0)
        self.assertEqual(row["renumbering_review_candidates"], history)

    def test_renumbering_review_wins_over_unrelated_same_code_history(self):
        history = [
            {
                "id": "same-code-other-professor",
                "course_code_base": "DPI-799",
                "course_name": "Different Course",
                "year": 2024,
                "has_eval": True,
                "professor": "Other, Professor",
            },
            {
                "id": "old-same-professor-code",
                "course_code_base": "DPI-700",
                "course_name": "Advanced Policy Design",
                "year": 2024,
                "has_eval": True,
                "professor": "Allison, Graham",
            },
        ]
        row = self.snapshot.materialize_catalogue_snapshot(
            [
                {
                    "id": "current-code",
                    "school": "HKS",
                    "course_code_base": "DPI-799",
                    "title": "Advanced Policy Design",
                    "instructors": ["Graham Allison"],
                }
            ],
            history,
            {},
        )[0]

        self.assertEqual(row["match_status"], "needs_review")
        self.assertEqual(row["match_method"], "suspected_renumbering_same_professor_title")
        self.assertEqual(row["historical_records"], [])
        self.assertEqual(row["course_history_records"], [history[0]])
        self.assertEqual(row["renumbering_review_candidates"], [history[1]])


if __name__ == "__main__":
    unittest.main()
