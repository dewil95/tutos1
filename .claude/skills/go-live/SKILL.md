---
name: go-live
description: Put the Ascend CRM online on an Oracle Cloud server from the user's own computer (Windows or Mac), step by step with them - Oracle account and server, server setup over SSH, Google, Cloudflare tunnel and sign-in, backups, settings, GitHub deploys, first sign-in. Use when the user types /go-live or asks to set up, launch or deploy the CRM.
disable-model-invocation: true
---

# Go live: Ascend CRM on Oracle Cloud

You are running in Claude Code on the user's own computer, in their copy of this repo. Walk them
through putting the CRM online at `https://crm.ascendfund.co` on one Oracle Cloud server. The
user is not technical: one step at a time, plain words, say what you are about to do and why, and
check each step worked before the next. Keep a checklist of the 12 steps below and show it when
you start and after each step.

How it fits together: the app, its SQLite database (`/var/lib/ascend-crm/crm.db`) and the
background-job timer run on the Oracle server under systemd (`deploy/oracle/`). Litestream
streams the database to Oracle Object Storage. Cloudflare is only the front door: a Cloudflare
Tunnel connects `crm.ascendfund.co` to the server (no open ports) and Cloudflare Access is the
team sign-in. README "Go live on Oracle Cloud" has the same steps for doing them by hand.

## Safety rules (always)

- **Never print, echo, log, or ask the user to paste into this chat any secret**: API keys,
  client secrets, the encryption key, Oracle secret keys, the tunnel token, SSH private keys.
  Secrets go into the server's settings file by the user typing them over SSH in **their own
  terminal window**, or are generated on the server and written straight into the file without
  being shown. Never `cat` the env file or the private key; check settings only through
  `/api/health`, which reports presence, not values.
- **Ask before**: merging a pull request, upgrading the Oracle account or anything else that
  could cost money, deleting anything, or changing DNS. Never touch `ascendfund.co` or
  `www.ascendfund.co` (the public website); only `crm.ascendfund.co`.
- Keep `MCA_EMAIL_DRY_RUN=true`. Turning on real lender emails is a separate decision for later.
- Never commit secrets, `.env*` files, SSH keys or real merchant files.
- If a command fails, read the error, explain it in one plain sentence, and fix what you can.
  Never disable checks or skip a step silently.

You can run SSH commands on the server yourself once the user has the key file on this computer:
`ssh -i <key file> ubuntu@<IP> '<command>'`. On Windows, Claude Code's shell is Git Bash, so
`ssh` and `scp` work as written; use the key path the user gives (e.g.
`~/Downloads/ssh-key-2026-10-17.key`) and run `chmod 600` on it first. For anything that asks for
a secret, give the user the exact command to run in their own window instead.

## Steps

### 1. Tools and repo

Required here: `git --version`, `gh --version`, `ssh -V`. If one is missing, Windows PowerShell:
`winget install Git.Git GitHub.cli` (Git includes ssh), then reopen. `git fetch origin` and
`git status`. The repo should be in the user's folder, never under `C:\WINDOWS\system32`.

### 2. GitHub sign-in and the code in `main`

1. `gh auth status`; if needed the user runs `gh auth login` in their own window (GitHub.com,
   HTTPS, browser).
2. The Oracle version lives on branch `ccr-a084c87c-zub6v3` until merged. `gh pr list --head
ccr-a084c87c-zub6v3 --state all`. If no open PR and `git log
origin/main..origin/ccr-a084c87c-zub6v3 --oneline` shows commits, create one:
   `gh pr create --base main --head ccr-a084c87c-zub6v3 --title "Ascend CRM on Oracle Cloud" --body "App, SQLite database, backups and jobs on an Oracle server; Cloudflare tunnel + Access in front. See README."`
3. `gh pr checks <number> --watch` until all pass. Ask "Merge it now?"; only on yes:
   `gh pr merge <number> --merge`. Then `git checkout main && git pull`.

