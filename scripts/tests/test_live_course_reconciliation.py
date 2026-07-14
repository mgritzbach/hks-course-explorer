"""Unit tests for the read-only source-aware live-course classifier."""

import hashlib
import json
import unittest
from copy import deepcopy
from datetime import datetime, timezone

from scripts.live_course_reconciliation import (
    ReconciliationError,
    classify_live_course_inventory,
)


def digest(*values):
    return hashlib.sha256("\n".join(sorted(values)).encode("utf-8")).hexdigest()


def queue_digest(*values):
    payload = json.dumps(sorted(values), ensure_ascii=False, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class LiveCourseReconciliationTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 7, 13, tzinfo=timezone.utc)
        self.source = [{"id": "ats-current"}]
        self.runs = [
            {
                "id": "run-active",
                "source": "myharvard",
                "status": "active",
                "offering_count": 2,
                "identity_sha256": digest("offering-a", "offering-b"),
                "term_counts": {"2026 Fall": 1, "2027 Spring": 1},
            },
            {
                "id": "run-rollback",
                "source": "myharvard",
                "status": "superseded",
                "offering_count": 1,
                "identity_sha256": digest("offering-old"),
                "term_counts": {"2026 Fall": 1},
            },
            {
                "id": "run-failed",
                "source": "myharvard",
                "status": "failed",
                "offering_count": 0,
                "identity_sha256": None,
                "term_counts": None,
            },
            {
                "id": "run-ats-active",
                "source": "ats",
                "status": "active",
                "offering_count": 1,
                "identity_sha256": digest("ats-current"),
                "term_counts": {"2026 Fall": 1},
            },
            {
                "id": "run-ats-superseded",
                "source": "ats",
                "status": "superseded",
                "offering_count": 2,
                "identity_sha256": digest("stale-active", "stale-inactive"),
                "term_counts": {"2025 Fall": 1, "2026 Fall": 1},
            },
        ]
        self.rows = [
            {
                "id": "ats-current",
                "source": "ats",
                "active": True,
                "is_hks": False,
                "sync_run_id": "run-ats-active",
                "school": "FAS",
                "term": "2026 Fall",
                "synced_at": "2026-07-13T00:00:00Z",
                "source_last_seen_at": "2026-07-13T00:00:00Z",
            },
            {
                "id": "myh-active-a",
                "source": "myharvard",
                "active": True,
                "is_hks": True,
                "sync_run_id": "run-active",
                "source_offering_id": "offering-a",
                "source_course_id": "legacy-hks-course",
                "term": "2026 Fall",
            },
            {
                "id": "myh-active-b",
                "source": "myharvard",
                "active": True,
                "is_hks": True,
                "sync_run_id": "run-active",
                "source_offering_id": "offering-b",
                "source_course_id": "other-hks-course",
                "term": "2027 Spring",
            },
            {
                "id": "myh-rollback",
                "source": "myharvard",
                "active": False,
                "is_hks": True,
                "sync_run_id": "run-rollback",
                "source_offering_id": "offering-old",
                "source_course_id": "legacy-hks-course",
                "term": "2026 Fall",
            },
            {
                "id": "legacy-hks-course",
                "source": "ats",
                "active": False,
                "is_hks": False,
                "sync_run_id": None,
                "school": "FAS",
                "term": "2026 Fall",
                "synced_at": "2026-07-01T00:00:00Z",
                "source_last_seen_at": "2026-07-01T00:00:00Z",
            },
            {
                "id": "stale-active",
                "source": "ats",
                "active": False,
                "is_hks": False,
                "sync_run_id": "run-ats-superseded",
                "school": "GSD",
                "term": "2026 Fall",
                "synced_at": "2026-07-12T00:00:00Z",
                "source_last_seen_at": "2026-07-12T00:00:00Z",
            },
            {
                "id": "stale-inactive",
                "source": "ats",
                "active": False,
                "is_hks": False,
                "sync_run_id": None,
                "school": "HLS",
                "term": "2025 Fall",
                "synced_at": "2026-05-01T00:00:00Z",
                "source_last_seen_at": "2026-05-01T00:00:00Z",
            },
        ]

    def classify(self, rows=None, source=None, runs=None):
        return classify_live_course_inventory(
            source if source is not None else self.source,
            rows if rows is not None else self.rows,
            runs if runs is not None else self.runs,
            now=self.now,
        )

    def test_partitions_every_row_and_emits_only_aggregate_queue_evidence(self):
        report = self.classify()

        self.assertEqual(report["database_row_count"], 7)
        self.assertEqual(report["classified_row_count"], 7)
        self.assertEqual(report["current_non_hks_ats_count"], 1)
        self.assertTrue(report["ats_manifest_enforced"])
        self.assertEqual(report["protected_active_myharvard_count"], 2)
        self.assertEqual(report["protected_myharvard_rollback_count"], 1)
        self.assertEqual(report["protected_legacy_hks_fallback_count"], 1)
        self.assertEqual(report["actionable_retained_non_hks_ats_count"], 2)
        self.assertEqual(
            report["actionable_queue_sha256"], queue_digest("stale-active", "stale-inactive")
        )
        self.assertEqual(report["actionable_by_active_state"], {"inactive": 2})
        self.assertEqual(report["actionable_by_age"], {"over_30_days": 1, "under_2_days": 1})
        self.assertEqual(report["actionable_by_school"], {"GSD": 1, "HLS": 1})
        self.assertEqual(report["actionable_by_term"], {"2025 Fall": 1, "2026 Fall": 1})
        self.assertNotIn("stale-active", repr(report))
        self.assertNotIn("stale-inactive", repr(report))

    def test_manifest_mode_rejects_active_retained_or_wrong_current_run(self):
        rows = deepcopy(self.rows)
        rows[5]["active"] = True
        with self.assertRaisesRegex(ReconciliationError, "retained ATS row is still active"):
            self.classify(rows=rows)

        rows = deepcopy(self.rows)
        rows[0]["sync_run_id"] = "run-ats-superseded"
        with self.assertRaisesRegex(ReconciliationError, "current ATS row"):
            self.classify(rows=rows)

    def test_manifest_mode_fails_on_ats_manifest_drift(self):
        runs = deepcopy(self.runs)
        next(run for run in runs if run["id"] == "run-ats-active")[
            "identity_sha256"
        ] = "0" * 64
        with self.assertRaisesRegex(ReconciliationError, "active ATS.*identity digest"):
            self.classify(runs=runs)

    def test_legacy_pre_manifest_inventory_remains_classifiable_during_rollout(self):
        runs = [run for run in deepcopy(self.runs) if run["source"] == "myharvard"]
        rows = deepcopy(self.rows)
        for row in rows:
            if row["source"] == "ats":
                row["sync_run_id"] = None
        rows[5]["active"] = True

        report = self.classify(rows=rows, runs=runs)

        self.assertFalse(report["ats_manifest_enforced"])
        self.assertEqual(report["actionable_by_active_state"], {"active": 1, "inactive": 1})

    def test_fails_if_a_current_source_row_is_missing_or_not_current_ats(self):
        with self.assertRaisesRegex(ReconciliationError, "missing from live_courses"):
            self.classify(source=self.source + [{"id": "not-in-database"}])

        rows = deepcopy(self.rows)
        rows[0]["active"] = False
        with self.assertRaisesRegex(ReconciliationError, "current ATS row"):
            self.classify(rows=rows)

        legacy_runs = [run for run in self.runs if run["source"] == "myharvard"]
        legacy_rows = deepcopy(self.rows)
        legacy_rows[0]["active"] = False
        for row in legacy_rows:
            if row["source"] == "ats":
                row["sync_run_id"] = None
        with self.assertRaisesRegex(ReconciliationError, "different population"):
            self.classify(
                rows=legacy_rows,
                source=[{"id": "myh-active-a"}],
                runs=legacy_runs,
            )

        with self.assertRaisesRegex(ReconciliationError, "overlaps active my.harvard"):
            self.classify(source=self.source + [{"id": "legacy-hks-course"}])

    def test_fails_on_duplicate_or_unowned_rows(self):
        with self.assertRaisesRegex(ReconciliationError, "duplicate IDs"):
            self.classify(source=self.source + deepcopy(self.source))

        rows = deepcopy(self.rows)
        rows.append(deepcopy(rows[0]))
        with self.assertRaisesRegex(ReconciliationError, "duplicate IDs"):
            self.classify(rows=rows)

        rows = deepcopy(self.rows)
        rows[-1]["source"] = "unknown"
        with self.assertRaisesRegex(ReconciliationError, "unowned row state"):
            self.classify(rows=rows)

    def test_fails_when_protected_hks_state_or_manifest_drifts(self):
        rows = deepcopy(self.rows)
        rows[1]["active"] = False
        with self.assertRaisesRegex(ReconciliationError, "active my.harvard ownership"):
            self.classify(rows=rows)

        runs = deepcopy(self.runs)
        runs[0]["identity_sha256"] = "0" * 64
        with self.assertRaisesRegex(ReconciliationError, "identity digest"):
            self.classify(runs=runs)

        rows = deepcopy(self.rows)
        rows[1]["source_course_id"] = ""
        with self.assertRaisesRegex(ReconciliationError, "has no source_course_id"):
            self.classify(rows=rows)

        rows = deepcopy(self.rows)
        rows[4]["active"] = True
        with self.assertRaisesRegex(ReconciliationError, "legacy HKS fallback"):
            self.classify(rows=rows)

        rows = [row for row in self.rows if row.get("sync_run_id") != "run-rollback"]
        with self.assertRaisesRegex(ReconciliationError, "exactly one row-bearing"):
            self.classify(rows=rows)

        rows = [row for row in self.rows if row.get("sync_run_id") != "run-active"]
        with self.assertRaisesRegex(ReconciliationError, "active my.harvard.*retains no rows"):
            self.classify(rows=rows)

    def test_fails_closed_on_invalid_actionable_last_seen_evidence(self):
        rows = deepcopy(self.rows)
        rows[-1]["source_last_seen_at"] = None
        rows[-1]["synced_at"] = None
        with self.assertRaisesRegex(ReconciliationError, "no source_last_seen_at"):
            self.classify(rows=rows)

        rows = deepcopy(self.rows)
        rows[-1]["source_last_seen_at"] = "2026-07-14T00:00:00Z"
        with self.assertRaisesRegex(ReconciliationError, "future source_last_seen_at"):
            self.classify(rows=rows)

    def test_allows_bounded_database_clock_skew_but_rejects_null_booleans(self):
        rows = deepcopy(self.rows)
        rows[-1]["source_last_seen_at"] = "2026-07-13T00:03:00Z"
        report = self.classify(rows=rows)
        self.assertEqual(report["actionable_by_age"]["under_2_days"], 2)

        rows = deepcopy(self.rows)
        rows[-1]["active"] = None
        with self.assertRaisesRegex(ReconciliationError, "non-boolean ownership state"):
            self.classify(rows=rows)

    def test_actionable_digest_is_unambiguous_for_ids_containing_newlines(self):
        rows = deepcopy(self.rows[:5])
        for row_id in ("a", "b"):
            rows.append(
                {
                    "id": row_id,
                    "source": "ats",
                    "active": False,
                    "is_hks": False,
                    "sync_run_id": "run-ats-superseded",
                    "school": "FAS",
                    "term": "2026 Fall",
                    "synced_at": "2026-07-12T00:00:00Z",
                    "source_last_seen_at": "2026-07-12T00:00:00Z",
                }
            )
        separate = self.classify(rows=rows)["actionable_queue_sha256"]

        newline_rows = deepcopy(self.rows[:5])
        newline_rows.append(
            {
                "id": "a\nb",
                "source": "ats",
                "active": False,
                "is_hks": False,
                "sync_run_id": "run-ats-superseded",
                "school": "FAS",
                "term": "2026 Fall",
                "synced_at": "2026-07-12T00:00:00Z",
                "source_last_seen_at": "2026-07-12T00:00:00Z",
            }
        )
        combined = self.classify(rows=newline_rows)["actionable_queue_sha256"]

        self.assertNotEqual(separate, combined)


if __name__ == "__main__":
    unittest.main()
