"""Static safety checks for the additive unified-catalogue migration."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260710134500_catalog_snapshot_v1.sql"


class CatalogueSnapshotMigrationTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_creates_new_snapshot_boundaries_without_replacing_existing_sources(self):
        self.assertIn("create table if not exists public.catalogue_sync_runs", self.sql)
        self.assertIn("create table if not exists public.catalogue_snapshot_v1", self.sql)
        self.assertNotIn("drop table public.courses", self.sql)
        self.assertNotIn("drop table public.live_courses", self.sql)
        self.assertNotIn("drop table public.course_sections", self.sql)

    def test_keeps_new_snapshot_tables_private_until_a_public_function_is_reviewed(self):
        self.assertIn("alter table public.catalogue_sync_runs enable row level security", self.sql)
        self.assertIn("alter table public.catalogue_snapshot_v1 enable row level security", self.sql)
        self.assertNotIn("create policy", self.sql)
        self.assertIn("create or replace view public.catalogue_current_v1", self.sql)

    def test_promotion_rejects_partial_snapshots(self):
        self.assertIn("mismatched source and snapshot counts", self.sql)
        self.assertIn("does not contain every current offering", self.sql)
        self.assertIn("catalogue_sync_runs_one_promoted", self.sql)


if __name__ == "__main__":
    unittest.main()
