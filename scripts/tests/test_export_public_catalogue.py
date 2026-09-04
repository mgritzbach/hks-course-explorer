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
