"""Safety tests for the production Cloudflare browser-cache control."""

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts" / "ensure_cloudflare_browser_cache.py"
SPEC = importlib.util.spec_from_file_location("ensure_cloudflare_browser_cache_test_subject", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)
CloudflarePolicyError = MODULE.CloudflarePolicyError
ensure_browser_cache_policy = MODULE.ensure_browser_cache_policy


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.requests = []

    def request(self, method, url, **kwargs):
        self.requests.append((method, url, kwargs))
        if not self.responses:
            raise AssertionError("Unexpected Cloudflare request")
        return self.responses.pop(0)


def ok(result):
    return FakeResponse({"success": True, "errors": [], "result": result})


ACTIVE_ZONE = [{"id": "zone-123", "name": "hks-course-explorer.org", "status": "active"}]


class EnsureCloudflareBrowserCacheTests(unittest.TestCase):
    def test_does_not_mutate_when_policy_is_already_safe(self):
        session = FakeSession(
            [ok(ACTIVE_ZONE), ok({"id": "browser_cache_ttl", "value": 0, "editable": True})]
        )

        zone_id, value, changed = ensure_browser_cache_policy(
            token="secret",
            zone_name="hks-course-explorer.org",
            apply=True,
            session=session,
        )

        self.assertEqual((zone_id, value, changed), ("zone-123", 0, False))
        self.assertEqual([request[0] for request in session.requests], ["GET", "GET"])

    def test_updates_exact_zone_and_requires_successful_read_back(self):
        session = FakeSession(
            [
                ok(ACTIVE_ZONE),
                ok({"id": "browser_cache_ttl", "value": 14400, "editable": True}),
                ok({"id": "browser_cache_ttl", "value": 0, "editable": True}),
                ok({"id": "browser_cache_ttl", "value": 0, "editable": True}),
            ]
        )

        result = ensure_browser_cache_policy(
            token="secret",
            zone_name="hks-course-explorer.org",
            apply=True,
            session=session,
        )

        self.assertEqual(result, ("zone-123", 0, True))
        self.assertEqual([request[0] for request in session.requests], ["GET", "GET", "PATCH", "GET"])
        self.assertEqual(session.requests[2][2]["json"], {"value": 0})

    def test_refuses_ambiguous_zone_lookup_before_mutation(self):
        session = FakeSession([ok(ACTIVE_ZONE * 2)])
        with self.assertRaisesRegex(CloudflarePolicyError, "exactly one active"):
            ensure_browser_cache_policy(
                token="secret",
                zone_name="hks-course-explorer.org",
                apply=True,
                session=session,
            )
        self.assertEqual(len(session.requests), 1)

    def test_dry_run_refuses_drift_without_mutating(self):
        session = FakeSession(
            [ok(ACTIVE_ZONE), ok({"id": "browser_cache_ttl", "value": 14400, "editable": True})]
        )
        with self.assertRaisesRegex(CloudflarePolicyError, "rerun with --apply"):
            ensure_browser_cache_policy(
                token="secret",
                zone_name="hks-course-explorer.org",
                apply=False,
                session=session,
            )
        self.assertEqual([request[0] for request in session.requests], ["GET", "GET"])

    def test_fails_when_cloudflare_does_not_persist_zero(self):
        session = FakeSession(
            [
                ok(ACTIVE_ZONE),
                ok({"id": "browser_cache_ttl", "value": 14400, "editable": True}),
                ok({"id": "browser_cache_ttl", "value": 0, "editable": True}),
                ok({"id": "browser_cache_ttl", "value": 14400, "editable": True}),
            ]
        )
        with self.assertRaisesRegex(CloudflarePolicyError, "read-back"):
            ensure_browser_cache_policy(
                token="secret",
                zone_name="hks-course-explorer.org",
                apply=True,
                session=session,
            )


if __name__ == "__main__":
    unittest.main()
