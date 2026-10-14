#!/usr/bin/env bash
# Install as root-owned /usr/local/sbin/rapidsims-runner-deploy.
# The runner may invoke only this helper through sudo, not arbitrary commands.
set -euo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
[[ "$(id -u)" == 0 ]] || { echo "Run through sudo" >&2; exit 1; }
[[ $# == 1 && "$1" =~ ^[a-f0-9]{40}$ ]] || { echo "One exact release SHA required" >&2; exit 1; }
sha="$1"
repo=/var/www/rapidsims
git_repo() { runuser -u rapidsims -- env HOME=/var/lib/rapidsims git -C "$repo" "$@"; }
git_repo fetch origin refs/heads/master:refs/remotes/origin/master
git_repo cat-file -e "$sha^{commit}"
[[ "$(git_repo rev-parse refs/remotes/origin/master)" == "$sha" ]] || {
  echo "Release superseded: deploy the latest verified master revision" >&2; exit 1;
}
script="$(mktemp /var/tmp/rapidsims-deploy-XXXXXXXX)"
trap 'rm -f -- "$script"' EXIT
git_repo show "$sha:ec2/deploy.sh" > "$script"
bash -n "$script"
bash "$script" "$sha" "$repo"
