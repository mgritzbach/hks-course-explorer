"""Regression contract for accountable, zero-cost service ownership."""

import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


class OperationalOwnershipTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ownership = (ROOT / "docs" / "OWNERSHIP.md").read_text(encoding="utf-8")
        cls.codeowners = (ROOT / ".github" / "CODEOWNERS").read_text(encoding="utf-8")
        cls.security = (ROOT / ".github" / "SECURITY.md").read_text(encoding="utf-8")
        cls.operations = (ROOT / "docs" / "OPERATIONS.md").read_text(encoding="utf-8")
        cls.readme = (ROOT / "README.md").read_text(encoding="utf-8")

    def test_current_owner_covers_every_production_boundary(self):
        for boundary in (
            "Product and release decisions",
            "Repository and CI/CD",
            "Supabase and catalogue data",
            "Cloudflare Pages and Functions",
            "Observability and providers",
        ):
            self.assertIn(boundary, self.ownership)
        self.assertGreaterEqual(self.ownership.count("`@mgritzbach`"), 5)

    def test_codeowners_covers_high_risk_paths(self):
        for path in ("*", "/.github/workflows/", "/functions/", "/supabase/", "/scripts/", "/data/"):
            self.assertIn(f"{path} @mgritzbach", self.codeowners)

    def test_incident_cost_and_handover_contracts_are_explicit(self):
        for required in (
            "| P0 |",
            "| P1 |",
            "| P2 |",
            "Mandatory zero-cost control",
            "hard `$0` spend/usage limit",
            "Successor IT-team acceptance checklist",
            "the transfer is incomplete",
        ):
            self.assertIn(required, self.ownership)

    def test_primary_handover_documents_link_to_ownership(self):
        self.assertIn("[`OWNERSHIP.md`](OWNERSHIP.md)", self.operations)
        self.assertIn("[service ownership](docs/OWNERSHIP.md)", self.readme)

    def test_private_vulnerability_intake_is_discoverable_and_safe(self):
        self.assertIn(
            "https://github.com/mgritzbach/hks-course-explorer/security/advisories/new",
            self.security,
        )
        self.assertIn("Do not put secrets, tokens, student data", self.security)
        self.assertIn("[`.github/SECURITY.md`](../.github/SECURITY.md)", self.ownership)

    def test_pages_rollback_is_actionable_and_separate_from_database_recovery(self):
        for required in (
            "## Manual Cloudflare Pages rollback",
            "Rollback to this deployment",
            "/deployments/$env:ROLLBACK_DEPLOYMENT_ID/rollback",
            "node scripts/smoke_deployed_site.mjs",
            "npm run test:e2e:production",
        ):
            self.assertIn(required, self.operations)
        self.assertIn(
            "does **not** roll back Supabase data",
            " ".join(self.operations.split()),
        )


if __name__ == "__main__":
    unittest.main()
