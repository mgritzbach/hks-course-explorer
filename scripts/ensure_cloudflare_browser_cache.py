"""Keep the production domain aligned with the Pages cache policy.

Cloudflare zones default to a four-hour browser cache. That default can
override the shorter Cache-Control header emitted by Cloudflare Pages and can
leave visitors running an obsolete JavaScript bundle after a deployment.

This script targets one exact, active zone and sets ``browser_cache_ttl`` to
zero, which Cloudflare defines as "Respect Existing Headers". It then reads the
setting back and fails unless the requested value is active.
"""

from __future__ import annotations

import argparse
import os
from typing import Any

import requests


DEFAULT_API_BASE = "https://api.cloudflare.com/client/v4"
SETTING_ID = "browser_cache_ttl"
RESPECT_EXISTING_HEADERS = 0


class CloudflarePolicyError(RuntimeError):
    """Raised when the requested zone setting cannot be verified safely."""


def _request_json(
    session: requests.Session,
    method: str,
    url: str,
    *,
    token: str,
    params: dict[str, str] | None = None,
    json: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response = session.request(
        method,
        url,
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        params=params,
        json=json,
        timeout=20,
    )
    try:
        payload = response.json()
    except ValueError as exc:
        raise CloudflarePolicyError(
            f"Cloudflare returned non-JSON content with HTTP {response.status_code}"
        ) from exc

    if response.status_code >= 400 or payload.get("success") is not True:
        errors = payload.get("errors") or []
        raise CloudflarePolicyError(
            f"Cloudflare API request failed with HTTP {response.status_code}: {errors!r}"
        )
    return payload


def ensure_browser_cache_policy(
    *,
    token: str,
    zone_name: str,
    apply: bool,
    session: requests.Session | None = None,
    api_base: str = DEFAULT_API_BASE,
) -> tuple[str, int, bool]:
    """Return ``(zone_id, final_value, changed)`` after exact-zone validation."""

    if not token.strip():
        raise CloudflarePolicyError("CLOUDFLARE_API_TOKEN is required")
    if not zone_name.strip() or zone_name != zone_name.strip().lower():
        raise CloudflarePolicyError("Zone name must be a non-empty lowercase hostname")

    client = session or requests.Session()
    base = api_base.rstrip("/")
    zones_payload = _request_json(
        client,
        "GET",
        f"{base}/zones",
        token=token,
        params={"name": zone_name, "status": "active"},
    )
    zones = zones_payload.get("result")
    if not isinstance(zones, list) or len(zones) != 1:
        count = len(zones) if isinstance(zones, list) else "invalid"
        raise CloudflarePolicyError(
            f"Expected exactly one active Cloudflare zone named {zone_name!r}; found {count}"
        )

    zone = zones[0]
    zone_id = zone.get("id")
    if zone.get("name") != zone_name or zone.get("status") != "active" or not zone_id:
        raise CloudflarePolicyError("Cloudflare returned a zone that did not match the exact target")

    setting_url = f"{base}/zones/{zone_id}/settings/{SETTING_ID}"

    def read_setting() -> dict[str, Any]:
        payload = _request_json(client, "GET", setting_url, token=token)
        result = payload.get("result")
        if not isinstance(result, dict) or result.get("id") != SETTING_ID:
            raise CloudflarePolicyError("Cloudflare returned an invalid browser cache setting")
        return result

    before = read_setting()
    current_value = before.get("value")
    if current_value == RESPECT_EXISTING_HEADERS:
        return str(zone_id), RESPECT_EXISTING_HEADERS, False
    if before.get("editable") is not True:
        raise CloudflarePolicyError("Cloudflare reports that Browser Cache TTL is not editable")
    if not apply:
        raise CloudflarePolicyError(
            f"Browser Cache TTL is {current_value!r}, not Respect Existing Headers; rerun with --apply"
        )

    _request_json(
        client,
        "PATCH",
        setting_url,
        token=token,
        json={"value": RESPECT_EXISTING_HEADERS},
    )
    after = read_setting()
    if after.get("value") != RESPECT_EXISTING_HEADERS:
        raise CloudflarePolicyError(
            f"Cloudflare read-back was {after.get('value')!r}, expected {RESPECT_EXISTING_HEADERS}"
        )
    return str(zone_id), RESPECT_EXISTING_HEADERS, True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--zone", required=True, help="Exact production zone hostname")
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply the safe setting after validating the exact active zone",
    )
    args = parser.parse_args()

    _, value, changed = ensure_browser_cache_policy(
        token=os.environ.get("CLOUDFLARE_API_TOKEN", ""),
        zone_name=args.zone,
        apply=args.apply,
    )
    action = "updated and verified" if changed else "already verified"
    print(f"Cloudflare Browser Cache TTL {action}: value={value} (Respect Existing Headers)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
