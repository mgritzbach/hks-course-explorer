"""Bounded retries for catalogue GETs only, never staging/promotion writes.

Callers retain responsibility for validating counts, identities and JSON. A
malformed successful response or permanent error is not made acceptable by
retrying it. Do not log request URLs, headers, bodies or credentials here.
"""
import time
from collections.abc import Mapping

import requests

RETRYABLE_STATUSES = {408, 425, 429, 500, 502, 503, 504}
MAX_ATTEMPTS = 3
MAX_DELAY_SECONDS = 30


def get_with_retry(url, *, request_get=requests.get, sleep=None, observe_response=None, **kwargs):
    """Retry the identical idempotent GET; return final response to its validator."""
    sleep = sleep or time.sleep
    kwargs.setdefault("timeout", 30)
    kwargs.setdefault("allow_redirects", False)
    for attempt in range(MAX_ATTEMPTS):
        response = None
        try:
            response = request_get(url, **kwargs)
        except requests.exceptions.SSLError:
            raise  # Certificate/security problems are not transient transport failures.
        except (requests.ConnectionError, requests.Timeout):
            if attempt == MAX_ATTEMPTS - 1:
                raise
        else:
            if observe_response is not None:
                observe_response(response)
            if response.status_code not in RETRYABLE_STATUSES or attempt == MAX_ATTEMPTS - 1:
                return response
        delay = min(2 ** (attempt + 1), MAX_DELAY_SECONDS)
        headers = getattr(response, "headers", {})
        if isinstance(headers, Mapping):
            retry_after = str(headers.get("Retry-After", ""))
            if retry_after.isdigit():
                delay = min(max(delay, int(retry_after)), MAX_DELAY_SECONDS)
        sleep(delay)
