#!/usr/bin/env bash
# One-time install on the EC2 server, as an administrator, from the deployed checkout:
#   sudo bash /var/www/rapidsims/ec2/runner/install-runner-watchdog.sh
# 1. The runner service restarts itself 30 seconds after any exit and starts at boot.
# 2. A timer checks every 5 minutes and restarts it if it has stopped anyway.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
unit=$(systemctl list-unit-files --no-legend 'actions.runner.*.service' | awk '{print $1}' | head -n1)
if [ -z "$unit" ]; then echo "No actions.runner service found. Install the runner first (docs/self-hosted-runner.md)." >&2; exit 1; fi
echo "Runner service: $unit"
install -d "/etc/systemd/system/$unit.d"
cat > "/etc/systemd/system/$unit.d/restart.conf" <<'CONF'
[Unit]
StartLimitIntervalSec=0

[Service]
Restart=always
RestartSec=30
CONF
install -o root -g root -m 0755 "$here/runner-watchdog.sh" /usr/local/sbin/rapidsims-runner-watchdog
install -o root -g root -m 0644 "$here/rapidsims-runner-watchdog.service" /etc/systemd/system/rapidsims-runner-watchdog.service
install -o root -g root -m 0644 "$here/rapidsims-runner-watchdog.timer" /etc/systemd/system/rapidsims-runner-watchdog.timer
systemctl daemon-reload
systemctl enable "$unit"
systemctl enable --now rapidsims-runner-watchdog.timer
/usr/local/sbin/rapidsims-runner-watchdog || true
systemctl --no-pager --lines=0 status "$unit" || true
systemctl list-timers --no-pager rapidsims-runner-watchdog.timer
echo "Done. The runner restarts itself, and the watchdog checks it every 5 minutes."
