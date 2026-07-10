"""Static safety checks for the scoped Course Explorer RLS hardening migration."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MIGRATION = ROOT / "supabase" / "migrations" / "20260710215439_restrict_course_explorer_browser_writes.sql"


class ProductionRlsMigrationTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_removes_only_the_two_known_unrestricted_browser_write_policies(self):
        self.assertIn(
            'drop policy if exists "anon write live_courses" on public.live_courses',
            self.sql,
        )
        self.assertIn(
            'drop policy if exists "schedules_anon_all" on public.schedules',
            self.sql,
        )

    def test_does_not_remove_rows_or_broaden_access(self):
        for forbidden in (
            "drop table",
            "truncate",
            "delete from",
            "insert into",
            "create policy",
            "grant ",
        ):
            self.assertNotIn(forbidden, self.sql)


if __name__ == "__main__":
    unittest.main()
