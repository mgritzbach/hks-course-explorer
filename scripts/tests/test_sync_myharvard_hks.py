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
  <span>2026 Fall</span><span>Full Term</span>
  <!-- Week Days: To Be Announced --><span>To Be Announced</span>
</div>
"""

PENDING_DETAIL = """
<strong>Credits</strong><span>4</span>
<strong>Cross Reg</strong><p>Not Available for Cross Registration</p></div></div>
<div id="course-time">
  <div role="group" aria-label="Week Days">
    <div aria-label="Monday">M</div><div aria-label="Wednesday">W</div>
  </div>
</div><!-- End Time -->
"""

SCHEDULED_DETAIL = """
<strong>Credits</strong><span>4</span>
<strong>Cross Reg</strong><p>Available for Cross Registration</p></div></div>
<div id="course-time">
  <div role="group" aria-label="Week Days">
    <div aria-label="Wednesday, selected">W</div>
    <div aria-label="Monday, selected">M</div>
  </div>
  <div><span>10:30am - 11:45am</span></div>
</div><!-- End Time -->
"""

MULTI_INTERVAL_DETAIL = """
<strong>Credits</strong><span>4</span>
<strong>Cross Reg</strong><p>Available for Cross Registration</p></div></div>
<div id="course-time">
  <div role="group" aria-label="Week Days">
    <div aria-label="Tuesday, selected">T</div>
    <div aria-label="Thursday, selected">Th</div>
  </div>
  <div><span>9:00am - 10:15am</span></div>
  <div role="group" aria-label="Week Days">
    <div aria-label="Tuesday, selected">T</div>
  </div>
  <div><span>4:30pm - 5:45pm</span></div>