### 3. Oracle account

Guide the user at https://cloud.oracle.com (they sign up or sign in themselves):

1. If new: pick the **home region** nearest to them (cannot be changed later).
2. **Upgrade to Pay As You Go** (Billing & Cost Management → Upgrade and Manage Payment). Explain
   first: it stays $0 inside the Always Free limits, and it stops Oracle from reclaiming idle free
   servers (a CRM is idle most of the day). Ask before they confirm.
3. Billing → **Budgets → Create budget**: $1 monthly, alert email to them.

### 4. The server

Guide the clicks in Compute → Instances → **Create instance**:

- Name `ascend-crm`. Image: **Canonical Ubuntu 24.04** (aarch64). Shape: **Ampere
  VM.Standard.A1.Flex**, 2 OCPUs / 12 GB. On "out of capacity": another availability domain,
  later, or 1 OCPU / 6 GB.
- SSH keys: **Generate a key pair for me** → **Save private key** (and public key). Ask where
  the private key file is saved on this computer.
- Networking: default VCN, **assign a public IPv4 address**. Do not add ingress rules (only SSH
  22 stays open; the site comes through the tunnel).
- Create, wait for **Running**, note the **public IP**.
  Then: `chmod 600 <key>` and test `ssh -i <key> -o StrictHostKeyChecking=accept-new ubuntu@<IP> 'uname -m && df -h /'`.

### 5. Set up the server

Run over SSH (the branch is `main` once merged in step 2):
`ssh -i <key> ubuntu@<IP> 'curl -fsSL https://raw.githubusercontent.com/dewil95/tutos1/main/deploy/oracle/setup-server.sh -o setup-server.sh && sudo bash setup-server.sh'`
It takes several minutes (installs Node, cloudflared, Litestream, builds the CRM). It ends with
"Done". Check: `ssh ... 'systemctl is-active ascend-crm && curl -s http://127.0.0.1:3000/api/health | head -c 300'`
(status "degraded" is expected until step 9).

### 6. Google: Gmail, Drive and Gemini

1. Project at https://console.cloud.google.com/projectcreate ("Ascend CRM").
2. Enable https://console.cloud.google.com/apis/library/gmail.googleapis.com and
   https://console.cloud.google.com/apis/library/drive.googleapis.com (project selected).
3. https://console.cloud.google.com/auth/overview → **Get started**: app "Ascend CRM", support
   email funding@ascendfund.co, audience **Internal**. Then **Clients → Create client**: **Web
   application**, redirect URI `https://crm.ascendfund.co/api/google/callback`. The user keeps the
   Client ID and secret for step 9 (in a note on their side, not in the chat).
4. Gemini key: https://aistudio.google.com/apikey → Create API key in the "Ascend CRM" project.
   Billing must be on for that project (ask before they add billing).

### 7. Cloudflare: tunnel and sign-in

At https://one.dash.cloudflare.com:

1. If asked, Free plan and team name (e.g. `ascendfund` → `ascendfund.cloudflareaccess.com`).
2. **Networks → Tunnels → Create a tunnel → Cloudflared**, name `ascend-crm`. It shows an install
   command with a token. The user runs on the server, in their own window:
   `ssh -i <key> ubuntu@<IP>` then `sudo cloudflared service install <TOKEN>`.
   Check: `ssh ... 'systemctl is-active cloudflared'`, and the tunnel shows **Healthy**.
3. Tunnel → **Public hostname → Add**: subdomain `crm`, domain `ascendfund.co`, type **HTTP**, URL
   `127.0.0.1:3000`.
4. **Access → Applications → Add → Self-hosted** "Ascend CRM", domain `crm.ascendfund.co`;
   policy "Team": **Allow**, **Emails ending in** `@ascendfund.co`; login **One-time PIN**.
