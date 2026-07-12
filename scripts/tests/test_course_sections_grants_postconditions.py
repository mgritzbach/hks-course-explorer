"""Contract for effective course_sections privilege assertions."""

import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260712213500_assert_course_sections_browser_grant_postconditions.sql"
)


class CourseSectionsGrantPostconditionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()
        cls.executable_sql = re.sub(r"--[^\n]*", "", cls.sql)

    def test_checks_effective_browser_and_service_privileges(self):
        self.assertIn("has_table_privilege(browser_role", self.sql)
        self.assertIn("'anon'::name", self.sql)
        self.assertIn("'authenticated'::name", self.sql)
        for privilege in (
            "'select'",
            "'insert'",
            "'update'",
            "'delete'",
            "'truncate'",
            "'references'",
            "'trigger'",
        ):
            self.assertIn(privilege, self.sql)
        self.assertIn("has_table_privilege('service_role'", self.sql)

    def test_requires_exact_permissive_public_read_policy(self):
        for required in (
            "policyname = 'public read'",
            "permissive = 'permissive'",
            "roles = array['public']::name[]",
            "cmd = 'select'",
            "coalesce(qual, '') = 'true'",
            "with_check is null",
            ") <> 1",
        ):
            self.assertIn(required, self.sql)

    def test_is_assertion_only(self):
        for pattern in (
            r"\bgrant\s+(?:all|select|insert|update|delete|truncate|references|trigger)\b",
            r"\brevoke\s+(?:all|select|insert|update|delete|truncate|references|trigger)\b",
            r"\bdelete\s+from\b",
            r"\btruncate\s+table\b",
            r"\bdrop\b",
            r"\balter\b",
            r"\binsert\s+into\b",
            r"\bupdate\s+public\.",
            r"\bcreate\s+(?:table|policy|function|trigger|index)\b",
        ):
            self.assertIsNone(re.search(pattern, self.executable_sql), pattern)


if __name__ == "__main__":
    unittest.main()
