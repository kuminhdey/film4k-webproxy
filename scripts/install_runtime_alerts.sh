#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${WEBPROXY_RUNTIME_ALERTS_ENV_FILE:-/etc/webproxy-runtime-alerts.env}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run as root to install the host runtime alert service." >&2
  exit 1
fi

install -D -m 0755 "$ROOT_DIR/scripts/runtime_alert_monitor.py" /usr/local/libexec/webproxy-runtime-alerts.py
install -D -m 0644 "$ROOT_DIR/ops/systemd/webproxy-runtime-alerts.service" /etc/systemd/system/webproxy-runtime-alerts.service
install -D -m 0644 "$ROOT_DIR/ops/systemd/webproxy-runtime-alerts.timer" /etc/systemd/system/webproxy-runtime-alerts.timer
if [[ -f "$ENV_FILE" ]]; then
  chmod 0600 "$ENV_FILE"
else
  echo "No webhook configured; runtime alerts will be recorded in the systemd journal."
fi
systemctl daemon-reload
systemctl enable --now webproxy-runtime-alerts.timer
systemctl start webproxy-runtime-alerts.service
systemctl --no-pager --full status webproxy-runtime-alerts.timer
