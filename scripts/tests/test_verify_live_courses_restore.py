"""Contracts for the encrypted backup PostgreSQL restore probe."""

from __future__ import annotations

import csv
import hashlib
import json
import tempfile
import unittest
from pathlib import Path

from scripts.live_courses_backup_format import BACKUP_FORMAT, canonical_payload_bytes
from scripts.verify_live_courses_restore import (
    MAX_RESTORED_PAYLOAD_CHARS,
    load_backup,
    read_restored_rows,
    verify_restored_rows,
    write_restore_csv,
)


class LiveCoursesRestoreVerificationTests(unittest.TestCase):
    def setUp(self):
        self.project_url = "https://production-ref.supabase.co"
        self.rows = [
            self.live_course_row(
                "course-1",
                title="Policy, data and evidence",
                credits=4.0,
                instructors=["Ada Lovelace"],
                sync_run_id="11111111-1111-1111-1111-111111111111",
            ),
            self.live_course_row(
                "course-2",
                title="Institutions\nand leadership",
                credits=None,
                instructors=[],
                sync_run_id=None,
            ),
        ]
        self.payload = {
            "format": BACKUP_FORMAT,
            "created_at": "2026-07-12T12:00:00+00:00",
            "project_url": self.project_url,
            "row_count": len(self.rows),
            "payload_sha256": hashlib.sha256(canonical_payload_bytes(self.rows)).hexdigest(),
            "rows": self.rows,
        }

    @staticmethod
    def live_course_row(row_id, **overrides):
        row = {
            "id": row_id,
            "course_code": "API-101",
            "course_code_base": "API-101",
            "title": "Course title",
            "term": "2026 Fall",
            "credits": 4.0,
            "instructors": [],
            "description": "",
            "location": "",
            "meeting_days": "",
            "time_start": "",
            "time_end": "",
            "school": "HKS",
            "is_hks": True,
            "synced_at": "2026-07-12T12:00:00+00:00",
            "session_code": "1",
            "session_description": "Full Term",
            "cross_reg_eligible": "YESXREG",
            "source": "myharvard",
            "source_course_id": "API101",
            "course_offer_nbr": "1",
            "section_code": "001",
            "source_url": "https://my.harvard.edu/course/API101/2026-Fall/001",
            "sync_run_id": None,
            "active": True,
            "source_offering_id": row_id,
        }
        row.update(overrides)
        return row

    def write_backup(self, directory: str) -> Path:
        path = Path(directory) / "backup.json"
        path.write_text(json.dumps(self.payload), encoding="utf-8")
        return path

    def test_validates_manifest_and_round_trips_csv_safe_payloads(self):
        with tempfile.TemporaryDirectory() as directory:
            backup_path = self.write_backup(directory)
            backup = load_backup(backup_path, self.project_url)
            csv_path = Path(directory) / "restore.csv"
            write_restore_csv(backup, csv_path)

            with csv_path.open(encoding="utf-8", newline="") as handle:
                csv_rows = list(csv.reader(handle))
            self.assertEqual([row[1] for row in csv_rows], ["course-1", "course-2"])

            restored_path = Path(directory) / "restored.csv"
            with restored_path.open("x", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle, lineterminator="\n")
                for row in self.rows:
                    writer.writerow([json.dumps(row, sort_keys=True)])
            restored = read_restored_rows(restored_path)
            result = verify_restored_rows(backup, restored)

        self.assertEqual(result["row_count"], 2)
        self.assertEqual(result["payload_sha256"], self.payload["payload_sha256"])

    def test_restored_csv_preserves_embedded_newlines_quotes_and_commas(self):
        restored_row = self.live_course_row(
            "course-special",
            title='Institutions, "leadership"\nand evidence',
            description="Line one\r\nLine two, with punctuation",
        )
        with tempfile.TemporaryDirectory() as directory:
            restored_path = Path(directory) / "restored.csv"
            with restored_path.open("x", encoding="utf-8", newline="") as handle:
                csv.writer(handle, lineterminator="\n").writerow(
                    [json.dumps(restored_row, sort_keys=True)]
                )

            self.assertEqual(read_restored_rows(restored_path), [restored_row])

    def test_restored_csv_rejects_extra_columns(self):
        with tempfile.TemporaryDirectory() as directory:
            restored_path = Path(directory) / "restored.csv"
            with restored_path.open("x", encoding="utf-8", newline="") as handle:
                csv.writer(handle, lineterminator="\n").writerow(["{}", "unexpected"])

            with self.assertRaisesRegex(ValueError, "exactly one JSON payload column"):
                read_restored_rows(restored_path)

    def test_restored_csv_accepts_valid_rows_larger_than_python_default(self):
        restored_row = self.live_course_row("course-large", description="x" * 150_000)
        with tempfile.TemporaryDirectory() as directory:
            restored_path = Path(directory) / "restored.csv"
            with restored_path.open("x", encoding="utf-8", newline="") as handle:
                csv.writer(handle, lineterminator="\n").writerow([json.dumps(restored_row)])

            self.assertEqual(read_restored_rows(restored_path), [restored_row])

    def test_restored_csv_rejects_rows_above_reviewed_memory_bound(self):
        restored_row = self.live_course_row(
            "course-too-large",
            description="x" * (MAX_RESTORED_PAYLOAD_CHARS + 1),
        )
        with tempfile.TemporaryDirectory() as directory:
            restored_path = Path(directory) / "restored.csv"
            with restored_path.open("x", encoding="utf-8", newline="") as handle:
                csv.writer(handle, lineterminator="\n").writerow([json.dumps(restored_row)])

            with self.assertRaisesRegex(ValueError, "exceeds the .*character limit"):
                read_restored_rows(restored_path)

    def test_rejects_count_digest_duplicate_and_restored_payload_mismatches(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_backup(directory)

            bad_count = dict(self.payload, row_count=1)
            path.write_text(json.dumps(bad_count), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "row count"):
                load_backup(path, self.project_url)

            bad_digest = dict(self.payload, payload_sha256="0" * 64)
            path.write_text(json.dumps(bad_digest), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "digest"):
                load_backup(path, self.project_url)

            duplicate_rows = [self.rows[0], dict(self.rows[1], id="course-1")]
            duplicate = dict(
                self.payload,
                rows=duplicate_rows,
                payload_sha256=hashlib.sha256(canonical_payload_bytes(duplicate_rows)).hexdigest(),
            )
            path.write_text(json.dumps(duplicate), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "duplicate"):
                load_backup(path, self.project_url)

            with self.assertRaisesRegex(ValueError, "does not exactly match"):
                verify_restored_rows(self.payload, self.rows[:1])

    def test_rejects_wrong_project_empty_inventory_and_schema_drift(self):
        with tempfile.TemporaryDirectory() as directory:
            path = self.write_backup(directory)
            with self.assertRaisesRegex(ValueError, "project URL"):
                load_backup(path, "https://wrong-project.supabase.co")

            empty = dict(
                self.payload,
                row_count=0,
                rows=[],
                payload_sha256=hashlib.sha256(canonical_payload_bytes([])).hexdigest(),
            )
            path.write_text(json.dumps(empty), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "row count"):
                load_backup(path, self.project_url, minimum_rows=1)

            missing_column_rows = [dict(self.rows[0])]
            missing_column_rows[0].pop("active")
            missing_column = dict(
                self.payload,
                row_count=1,
                rows=missing_column_rows,
                payload_sha256=hashlib.sha256(
                    canonical_payload_bytes(missing_column_rows)
                ).hexdigest(),
            )
            path.write_text(json.dumps(missing_column), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "column contract"):
                load_backup(path, self.project_url)


if __name__ == "__main__":
    unittest.main()
