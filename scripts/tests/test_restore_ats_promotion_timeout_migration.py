"""Contracts for the callable ATS promotion wrapper timeout."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260825042405_restore_ats_promotion_statement_timeout.sql"
)


class RestoreAtsPromotionTimeoutMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_restores_bounded_timeout_on_callable_wrapper(self):
        self.assertIn(
            "alter function public.sync_live_courses_atomically(jsonb)",
            self.sql,
        )
        self.assertIn("set statement_timeout to '60s'", self.sql)
        self.assertIn("statement_timeout=60s", self.sql)
        self.assertIn('search_path=""', self.sql)

    def test_preserves_service_only_access_and_scope(self):
        self.assertIn("has_function_privilege", self.sql)
        self.assertNotIn("alter role", self.sql)
        self.assertNotIn("alter database", self.sql)
        self.assertNotIn("lock_timeout", self.sql)
        self.assertNotIn("delete from", self.sql)
        self.assertNotIn("drop table", self.sql)


if __name__ == "__main__":
    unittest.main()
