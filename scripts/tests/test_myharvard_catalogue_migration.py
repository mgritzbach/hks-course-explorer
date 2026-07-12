"""Static safety contract for section-level HKS catalogue promotion."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260712060918_authoritative_myharvard_hks_catalogue.sql"
FOLLOW_UP = ROOT / "supabase" / "migrations" / "20260712062903_fix_myharvard_staging_isolation_and_rollback.sql"
RETENTION_FIX = ROOT / "supabase" / "migrations" / "20260712065000_make_myharvard_snapshot_retention_deterministic.sql"
MANIFEST_FIX = ROOT / "supabase" / "migrations" / "20260712193000_persist_hks_catalogue_manifest.sql"


class MyHarvardCatalogueMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()
        cls.follow_up = FOLLOW_UP.read_text(encoding="utf-8").lower()
        cls.retention_fix = RETENTION_FIX.read_text(encoding="utf-8").lower()
        cls.manifest_fix = MANIFEST_FIX.read_text(encoding="utf-8").lower()

    def test_uses_inactive_staging_and_atomic_promotion(self):
        self.assertIn("stage_myharvard_hks_offerings", self.sql)
        self.assertIn("promote_myharvard_hks_run", self.sql)
        self.assertIn("active = false", self.sql)
        self.assertIn("active = true", self.sql)
        self.assertIn("pg_advisory_xact_lock", self.sql)

    def test_preserves_a_deletion_free_rollback_path(self):
        self.assertIn("rollback_myharvard_hks_run", self.sql)
        self.assertNotIn("delete from public.live_courses", self.sql)
        self.assertNotIn("drop table public.live_courses", self.sql)

    def test_keeps_write_functions_service_only(self):
        self.assertIn("revoke all on function public.stage_myharvard_hks_offerings", self.sql)
        self.assertIn("grant execute on function public.stage_myharvard_hks_offerings", self.sql)
        self.assertIn("to service_role", self.sql)

    def test_staging_uses_a_versioned_database_id(self):
        self.assertIn("source_offering_id", self.follow_up)
        self.assertIn("row.id || '|run|' || p_run_id::text", self.follow_up)
        self.assertIn("live_courses_run_offering_identity", self.follow_up)

    def test_rollback_restores_previous_validated_snapshot_before_ats(self):
        rollback = self.follow_up.split(
            "create or replace function public.rollback_myharvard_hks_run", 1
        )[1]
        mark_rolled_back = rollback.index("set status = 'rolled_back'")
        reactivate_rows = rollback.index("set active = true")
        self.assertLess(mark_rolled_back, reactivate_rows)
        self.assertIn("status = 'superseded'", self.follow_up)
        self.assertIn("order by activated_at desc nulls last", self.follow_up)

    def test_retention_is_bounded_to_exact_previous_active_snapshot(self):
        self.assertIn("select id into previous_run_id", self.retention_fix)
        self.assertIn("sync_run_id <> coalesce(previous_run_id, p_run_id)", self.retention_fix)
        self.assertIn("delete from public.live_courses", self.retention_fix)
        self.assertIn("exists (select 1 from public.live_courses", self.retention_fix)

    def test_promotion_validates_persisted_identity_and_term_manifest_atomically(self):
        promotion = self.manifest_fix.split(
            "create or replace function public.promote_myharvard_hks_run", 1
        )[1]
        manifest_check = promotion.index("staged offerings do not match the persisted upstream manifest")
        deactivate = promotion.index("update public.live_courses set active = false")
        self.assertLess(manifest_check, deactivate)
        self.assertIn("identity_sha256", self.manifest_fix)
        self.assertIn("term_counts", self.manifest_fix)
        self.assertIn("string_agg(source_offering_id", self.manifest_fix)
        self.assertIn("identity_sha256 is not null", self.manifest_fix)
        self.assertIn("term_counts is not null", self.manifest_fix)
        self.assertIn("live_catalogue_runs_one_active_myharvard", self.manifest_fix)

    def test_publishable_role_can_read_only_the_active_manifest(self):
        self.assertIn('to anon\n  using (source = \'myharvard\' and status = \'active\')', self.manifest_fix)
        self.assertIn("grant select (", self.manifest_fix)
        self.assertNotIn("grant all on table public.live_catalogue_runs to anon", self.manifest_fix)


if __name__ == "__main__":
    unittest.main()
