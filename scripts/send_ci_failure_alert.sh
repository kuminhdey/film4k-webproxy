#!/usr/bin/env bash
set -u
webhook_url="${1:?webhook URL required}"
payload="${2:?payload required}"
if http_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' --max-time 15 --request POST -H 'Content-type: application/json' --data "$payload" "$webhook_url"); then
  if [[ "$http_status" =~ ^2[0-9][0-9]$ ]]; then
    echo "Alert webhook accepted the payload (HTTP $http_status)."
  else
    echo "::warning::Alert webhook returned HTTP ${http_status:-unknown}; delivery was not confirmed."
  fi
else
  echo "::warning::Alert webhook request failed; delivery was not confirmed."
fi
