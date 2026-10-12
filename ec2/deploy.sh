#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash $ROOT/ec2/deploy.sh" >&2
  exit 1
fi
if ! id rapidsims >/dev/null 2>&1; then
  echo "The rapidsims system account does not exist. Follow ec2/README.md first." >&2
  exit 1
fi

as_app_user() {
  runuser -u rapidsims -- "$@"
}

echo "Installing runtime dependencies..."
for app in platform sim sim-02 sim03 sim04 sim05 sim06 sim07 sim08 sim09 sim10 sim-plus-01 simplus02; do
  as_app_user npm install --prefix "$ROOT/$app" --omit=dev --no-package-lock --no-audit --no-fund
done

echo "Building generated simulation assets..."
for app in sim sim-02 sim03 sim04 sim05 sim06 sim07 sim08 sim09 sim10 simplus02; do
  if as_app_user node -e "const p=require('$ROOT/$app/package.json'); process.exit(p.scripts && p.scripts.build ? 0 : 1)"; then
    as_app_user npm --prefix "$ROOT/$app" run build
  fi
done

echo "Enabling and restarting the systemd app services..."
for app in platform sim01 sim02 sim03 sim04 sim05 sim06 sim07 sim08 sim09 sim10 simplus01 simplus02; do
  systemctl enable "rapidsims@$app.service"
  systemctl restart "rapidsims@$app.service"
done

echo "Checking platform health through Nginx..."
curl --fail --silent --show-error http://127.0.0.1/api/health
echo
echo "EC2 deployment completed."
