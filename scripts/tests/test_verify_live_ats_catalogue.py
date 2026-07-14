import hashlib
import json
import sys
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import verify_live_ats_catalogue as verifier


def row(row_id, *, active, term="2026 Fall", code=None, run_id="run-1"):
    return {
        "id": row_id,
        "course_code": code or row_id.upper(),
        "title": f"Course {row_id}",
        "term": term,
        "school": "FAS",
        "source": "ats",
        "is_hks": False,
        "sync_run_id": run_id if active else "old-run",
        "active": active,
        "source_last_seen_at": "2026-07-14T00:00:00Z",
    }


class VerifyLiveAtsCatalogueTests(unittest.TestCase):
    def setUp(self):
        self.rows = [row("active-a", active=True), row("active-b", active=True), row("old", active=False)]
        digest = hashlib.sha256(b"active-a\nactive-b").hexdigest()
        self.manifest = {
            "id": "run-1",
            "offering_count": 2,
            "identity_sha256": digest,
            "term_counts": {"2026 Fall": 2},
            "source_snapshot_at": "2026-07-14T00:00:00Z",
        }

    def verify(self, **kwargs):
        now = kwargs.pop("now", datetime(2026, 7, 14, 1, tzinfo=timezone.utc))
        return verifier.verify_ats_catalogue(
            self.manifest,
            self.rows,
            ats_owned_hks_rows=[],
            now=now,
            **kwargs,
        )

    def test_accepts_exact_active_manifest_and_retained_row(self):
        report = self.verify()
        self.assertEqual(report["active_offering_count"], 2)
        self.assertEqual(report["retained_inactive_count"], 1)
        self.assertEqual(report["active_candidate"]["id"], "active-a")
        self.assertEqual(report["browser_term_count"], 2)

    def test_rejects_manifest_drift(self):
        self.manifest["identity_sha256"] = "0" * 64
        with self.assertRaisesRegex(RuntimeError, "identities do not match"):
            self.verify()

    def test_rejects_missing_observation_timestamp(self):
        self.rows[-1]["source_last_seen_at"] = None
        with self.assertRaisesRegex(RuntimeError, "missing observation"):
            self.verify()

    def test_rejects_hks_owned_by_active_ats_run(self):
        with self.assertRaisesRegex(RuntimeError, "owns an HKS row"):
            verifier.verify_ats_catalogue(
                self.manifest, self.rows, ats_owned_hks_rows=[{"id": "protected"}]
            )

    def test_rejects_stale_manifest(self):
        with self.assertRaisesRegex(RuntimeError, "age"):
            self.verify(now=datetime(2026, 7, 20, tzinfo=timezone.utc))

    def test_requires_exact_production_origin(self):
        self.assertEqual(
            verifier.validate_production_url("https://cbtroatixvydpwoviezf.supabase.co/"),
            verifier.PRODUCTION_PROJECT_URL,
        )
        for unsafe in (
            "https://cbtroatixvydpwoviezf.supabase.co.attacker.example",
            "https://cbtroatixvydpwoviezf.supabase.co/rest/v1",
            "https://cbtroatixvydpwoviezf.supabase.co?redirect=1",
            "http://cbtroatixvydpwoviezf.supabase.co",
        ):
            with self.subTest(unsafe=unsafe), self.assertRaisesRegex(RuntimeError, "reviewed"):
                verifier.validate_production_url(unsafe)

    def test_rest_request_validation_happens_before_request(self):
        called = False

        def request_get(*args, **kwargs):
            nonlocal called
            called = True
            raise AssertionError("unsafe request must not run")

        with self.assertRaisesRegex(RuntimeError, "reviewed"):
            verifier.fetch_json(
                "https://cbtroatixvydpwoviezf.supabase.co.attacker.example/rest/v1/live_courses",
                "service-key",
                {},
                request_get,
            )
        self.assertFalse(called)

    def test_refuses_redirects_without_following_them(self):
        class Redirect:
            status_code = 302

            def raise_for_status(self):
                raise AssertionError("redirect should be rejected before status handling")

        calls = []

        def request_get(url, **kwargs):
            calls.append((url, kwargs))
            return Redirect()

        with self.assertRaisesRegex(RuntimeError, "redirect refused"):
            verifier.fetch_json(
                f"{verifier.PRODUCTION_PROJECT_URL}/rest/v1/live_courses",
                "service-key",
                {},
                request_get,
            )
        self.assertFalse(calls[0][1]["allow_redirects"])

    def test_shared_hks_transport_also_refuses_redirects(self):
        response = mock.Mock(status_code=302)
        with mock.patch.object(verifier.requests, "get", return_value=response) as request_get:
            with self.assertRaisesRegex(RuntimeError, "redirect refused"):
                verifier.secure_request_get(
                    f"{verifier.PRODUCTION_PROJECT_URL}/rest/v1/live_courses",
                    headers={"Authorization": "Bearer service-key"},
                )
        self.assertFalse(request_get.call_args.kwargs["allow_redirects"])

    def test_workflow_is_master_only_exact_sha_and_serialized(self):
        workflow = (ROOT / ".github" / "workflows" / "verify-live-ats-catalogue.yml").read_text(
            encoding="utf-8"
        )
        self.assertIn("if: github.ref == 'refs/heads/master'", workflow)
        self.assertIn("ref: ${{ github.sha }}", workflow)
        self.assertIn("group: hks-production-catalogue-sync", workflow)
        self.assertIn("cancel-in-progress: false", workflow)
        self.assertIn("--config=playwright.ats-production.config.js", workflow)

        spec = (ROOT / "tests" / "production" / "ats-catalogue-closeout.spec.js").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("test.skip", spec)
        self.assertIn("Protected ATS browser evidence is missing or invalid", spec)
        default_config = (ROOT / "playwright.production.config.js").read_text(encoding="utf-8")
        self.assertIn("testIgnore: '**/ats-catalogue-closeout.spec.js'", default_config)

    def test_candidate_details_are_not_in_aggregate_log_report(self):
        report = self.verify()
        aggregate = verifier.aggregate_report(report)
        serialized = json.dumps(aggregate)
        self.assertNotIn("active-a", serialized)
        self.assertNotIn("old", serialized)

        with tempfile.TemporaryDirectory() as directory:
            env_path = Path(directory) / "github-env"
            verifier.write_github_env(env_path, report)
            env_text = env_path.read_text(encoding="utf-8")
        self.assertIn("ATS_ACTIVE_CODE=ACTIVE-A", env_text)
        self.assertIn("ATS_ACTIVE_TERM_COUNT=2", env_text)
        self.assertNotIn("OLD", env_text)


if __name__ == "__main__":
    unittest.main()
