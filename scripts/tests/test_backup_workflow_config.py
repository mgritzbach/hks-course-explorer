"""Static safety checks for the manual encrypted backup workflow."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = ROOT / ".github" / "workflows" / "backup-live-courses.yml"


class BackupWorkflowConfigTests(unittest.TestCase):
    def test_refuses_plaintext_artifacts_without_a_dedicated_secret(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")

        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("confirm_backup:", workflow)
        self.assertIn("BACKUP_ARTIFACT_PASSPHRASE", workflow)
        self.assertIn("refusing plaintext backup upload", workflow)
        self.assertIn("openssl enc -aes-256-cbc", workflow)
        self.assertIn("-pbkdf2 -iter 600000", workflow)
        self.assertIn("live-courses-backup.json.enc", workflow)
        self.assertNotIn("path: ${{ runner.temp }}/live-courses-backup.json\n", workflow)


if __name__ == "__main__":
    unittest.main()
