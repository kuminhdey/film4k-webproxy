#!/usr/bin/env python3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import runtime_alert_monitor as monitor


class RuntimeMonitorTests(unittest.TestCase):
    def test_fresh_crawl_is_healthy(self):
        issue, missing_since = monitor.assess_crawler(
            {"is_running": False, "last_run": "UTC timestamp: 990s"}, {}, 1000, 100, 50
        )
        self.assertIsNone(issue)
        self.assertIsNone(missing_since)

    def test_stale_crawl_is_reported(self):
        issue, _ = monitor.assess_crawler(
            {"is_running": False, "last_run": "UTC timestamp: 1s"}, {}, 1000, 100, 50
        )
        self.assertEqual(issue, "crawler_lag:999")

    def test_changing_lag_measurement_keeps_one_alert_key(self):
        self.assertEqual(monitor.issue_key("crawler_lag:999"), "crawler_lag")
        self.assertEqual(monitor.issue_key("crawler_lag:1299"), "crawler_lag")
        self.assertEqual(monitor.issue_key("readiness_not_ready"), "readiness_not_ready")

    def test_missing_first_run_has_startup_grace(self):
        crawler = {"is_running": False, "last_run": None}
        issue, missing_since = monitor.assess_crawler(crawler, {}, 1000, 100, 50)
        self.assertIsNone(issue)
        self.assertEqual(missing_since, 1000)
        issue, _ = monitor.assess_crawler(crawler, {"crawler_missing_since": 1000}, 1051, 100, 50)
        self.assertEqual(issue, "crawler_lag:no_completed_run_observed")

    def test_running_crawler_is_not_marked_stale(self):
        issue, missing_since = monitor.assess_crawler(
            {"is_running": True, "last_run": None}, {"crawler_missing_since": 1}, 1000, 100, 50
        )
        self.assertIsNone(issue)
        self.assertIsNone(missing_since)

    def test_webhook_requires_confirmed_success(self):
        response = unittest.mock.MagicMock(status=204)
        response.__enter__.return_value = response
        with patch.object(monitor, "urlopen", return_value=response):
            self.assertTrue(monitor.post_alert("https://webhook.invalid", "test"))
        response.status = 503
        with patch.object(monitor, "urlopen", return_value=response):
            self.assertFalse(monitor.post_alert("https://webhook.invalid", "test"))

    def test_state_file_is_private_and_atomic(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "state" / "monitor.json"
            monitor.write_state(path, {"active_issue": "test"})
            self.assertEqual(monitor.read_state(path), {"active_issue": "test"})
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(path.with_suffix(".json.tmp").exists())


if __name__ == "__main__":
    unittest.main()
