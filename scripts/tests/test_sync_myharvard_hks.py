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
        run_manifest = post.call_args_list[0].kwargs["json"]
        self.assertEqual(len(run_manifest["identity_sha256"]), 64)
        self.assertEqual(run_manifest["term_counts"], {"2026 Fall": 1})

    def test_reads_every_active_hks_identity_with_stable_pagination(self):
        self.sync.SUPABASE_PAGE_SIZE = 1
        first = Mock()
        first.raise_for_status.return_value = None
        first.json.return_value = [
            {"source_offering_id": "myh|one", "source": "myharvard"}
        ]
        second = Mock()
        second.raise_for_status.return_value = None
        second.json.return_value = [
            {"source_offering_id": "myh|two", "source": "myharvard"}
        ]
        final = Mock()
        final.raise_for_status.return_value = None
        final.json.return_value = []
        request_get = Mock(side_effect=[first, second, final])

        inventory = self.sync.fetch_active_hks_inventory(request_get)

        self.assertEqual(inventory, {"myh|one": "myharvard", "myh|two": "myharvard"})
        self.assertEqual(request_get.call_args_list[1].kwargs["params"]["offset"], "1")

    def test_reads_a_legacy_ats_rollback_baseline_without_upstream_identities(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [{"id": "legacy-ats-row", "source": "ats"}]

        inventory = self.sync.fetch_active_hks_storage_inventory(Mock(return_value=response))

        self.assertEqual(inventory, {"legacy-ats-row": "ats"})

    def test_requires_exact_authoritative_upstream_to_production_identity_set(self):
        rows = self.sync.parse_cards(CARD)
        offering_id = rows[0]["id"]

        digest = self.sync.verify_promoted_inventory(rows, {offering_id: "myharvard"})

        self.assertEqual(len(digest), 64)
        with self.assertRaisesRegex(RuntimeError, "missing=1, extra=1"):
            self.sync.verify_promoted_inventory(rows, {"myh|unexpected": "myharvard"})
        with self.assertRaisesRegex(RuntimeError, "non_authoritative=1"):
            self.sync.verify_promoted_inventory(rows, {offering_id: "ats"})

    def test_post_promotion_mismatch_rolls_back_and_restores_exact_previous_inventory(self):
        rows = self.sync.parse_cards(CARD)
        previous = {"myh|previous": "myharvard"}
        mismatched = {"myh|unexpected": "myharvard"}

        with (
            patch.object(self.sync, "fetch_active_hks_storage_inventory", side_effect=[previous, previous]),
            patch.object(self.sync, "fetch_active_hks_inventory", return_value=mismatched),
            patch.object(self.sync, "promote", return_value=1) as promote,
            patch.object(self.sync, "rollback", return_value=1) as rollback,
        ):
            with self.assertRaisesRegex(RuntimeError, "exact previous HKS catalogue was restored"):
                self.sync.promote_and_verify(rows, "run-id")

        promote.assert_called_once_with("run-id")
        rollback.assert_called_once_with("run-id")

    def test_first_authoritative_promotion_accepts_a_legacy_ats_rollback_baseline(self):
        rows = self.sync.parse_cards(CARD)
        offering_id = rows[0]["id"]

        with (
            patch.object(
                self.sync,
                "fetch_active_hks_storage_inventory",
                return_value={"legacy-ats-row": "ats"},
            ),
            patch.object(
                self.sync,
                "fetch_active_hks_inventory",
                return_value={offering_id: "myharvard"},
            ),
            patch.object(self.sync, "promote", return_value=1),
            patch.object(self.sync, "rollback") as rollback,
        ):
            activated, digest = self.sync.promote_and_verify(rows, "run-id")

        self.assertEqual(activated, 1)
        self.assertEqual(len(digest), 64)
        rollback.assert_not_called()

    def test_failed_first_promotion_restores_the_exact_legacy_ats_baseline(self):
        rows = self.sync.parse_cards(CARD)
        legacy = {"legacy-ats-row": "ats"}

        with (
            patch.object(
                self.sync,
                "fetch_active_hks_storage_inventory",
                side_effect=[legacy, legacy],
            ),
            patch.object(
                self.sync,
                "fetch_active_hks_inventory",
                return_value={"unexpected-offering": "myharvard"},
            ),
            patch.object(self.sync, "promote", return_value=1),
            patch.object(self.sync, "rollback", return_value=1) as rollback,
        ):
            with self.assertRaisesRegex(RuntimeError, "exact previous HKS catalogue was restored"):
                self.sync.promote_and_verify(rows, "run-id")

        rollback.assert_called_once_with("run-id")


if __name__ == "__main__":
    unittest.main()
