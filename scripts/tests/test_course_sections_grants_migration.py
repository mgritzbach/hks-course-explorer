"""Scope lock for read-only course_sections browser grants."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260712213000_revoke_course_sections_browser_write_grants.sql"
)


class CourseSectionsGrantMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_preserves_browser_select_and_service_role(self):
        self.assertIn("public.course_sections", self.sql)
        self.assertIn("from anon, authenticated", self.sql)
        self.assertEqual(self.sql.count("grant select on table public.course_sections"), 1)
        for privilege in ("insert", "update", "delete", "truncate", "references", "trigger"):
            self.assertIn(privilege, self.sql)
        self.assertNotIn("service_role", self.sql)
        self.assertNotIn("revoke all privileges", self.sql)

    def test_fails_closed_on_table_rls_or_policy_drift(self):
        for required in (
            "public.course_sections is missing",
            "public.course_sections rls is not enabled",
            "expected exactly one select policy",
            "public select policy drifted",
            "roles = array['public']::name[]",
            "coalesce(qual, '') = 'true'",
            "with_check is null",
        ):
            self.assertIn(required, self.sql)

    def test_contains_no_row_or_schema_mutation(self):
        for pattern in (
            r"\bdelete\s+from\b",
            r"\btruncate\s+table\b",
            r"\bdrop\s+(?:table|schema|column|policy)\b",
            r"\balter\s+table\b",
            r"\binsert\s+into\b",
            r"\bupdate\s+public\.",
            r"\bcreate\s+(?:table|policy|function|trigger|index)\b",
        ):
            self.assertIsNone(re.search(pattern, self.sql), pattern)

    def test_version_follows_existing_browser_grant_hardening(self):
        self.assertGreater(
            MIGRATION.name.split("_", 1)[0],
            "20260712200000",
        )


if __name__ == "__main__":
    unittest.main()