5. Another **Self-hosted** app "Ascend CRM public paths": `crm.ascendfund.co/api/v1/*`,
   `crm.ascendfund.co/api/health`, `crm.ascendfund.co/apply/*`,
   `crm.ascendfund.co/api/whatsapp/*`, `crm.ascendfund.co/_next/*`; policy **Bypass**, **Everyone**.
6. "Ascend CRM" app → Overview → **Application Audience (AUD) Tag**: the user keeps it for step 9.
   Check: `curl -s https://crm.ascendfund.co/api/health | head -c 200` answers through the tunnel.

### 8. Backups (Object Storage)

Guide: Storage → Buckets → **Create bucket** `ascend-crm-backups` (private). Profile → **Customer
secret keys → Generate** (secret shown once; the user keeps it for step 9) and the Access key.
Tenancy details → **Object storage namespace**; region id from the region menu (e.g.
`us-ashburn-1`). Endpoint: `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`
(namespace and region are not secret; you may help assemble it).

### 9. Settings on the server

1. Generate the two server secrets on the server, written straight into the file:
   `ssh ... 'sudo sed -i "s|^CRON_SECRET=.*|CRON_SECRET=$(openssl rand -hex 32)|" /etc/ascend-crm/env'`
   For the encryption key the user must keep a copy, so in **their own window**:
   `ssh -i <key> ubuntu@<IP>` then `openssl rand -base64 32` → they save it in their password
   manager → then they paste it in the next step.
2. The user, in their own window on the server: `sudo nano /etc/ascend-crm/env` and fills
   `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GEMINI_API_KEY`, `PII_ENCRYPTION_KEY`, `BACKUP_ENDPOINT`, `BACKUP_REGION`,
   `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY` (Ctrl+O, Enter, Ctrl+X to save).
3. Apply: `ssh ... 'sudo systemctl restart ascend-crm && sudo systemctl enable --now litestream'`.
4. Check: `curl -s https://crm.ascendfund.co/api/health`: every check `ok` (WhatsApp ones may say
   missing; it is switched off). Backups: `ssh ... 'sleep 20; sudo -u ascend litestream snapshots -config /etc/litestream.yml /var/lib/ascend-crm/crm.db'`
   lists a snapshot. If a check is missing, return to its step.

### 10. Automatic updates from GitHub

GitHub needs its own key to reach the server:

1. Make a deploy key on this computer: `ssh-keygen -t ed25519 -N "" -C "github-deploy" -f ~/.ssh/ascend_deploy`.
2. Add its public half on the server: `ssh -i <key> ubuntu@<IP> 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/ascend_deploy.pub`.
3. Secrets: `gh secret set ORACLE_HOST --body <IP> --repo dewil95/tutos1`,
   `gh secret set ORACLE_USER --body ubuntu --repo dewil95/tutos1`, and
   `gh secret set ORACLE_SSH_KEY --repo dewil95/tutos1 < ~/.ssh/ascend_deploy` (read from the
   file, never shown).
4. `gh workflow run deploy.yml --ref main`, then `gh run watch <id> --exit-status`.

### 11. First sign-in (in the browser, with the user)

1. https://crm.ascendfund.co → sign in with the emailed code → **one-time setup** button.
2. Settings → **Connect funding@ascendfund.co** (funding@, allow Gmail and Drive).
3. Settings → Learn from past email → **Connect a mailbox to learn from** → jonas@ (read-only).
4. Settings → **Ascend application**: paste the authorization wording.

### 12. Dry-run test

New deal → upload a made-up application PDF and statement; check the fields, download Ascend's
application, upload a "signed" copy, tick two lenders, Send. Each email appears on the deal
timeline with its To and CC, marked dry run.

Finish with the checklist, anything pending, and reminders: real lender emails stay off until
they set `MCA_EMAIL_DRY_RUN=false` in `/etc/ascend-crm/env` and restart; "Looking after the
server" in the README has status, backup-restore and disk commands.
