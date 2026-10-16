#!/usr/bin/env bash
# Restart the GitHub Actions runner service if it is not running. Installed as
# /usr/local/sbin/rapidsims-runner-watchdog and run every 5 minutes by
# rapidsims-runner-watchdog.timer. Runbook: docs/runner-runbook.md
set -uo pipefail
unit=$(systemctl list-unit-files --no-legend 'actions.runner.*.service' | awk '{print $1}' | head -n1)
if [ -z "$unit" ]; then
  logger -t rapidsims-runner-watchdog "No actions.runner service is installed; nothing to restart."
  exit 1
fi
if systemctl is-active --quiet "$unit"; then exit 0; fi
logger -t rapidsims-runner-watchdog "$unit is $(systemctl is-active "$unit"); restarting."
systemctl reset-failed "$unit" 2>/dev/null || true
systemctl restart "$unit"
sleep 10
if systemctl is-active --quiet "$unit"; then
  logger -t rapidsims-runner-watchdog "$unit restarted."
else
  logger -t rapidsims-runner-watchdog "$unit did not start; see journalctl -u $unit."
  exit 1
fi
