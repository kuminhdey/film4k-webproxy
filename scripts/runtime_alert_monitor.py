#!/usr/bin/env python3
"""Check production readiness and crawler freshness; notify on state changes."""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def fetch_json(url: str, timeout: float = 8.0) -> dict:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "webproxy-runtime-monitor/1"})
    with urlopen(request, timeout=timeout) as response:
        if not 200 <= response.status < 300:
            raise RuntimeError(f"HTTP {response.status}")
        value = json.loads(response.read())
    if not isinstance(value, dict):
        raise RuntimeError("response was not a JSON object")
    return value


def parse_last_run(value: object) -> int | None:
    if not isinstance(value, str):
        return None
    match = re.fullmatch(r"UTC timestamp: (\d+)s", value.strip())
    return int(match.group(1)) if match else None


def assess_crawler(
    crawler: dict,
    state: dict,
    now: int,
    max_lag_seconds: int,
    startup_grace_seconds: int,
) -> tuple[str | None, int | None]:
    if crawler.get("is_running") is True:
        return None, None

    last_run = parse_last_run(crawler.get("last_run"))
    if last_run is not None:
        age = max(0, now - last_run)
        if age > max_lag_seconds:
            return f"crawler_lag:{age}", None
        return None, None

    missing_since = state.get("crawler_missing_since")
    if not isinstance(missing_since, int):
        missing_since = now
    if now - missing_since > startup_grace_seconds:
        return "crawler_lag:no_completed_run_observed", missing_since
    return None, missing_since


def post_alert(webhook_url: str, message: str, timeout: float = 10.0) -> bool:
    payload = json.dumps({"text": message}).encode("utf-8")
    request = Request(webhook_url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urlopen(request, timeout=timeout) as response:
            return 200 <= response.status < 300
    except (HTTPError, URLError, TimeoutError, OSError):
        return False


def read_state(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def write_state(path: Path, state: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True) + "\n", encoding="utf-8")
    os.chmod(temporary, 0o600)
    temporary.replace(path)


def issue_key(issue: str | None) -> str | None:
    """Keep changing measurements (for example crawler age) from spamming alerts."""
    return issue.split(":", 1)[0] if issue else None


def main() -> int:
    base_url = os.environ.get("WEBPROXY_BASE_URL", "http://127.0.0.1:8090").rstrip("/")
    webhook_url = os.environ.get("ALERT_WEBHOOK_URL", "").strip()
    state_path = Path(os.environ.get("STATE_FILE", "/var/lib/webproxy-runtime-alerts/state.json"))
    max_lag = int(os.environ.get("CRAWLER_MAX_LAG_SECONDS", str(26 * 60 * 60)))
    startup_grace = int(os.environ.get("CRAWLER_STARTUP_GRACE_SECONDS", str(2 * 60 * 60)))
    now = int(time.time())
    state = read_state(state_path)

    issue: str | None = None
    missing_since: int | None = state.get("crawler_missing_since") if isinstance(state.get("crawler_missing_since"), int) else None
    try:
        readiness = fetch_json(base_url + "/health/ready")
        if readiness.get("ready") is not True:
            issue = "readiness_not_ready"
        else:
            crawler = fetch_json(base_url + "/api/crawler/status")
            issue, missing_since = assess_crawler(crawler, state, now, max_lag, startup_grace)
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, RuntimeError) as error:
        # Log only the error class; avoid echoing response bodies or URLs that may contain secrets.
        issue = f"readiness_or_status_unavailable:{type(error).__name__}"

    previous_issue = state.get("active_issue")
    state["crawler_missing_since"] = missing_since
    message = None
    event_key = None
    if issue:
        state["active_issue"] = issue
        event_key = issue_key(issue)
        if state.get("last_delivered_issue") != event_key:
            message = f"🚨 Film4K Webproxy runtime alert: {issue}. Check /health/ready and /api/crawler/status on the host."
        print(f"Runtime check: unhealthy ({issue})")
    elif previous_issue:
        message = f"✅ Film4K Webproxy runtime recovered from: {previous_issue}."
        print(f"Runtime check: recovered ({previous_issue})")
    else:
        state["active_issue"] = None
        print("Runtime check: healthy")

    if message:
        if not webhook_url:
            print("ALERT_WEBHOOK_URL is not configured; notification delivery is unavailable.", file=sys.stderr)
            write_state(state_path, state)
            return 0
        if post_alert(webhook_url, message):
            if issue:
                state["last_delivered_issue"] = event_key
            else:
                # Keep active_issue until recovery delivery is confirmed so a
                # failed notification is retried on the next timer invocation.
                state["active_issue"] = None
                state["last_delivered_issue"] = None
            print("Runtime alert webhook accepted the notification.")
        else:
            print("Runtime alert webhook delivery was not confirmed; it will retry next interval.", file=sys.stderr)
            write_state(state_path, state)
            return 1 if issue else 0

    if issue is None and not previous_issue:
        state["last_delivered_issue"] = None
    write_state(state_path, state)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
