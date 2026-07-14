import json
import re
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import build_historical_parity_registry as registry_builder  # noqa: E402
import build_data  # noqa: E402
import historical_parity_reconciliation as reconciliation  # noqa: E402
import render_historical_parity_migration as renderer  # noqa: E402
from load_to_supabase import load_courses  # noqa: E402


REGISTRY_PATH = ROOT / "data" / "historical_parity_registry.json"
MIGRATION_PATH = (
    ROOT
    / "supabase"
    / "migrations"
    / "20260714124737_reconcile_historical_catalogue_additively.sql"
)


class HistoricalParityRegistryContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.registry = reconciliation.load_registry(REGISTRY_PATH)
        cls.base_courses = registry_builder.load_generated_canonical_rows()

    def test_reviewed_registry_closes_without_omitting_database_rows(self):
        result = self.registry["result"]
        self.assertEqual(result["same_id_count"], 4287)
        self.assertEqual(result["same_id_exact_observation_count"], 4270)
        self.assertEqual(result["same_id_source_preservation_count"], 16)
        self.assertEqual(result["same_id_canonical_enrichment_count"], 1)
        self.assertEqual(result["exact_observation_id_override_count"], 1273)
        self.assertEqual(result["preserved_database_only_count"], 252)
        self.assertEqual(result["additive_canonical_only_count"], 20)
        self.assertEqual(result["projected_row_count"], 5832)
        self.assertTrue(result["zero_omitted_database_rows"])

    def test_registry_applies_to_current_csv_and_matches_built_catalogue(self):
        reconciled = reconciliation.apply_registry(
            self.base_courses,
            self.registry,
            build_data.prepare_preserved_course,
        )
        built = json.loads((ROOT / "public" / "courses.json").read_text(encoding="utf-8"))[
            "courses"
        ]
        self.assertEqual(reconciliation.id_digest(reconciled), reconciliation.id_digest(built))
        self.assertEqual(len(built), 5832)
        self.assertTrue(
            all(
                next(row for row in built if row["id"] == item["id"])["has_eval"]
                for item in self.registry["same_id_source_preservations"]
            )
        )
        self.assertTrue(
            all(
                next(row for row in built if row["id"] == item["id"])["has_eval"]
                for item in self.registry["same_id_canonical_enrichments"]
            )
        )

    def test_migration_is_generated_from_exact_additive_set(self):
        expected = renderer.render_migration(self.registry, load_courses())
        actual = MIGRATION_PATH.read_text(encoding="utf-8")
        self.assertEqual(actual, expected)

        payload_match = re.search(
            r"\$historical_rows\$(\[.*\])\$historical_rows\$::jsonb",
            actual,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(payload_match)
        payload = json.loads(payload_match.group(1))
        self.assertEqual(len(payload), 20)
        self.assertEqual(
            sorted(row["id"] for row in payload),
            self.registry["additive_canonical_ids"],
        )

        enrichment_match = re.search(
            r"\$historical_enrichments\$(\[.*\])\$historical_enrichments\$::jsonb",
            actual,
            flags=re.DOTALL,
        )
        self.assertIsNotNone(enrichment_match)
        enrichments = json.loads(enrichment_match.group(1))
        self.assertEqual(len(enrichments), 1)
        self.assertFalse(enrichments[0]["before"]["has_eval"])
        self.assertTrue(enrichments[0]["target"]["has_eval"])
        changed_fields = {
            key
            for key in enrichments[0]["before"]
            if enrichments[0]["before"].get(key) != enrichments[0]["target"].get(key)
        }
        self.assertTrue(changed_fields)
        self.assertLessEqual(
            changed_fields, set(reconciliation.EVALUATION_ENRICHMENT_FIELDS)
        )

    def test_migration_has_fail_closed_baseline_and_only_reviewed_enrichment(self):
        sql = MIGRATION_PATH.read_text(encoding="utf-8")
        self.assertIn("expected_before_count constant integer := 5812", sql)
        self.assertIn("expected_update_count constant integer := 1", sql)
        self.assertIn("expected_after_count constant integer := 5832", sql)
        self.assertIn("lock table public.courses in share row exclusive mode", sql.casefold())
        statements = [line.strip().casefold() for line in sql.splitlines()]
        self.assertEqual(sum(line.startswith("update public.courses") for line in statements), 1)
        self.assertIn("to_jsonb(existing) <> item -> 'before'", sql)
        self.assertIn("to_jsonb(existing) <> item -> 'target'", sql)
        self.assertFalse(any(line.startswith("delete ") for line in statements))
        self.assertNotIn("on conflict", sql.casefold())


if __name__ == "__main__":
    unittest.main()
