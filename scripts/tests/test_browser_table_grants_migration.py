"""Scope lock for Course Explorer browser table-grant hardening."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260712200000_revoke_course_explorer_browser_write_grants.sql"
)


class BrowserTableGrantMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_revokes_only_browser_roles_and_preserves_catalogue_select(self):
        self.assertIn("from anon, authenticated", self.sql)
        self.assertIn("public.courses", self.sql)
        self.assertIn("public.live_courses", self.sql)
        self.assertIn("public.schedules", self.sql)
        self.assertEqual(self.sql.count("grant select on table"), 2)
        self.assertNotIn("from service_role", self.sql)
        self.assertNotIn("revoke all privileges on table public.live_courses", self.sql)
        self.assertNotIn("revoke all privileges on table public.courses", self.sql)

    def test_fails_closed_on_rls_policy_or_table_drift(self):
        self.assertGreaterEqual(self.sql.count("relrowsecurity"), 3)
        self.assertGreaterEqual(self.sql.count("raise exception 'refusing grant hardening"), 9)
        self.assertIn("public.courses is missing", self.sql)
        self.assertIn("public.live_courses is missing", self.sql)
        self.assertIn("public.schedules is missing", self.sql)
        self.assertIn("cmd <> 'select'", self.sql)
        self.assertIn("public.schedules has an unexpected policy", self.sql)

    def test_contains_no_row_or_schema_destructive_statement(self):
        for pattern in (
            r"\bdelete\s+from\b",
            r"\btruncate\s+table\b",
            r"\bdrop\s+(?:table|schema|column)\b",
            r"\balter\s+table\b",
            r"\binsert\s+into\b",
            r"\bupdate\s+public\.",
        ):
            self.assertIsNone(re.search(pattern, self.sql), pattern)

    def test_version_sorts_after_every_existing_production_migration(self):
        versions = sorted(
            path.name.split("_", 1)[0]
            for path in MIGRATION.parent.glob("*.sql")
            if path.name[0].isdigit()
        )
        self.assertEqual(MIGRATION.name.split("_", 1)[0], versions[-1])


if __name__ == "__main__":
    unittest.main()