</div><!-- End Time -->
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
        self.assertTrue(rows[0]["_schedule_pending_advertised"])

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
        self.assertFalse(session.get.call_args.kwargs["allow_redirects"])

    def test_retries_invalid_and_incomplete_search_payloads_before_returning(self):
        invalid = Mock(ok=True, status_code=200)
        invalid.json.return_value = {"unexpected": "payload"}
        incomplete = Mock(ok=True, status_code=200)
        incomplete.json.return_value = {"total_hits": 0, "hits": ""}
        complete = Mock(ok=True, status_code=200)
        complete.json.return_value = {"total_hits": 1, "hits": CARD}
        session = Mock()
        session.get.side_effect = [invalid, incomplete, complete]

        with patch.object(self.sync.time, "sleep") as sleep:
            rows = self.sync.fetch_all_hks_offerings(session)

        self.assertEqual(len(rows), 1)
        self.assertEqual(session.get.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_retries_changed_pagination_total_without_mixing_snapshots(self):
        first = Mock(ok=True, status_code=200)
        first.json.return_value = {"total_hits": 2, "hits": CARD}
        changed = Mock(ok=True, status_code=200)
        changed.json.return_value = {
            "total_hits": 3,
            "hits": CARD.replace("170000", "170009").replace("/A", "/Z"),
        }
        restarted_first = Mock(ok=True, status_code=200)
        restarted_first.json.return_value = {
            "total_hits": 2,
            "hits": CARD.replace("170000", "170010").replace("/A", "/C"),
        }
        restarted_second = Mock(ok=True, status_code=200)
        restarted_second.json.return_value = {
            "total_hits": 2,
            "hits": CARD.replace("170000", "170011").replace("/A", "/D"),
        }
        session = Mock()
        session.get.side_effect = [first, changed, restarted_first, restarted_second]

        with patch.object(self.sync.time, "sleep") as sleep:
            rows = self.sync.fetch_all_hks_offerings(session)

        self.assertEqual({row["source_course_id"] for row in rows}, {"170010", "170011"})
        self.assertNotIn("170000", {row["source_course_id"] for row in rows})
        self.assertEqual(session.get.call_count, 4)
        sleep.assert_called_once()

    def test_exhausted_invalid_search_never_reaches_staging(self):
        invalid_responses = []
        for _ in range(self.sync.SEARCH_MAX_ATTEMPTS):
            response = Mock(ok=True, status_code=200)
            response.json.return_value = {"total_hits": 0, "hits": ""}
            invalid_responses.append(response)
        session = Mock()
        session.get.side_effect = invalid_responses

        with patch.object(self.sync.time, "sleep"):
            with self.assertRaisesRegex(RuntimeError, "after 3 attempts"):
                self.sync.fetch_all_hks_offerings(session)

        self.assertEqual(session.get.call_count, self.sync.SEARCH_MAX_ATTEMPTS)

    def test_main_search_failure_prevents_inventory_stage_and_promotion(self):
        with (
            patch.object(
                self.sync,
                "fetch_all_hks_offerings",
                side_effect=RuntimeError("search exhausted"),
            ),
            patch.object(self.sync, "enrich_offering_details") as enrich,
            patch.object(self.sync, "fetch_active_hks_schedule_inventory") as inventory,
            patch.object(self.sync, "stage") as stage,
            patch.object(self.sync, "promote_and_verify") as promote,
        ):
            with self.assertRaisesRegex(RuntimeError, "search exhausted"):
                self.sync.main()

        enrich.assert_not_called()
        inventory.assert_not_called()
        stage.assert_not_called()
        promote.assert_not_called()

    def test_search_rejects_redirects_without_retry(self):
        redirect = Mock(ok=False, status_code=302)
        session = Mock()
        session.get.return_value = redirect

        with patch.object(self.sync.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "search redirect was refused"):
                self.sync.fetch_all_hks_offerings(session)

        session.get.assert_called_once()
        sleep.assert_not_called()

    def test_search_rejects_changed_final_url_and_nonretryable_http(self):
        changed = Mock(
            ok=True,
            status_code=200,
            url="https://other.example/search/?school=HKS",
        )
        session = Mock()
        session.get.return_value = changed
        with patch.object(self.sync.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "search response URL changed"):
                self.sync.fetch_all_hks_offerings(session)
        session.get.assert_called_once()
        sleep.assert_not_called()

        wrong_query = Mock(
            ok=True,
            status_code=200,
            url=(
                "https://my.harvard.edu/search/"
                "?q=&school=FAS&term=All&sort=subject_catalog&page=99&browseSchool=true"
            ),
        )
        session = Mock()
        session.get.return_value = wrong_query
        with patch.object(self.sync.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "search response URL changed"):
                self.sync.fetch_all_hks_offerings(session)
        session.get.assert_called_once()
        sleep.assert_not_called()

        denied = Mock(ok=False, status_code=403)
        denied.raise_for_status.side_effect = self.sync.requests.HTTPError("forbidden")
        session = Mock()
        session.get.return_value = denied
        with patch.object(self.sync.time, "sleep") as sleep:
            with self.assertRaises(self.sync.requests.HTTPError):
                self.sync.fetch_all_hks_offerings(session)
        session.get.assert_called_once()
        sleep.assert_not_called()

    def test_parses_exact_credits_and_cross_registration_status(self):
        details = self.sync.parse_course_details(PENDING_DETAIL, pending_advertised=True)

        self.assertEqual(
            details,
            {
                "credits": 4.0,
                "cross_reg_eligible": "NOXREG",
                "location": "",
                "meetings": [],
                "meeting_days": "",
                "time_start": "",
                "time_end": "",
            },
        )

    def test_parses_real_myharvard_selected_day_and_time_contract(self):
        schedule = self.sync.parse_course_schedule(SCHEDULED_DETAIL)

        self.assertEqual(schedule["state"], "scheduled")
        self.assertEqual(schedule["meeting_days"], "MON/WED")
        self.assertEqual(schedule["time_start"], "10:30")
        self.assertEqual(schedule["time_end"], "11:45")
        self.assertEqual(
            schedule["meetings"],
            [
                {"day": "MON", "start": "10:30", "end": "11:45", "location": ""},
                {"day": "WED", "start": "10:30", "end": "11:45", "location": ""},
            ],
        )

    def test_preserves_multiple_published_meeting_intervals(self):
        schedule = self.sync.parse_course_schedule(MULTI_INTERVAL_DETAIL)

        self.assertEqual(schedule["state"], "scheduled")
        self.assertEqual(schedule["meeting_days"], "TUE/THU")
        self.assertEqual(schedule["time_start"], "")
        self.assertEqual(schedule["time_end"], "")
        self.assertEqual(
            schedule["meetings"],
            [
                {"day": "TUE", "start": "09:00", "end": "10:15", "location": ""},
                {"day": "THU", "start": "09:00", "end": "10:15", "location": ""},
                {"day": "TUE", "start": "16:30", "end": "17:45", "location": ""},
            ],
        )

    def test_tba_schedule_is_valid_pending_and_retained(self):
        schedule = self.sync.parse_course_schedule(PENDING_DETAIL, pending_advertised=True)

        self.assertEqual(schedule["state"], "pending")
        self.assertEqual(schedule["meetings"], [])
        self.assertEqual(schedule["meeting_days"], "")

        with self.assertRaisesRegex(self.sync.ScheduleParseError, "without an explicit TBA"):
            self.sync.parse_course_schedule(PENDING_DETAIL)

    def test_rejects_partial_reversed_and_multi_interval_schedules(self):
        selected_without_time = SCHEDULED_DETAIL.replace(
            '<div><span>10:30am - 11:45am</span></div>', ""
        )
        time_without_selected = SCHEDULED_DETAIL.replace(", selected", "")
        reversed_time = SCHEDULED_DETAIL.replace("10:30am - 11:45am", "11:45am - 10:30am")
        multiple_times = SCHEDULED_DETAIL.replace(
            "10:30am - 11:45am", "10:30am - 11:45am 12:00pm - 1:00pm"
        )

        for malformed in (
            selected_without_time,
            time_without_selected,
            reversed_time,
            multiple_times,
        ):
            with self.subTest(malformed=malformed):
                with self.assertRaises(self.sync.ScheduleParseError):
                    self.sync.parse_course_schedule(malformed)

    def test_fetches_and_applies_schedule_per_exact_offering_url(self):
        second_card = (
            CARD.replace("170000", "170001")
            .replace("/A\"", "/B\"")
            .replace("Resources and Incentives", "Resources and Incentives B")
        )
        rows = self.sync.parse_cards(CARD + second_card)

        def get_detail(url, **_kwargs):
            response = Mock(ok=True, status_code=200)
            response.text = SCHEDULED_DETAIL if url.endswith("/A") else PENDING_DETAIL
            return response

        with patch.object(self.sync.requests, "get", side_effect=get_detail) as request_get:
            enriched = self.sync.enrich_offering_details(rows)

        by_section = {row["section_code"]: row for row in enriched}
        self.assertEqual(by_section["A"]["meeting_days"], "MON/WED")
        self.assertEqual(by_section["B"]["meeting_days"], "")
        self.assertNotIn("_schedule_pending_advertised", by_section["A"])
        self.assertNotIn("_schedule_pending_advertised", by_section["B"])
        self.assertEqual(request_get.call_count, 2)
        self.assertEqual(self.sync.count_schedule_states(enriched), (1, 1))

    def test_rejects_one_source_url_owned_by_distinct_offering_identities(self):
        rows = self.sync.parse_cards(
            CARD + CARD.replace("170000", "170001").replace("/A\"", "/B\"")
        )
        rows[1]["source_url"] = rows[0]["source_url"]

        with patch.object(self.sync.requests, "get") as request_get:
            with self.assertRaisesRegex(self.sync.ScheduleParseError, "share one source URL"):
                self.sync.enrich_offering_details(rows)
        request_get.assert_not_called()

    def test_detail_fetch_retries_only_transient_failures(self):
        transient = Mock(ok=False, status_code=503)
        source_url = "https://my.harvard.edu/course/example"
        success = Mock(ok=True, status_code=200, text=PENDING_DETAIL, url=source_url)
        with (
            patch.object(self.sync.requests, "get", side_effect=[transient, success]) as request_get,
            patch.object(self.sync.time, "sleep") as sleep,
        ):
            html = self.sync.fetch_detail_html(source_url)

        self.assertEqual(html, PENDING_DETAIL)
        self.assertEqual(request_get.call_count, 2)
        self.assertFalse(request_get.call_args.kwargs["allow_redirects"])
        sleep.assert_called_once()

        denied = Mock(ok=False, status_code=403)
        denied.raise_for_status.side_effect = self.sync.requests.HTTPError("forbidden")
        with patch.object(self.sync.requests, "get", return_value=denied) as request_get:
            with self.assertRaises(self.sync.requests.HTTPError):
                self.sync.fetch_detail_html("https://my.harvard.edu/course/denied")
        request_get.assert_called_once()

    def test_detail_fetch_rejects_redirects_and_changed_final_urls(self):
        redirect = Mock(ok=False, status_code=302, url="https://my.harvard.edu/course/other")
        with patch.object(self.sync.requests, "get", return_value=redirect) as request_get:
            with self.assertRaisesRegex(RuntimeError, "redirect was refused"):
                self.sync.fetch_detail_html("https://my.harvard.edu/course/original")
        request_get.assert_called_once()

        changed = Mock(
            ok=True,
            status_code=200,
            text=PENDING_DETAIL,
            url="https://my.harvard.edu/course/other",
        )
        with patch.object(self.sync.requests, "get", return_value=changed) as request_get:
            with self.assertRaisesRegex(RuntimeError, "response URL changed"):
                self.sync.fetch_detail_html("https://my.harvard.edu/course/original")
        request_get.assert_called_once()

    def test_schedule_partition_rejects_partial_normalized_rows(self):
        row = self.sync.parse_cards(CARD)[0]
        row.update({"meeting_days": "MON", "time_start": "10:30", "time_end": ""})

        with self.assertRaisesRegex(self.sync.ScheduleParseError, "partial normalized"):
            self.sync.count_schedule_states([row])

    def test_refuses_to_blank_a_previously_scheduled_exact_offering(self):
        pending = self.sync.parse_cards(CARD)[0]
        pending.pop("_schedule_pending_advertised")

        with self.assertRaisesRegex(self.sync.ScheduleParseError, "previously scheduled"):
            self.sync.verify_schedule_non_regression([pending], {pending["id"]: True})

        # A retired identity is outside the new authoritative set and does not
        # block a normal term turnover; exact identity overlap is the guard.
        self.sync.verify_schedule_non_regression([pending], {"retired-offering": True})

    def test_reads_only_complete_authoritative_schedule_baselines(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [
            {
                "id": "active-one",
                "source_offering_id": "myh|one",
                "source": "myharvard",
                "meeting_days": "MON/WED",
                "time_start": "10:30",
                "time_end": "11:45",
            },
            {
                "id": "active-two",
                "source_offering_id": "myh|two",
                "source": "myharvard",
                "meeting_days": "",
                "time_start": "",
                "time_end": "",
            },
            {
                "id": "legacy-ats",
                "source_offering_id": "",
                "source": "ats",
                "meeting_days": "MON",
                "time_start": "09:00",
                "time_end": "10:00",
            },
        ]

        inventory = self.sync.fetch_active_hks_schedule_inventory(Mock(return_value=response))

        self.assertEqual(inventory, {"myh|one": True, "myh|two": False})

    def test_stages_before_optional_promotion(self):
        run_response = Mock(ok=True, content=b"yes")
        run_response.json.return_value = [{"id": "run-id"}]
        stage_response = Mock(ok=True, content=b"yes")
        stage_response.json.return_value = 1

        rows = self.sync.parse_cards(CARD)
        rows[0].pop("_schedule_pending_advertised")
        with patch.object(self.sync.requests, "post", side_effect=[run_response, stage_response]) as post:
            run_id, staged = self.sync.stage(rows)

        self.assertEqual((run_id, staged), ("run-id", 1))
        self.assertIn("live_catalogue_runs", post.call_args_list[0].args[0])
        self.assertIn("stage_myharvard_hks_offerings", post.call_args_list[1].args[0])
        run_manifest = post.call_args_list[0].kwargs["json"]
        self.assertEqual(len(run_manifest["identity_sha256"]), 64)
        self.assertEqual(run_manifest["term_counts"], {"2026 Fall": 1})

        with self.assertRaisesRegex(RuntimeError, "must not be staged"):
            self.sync.stage(self.sync.parse_cards(CARD))

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
