"""Contracts for the allowlist-only Course Explorer recovery package."""

from __future__ import annotations

import csv
import importlib.util
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST_COMMIT = "a" * 40
TEST_CONTRACT_DIGEST = "b" * 64


def load_exporter():
    name = "course_explorer_recovery_export_test_subject"
    sys.modules.pop(name, None)
    path = ROOT / "scripts" / "export_course_explorer_recovery.py"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def row_for(module, table, row_id):
    return {column: row_id if column == "id" else None for column in module.TABLE_COLUMNS[table]}


class FakeResponse:
    def __init__(self, rows, content_range, status=206):
        self._rows = rows
        self.headers = {"Content-Range": content_range}
        self.status_code = status

    def json(self):
        return self._rows


class CourseExplorerRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.exporter = load_exporter()
        self.minimums = dict(self.exporter.MINIMUM_ROWS)
        self.exporter.MINIMUM_ROWS.update({table: 0 for table in self.exporter.TABLE_ORDER})

    def tearDown(self):
        self.exporter.MINIMUM_ROWS.clear()
        self.exporter.MINIMUM_ROWS.update(self.minimums)

    def test_writes_twice_captured_allowlist_with_schema_and_package_digests(self):
        rows = {
            table: [row_for(self.exporter, table, f"{table}-1")]
            for table in self.exporter.TABLE_ORDER
        }
        calls = []

        def fetch(_url, key, table):
            calls.append((key, table))
            return rows[table]

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            schema = root / "schema.sql"
            schema.write_text("select 1;\n", encoding="utf-8")
            output = root / "recovery.json"
            result = self.exporter.write_recovery_package(
                output,
                "https://cbtroatixvydpwoviezf.supabase.co/",
                "service-key-canary",
                expected_project_ref="cbtroatixvydpwoviezf",
                source_commit=TEST_COMMIT,
                schema_path=schema,
                fetch_rows=fetch,
                now=datetime(2026, 7, 12, tzinfo=timezone.utc),
                contract_digest=TEST_CONTRACT_DIGEST,
            )
            payload = json.loads(output.read_text(encoding="utf-8"))

        self.assertEqual(len(calls), len(self.exporter.TABLE_ORDER) * 2)
        self.assertEqual(result["total_row_count"], len(self.exporter.TABLE_ORDER))
        self.assertEqual(payload["format"], "hks-course-explorer-recovery-v2")
        self.assertEqual(payload["source_commit"], TEST_COMMIT)
        self.assertEqual(payload["recovery_contract_sha256"], TEST_CONTRACT_DIGEST)
        self.assertEqual(set(payload["tables"]), set(self.exporter.TABLE_ORDER))
        self.assertEqual(payload["package_sha256"], result["package_sha256"])
        self.assertNotIn("service-key-canary", json.dumps(payload))

    def test_digest_treats_postgres_integral_real_rendering_as_equivalent(self):
        from scripts.course_explorer_recovery_format import rows_sha256

        self.assertEqual(rows_sha256([{"credits": 4.0}]), rows_sha256([{"credits": 4}]))
        self.assertNotEqual(rows_sha256([{"credits": 4.5}]), rows_sha256([{"credits": 4}]))

    def test_rejects_wrong_project_urls_overwrite_and_inconsistent_double_capture(self):
        for url in (
            "http://cbtroatixvydpwoviezf.supabase.co",
            "https://wrongwrongwrongwrongwr.supabase.co",
            "https://user@cbtroatixvydpwoviezf.supabase.co",
            "https://cbtroatixvydpwoviezf.supabase.co/path",
            "https://cbtroatixvydpwoviezf.supabase.co?redirect=1",
        ):
            with self.subTest(url=url), self.assertRaises(ValueError):
                self.exporter.validate_project_url(url, "cbtroatixvydpwoviezf")

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            schema = root / "schema.sql"
            schema.write_text("select 1;\n", encoding="utf-8")
            output = root / "existing.json"
            output.write_text("existing", encoding="utf-8")
            with self.assertRaisesRegex(FileExistsError, "overwrite"):
                self.exporter.write_recovery_package(
                    output,
                    "https://cbtroatixvydpwoviezf.supabase.co",
                    "key",
                    expected_project_ref="cbtroatixvydpwoviezf",
                    source_commit=TEST_COMMIT,
                    schema_path=schema,
                    fetch_rows=lambda *_: [],
                    contract_digest=TEST_CONTRACT_DIGEST,
                )

            output.unlink()
            call = 0

            def changing(_url, _key, table):
                nonlocal call
                call += 1
                suffix = "2" if call > len(self.exporter.TABLE_ORDER) and table == "courses" else "1"
                return [row_for(self.exporter, table, f"{table}-{suffix}")]

            with self.assertRaisesRegex(RuntimeError, "changed between"):
                self.exporter.write_recovery_package(
                    output,
                    "https://cbtroatixvydpwoviezf.supabase.co",
                    "key",
                    expected_project_ref="cbtroatixvydpwoviezf",
                    source_commit=TEST_COMMIT,
                    schema_path=schema,
                    fetch_rows=changing,
                    contract_digest=TEST_CONTRACT_DIGEST,
                )

    def test_strict_pagination_rejects_redirects_overlap_and_missing_ranges(self):
        calls = []
        first = [{"id": str(index)} for index in range(1_000)]
        second = [{"id": "1000"}]
        responses = iter(
            [FakeResponse(first, "0-999/1001"), FakeResponse(second, "1000-1000/1001")]
        )

        def get(*args, **kwargs):
            calls.append((args, kwargs))
            return next(responses)

        rows = self.exporter.fetch_table_snapshot(
            "https://cbtroatixvydpwoviezf.supabase.co", "key", "courses", request_get=get
        )
        self.assertEqual(len(rows), 1_001)
        self.assertTrue(all(call[1]["allow_redirects"] is False for call in calls))
        self.assertTrue(all(call[1]["params"] == {"select": "*", "order": "id.asc"} for call in calls))

        with self.assertRaisesRegex(RuntimeError, "HTTP 302"):
            self.exporter.fetch_table_snapshot(
                "https://cbtroatixvydpwoviezf.supabase.co",
                "key",
                "courses",
                request_get=lambda *_args, **_kwargs: FakeResponse([], "*/0", status=302),
            )
        with self.assertRaisesRegex(RuntimeError, "Content-Range"):
            self.exporter.fetch_table_snapshot(
                "https://cbtroatixvydpwoviezf.supabase.co",
                "key",
                "courses",
                request_get=lambda *_args, **_kwargs: FakeResponse([], "", status=200),
            )

    def test_row_validation_canonicalizes_database_collation_order(self):
        rows = [
            row_for(self.exporter, "schedules", "schedule-z"),
            row_for(self.exporter, "schedules", "schedule-a"),
        ]

        validated = self.exporter._validate_rows("schedules", rows)

        self.assertEqual([row["id"] for row in validated], ["schedule-a", "schedule-z"])
        self.assertEqual([row["id"] for row in rows], ["schedule-z", "schedule-a"])

    def test_validator_round_trip_and_tamper_fail_closed(self):
        from scripts import verify_course_explorer_recovery as verifier

        rows = {
            table: [row_for(self.exporter, table, f"{table}-1")]
            for table in self.exporter.TABLE_ORDER
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            schema = root / "schema.sql"
            schema.write_text("select 1;\n", encoding="utf-8")
            package_path = root / "package.json"
            self.exporter.write_recovery_package(
                package_path,
                "https://cbtroatixvydpwoviezf.supabase.co",
                "key",
                expected_project_ref="cbtroatixvydpwoviezf",
                source_commit=TEST_COMMIT,
                schema_path=schema,
                fetch_rows=lambda _url, _key, table: rows[table],
                contract_digest=TEST_CONTRACT_DIGEST,
            )
            package = verifier.load_recovery_package(
                package_path,
                "https://cbtroatixvydpwoviezf.supabase.co",
                schema,
                TEST_COMMIT,
                expected_contract_digest=TEST_CONTRACT_DIGEST,
            )
            restored_path = root / "restored.csv"
            with restored_path.open("x", encoding="utf-8", newline="") as handle:
                writer = csv.writer(handle, lineterminator="\n")
                for table in self.exporter.TABLE_ORDER:
                    writer.writerow([table, json.dumps(rows[table][0], sort_keys=True)])
            result = verifier.verify_restored_rows(
                package, verifier.read_restored_rows(restored_path)
            )
            self.assertEqual(result["courses"]["row_count"], 1)

            tampered = json.loads(package_path.read_text(encoding="utf-8"))
            tampered["tables"]["courses"]["rows"][0]["course_name"] = "tampered"
            package_path.write_text(json.dumps(tampered), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "digest"):
                verifier.load_recovery_package(
                    package_path,
                    "https://cbtroatixvydpwoviezf.supabase.co",
                    schema,
                    TEST_COMMIT,
                    expected_contract_digest=TEST_CONTRACT_DIGEST,
                )

    def test_rejects_wrong_backup_commit_and_recovery_contract(self):
        from scripts import verify_course_explorer_recovery as verifier

        rows = {
            table: [row_for(self.exporter, table, f"{table}-1")]
            for table in self.exporter.TABLE_ORDER
        }
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            schema = root / "schema.sql"
            schema.write_text("select 1;\n", encoding="utf-8")
            package_path = root / "package.json"
            self.exporter.write_recovery_package(
                package_path,
                "https://cbtroatixvydpwoviezf.supabase.co",
                "key",
                expected_project_ref="cbtroatixvydpwoviezf",
                source_commit=TEST_COMMIT,
                schema_path=schema,
                fetch_rows=lambda _url, _key, table: rows[table],
                contract_digest=TEST_CONTRACT_DIGEST,
            )
            with self.assertRaisesRegex(ValueError, "backup workflow commit"):
                verifier.load_recovery_package(
                    package_path,
                    "https://cbtroatixvydpwoviezf.supabase.co",
                    schema,
                    "c" * 40,
                    expected_contract_digest=TEST_CONTRACT_DIGEST,
                )
            with self.assertRaisesRegex(ValueError, "recovery contract"):
                verifier.load_recovery_package(
                    package_path,
                    "https://cbtroatixvydpwoviezf.supabase.co",
                    schema,
                    TEST_COMMIT,
                    expected_contract_digest="d" * 64,
                )


class CourseExplorerRecoveryWorkflowTests(unittest.TestCase):
    def test_ciphertext_authentication_rejects_tamper_wrong_key_and_overwrite(self):
        from scripts.recovery_ciphertext_hmac import create_tag, verify_tag

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            ciphertext = root / "recovery.enc"
            tag = root / "recovery.enc.hmac"
            ciphertext.write_bytes(b"encrypted recovery bytes")
            create_tag(ciphertext, tag, "correct horse battery staple")
            verify_tag(ciphertext, tag, "correct horse battery staple")

            with self.assertRaisesRegex(FileExistsError, "exists"):
                create_tag(ciphertext, tag, "correct horse battery staple")
            with self.assertRaisesRegex(ValueError, "authentication failed"):
                verify_tag(ciphertext, tag, "different passphrase value")
            ciphertext.write_bytes(b"tampered recovery bytes")
            with self.assertRaisesRegex(ValueError, "authentication failed"):
                verify_tag(ciphertext, tag, "correct horse battery staple")

    def test_workflows_are_allowlist_only_encrypted_authenticated_and_ephemeral(self):
        backup = (ROOT / ".github/workflows/backup-course-explorer-recovery.yml").read_text(
            encoding="utf-8"
        )
        restore = (ROOT / ".github/workflows/verify-course-explorer-recovery.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("group: hks-production-catalogue-sync", backup)
        self.assertIn("github.ref == 'refs/heads/master'", backup)
        self.assertIn("github.ref == 'refs/heads/master'", restore)
        self.assertIn('--source-commit "${{ github.sha }}"', backup)
        self.assertIn("steps.provenance.outputs.head_sha", restore)
        self.assertIn("cancel-in-progress: false", backup)
        self.assertIn("allowlist-only", backup)
        self.assertIn("course-explorer-recovery.json.enc.hmac", backup)
        self.assertIn("if: always()", backup)
        self.assertNotIn("path: ${{ runner.temp }}/course-explorer-recovery.json\n", backup)
        self.assertIn("Verify backup workflow provenance", restore)
        self.assertIn("recovery_ciphertext_hmac.py verify", restore)
        self.assertIn("postgres:17.10-alpine3.24@sha256:", restore)
        self.assertIn("Prove exact recovery schema contract", restore)
        self.assertIn("Prove foreign-key enforcement and transaction rollback", restore)
        self.assertNotIn("SUPABASE_URL:", restore)
        self.assertNotIn("SUPABASE_KEY:", restore)
        for unrelated in ("orders", "availability", "vouchers", "profiles"):
            self.assertNotIn(f"rest/v1/{unrelated}", backup + restore)

    def test_baseline_and_schema_probe_cover_current_production_boundary(self):
        baseline = (ROOT / "supabase/recovery/course_explorer_base.sql").read_text(
            encoding="utf-8"
        )
        probe = (ROOT / "scripts/verify_course_explorer_schema.sql").read_text(
            encoding="utf-8"
        )
        for table in (
            "courses", "course_sections", "schedules", "live_courses"
        ):
            self.assertIn(f"create table public.{table}", baseline.lower())
        self.assertIn("create extension if not exists pgcrypto", baseline.lower())
        self.assertIn("live_courses_sync_run_id_fkey", probe)
        self.assertIn("orphaned sync_run_id", probe)
        self.assertIn("foreach required_privilege", probe)
        self.assertIn("Publishable read active myharvard manifest", probe)
        self.assertIn("unrelated_recovery_sentinel", probe)

        contract_lines = (
            ROOT / "supabase/recovery/course_explorer_schema_contract.txt"
        ).read_text(encoding="utf-8").splitlines()
        self.assertGreaterEqual(len(contract_lines), 800)
        for prefix in (
            "TABLE|", "COLUMN|", "INDEX|", "CONSTRAINT|", "POLICY|",
            "TABLE_PRIVILEGE|", "COLUMN_PRIVILEGE|", "FUNCTION|",
            "TABLE_GRANT_OPTION|", "TABLE_ACL|", "COLUMN_ACL|",
            "FUNCTION_PRIVILEGE|", "FUNCTION_GRANT_OPTION|", "FUNCTION_ACL|",
            "TRIGGER|", "SCHEMA_PRIVILEGE|", "SCHEMA_GRANT_OPTION|", "EXTENSION|",
        ):
            self.assertTrue(any(line.startswith(prefix) for line in contract_lines), prefix)
        from scripts.course_explorer_recovery_format import MINIMUM_ROWS

        self.assertEqual(MINIMUM_ROWS["course_sections"], 250)

        restore_sql = (ROOT / "scripts/restore_course_explorer_recovery.sql").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("session_replication_role", restore_sql)
        self.assertIn("disable trigger user", restore_sql.lower())
        self.assertIn("enable trigger user", restore_sql.lower())

    def test_recovery_contract_covers_every_replayed_migration(self):
        from scripts.course_explorer_recovery_format import RECOVERY_CONTRACT_PATHS

        workflow = (ROOT / ".github/workflows/verify-course-explorer-recovery.yml").read_text(
            encoding="utf-8"
        )
        migration_paths = [
            path for path in RECOVERY_CONTRACT_PATHS if path.startswith("supabase/migrations/")
        ]
        self.assertGreater(len(migration_paths), 0)
        for path in migration_paths:
            self.assertIn(path, workflow)

        hardening = (
            ROOT / "supabase/migrations/20260712224500_harden_maintain_and_trigger_function_grants.sql"
        ).read_text(encoding="utf-8").lower()
        self.assertIn("revoke maintain", hardening)
        self.assertIn("grant maintain", hardening)
        self.assertIn("refresh_synced_at()", hardening)
        self.assertIn("keep_ats_hks_inactive_after_myharvard()", hardening)
        self.assertNotIn("delete from", hardening)
        self.assertNotIn("drop table", hardening)


if __name__ == "__main__":
    unittest.main()
