"""Contracts for lossless live-course meetings and failure alerting."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260726203607_store_live_course_meeting_intervals.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "sync-myharvard-hks.yml"


class MeetingIntervalsMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()
        cls.workflow = WORKFLOW.read_text(encoding="utf-8")

    def test_adds_lossless_meetings_and_wraps_both_atomic_sync_paths(self):
        self.assertIn("add column if not exists meetings jsonb", self.sql)
        self.assertIn("stage_myharvard_hks_offerings_without_meetings", self.sql)
        self.assertIn("sync_live_courses_atomically_without_meetings", self.sql)
        self.assertGreaterEqual(self.sql.count("set meetings = item.value -> 'meetings'"), 2)

    def test_keeps_privileged_wrappers_private(self):
        self.assertIn(
            "revoke all on function public.stage_myharvard_hks_offerings(uuid, jsonb)",
            self.sql,
        )
        self.assertIn(
            "revoke all on function public.sync_live_courses_atomically(jsonb)",
            self.sql,
        )
        self.assertEqual(self.sql.count("to service_role;"), 2)

    def test_daily_workflow_opens_and_recovers_a_durable_alert(self):
        self.assertIn("issues: write", self.workflow)
        self.assertIn("if: ${{ failure() }}", self.workflow)
        self.assertIn("gh issue create", self.workflow)
        self.assertIn("--assignee \"$ALERT_ASSIGNEE\"", self.workflow)
        self.assertIn("if: ${{ success() && (github.event_name == 'schedule' || inputs.promote) }}", self.workflow)
        self.assertIn("gh issue close", self.workflow)


if __name__ == "__main__":
    unittest.main()