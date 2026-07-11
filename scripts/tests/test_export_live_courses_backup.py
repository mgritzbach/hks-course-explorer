"""Regression tests for the read-only live-course backup artifact."""

import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "export_live_courses_backup.py"


def load_module():
    name = "export_live_courses_backup_test_subject"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class ExportLiveCoursesBackupTests(unittest.TestCase):
    def setUp(self):
        self.backup = load_module()
        self.rows = [{"id": "a", "title": "Alpha"}, {"id": "b", "title": "Bravo"}]
        self.now = datetime(2026, 7, 11, 12, 0, tzinfo=timezone.utc)

    def test_writes_manifest_with_a_deterministic_payload_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "live-courses.json"
            result = self.backup.write_backup(
                output,
                "https://project.supabase.co/",
                "service-key-is-not-written",
                fetch_rows=lambda *_: self.rows,
                now=self.now,
            )

            payload = json.loads(output.read_text(encoding="utf-8"))
            expected_digest = hashlib.sha256(self.backup.canonical_payload_bytes(self.rows)).hexdigest()
            self.assertEqual(result, {"row_count": 2, "payload_sha256": expected_digest})
            self.assertEqual(payload["format"], "hks-live-courses-backup-v1")
            self.assertEqual(payload["created_at"], "2026-07-11T12:00:00+00:00")
            self.assertEqual(payload["project_url"], "https://project.supabase.co")
            self.assertEqual(payload["row_count"], 2)
            self.assertEqual(payload["payload_sha256"], expected_digest)
            self.assertEqual(payload["rows"], self.rows)
            self.assertNotIn("service-key-is-not-written", output.read_text(encoding="utf-8"))

    def test_refuses_relative_or_overwrite_destinations_before_fetching(self):
        fetch_calls = []
        with self.assertRaisesRegex(ValueError, "absolute"):
            self.backup.write_backup(
                "relative.json", "https://project.supabase.co", "key", fetch_rows=lambda *_: fetch_calls.append(1)
            )
        self.assertEqual(fetch_calls, [])

        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "existing.json"
            output.write_text("existing", encoding="utf-8")
            with self.assertRaisesRegex(FileExistsError, "overwrite"):
                self.backup.write_backup(
                    output, "https://project.supabase.co", "key", fetch_rows=lambda *_: fetch_calls.append(1)
                )
        self.assertEqual(fetch_calls, [])


if __name__ == "__main__":
    unittest.main()
