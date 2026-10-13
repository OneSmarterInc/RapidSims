#!/usr/bin/env bash
set -euo pipefail
# Run only through the tested release workflow or explicitly by an operator.
sha="${1:?Exact tested commit SHA required}"
repo="${2:-/var/www/rapidsims}"
[[ "$sha" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid release SHA" >&2; exit 1; }
[[ "$(id -u)" == 0 && "$repo" == /var/www/rapidsims ]] || { echo "Run as root with the configured checkout" >&2; exit 1; }
exec 9>/var/lock/rapidsims-deploy.lock
flock -n 9 || { echo "Another deployment is running" >&2; exit 1; }
git_repo() { runuser -u rapidsims -- git -C "$repo" "$@"; }
git_repo cat-file -e "$sha^{commit}"
releases=/var/www/rapidsims-releases
links=/var/www/rapidsims-services
install -d -m 0755 "$releases" "$links"
[[ -f /etc/nginx/rapidsims-locations.conf ]] || { echo "Install the managed Nginx locations include first; see docs/aws-security-rollout.md" >&2; exit 1; }
release="$releases/$sha"
[[ ! -e "$release" ]] || { echo "Release already exists; use documented rollback/retry procedure" >&2; exit 1; }
stage="$(mktemp -d "$releases/.staging-XXXXXXXX")"
git_repo archive "$sha" | tar -xf - -C "$stage"
chown -R rapidsims:rapidsims "$stage"
as_app() { runuser -u rapidsims -- env HOME=/var/lib/rapidsims npm_config_cache=/var/lib/rapidsims/.npm "$@"; }
cd "$stage"
as_app npm ci --ignore-scripts --no-audit --no-fund
as_app npm test
while IFS=$'\t' read -r app dir; do
  as_app npm --prefix "$stage/$dir" run build --if-present
done < <(node -e "for(const [id,a] of Object.entries(require('./ec2/apps.json')))console.log(id+'\t'+a.dir)")
as_app node ec2/render-nginx.js --locations > "$stage/nginx-generated.conf"
printf 'RELEASE_SHA=%s\n' "$sha" > "$stage/release.env"
export RELEASE_SHA="$sha"
# Environment files are trusted root-owned shell-compatible assignments.
set -a
source /etc/rapidsims.env
if [[ -f /etc/rapidsims/platform.env ]]; then source /etc/rapidsims/platform.env; fi
set +a
as_app node ec2/migrate.js
as_app npm prune --omit=dev --ignore-scripts --no-audit --no-fund
mv "$stage" "$release"
cd "$release"
declare -A previous=()
changed=()
for app in $(node -e "console.log(Object.keys(require('./ec2/apps.json')).join(' '))"); do
  dir="$(node -e "console.log(require('./ec2/apps.json')[process.argv[1]].dir)" "$app")"
  if [[ -L "$links/$app" ]]; then previous[$app]="$(readlink -f "$links/$app")"; else previous[$app]="$repo"; fi
  printf '%s\t%s\n' "$app" "${previous[$app]}" >> "$release/services-previous.tsv"
  old="${previous[$app]##*/}"
  if [[ "$old" =~ ^[a-f0-9]{40}$ ]] && git_repo diff --quiet "$old" "$sha" -- "$dir" shared ec2 package.json package-lock.json; then continue; fi
  changed+=("$app")
done
# Retain old configuration for rollback; do not remove release directories here.
cp /etc/nginx/rapidsims-locations.conf "$release/nginx-previous.conf"
rollback() {
  trap - ERR
  set +e
  for app in "${changed[@]}"; do
    if [[ -n "${previous[$app]}" ]]; then
      ln -sfn "${previous[$app]}" "$links/$app.rollback"
      mv -Tf "$links/$app.rollback" "$links/$app"
      systemctl restart "rapidsims@$app.service"
    else systemctl stop "rapidsims@$app.service"; fi
  done
  cp "$release/nginx-previous.conf" /etc/nginx/rapidsims-locations.conf
  nginx -t && systemctl reload nginx
  systemctl restart rapidsims-reports.service
  echo "Release failed; previous service pointers restored. New release retained for diagnosis." >&2
  exit 1
}
trap rollback ERR
install -m 0644 ec2/rapidsims@.service /etc/systemd/system/rapidsims@.service
install -m 0644 ec2/rapidsims-reports.service /etc/systemd/system/rapidsims-reports.service
systemctl daemon-reload
for app in "${changed[@]}"; do
  ln -sfn "$release" "$links/$app.next"
  mv -Tf "$links/$app.next" "$links/$app"
  systemctl enable "rapidsims@$app.service"
  systemctl restart "rapidsims@$app.service"
  # A service may override its diagnostic key in its own environment file.
  (set -a; if [[ -f "/etc/rapidsims/$app.env" ]]; then source "/etc/rapidsims/$app.env"; fi; set +a; node ec2/check-ready.js "$app")
done
install -m 0644 "$release/nginx-generated.conf" /etc/nginx/rapidsims-locations.conf
nginx -t
systemctl reload nginx
systemctl enable --now rapidsims-reports.service
systemctl restart rapidsims-reports.service
trap - ERR
printf 'Deployed %s; updated services: %s\n' "$sha" "${changed[*]}"

