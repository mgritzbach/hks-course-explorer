"""Protect the production sync workflow's fail-closed coverage floor."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "sync-live-courses.yml"


class SyncWorkflowConfigTests(unittest.TestCase):
    def test_production_sync_sets_a_reviewed_catalogue_floor(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("SYNC_ALLOW_STALE_DELETE: 'false'", workflow)
        self.assertIn("SYNC_MIN_UNIQUE_COURSES: '1200'", workflow)

    def test_production_sync_serializes_manual_and_scheduled_promotions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("group: hks-live-courses-production-sync", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)


if __name__ == "__main__":
    unittest.main()
