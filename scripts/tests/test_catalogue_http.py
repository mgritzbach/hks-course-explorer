"""Read retries must never weaken validation or repeat writes."""
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock

import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from catalogue_http import get_with_retry


class CatalogueHttpTests(unittest.TestCase):
    def test_retries_transient_read_without_changing_request(self):
        good = Mock(status_code=200)
        get = Mock(side_effect=[requests.Timeout(), Mock(status_code=503, headers={}), good])
        sleep = Mock()
        result = get_with_retry('https://example.test', request_get=get, sleep=sleep,
                                headers={'Authorization': 'secret'}, params={'offset': 1000})
        self.assertIs(result, good)
        self.assertEqual(get.call_args_list[0], get.call_args_list[-1])
        self.assertEqual([c.args[0] for c in sleep.call_args_list], [2, 4])
        self.assertFalse(get.call_args.kwargs['allow_redirects'])

    def test_rate_limit_wait_is_honored_but_bounded(self):
        get = Mock(side_effect=[Mock(status_code=429, headers={'Retry-After': '3600'}),
                               Mock(status_code=200)])
        sleep = Mock()
        get_with_retry('https://example.test', request_get=get, sleep=sleep)
        sleep.assert_called_once_with(30)

    def test_permanent_or_redirect_responses_are_not_retried(self):
        for status in [200, 206, 301, 400, 401, 403, 404]:
            get, sleep = Mock(return_value=Mock(status_code=status)), Mock()
            get_with_retry('https://example.test', request_get=get, sleep=sleep)
            get.assert_called_once()
            sleep.assert_not_called()

    def test_exhausted_transport_error_is_not_swallowed(self):
        get, sleep = Mock(side_effect=requests.ConnectionError()), Mock()
        with self.assertRaises(requests.ConnectionError):
            get_with_retry('https://example.test', request_get=get, sleep=sleep)
        self.assertEqual(get.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_exhausted_server_error_remains_an_error_response(self):
        bad = Mock(status_code=503, headers={})
        get = Mock(return_value=bad)
        self.assertIs(get_with_retry('https://example.test', request_get=get, sleep=Mock()), bad)
        self.assertEqual(get.call_count, 3)

    def test_certificate_errors_are_not_retried(self):
        get, sleep = Mock(side_effect=requests.exceptions.SSLError()), Mock()
        with self.assertRaises(requests.exceptions.SSLError):
            get_with_retry('https://example.test', request_get=get, sleep=sleep)
        get.assert_called_once()
        sleep.assert_not_called()
