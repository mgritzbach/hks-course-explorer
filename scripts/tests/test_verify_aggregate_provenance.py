import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "verify_aggregate_provenance.py"


def load_module():
    spec = importlib.util.spec_from_file_location("aggregate_provenance_test_subject", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AggregateProvenanceTests(unittest.TestCase):
    def test_verifies_only_a_recomputed_average_digest(self):
        audit = load_module()
        source = {
            "id": "API-101-A||0||Average||Saavedra, Juan",
            "course_code": "API-101-A",
            "year": 0,
            "term": "Average",
            "professor": "Saavedra, Juan",
            "course_name": "Resources",
            "is_average": True,
            "year_range": "2021-2024",
            "n_terms": 3,
        }
        generated = audit.generated_aggregate_id(source)
        result = audit.verify_aggregate_provenance([source], [{"id": generated, "is_average": True}])
        self.assertEqual(result["verified_generated_aggregate_count"], 1)
        self.assertEqual(result["missing_generated_aggregate_count"], 0)

    def test_keeps_non_aggregate_section_changes_out_of_provenance(self):
        audit = load_module()
        source = {
            "id": "DPI-820-M-A||2025||Fall||Example, Avery",
            "course_code": "DPI-820-M-A",
            "year": 2025,
            "term": "Fall",
            "professor": "Example, Avery",
            "course_name": "Policy",
            "is_average": False,
        }
        result = audit.verify_aggregate_provenance([source], [])
        self.assertEqual(result["aggregate_source_count"], 0)
        self.assertEqual(result["verified_generated_aggregate_count"], 0)

    def test_rejects_an_aggregate_row_with_an_unrelated_source_id(self):
        audit = load_module()
        source = {
            "id": "manual-id",
            "course_code": "API-101-A",
            "year": 0,
            "term": "Average",
            "professor": "Saavedra, Juan",
            "course_name": "Resources",
            "is_average": True,
            "year_range": "2021-2024",
            "n_terms": 3,
        }
        generated = audit.generated_aggregate_id(source)
        result = audit.verify_aggregate_provenance([source], [{"id": generated, "is_average": True}])
        self.assertEqual(result["verified_generated_aggregate_count"], 0)
        self.assertEqual(result["invalid_generated_aggregate_count"], 1)
