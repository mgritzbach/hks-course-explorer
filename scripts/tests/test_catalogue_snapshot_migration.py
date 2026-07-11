"""Static safety checks for the additive unified-catalogue migration."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260710134500_catalog_snapshot_v1.sql"
RENUMBERING_MIGRATION = ROOT / "supabase" / "migrations" / "20260710234500_catalogue_renumbering_review.sql"
NON_HKS_MIGRATION = ROOT / "supabase" / "migrations" / "20260711185312_allow_non_hks_current_only.sql"


class CatalogueSnapshotMigrationTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.renumbering_sql = RENUMBERING_MIGRATION.read_text(encoding="utf-8").lower()
        self.non_hks_sql = NON_HKS_MIGRATION.read_text(encoding="utf-8").lower()

    def test_creates_new_snapshot_boundaries_without_replacing_existing_sources(self):
        self.assertIn("create table if not exists public.catalogue_sync_runs", self.sql)
        self.assertIn("create table if not exists public.catalogue_snapshot_v1", self.sql)
        self.assertNotIn("drop table public.courses", self.sql)
        self.assertNotIn("drop table public.live_courses", self.sql)
        self.assertNotIn("drop table public.course_sections", self.sql)

    def test_keeps_new_snapshot_tables_private_until_a_public_function_is_reviewed(self):
        self.assertIn("alter table public.catalogue_sync_runs enable row level security", self.sql)
        self.assertIn("alter table public.catalogue_snapshot_v1 enable row level security", self.sql)
        self.assertIn(
            "revoke all on table public.catalogue_sync_runs from public, anon, authenticated",
            self.sql,
        )
        self.assertIn(
            "revoke all on table public.catalogue_snapshot_v1 from public, anon, authenticated",
            self.sql,
        )
        self.assertNotIn("create policy", self.sql)
        self.assertIn("create or replace view public.catalogue_current_v1", self.sql)

    def test_all_browser_roles_are_revoked_before_service_role_promotion_access(self):
        self.assertIn(
            "revoke all on function public.promote_catalogue_snapshot(uuid)\n"
            "  from public, anon, authenticated",
            self.sql,
        )
        self.assertIn(
            "grant execute on function public.promote_catalogue_snapshot(uuid) to service_role",
            self.sql,
        )

    def test_promotion_rejects_partial_snapshots(self):
        self.assertIn("mismatched source and snapshot counts", self.sql)
        self.assertIn("does not contain every current offering", self.sql)
        self.assertIn("catalogue_sync_runs_one_promoted", self.sql)

    def test_allows_and_persists_renumbering_review_candidates(self):
        self.assertIn("renumbering_review_candidates jsonb not null", self.renumbering_sql)
        self.assertIn("suspected_renumbering_same_professor_title", self.renumbering_sql)
        self.assertIn("suspected_section_split_and_renumbering", self.renumbering_sql)
        self.assertIn("canonical_course_code is null", self.renumbering_sql)

    def test_allows_current_only_non_hks_rows_without_broadening_browser_access(self):
        self.assertIn("drop constraint if exists catalogue_snapshot_v1_match_method_check", self.non_hks_sql)
        self.assertIn("drop constraint if exists catalogue_snapshot_v1_match_state_check", self.non_hks_sql)
        self.assertIn("'not_applicable'", self.non_hks_sql)
        self.assertIn("'non_hks_current_only'", self.non_hks_sql)
        self.assertIn("canonical_course_code is null", self.non_hks_sql)
        self.assertNotIn("grant", self.non_hks_sql)
        self.assertNotIn("create policy", self.non_hks_sql)
        self.assertNotIn("alter table public.live_courses", self.non_hks_sql)
        self.assertNotIn("delete from", self.non_hks_sql)


if __name__ == "__main__":
    unittest.main()
