"""Tests for the read-only production HKS manifest parity gate."""

from __future__ import annotations

import importlib.util
import sys
import unittest
import hashlib
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import Mock

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "verify_live_hks_catalogue.py"


def load_module():
    name = "verify_live_hks_catalogue_test_subject"
    sys.modules.pop(name, None)
    spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class LiveHksCatalogueVerificationTests(unittest.TestCase):
    def setUp(self):
        self.verify = load_module()
        self.now = datetime(2026, 7, 12, 12, tzinfo=timezone.utc)
        self.manifest = {
            "id": "run-1",
            "offering_count": 2,
            "source_snapshot_at": "2026-07-12T10:00:00Z",
            "activated_at": "2026-07-12T10:02:00Z",
            "identity_sha256": hashlib.sha256(
                "myh|fall\nmyh|spring".encode("utf-8")
            ).hexdigest(),
            "term_counts": {"2026 Fall": 1, "2027 Spring": 1},
        }
        self.rows = [
            {
                "id": "myh|fall",
                "source_offering_id": "myh|fall",
                "course_code": "API-101-A",
                "title": "Analysis",
                "term": "2026 Fall",
                "source": "myharvard",
                "sync_run_id": "run-1",
            },
            {
                "id": "myh|spring",
                "source_offering_id": "myh|spring",
                "course_code": "IGA-101-A",
                "title": "Institutions",
                "term": "2027 Spring",
                "source": "myharvard",
                "sync_run_id": "run-1",
            },
        ]

    def test_reports_exact_manifest_row_and_term_parity(self):
        report = self.verify.verify_catalogue(self.manifest, self.rows, now=self.now)

        self.assertEqual(report["offering_count"], 2)
        self.assertEqual(report["distinct_ids"], 2)
        self.assertEqual(report["distinct_source_ids"], 2)
        self.assertEqual(report["terms"], {"2026 Fall": 1, "2027 Spring": 1})
        self.assertEqual(len(report["identity_sha256"]), 64)

    def test_rejects_count_source_run_and_freshness_mismatches(self):
        with self.assertRaisesRegex(RuntimeError, "does not match manifest"):
            self.verify.verify_catalogue(self.manifest, self.rows[:1], now=self.now)

        bad_source = [dict(self.rows[0], source="ats"), self.rows[1]]
        with self.assertRaisesRegex(RuntimeError, "outside the active my.harvard run"):
            self.verify.verify_catalogue(self.manifest, bad_source, now=self.now)

        stale = dict(self.manifest, source_snapshot_at="2026-07-09T10:00:00Z")
        with self.assertRaisesRegex(RuntimeError, "exceeds the 48.0h limit"):
            self.verify.verify_catalogue(stale, self.rows, now=self.now)

    def test_reads_the_active_manifest_with_publishable_headers(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [self.manifest]
        request_get = Mock(return_value=response)

        manifest = self.verify.fetch_active_manifest(
            "https://example.supabase.co", "publishable-key", request_get
        )

        self.assertEqual(manifest, self.manifest)
        self.assertEqual(request_get.call_args.kwargs["headers"]["apikey"], "publishable-key")
        self.assertEqual(request_get.call_args.kwargs["params"]["status"], "eq.active")
        self.assertEqual(request_get.call_args.kwargs["params"]["limit"], "2")

    def test_rejects_multiple_active_manifests(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [self.manifest, dict(self.manifest, id="run-2")]

        with self.assertRaisesRegex(RuntimeError, "exactly one active"):
            self.verify.fetch_active_manifest(
                "https://example.supabase.co", "publishable-key", Mock(return_value=response)
            )

    def test_rejects_persisted_identity_and_term_manifest_mismatches(self):
        bad_digest = dict(self.manifest, identity_sha256="0" * 64)
        with self.assertRaisesRegex(RuntimeError, "persisted upstream digest"):
            self.verify.verify_catalogue(bad_digest, self.rows, now=self.now)

        bad_terms = dict(self.manifest, term_counts={"2026 Fall": 2})
        with self.assertRaisesRegex(RuntimeError, "persisted upstream term counts"):
            self.verify.verify_catalogue(bad_terms, self.rows, now=self.now)


if __name__ == "__main__":
    unittest.main()
