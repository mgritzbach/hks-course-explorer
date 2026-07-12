"""Tests for complete section-level my.harvard HKS synchronization."""

import importlib.util
import os
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "sync_myharvard_hks.py"


def load_module():
    name = "sync_myharvard_hks_test_subject"
    sys.modules.pop(name, None)
    with patch.dict(
        os.environ,
        {
            "SUPABASE_URL": "https://example.supabase.co",
            "SUPABASE_KEY": "service-key",
            "MYHARVARD_MIN_HKS_OFFERINGS": "1",
        },
        clear=False,
    ):
        spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module


CARD = """
<div class="course-card panel" data-course-id="170000" data-crse-offer-nbr="1">
  <h2><a href="/course/API101/2026-Fall/A">Resources and Incentives</a></h2>
  <a href="/instructor/one"><span>J</span><span class="link-body">Juan Saavedra</span></a>
  <div class="course-description"><p>Microeconomic reasoning.</p></div>
  <span>2026 Fall</span><span>Full Term</span><span>To Be Announced</span>
</div>
"""


class MyHarvardSyncTests(unittest.TestCase):
    def setUp(self):
        self.sync = load_module()

    def test_parses_section_identity_and_student_visible_fields(self):
        rows = self.sync.parse_cards(CARD)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["id"], "myh|HKS|2026-Fall|170000|1|A")
        self.assertEqual(rows[0]["course_code"], "API-101-A")
        self.assertEqual(rows[0]["course_code_base"], "API-101")
        self.assertEqual(rows[0]["term"], "2026 Fall")
        self.assertEqual(rows[0]["session_description"], "Full Term")
        self.assertIn("Juan Saavedra", rows[0]["instructors"])

    def test_formats_modular_and_year_long_suffixes_for_legacy_linking(self):
        self.assertEqual(self.sync.format_base_code("DPI810M"), "DPI-810-M")
        self.assertEqual(self.sync.format_base_code("SUP150Y"), "SUP-150-Y")

    def test_separates_demand_split_display_from_legacy_history_base(self):
        split_card = CARD.replace("API101", "MLD201A").replace("/A\"", "/001\"")
        row = self.sync.parse_cards(split_card)[0]
        self.assertEqual(row["course_code"], "MLD-201-A")
        self.assertEqual(row["course_code_base"], "MLD-201")

    def test_normalizes_leading_hyphen_section_without_losing_source_identity(self):
        section_card = CARD.replace("API101", "DEV401Y").replace("/A\"", "/-1\"")
        row = self.sync.parse_cards(section_card)[0]
        self.assertEqual(row["course_code"], "DEV-401-Y-1")
        self.assertEqual(row["course_code_base"], "DEV-401-Y")
        self.assertTrue(row["id"].endswith("|-1"))
        self.assertEqual(row["section_code"], "1")

    def test_requires_every_advertised_page_and_identity(self):
        first = Mock()
        first.raise_for_status.return_value = None
        first.json.return_value = {"total_hits": 2, "hits": CARD}
        second = Mock()
        second.raise_for_status.return_value = None
        second.json.return_value = {
            "total_hits": 2,
            "hits": CARD.replace("170000", "170001").replace("/A", "/B"),
        }
        session = Mock()
        session.get.side_effect = [first, second]

        rows = self.sync.fetch_all_hks_offerings(session)

        self.assertEqual(len(rows), 2)
        self.assertEqual(len({row["id"] for row in rows}), 2)
        self.assertEqual(session.get.call_count, 2)

    def test_parses_exact_credits_and_cross_registration_status(self):
        details = self.sync.parse_course_details(
            '<strong>Credits</strong><span>4</span>'
            '<strong>Cross Reg</strong><p>Not Available for Cross Registration</p></div></div>'
        )

        self.assertEqual(details, {"credits": 4.0, "cross_reg_eligible": "NOXREG"})

    def test_stages_before_optional_promotion(self):
        run_response = Mock(ok=True, content=b"yes")
        run_response.json.return_value = [{"id": "run-id"}]
        stage_response = Mock(ok=True, content=b"yes")
        stage_response.json.return_value = 1

        with patch.object(self.sync.requests, "post", side_effect=[run_response, stage_response]) as post:
            run_id, staged = self.sync.stage(self.sync.parse_cards(CARD))

        self.assertEqual((run_id, staged), ("run-id", 1))
        self.assertIn("live_catalogue_runs", post.call_args_list[0].args[0])
        self.assertIn("stage_myharvard_hks_offerings", post.call_args_list[1].args[0])


if __name__ == "__main__":
    unittest.main()
