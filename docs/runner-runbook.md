# When deploys are stuck: the EC2 runner runbook

Merging a pull request deploys RapidSims in two steps. GitHub's own machines test the merged code, then the
**RapidSims runner** on the production EC2 server installs it. If that runner is offline, the deploy waits, and
nothing merged reaches the site.

The **Deploy watch** workflow checks every 15 minutes. When a deploy has waited more than 15 minutes, it opens the
issue "Production deploy is waiting for the EC2 runner", assigned to the owner. GitHub emails it and notifies the
GitHub app. When deploys move again, the issue closes itself.

## For Vikram: getting deploys moving (5 to 10 minutes, phone or laptop)

1. **Check the runner.** Open https://github.com/OneSmarterInc/RapidSims/settings/actions/runners.
   *Idle* or *Active* means the runner is fine and the deploy should start within a minute. *Offline* means go on.
2. **Reboot the server.** In the AWS console, open **EC2 → Instances**, select the RapidSims instance, then
   **Instance state → Reboot instance**. The site is down for about two minutes. Once the self-restart setup below
   is installed, the runner starts with the server.
3. **Wait three minutes and check the Runners page again.** When it shows *Idle* or *Active*, the waiting deploys
   run in order by themselves. Watch them at https://github.com/OneSmarterInc/RapidSims/actions.
4. **Still offline? Restart the runner by hand.** In EC2, select the instance, then **Connect → Session Manager →
   Connect**. A terminal opens in the browser. Run:

   ```bash
   sudo /usr/local/sbin/rapidsims-runner-watchdog
   ```

   If that command does not exist yet (setup A not done), run instead:

   ```bash
   cd /opt/actions-runner && sudo ./svc.sh start && sudo ./svc.sh status
   ```

5. **Still offline after that?** Send the team the output of the command under C below. One case needs them: if the
   log says the runner registration was removed (GitHub drops runners that stay offline for weeks), it has to be
   registered again with a new token (docs/self-hosted-runner.md).

If the instance shows **Stopped** in step 2, choose **Instance state → Start instance** instead of Reboot.

## For the team: one-time setup

### A. The runner restarts itself (about 5 minutes)

On the EC2 server, as an administrator, after this change is deployed:

```bash
sudo bash /var/www/rapidsims/ec2/runner/install-runner-watchdog.sh
```

This makes the runner service start at boot and restart 30 seconds after any exit, and it installs a timer that
checks every 5 minutes and restarts the runner if it has stopped anyway. Each restart is logged:
`journalctl -t rapidsims-runner-watchdog`.

If deploys are stuck right now, the files are not on the server yet. Copy the four files in `ec2/runner/` from
GitHub to a folder on the server and run `install-runner-watchdog.sh` from there.

### B. Vikram can reboot the server and open a terminal (about 15 minutes)

1. The instance needs the SSM agent (preinstalled on Amazon Linux and Ubuntu AMIs) and an instance profile with the
   managed policy **AmazonSSMManagedInstanceCore**. Check: the instance appears under **Systems Manager → Fleet
   Manager**.
2. Attach this policy to Vikram's IAM user or role. Replace REGION, ACCOUNT and INSTANCE_ID.

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["ec2:DescribeInstances", "ec2:DescribeInstanceStatus", "ssm:DescribeInstanceInformation", "ssm:DescribeSessions", "ssm:GetConnectionStatus"], "Resource": "*" },
    { "Effect": "Allow", "Action": ["ec2:RebootInstances", "ec2:StartInstances"], "Resource": "arn:aws:ec2:REGION:ACCOUNT:instance/INSTANCE_ID" },
    { "Effect": "Allow", "Action": "ssm:StartSession", "Resource": ["arn:aws:ec2:REGION:ACCOUNT:instance/INSTANCE_ID", "arn:aws:ssm:REGION::document/SSM-SessionManagerRunShell"] },
    { "Effect": "Allow", "Action": ["ssm:TerminateSession", "ssm:ResumeSession"], "Resource": "arn:aws:ssm:*:*:session/${aws:username}-*" }
  ]
}
```

3. Have Vikram try steps 1 to 4 above once while someone is around.

### C. Why the runner stopped (today: about 10:27 ET, Oct 16, 2026)

```bash
last -x | head -5                                   # reboots and shutdowns
systemctl list-unit-files 'actions.runner.*'        # is the service installed and enabled?
sudo journalctl -u 'actions.runner.*' --since "2026-10-16 14:00 UTC" --until "2026-10-16 15:30 UTC" --no-pager | tail -50
sudo ls -t /opt/actions-runner/_diag/ | head -3      # newest runner logs; read the top one with tail -100
free -h; df -h /                                     # memory and disk
```

The deploy that was running at that moment was cancelled mid-way (run 38915728683), which points at the server or
the runner going down rather than a failed deploy.

## Not set up, on purpose

A "deploy without the runner" button would need GitHub to hold AWS access again, which was removed when deploys
moved to the self-hosted runner (docs/self-hosted-runner.md). That is a team decision.
