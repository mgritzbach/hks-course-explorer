"""Static security checks for the atomic live-course sync migration."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260710235500_atomic_live_course_sync.sql"
SERIALIZATION = ROOT / "supabase" / "migrations" / "20260712070000_serialize_and_guard_catalogue_promotions.sql"
SOURCE_ISOLATION = ROOT / "supabase" / "migrations" / "20260712092831_isolate_non_hks_ats_activation.sql"
ATS_MANIFEST = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260714075356_persist_ats_source_manifest.sql"
)
ATS_PROMOTION_TIMEOUT = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260714102702_raise_ats_promotion_statement_timeout.sql"
)


class AtomicLiveCourseSyncMigrationTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.serialization = SERIALIZATION.read_text(encoding="utf-8").lower()
        self.source_isolation = SOURCE_ISOLATION.read_text(encoding="utf-8").lower()
        self.ats_manifest = ATS_MANIFEST.read_text(encoding="utf-8").lower()
        self.ats_promotion_timeout = ATS_PROMOTION_TIMEOUT.read_text(
            encoding="utf-8"
        ).lower()

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

    def test_non_hks_sync_rejects_hks_and_reactivates_accepted_rows(self):
        self.assertIn("general live-course sync accepts non-hks rows only", self.source_isolation)
        self.assertIn("item.value -> 'is_hks' is distinct from 'false'::jsonb", self.source_isolation)
        self.assertIn("upper(btrim(item.value ->> 'school')) = 'hks'", self.source_isolation)
        self.assertIn("authoritative_hks.source = 'myharvard'", self.source_isolation)
        self.assertIn(
            "authoritative_hks.source_course_id = item.value ->> 'id'",
            self.source_isolation,
        )
        self.assertIn("source, active", self.source_isolation)
        self.assertIn("'ats', true", self.source_isolation)
        self.assertIn("source = 'ats'", self.source_isolation)
        self.assertIn("active = true", self.source_isolation)
        self.assertIn(
            "revoke all on function public.sync_live_courses_atomically(jsonb)",
            self.source_isolation,
        )

    def test_ats_manifest_transition_is_atomic_manifested_and_no_delete(self):
        sql = self.ats_manifest
        self.assertIn("set search_path = ''", sql)
        self.assertIn("myharvard-hks-catalogue-promotion", sql)
        self.assertIn("source = 'ats' and status = 'active'", sql)
        self.assertIn("identity_sha256", sql)
        self.assertIn("term_counts", sql)
        self.assertIn("extensions.digest", sql)
        self.assertIn("set active = false", sql)
        self.assertIn("'ats', run_id, true, source_observed_at", sql)
        self.assertLess(sql.index("set active = false"), sql.index("on conflict (id) do update"))
        self.assertNotIn("delete from public.live_courses", sql)
        self.assertIn("source_last_seen_at", sql)

    def test_ats_manifest_rejects_incomplete_direct_rpc_payloads(self):
        sql = self.ats_manifest
        self.assertIn("every live-course sync record needs a term", sql)
        self.assertIn("production minimum is 5000", sql)
        self.assertIn("expected_rows < 5000", sql)
        self.assertIn("existing_ats_count", sql)
        self.assertIn("payload contains duplicate ids", sql)
        self.assertIn("general live-course sync accepts non-hks rows only", sql)
        self.assertIn("payload id collides with a protected row", sql)
        self.assertIn("existing.source is distinct from 'ats'", sql)
        self.assertIn("existing.is_hks is distinct from false", sql)
        self.assertIn("where source = 'ats'", sql)
        self.assertIn("source_last_seen_at drop default", sql)
        self.assertIn("source_last_seen_at drop not null", sql)
        self.assertNotIn("source_last_seen_at set not null", sql)

    def test_ats_manifest_rpc_remains_service_only(self):
        sql = self.ats_manifest
        self.assertIn(
            "revoke all on function public.sync_live_courses_atomically(jsonb)",
            sql,
        )
        self.assertIn("from public, anon, authenticated", sql)
        self.assertIn(
            "grant execute on function public.sync_live_courses_atomically(jsonb) to service_role",
            sql,
        )

    def test_ats_promotion_timeout_is_bounded_and_function_only(self):
        sql = self.ats_promotion_timeout
        self.assertIn(
            "alter function public.sync_live_courses_atomically(jsonb)",
            sql,
        )
        self.assertIn("set statement_timeout to '60s'", sql)
        self.assertIn("statement_timeout=60s", sql)
        self.assertIn("search_path=\"\"", sql)
        self.assertIn("has_function_privilege", sql)
        self.assertNotIn("alter role", sql)
        self.assertNotIn("alter database", sql)
        self.assertNotIn("lock_timeout", sql.replace("lock_timeout remains unchanged", ""))
        self.assertNotIn("delete from", sql)
        self.assertNotIn("drop table", sql)


if __name__ == "__main__":
    unittest.main()
