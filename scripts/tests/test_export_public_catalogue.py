from datetime import datetime, timezone, timedelta
import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import export_public_catalogue as exporter
from copy_public_catalogue import copy_snapshot, read_manifest


def response(rows, total):
    result = Mock(status_code=200, content=exporter.encode(rows), headers={"Content-Range": f"0-0/{total}"})
    result.json.return_value = rows
    return result


class PublicSnapshotTests(unittest.TestCase):
    def source_fixture(self):
        now = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
        observed = (now - timedelta(hours=1)).isoformat()
        ats = [{"id": f"a{i}", "source": "ats", "is_hks": False,
                "sync_run_id": "ats-run", "source_last_seen_at": observed} for i in range(5000)]
        hks = [{"id": f"h{i}", "source": "myharvard", "is_hks": True,
                "sync_run_id": "hks-run", "source_offering_id": f"s{i}", "term": "2027 Spring"}
               for i in range(285)]
        manifest = {"id": "hks-run", "source_snapshot_at": observed, "offering_count": 285,
                    "identity_sha256": hashlib.sha256("\n".join(sorted(r["source_offering_id"] for r in hks)).encode()).hexdigest(),
                    "term_counts": {"2027 Spring": 285}}
        reader = Mock()
        reader.rows.return_value = [manifest]
        return now, ats + hks, reader

    def test_provenance_records_each_source_observation_not_export_time(self):
        now, live, reader = self.source_fixture()
        sources = exporter.source_observations(reader, live, now=now)
        self.assertEqual(sources["ats"]["offeringCount"], 5000)
        self.assertEqual(sources["myharvard"]["offeringCount"], 285)
        self.assertNotEqual(sources["ats"]["observedAt"], now.isoformat())
        self.assertNotIn("ats-run", json.dumps(sources))
        self.assertNotIn("hks-run", json.dumps(sources))

    def test_fresh_export_cannot_disguise_stale_ats_or_hks(self):
        for source in ["ats", "myharvard"]:
            now, live, reader = self.source_fixture()
            stale = (now - timedelta(hours=49)).isoformat()
            if source == "ats":
                for row in live[:5000]:
                    row["source_last_seen_at"] = stale
            else:
                reader.rows.return_value[0]["source_snapshot_at"] = stale
            with self.assertRaisesRegex(ValueError, "source age"):
                exporter.source_observations(reader, live, now=now)

    def test_source_evidence_rejects_mixed_run_and_missing_observation(self):
        for field, value in [("sync_run_id", "other"), ("source_last_seen_at", None)]:
            now, live, reader = self.source_fixture()
            live[0][field] = value
            with self.assertRaises(ValueError):
                exporter.source_observations(reader, live, now=now)

    def test_hks_metadata_must_match_the_exported_generation(self):
        now, live, reader = self.source_fixture()
        live[-1]["sync_run_id"] = "old-hks-run"
        with self.assertRaisesRegex(ValueError, "differs"):
            exporter.source_observations(reader, live, now=now)

    def test_hks_provenance_rejects_manifest_count_digest_and_terms_mismatch(self):
        for field, bad in [("offering_count", 286), ("identity_sha256", "0" * 64), ("term_counts", {"2026 Fall": 285})]:
            now, live, reader = self.source_fixture()
            reader.rows.return_value[0][field] = bad
            with self.assertRaisesRegex(ValueError, "differs"):
                exporter.source_observations(reader, live, now=now)

    def test_provenance_rejects_future_observation(self):
        now, live, reader = self.source_fixture()
        for row in live[:5000]:
            row["source_last_seen_at"] = (now + timedelta(hours=2)).isoformat()
        with self.assertRaisesRegex(ValueError, "source age"):
            exporter.source_observations(reader, live, now=now)

    def test_main_reads_proof_fields_but_does_not_publish_them(self):
        reader = Mock(bytes=123)
        live = [{**{k: None for k in exporter.LIVE_COLUMNS}, "id": "a",
                 "sync_run_id": "private-run", "source_last_seen_at": "time",
                 "source_offering_id": "source-id"}]
        reader.rows.side_effect = [[], live, [], []]
        with tempfile.TemporaryDirectory() as directory, \
                patch.object(sys, "argv", ["export", "--output", directory]), \
                patch.object(exporter, "PublicReader", return_value=reader), \
                patch.object(exporter, "source_observations", return_value={}) as proof, \
                patch.object(exporter, "build_datasets", return_value={}) as build:
            exporter.main()
        columns = reader.rows.call_args_list[1].args[1]
        self.assertTrue({"sync_run_id", "source_last_seen_at", "source_offering_id"}.issubset(columns))
        self.assertIs(proof.call_args.args[1], live)
        self.assertEqual(set(build.call_args.args[1][0]), set(exporter.LIVE_COLUMNS))

    def test_reader_proves_completeness_and_uses_only_explicit_public_columns(self):
        get = Mock(side_effect=[response([{"id": "a"}, {"id": "b"}], 3), response([{"id": "c"}], 3)])
        with patch.object(exporter, "PAGE_SIZE", 2):
            reader = exporter.PublicReader(exporter.PROJECT_URL, "public", get)
            self.assertEqual(reader.rows("courses", ("id",)), [{"id": "a"}, {"id": "b"}, {"id": "c"}])
        self.assertEqual(get.call_args.kwargs["params"]["offset"], 2)
        self.assertEqual(get.call_args.kwargs["params"]["select"], "id")
        self.assertFalse(get.call_args.kwargs["allow_redirects"])

    def test_historical_reader_preserves_legacy_database_order(self):
        get = Mock(return_value=response([{"id": "b"}, {"id": "a"}], 2))
        rows = exporter.PublicReader(exporter.PROJECT_URL, "public", get).rows("courses", ("id",), order=None)
        self.assertEqual([r["id"] for r in rows], ["b", "a"])
        self.assertNotIn("order", get.call_args.kwargs["params"])

    def test_reader_rejects_duplicates_count_drift_and_unknown_fields(self):
        for rows, total in [([{"id": "a"}, {"id": "a"}], 2), ([{"id": "a", "secret": "x"}], 1)]:
            reader = exporter.PublicReader(exporter.PROJECT_URL, "public", Mock(return_value=response(rows, total)))
            with self.assertRaises(ValueError):
                reader.rows("courses", ("id",))
        get = Mock(side_effect=[response([{"id": "a"}], 2), response([{"id": "b"}], 3)])
        with patch.object(exporter, "PAGE_SIZE", 1), self.assertRaisesRegex(ValueError, "changed"):
            exporter.PublicReader(exporter.PROJECT_URL, "public", get).rows("courses", ("id",))

    def test_reader_stops_at_source_byte_budget(self):
        get = Mock(return_value=response([{"id": "a"}], 1))
        with patch.object(exporter, "MAX_EXPORT_BYTES", 2), self.assertRaisesRegex(ValueError, "budget"):
            exporter.PublicReader(exporter.PROJECT_URL, "public", get).rows("courses", ("id",))
        self.assertEqual(get.call_count, 1)

    def test_failed_read_response_still_counts_against_export_budget(self):
        get = Mock(return_value=Mock(status_code=503, content=b"oversized-error", headers={}))
        reader = exporter.PublicReader(exporter.PROJECT_URL, "public", get)
        with patch.object(exporter, "MAX_EXPORT_BYTES", 2), self.assertRaisesRegex(ValueError, "budget"):
            reader.rows("courses", ("id",))
        get.assert_called_once()

    def test_grouping_preserves_fields_values_order_and_all_terms(self):
        history = [{"id": str(i), "metrics_raw": {"Course_Rating": 4.5}, "description": "Same text"} for i in range(5000)]
        live = [{"id": str(i), "term": "2026 Fall" if i % 2 else "2027 Spring", "is_hks": i < 318,
                 "credits": 2 if i % 2 else 4, "meetings": [{"days": ["M"], "start": "10:00"}]} for i in range(5000)]
        credits = [{"id": "credit", "course_code": "API-101", "credits": 4}]
        sections = [{"id": "section", "term": "2026Fall", "meetings": None}]
        datasets = exporter.build_datasets(history, live, credits, sections)
        self.assertEqual(datasets["history"], history)
        self.assertEqual(datasets["credits"], credits)
        self.assertEqual(datasets["live/2026 Fall"], [r for r in live if r["term"] == "2026 Fall"])
        self.assertEqual(datasets["sections/2026Fall"], [{"id": "section", "meetings": None}])
        self.assertEqual(len(datasets["terms"]), 318)
        with tempfile.TemporaryDirectory() as directory:
            manifest = exporter.write_snapshot(directory, datasets)
            for name, entry in manifest["datasets"].items():
                raw = (Path(directory) / entry["path"]).read_bytes()
                self.assertEqual(hashlib.sha256(raw).hexdigest(), entry["sha256"])
                self.assertEqual(json.loads(raw), datasets[name])

    def test_failed_candidate_cannot_verify_as_a_different_release(self):
        get = Mock(return_value=response({"version": "old"}, 0))
        with tempfile.TemporaryDirectory() as directory, self.assertRaisesRegex(ValueError, "exact candidate"):
            copy_snapshot("https://data.pages.dev", directory, get, {"version": "new"})
        self.assertEqual(get.call_count, 1)

    def test_publication_waits_only_for_the_exact_expected_manifest(self):
        expected = {"version": "new", "exportedAt": "today"}
        get = Mock(side_effect=[response({"version": "old"}, 0), response(expected, 0)])
        pause = Mock()
        self.assertEqual(read_manifest("https://data.pages.dev", expected, get, 7, pause), expected)
        self.assertEqual(get.call_count, 2)
        pause.assert_called_once_with(5)
        self.assertTrue(all(call.args[0].endswith('/manifest.json') for call in get.call_args_list))

    def test_publication_wait_is_bounded_and_never_accepts_the_previous_manifest(self):
        get = Mock(return_value=response({"version": "old"}, 0))
        pause = Mock()
        with self.assertRaisesRegex(ValueError, "exact candidate"):
            read_manifest("https://data.pages.dev", {"version": "new"}, get, 3, pause)
        self.assertEqual(get.call_count, 3)
        self.assertEqual(pause.call_count, 2)
        with self.assertRaisesRegex(ValueError, "between"):
            read_manifest("https://data.pages.dev", {}, get, 1000, pause)


if __name__ == "__main__":
    unittest.main()
