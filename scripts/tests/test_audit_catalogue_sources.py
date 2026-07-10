"""Read-only source-audit contract tests."""

import importlib.util
import sys
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
                {"id": "current-a", "school": "HKS", "course_code_base": "API-101"},
                {"id": "current-b", "school": "HKS", "course_code_base": "DPI-802-M-D"},
                {"id": "other", "school": "FAS", "course_code_base": "GEN-1"},
            ],
            [{"id": "history-a", "course_code_base": "API-101", "has_eval": True}],
            {},
        )
        self.assertEqual(report["current_offering_count"], 3)
        self.assertEqual(report["hks_current_offering_count"], 2)
        self.assertEqual(report["hks_verified_history_count"], 1)
        self.assertEqual(report["hks_unmatched_history_count"], 1)
        self.assertEqual(report["unmatched_hks_codes"], ["DPI-802-M-D"])


if __name__ == "__main__":
    unittest.main()
