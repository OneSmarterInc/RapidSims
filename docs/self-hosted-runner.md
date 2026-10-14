# Production runner on the existing EC2 server

Verification stays on GitHub-hosted Ubuntu. Only successful master push
deployments use the repository runner labeled `rapidsims-production`. OIDC and
SSM are no longer used by this workflow. Existing release staging, tests,
migrations, readiness checks and rollback remain in ec2/deploy.sh.

## Register the runner

Run on EC2 as an administrator, not on the Windows workstation:

```bash
sudo useradd --create-home --shell /bin/bash github-runner
sudo install -d -o github-runner -g github-runner /opt/actions-runner
uname -m
sudo -iu github-runner
cd /opt/actions-runner
```

If the user already exists, skip useradd. In GitHub open this repository's
Settings > Actions > Runners > New self-hosted runner. Select Linux and the
architecture matching uname (`x86_64` = x64; `aarch64` = ARM64).
Run GitHub's current download, checksum and extraction commands in this directory;
skip its mkdir/cd commands to avoid a nested directory. Use the temporary token
from that page locally with:

```bash
./config.sh --url https://github.com/OneSmarterInc/RapidSims --token YOUR_TEMPORARY_TOKEN --name rapidsims-ec2 --labels rapidsims-production --work _work
exit
```

Keep the token out of chat. Do not start the service until the helper is installed.
Do not assign PR jobs to this production runner. Trusted master deployment code
has production privileges. Keep the runner user separate from the application user.

## Install the deployment helper

The existing checkout must support authenticated fetch as the rapidsims user.
The host must already meet ec2/deploy.sh prerequisites, including Node 24, npm,
the service account, database configuration and managed Nginx include. Node/npm
must be on the system PATH, not available only through an interactive shell.

```bash
sudo -u rapidsims env HOME=/var/lib/rapidsims git -C /var/www/rapidsims fetch origin refs/heads/master:refs/remotes/origin/master
```

After that succeeds, install the helper from the fetched revision:

```bash
set -o pipefail
sudo -u rapidsims git -C /var/www/rapidsims show origin/master:ec2/runner-deploy.sh | sudo tee /usr/local/sbin/rapidsims-runner-deploy >/dev/null
sudo chown root:root /usr/local/sbin/rapidsims-runner-deploy
sudo chmod 0755 /usr/local/sbin/rapidsims-runner-deploy
sudo bash -n /usr/local/sbin/rapidsims-runner-deploy
sudo visudo -f /etc/sudoers.d/rapidsims-runner
```

Add exactly this line, save and exit:

```sudoers
github-runner ALL=(root) NOPASSWD: /usr/local/sbin/rapidsims-runner-deploy
```

The root-owned helper validates its sole SHA argument and deploys only the current
master tip. It does not accept a repository path or arbitrary shell command.
Verify configuration and start the service:

```bash
sudo chmod 0440 /etc/sudoers.d/rapidsims-runner
sudo visudo -cf /etc/sudoers.d/rapidsims-runner
cd /opt/actions-runner
sudo ./svc.sh install github-runner
sudo ./svc.sh start
sudo ./svc.sh status
```

GitHub should show the runner as Idle (or Active if the queued deployment starts).
The commit enabling this workflow queues deployment until this runner is online.
Rerunning an older OIDC workflow still uses its old configuration: use the run
for the commit introducing the runner workflow or a newer master commit.

Installation and a successful production run must be verified on EC2; local
repository tests cannot confirm server permissions or runner connectivity.

Official references:
- https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners
- https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application?platform=linux
