"""Static security checks for the atomic live-course sync migration."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260710235500_atomic_live_course_sync.sql"
SERIALIZATION = ROOT / "supabase" / "migrations" / "20260712070000_serialize_and_guard_catalogue_promotions.sql"


class AtomicLiveCourseSyncMigrationTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.serialization = SERIALIZATION.read_text(encoding="utf-8").lower()

    def test_uses_one_service_only_atomic_function(self):
        self.assertIn("create or replace function public.sync_live_courses_atomically(p_rows jsonb)", self.sql)
        self.assertIn("security definer", self.sql)
        self.assertIn("on conflict (id) do update", self.sql)
        self.assertIn("revoke all on function public.sync_live_courses_atomically(jsonb)", self.sql)
        self.assertIn("from public, anon, authenticated", self.sql)
        self.assertIn("grant execute on function public.sync_live_courses_atomically(jsonb) to service_role", self.sql)

    def test_rejects_incomplete_or_ambiguous_payloads_before_writing(self):
        self.assertIn("payload must not be empty", self.sql)
        self.assertIn("every live-course sync record needs an id", self.sql)
        self.assertIn("payload contains duplicate ids", self.sql)
        self.assertIn("applied % rows; expected %", self.sql)

    def test_serializes_both_catalogue_write_paths_and_guards_material_drops(self):
        lock = "pg_advisory_xact_lock(hashtext('myharvard-hks-catalogue-promotion'))"
        self.assertEqual(self.serialization.count(lock), 2)
        self.assertIn("material catalogue drop rejected", self.serialization)
        self.assertIn("expected_rows < ceil(previous_rows * 0.95)", self.serialization)


if __name__ == "__main__":
    unittest.main()
