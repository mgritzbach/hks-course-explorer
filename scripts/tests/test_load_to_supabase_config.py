"""Regression coverage for trusted loader target-project configuration."""

import importlib.util
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "load_to_supabase.py"


def load_module(environment):
    name = "load_to_supabase_test_subject"
    sys.modules.pop(name, None)
    with patch.dict(os.environ, environment, clear=True):
        spec = importlib.util.spec_from_file_location(name, MODULE_PATH)
        module = importlib.util.module_from_spec(spec)
        sys.modules[name] = module
        spec.loader.exec_module(module)
        return module


class LoadToSupabaseConfigTests(unittest.TestCase):
    def test_missing_target_values_never_select_a_project_fallback(self):
        loader = load_module({})

        self.assertEqual(loader.SUPABASE_URL, "")
        self.assertEqual(loader.SUPABASE_KEY, "")
        with self.assertRaises(SystemExit) as exit_context:
            loader.main()
        self.assertIn("SUPABASE_URL and SUPABASE_KEY", str(exit_context.exception))

    def test_load_courses_rejects_invalid_payload_shapes(self):
        loader = load_module({})
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "courses.json"
            cases = (
                ([], "JSON object"),
                ({"courses": {}}, "'courses' array"),
                ({"courses": ["bad"]}, "must be an object"),
            )
            for payload, message in cases:
                path.write_text(json.dumps(payload), encoding="utf-8")
                with patch.object(loader, "COURSES_JSON", path), self.assertRaises(SystemExit) as exit_context:
                    loader.load_courses()
                self.assertIn(message, str(exit_context.exception))

            path.write_text("not-json", encoding="utf-8")
            with patch.object(loader, "COURSES_JSON", path), self.assertRaises(SystemExit) as exit_context:
                loader.load_courses()
            self.assertIn("not valid UTF-8 JSON", str(exit_context.exception))

            path.write_bytes(b"\xff\xfe")
            with patch.object(loader, "COURSES_JSON", path), self.assertRaises(SystemExit) as exit_context:
                loader.load_courses()
            self.assertIn("not valid UTF-8 JSON", str(exit_context.exception))

    def test_validate_prepared_rows_rejects_missing_and_duplicate_ids(self):
        loader = load_module({})
        with self.assertRaises(SystemExit) as exit_context:
            loader.validate_prepared_rows([{"id": ""}])
        self.assertIn("missing or invalid id", str(exit_context.exception))
        with self.assertRaises(SystemExit) as exit_context:
            loader.validate_prepared_rows([{"id": "a"}, {"id": "a"}, {"id": "b"}])
        self.assertIn("duplicate prepared course id", str(exit_context.exception))

    def test_validate_prepared_rows_accepts_valid_ids_without_mutation(self):
        loader = load_module({})
        rows = [{"id": "a"}, {"id": "b"}]
        self.assertIsNone(loader.validate_prepared_rows(rows))
        self.assertEqual(rows, [{"id": "a"}, {"id": "b"}])

    def test_database_count_mismatch_is_a_failed_promotion(self):
        loader = load_module({})
        with self.assertRaises(SystemExit) as missing_count:
            loader.require_database_count(None, 2)
        self.assertIn("did not return", str(missing_count.exception))

        with self.assertRaises(SystemExit) as stale_count:
            loader.require_database_count(3, 2)
        self.assertIn("No stale rows were deleted automatically", str(stale_count.exception))

        self.assertIsNone(loader.require_database_count(2, 2))

    def test_invalid_preflight_exits_before_creating_a_supabase_client(self):
        loader = load_module({"SUPABASE_URL": "https://target.supabase.co", "SUPABASE_KEY": "test-service-key"})
        fake_supabase = types.ModuleType("supabase")
        fake_supabase.create_client = Mock()
        with patch.object(loader, "load_courses", return_value=[{"id": ""}]), patch.dict(sys.modules, {"supabase": fake_supabase}):
            with self.assertRaises(SystemExit) as exit_context:
                loader.main()
        self.assertIn("missing or invalid id", str(exit_context.exception))
        fake_supabase.create_client.assert_not_called()

    def test_duplicate_preflight_exits_before_creating_a_supabase_client(self):
        loader = load_module(
            {"SUPABASE_URL": "https://target.supabase.co", "SUPABASE_KEY": "test-service-key"}
        )
        fake_supabase = types.ModuleType("supabase")
        fake_supabase.create_client = Mock()
        with patch.object(
            loader,
            "load_courses",
            return_value=[{"id": "duplicate"}, {"id": "duplicate"}],
        ), patch.dict(sys.modules, {"supabase": fake_supabase}):
            with self.assertRaises(SystemExit) as exit_context:
                loader.main()
        self.assertIn("duplicate prepared course id", str(exit_context.exception))
        fake_supabase.create_client.assert_not_called()

    def test_repository_generated_catalogue_has_valid_prepared_ids(self):
        loader = load_module({})
        rows = [loader.prepare_row(course) for course in loader.load_courses()]
        self.assertGreater(len(rows), 5_000)
        self.assertIsNone(loader.validate_prepared_rows(rows))
        self.assertEqual(loader.find_duplicate_prepared_ids(rows), [])


if __name__ == "__main__":
    unittest.main()
