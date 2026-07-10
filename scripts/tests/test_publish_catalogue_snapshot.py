"""Safety tests for the opt-in snapshot publisher."""

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
MODULE_PATH = SCRIPTS / "publish_catalogue_snapshot.py"


def load_module():
    name = "publish_catalogue_snapshot_test_subject"
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


class PublishCatalogueSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.publisher = load_module()

    def test_is_disabled_by_default(self):
        with patch.dict(os.environ, {"CATALOGUE_SNAPSHOT_ENABLED": "false"}, clear=False):
            self.assertFalse(self.publisher.enabled())

    def test_database_rows_preserve_current_offering_and_verified_match_evidence(self):
        rows = self.publisher.snapshot_database_rows(
            "run-1",
            [
                {
                    "offering_id": "live-1",
                    "course_code": "API-101",
                    "course_code_base": "API-101",
                    "term": "2026 Fall",
                    "school": "HKS",
                    "title": "Policy Analysis",
                    "instructors": ["Example"],
                    "canonical_course_code": "API-101",
                    "match_status": "verified",
                    "match_method": "exact_code",
                    "historical_course_codes": ["API-101"],
                    "evaluation_summary": {"evaluated_offering_count": 1},
                    "historical_records": [{"id": "history-1"}],
                }
            ],
            {"live-1": {"id": "live-1", "raw": "source"}},
        )
        self.assertEqual(rows[0]["sync_run_id"], "run-1")
        self.assertEqual(rows[0]["current_offering"], {"id": "live-1", "raw": "source"})
        self.assertEqual(rows[0]["match_method"], "exact_code")


if __name__ == "__main__":
    unittest.main()
