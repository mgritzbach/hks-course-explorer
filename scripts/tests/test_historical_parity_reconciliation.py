import copy
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import historical_parity_reconciliation as reconciliation  # noqa: E402


def row(row_id, *, respondents=10, has_eval=True, has_bidding=False):
    return {
        "id": row_id,
        "course_code": "DPI-101",
        "course_code_base": "DPI-101",
        "year": 2025,
        "term": "Fall",
        "professor": "Example, Avery",
        "course_name": "Policy Analysis",
        "is_average": False,
        "year_range": None,
        "n_terms": 1,
        "n_respondents": respondents,
        "metrics_raw": {"Course_Rating": 4.5},
        "metrics_pct": {"Course_Rating": 91},
        "has_eval": has_eval,
        "has_bidding": has_bidding,
    }


class HistoricalParityReconciliationTests(unittest.TestCase):
    def test_exact_observation_keeps_database_id_without_duplicate(self):
        source = [row("stored-id")]
        canonical = [row("generated-id")]
        registry = reconciliation.build_registry(source, canonical, "source-digest")

        self.assertEqual(registry["result"]["exact_observation_id_override_count"], 1)
        self.assertEqual(registry["result"]["preserved_database_only_count"], 0)
        self.assertEqual(registry["result"]["additive_canonical_only_count"], 0)
        self.assertEqual(
            [item["id"] for item in reconciliation.apply_registry(canonical, registry)],
            ["stored-id"],
        )

    def test_distinct_section_evaluation_and_bidding_record_are_both_preserved(self):
        source = [row("DPI-101-A", respondents=12, has_eval=True, has_bidding=False)]
        canonical = [row("DPI-101", respondents=None, has_eval=False, has_bidding=True)]
        registry = reconciliation.build_registry(source, canonical, "source-digest")
        reconciled = reconciliation.apply_registry(canonical, registry)

        self.assertEqual(registry["result"]["exact_observation_id_override_count"], 0)
        self.assertEqual(registry["result"]["preserved_database_only_count"], 1)
        self.assertEqual(registry["result"]["additive_canonical_only_count"], 1)
        self.assertEqual({item["id"] for item in reconciled}, {"DPI-101", "DPI-101-A"})

    def test_existing_and_canonical_only_rows_form_additive_union(self):
        source = [row("shared"), row("database-only", respondents=8)]
        canonical = [row("shared"), row("canonical-only", respondents=9)]
        registry = reconciliation.build_registry(source, canonical, "source-digest")
        reconciled = reconciliation.apply_registry(canonical, registry)

        self.assertEqual({item["id"] for item in reconciled}, {"shared", "database-only", "canonical-only"})
        self.assertTrue(registry["result"]["zero_omitted_database_rows"])

    def test_same_id_observation_drift_preserves_the_database_source_row(self):
        source = [row("shared", respondents=19, has_eval=True)]
        canonical = [row("shared", respondents=None, has_eval=False, has_bidding=True)]
        registry = reconciliation.build_registry(source, canonical, "source-digest")
        reconciled = reconciliation.apply_registry(canonical, registry)

        self.assertEqual(registry["result"]["same_id_count"], 1)
        self.assertEqual(registry["result"]["same_id_exact_observation_count"], 0)
        self.assertEqual(registry["result"]["same_id_source_preservation_count"], 1)
        self.assertEqual(registry["result"]["same_id_canonical_enrichment_count"], 0)
        self.assertEqual(reconciled, source)

    def test_same_id_canonical_evaluation_enriches_a_bidding_only_source(self):
        source = [row("shared", respondents=None, has_eval=False, has_bidding=True)]
        canonical = [row("shared", respondents=22, has_eval=True, has_bidding=True)]
        registry = reconciliation.build_registry(source, canonical, "source-digest")
        reconciled = reconciliation.apply_registry(canonical, registry)

        self.assertEqual(registry["result"]["same_id_source_preservation_count"], 0)
        self.assertEqual(registry["result"]["same_id_canonical_enrichment_count"], 1)
        self.assertEqual(reconciled[0]["id"], "shared")
        self.assertTrue(reconciled[0]["has_eval"])
        self.assertEqual(reconciled[0]["n_respondents"], 22)
        self.assertEqual(reconciled[0]["metrics_raw"], canonical[0]["metrics_raw"])
        self.assertTrue(reconciled[0]["has_bidding"])

    def test_same_id_unexplained_metric_drift_is_rejected(self):
        source = [row("shared", respondents=19, has_eval=True)]
        canonical = [row("shared", respondents=22, has_eval=True)]

        with self.assertRaisesRegex(RuntimeError, "unexplained observation drift"):
            reconciliation.build_registry(source, canonical, "source-digest")

    def test_same_id_source_preservation_fails_after_canonical_drift(self):
        source = [row("shared", respondents=19, has_eval=True)]
        canonical = [row("shared", respondents=None, has_eval=False, has_bidding=True)]
        registry = reconciliation.build_registry(source, canonical, "source-digest")
        drifted = copy.deepcopy(canonical)
        drifted[0]["course_name"] = "Different course"

        with self.assertRaisesRegex(RuntimeError, "Same-ID canonical observation drifted"):
            reconciliation.apply_registry(drifted, registry)

    def test_same_id_disposition_cannot_be_removed_from_the_registry(self):
        source = [row("shared", respondents=19, has_eval=True)]
        canonical = [row("shared", respondents=None, has_eval=False, has_bidding=True)]
        registry = reconciliation.build_registry(source, canonical, "source-digest")
        registry["same_id_source_preservations"] = []

        with self.assertRaisesRegex(RuntimeError, "source-preservation count"):
            reconciliation.apply_registry(canonical, registry)

    def test_registry_fails_closed_after_observation_drift(self):
        source = [row("stored-id")]
        canonical = [row("generated-id")]
        registry = reconciliation.build_registry(source, canonical, "source-digest")
        drifted = copy.deepcopy(canonical)
        drifted[0]["metrics_raw"]["Course_Rating"] = 1.0

        with self.assertRaisesRegex(RuntimeError, "Observation drifted"):
            reconciliation.apply_registry(drifted, registry)

    def test_registry_fails_closed_after_preserved_row_tampering(self):
        source = [row("database-only")]
        registry = reconciliation.build_registry(source, [], "source-digest")
        registry["preserved_rows"][0]["row"]["n_respondents"] = 999

        with self.assertRaisesRegex(RuntimeError, "failed its registry digest"):
            reconciliation.apply_registry([], registry)

    def test_duplicate_ids_are_rejected(self):
        with self.assertRaisesRegex(RuntimeError, "duplicate immutable id"):
            reconciliation.build_registry([row("same"), row("same")], [], "source-digest")


if __name__ == "__main__":
    unittest.main()
