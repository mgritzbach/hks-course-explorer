"""Static guardrails for the versioned Supabase admin-import contract."""

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260710003218_corporate_admin_import.sql"


class CorporateAdminImportSchemaTests(unittest.TestCase):
    def test_creates_only_forward_admin_tables_and_enables_rls(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        for table in ("bidding", "qguide", "requirements_tags", "stem_designations"):
            self.assertIn(f"create table if not exists public.{table}", sql)
            self.assertIn(f"alter table public.{table} enable row level security", sql)
        self.assertNotIn("create table if not exists public.courses", sql)
        self.assertNotIn("create table if not exists public.uploads", sql)

    def test_does_not_grant_browser_access_to_admin_data(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("from anon, authenticated", sql)
        self.assertIn("alter table public.uploads enable row level security", sql)
        self.assertIn("revoke all on table public.uploads from public, anon, authenticated", sql)
        self.assertIn("drop policy if exists uploads_public_read on public.uploads", sql)
        self.assertNotIn("grant select on table public.bidding to anon", sql)

    def test_admin_import_is_transactional_and_idempotent(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create or replace function public.admin_import", sql)
        self.assertIn("insert into public.uploads (upload_type, filename, row_count, status)", sql)
        self.assertGreaterEqual(sql.count("on conflict (import_key) do update"), 2)
        self.assertIn("security definer", sql)
        self.assertIn("set search_path = ''", sql)
        self.assertIn("revoke all on function public.admin_import", sql)
        self.assertIn("grant execute on function public.admin_import", sql)

    def test_reconciles_legacy_import_tables_before_rpc_use(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("alter table public.bidding add column if not exists import_key text", sql)
        self.assertIn("alter table public.qguide add column if not exists import_key text", sql)
        self.assertIn("legacy duplicates require review", sql)
        self.assertIn("create unique index if not exists bidding_import_key_unique", sql)
        self.assertIn("create unique index if not exists qguide_import_key_unique", sql)


if __name__ == "__main__":
    unittest.main()
