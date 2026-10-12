#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(id -un)" != "rapidsims" ]]; then
  echo "Run this script as the rapidsims service user: sudo -u rapidsims $ROOT/ec2/deploy.sh" >&2
  exit 1
fi

echo "Installing runtime dependencies..."
for app in platform sim sim-02 sim03 sim04 sim05 sim06 sim07 sim08 sim09 sim10 sim-plus-01 simplus02; do
  npm install --prefix "$ROOT/$app" --omit=dev --no-package-lock --no-audit --no-fund
done

echo "Building generated simulation assets..."
for app in sim sim-02 sim03 sim04 sim05 sim07 sim08 sim09 sim10 simplus02; do
  if node -e "const p=require('$ROOT/$app/package.json'); process.exit(p.scripts && p.scripts.build ? 0 : 1)"; then
    npm --prefix "$ROOT/$app" run build
  fi
done

echo "Restarting systemd app services..."
for app in platform sim01 sim02 sim03 sim04 sim05 sim06 sim07 sim08 sim09 sim10 simplus01 simplus02; do
  sudo systemctl restart "rapidsims@$app.service"
done

echo "Checking platform health through Nginx..."
curl --fail --silent --show-error http://127.0.0.1/api/health
echo
echo "EC2 deployment completed."
