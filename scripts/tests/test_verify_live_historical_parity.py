import copy
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import historical_parity_reconciliation as reconciliation  # noqa: E402
import verify_live_historical_parity as verifier  # noqa: E402
from load_to_supabase import prepare_row  # noqa: E402


def canonical(row_id, rating):
    return {
        "id": row_id,
        "course_code": "API-101",
        "course_code_base": "API-101",
        "year": 2025,
        "term": "Fall",
        "professor": "Example, Avery",
        "course_name": "Policy",
        "has_eval": True,
        "metrics_raw": {"Course_Rating": rating},
        "metrics_pct": {"Course_Rating": 50},
    }


class Response:
    def __init__(self, status, payload):
        self.status_code = status
        self._payload = payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError("http failure")

    def json(self):
        return self._payload


class LiveHistoricalParityVerifierTests(unittest.TestCase):
    def fixture(self):
        original = prepare_row(canonical("existing", 4.0))
        added_course = canonical("added", 4.5)
        added = prepare_row(added_course)
        database = [added, original]
        registry = {
            "source": {
                "database_row_count": 1,
                "database_id_sha256": reconciliation.id_digest([original]),
                "database_row_sha256": reconciliation.sha256_json([original]),
                "database_unchanged_after_enrichment_row_count": 1,
                "database_unchanged_after_enrichment_row_sha256": reconciliation.sha256_json(
                    [original]
                ),
            },
            "result": {
                "projected_row_count": 2,
                "projected_id_sha256": reconciliation.id_digest(database),
            },
            "additive_canonical_ids": ["added"],
            "same_id_canonical_enrichments": [],
        }
        return database, [added_course, canonical("existing", 4.0)], registry

    def test_exact_additive_and_unchanged_populations_pass(self):
        database, courses, registry = self.fixture()
        report = verifier.verify_live_catalogue(database, courses, registry)
        self.assertEqual(report["historical_row_count"], 2)
        self.assertEqual(report["unchanged_prechange_row_count"], 1)
        self.assertEqual(report["additive_row_count"], 1)

    def test_prechange_payload_drift_fails(self):
        database, courses, registry = self.fixture()
        database[1]["course_name"] = "Changed"
        with self.assertRaisesRegex(RuntimeError, "non-enriched historical.*payload changed"):
            verifier.verify_live_catalogue(database, courses, registry)

    def test_exact_pre_migration_manifest_and_payload_pass(self):
        database, _courses, registry = self.fixture()
        report = verifier.verify_pre_migration_catalogue([database[1]], registry)
        self.assertEqual(report["phase"], "before")
        self.assertEqual(report["historical_row_count"], 1)
        self.assertTrue(report["additive_ids_absent"])

    def test_pre_migration_payload_drift_fails(self):
        database, _courses, registry = self.fixture()
        before = copy.deepcopy(database[1])
        before["course_name"] = "Changed"
        with self.assertRaisesRegex(RuntimeError, "full row payload drifted"):
            verifier.verify_pre_migration_catalogue([before], registry)

    def test_same_id_enrichment_and_addition_pass_exactly(self):
        before = prepare_row(canonical("existing", 4.0))
        before["has_eval"] = False
        before["n_respondents"] = None
        before["metrics_raw"] = {"Course_Rating": None}
        before["metrics_pct"] = {"Course_Rating": None}
        target_course = canonical("existing", 4.0)
        target = reconciliation.same_id_evaluation_enrichment_target(
            before, prepare_row(target_course)
        )
        added_course = canonical("added", 4.5)
        added = prepare_row(added_course)
        database = [added, target]
        registry = {
            "source": {
                "database_row_count": 1,
                "database_id_sha256": reconciliation.id_digest([before]),
                "database_row_sha256": reconciliation.sha256_json([before]),
                "database_unchanged_after_enrichment_row_count": 0,
                "database_unchanged_after_enrichment_row_sha256": reconciliation.sha256_json(
                    []
                ),
            },
            "result": {
                "projected_row_count": 2,
                "projected_id_sha256": reconciliation.id_digest(database),
            },
            "additive_canonical_ids": ["added"],
            "same_id_canonical_enrichments": [
                {
                    "id": "existing",
                    "row": before,
                    "row_sha256": reconciliation.sha256_json(before),
                    "source_observation_sha256": reconciliation.observation_digest(before),
                    "canonical_observation_sha256": reconciliation.observation_digest(
                        target_course
                    ),
                }
            ],
        }
        report = verifier.verify_live_catalogue(
            database, [added_course, target_course], registry
        )
        self.assertEqual(report["unchanged_prechange_row_count"], 0)
        self.assertEqual(report["same_id_evaluation_enrichment_count"], 1)

    def test_additive_payload_drift_fails(self):
        database, courses, registry = self.fixture()
        database[0]["course_name"] = "Changed"
        with self.assertRaisesRegex(RuntimeError, "Additive historical row payload differs"):
            verifier.verify_live_catalogue(database, courses, registry)

    def test_wrong_origin_is_rejected_before_request(self):
        with self.assertRaisesRegex(RuntimeError, "reviewed production project"):
            verifier.fetch_courses("https://example.supabase.co", "public")

    def test_redirect_is_rejected(self):
        def redirect(*_args, **_kwargs):
            return Response(302, [])

        with self.assertRaisesRegex(RuntimeError, "redirect refused"):
            verifier.fetch_courses(verifier.PRODUCTION_PROJECT_URL, "public", redirect)

    def test_duplicate_database_ids_fail(self):
        database, courses, registry = self.fixture()
        duplicate = copy.deepcopy(database[0])
        database.append(duplicate)
        registry["result"]["projected_row_count"] = 3
        with self.assertRaisesRegex(RuntimeError, "duplicate immutable ids"):
            verifier.verify_live_catalogue(database, courses, registry)

    def test_workflow_exposes_protected_before_and_after_phases(self):
        workflow = (
            ROOT / ".github" / "workflows" / "verify-live-historical-parity.yml"
        ).read_text(encoding="utf-8")
        self.assertIn("phase:", workflow)
        self.assertIn("- before", workflow)
        self.assertIn("- after", workflow)
        self.assertIn("github.ref == 'refs/heads/master'", workflow)
        self.assertIn('--phase "${{ inputs.phase }}"', workflow)


if __name__ == "__main__":
    unittest.main()
