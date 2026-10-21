---
name: go-live
description: Put the Ascend CRM online on an Oracle Cloud server from the user's own computer (Windows or Mac), step by step with them - Oracle account and server, server setup over SSH, Google, Cloudflare tunnel and sign-in, backups, settings, GitHub deploys, first sign-in. Use when the user types /go-live or asks to set up, launch or deploy the CRM.
disable-model-invocation: true
---

# Go live: Ascend CRM on Oracle Cloud

You are running in Claude Code on the user's own computer, in their copy of this repo. Walk them
through putting the CRM online at `https://crm.ascendfund.co` on one Oracle Cloud server. The
user is not technical: one step at a time, plain words, say what you are about to do and why, and
check each step worked before the next. Keep a checklist of the 13 steps below and show it when
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

You can run SSH commands on the server yourself with the key made in step 4:
`ssh -i ~/.ssh/ascend_oracle ubuntu@<IP> '<command>'` (written `ssh ...` below). On Windows,
Claude Code's shell is Git Bash, so `ssh`, `ssh-keygen` and `scp` work as written. For anything
that asks for a secret, give the user the exact command to run in their own window instead.

## Browser helper rules (when the Playwright tools are loaded)

With the browser helper from step 1, you do the clicks in a visible Edge window
(`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_fill_form`,
`browser_select_option`; in Claude Code they appear as `mcp__playwright__browser_*`). It runs
with `--snapshot-mode none`: clicks and page loads return only the address and title, and you
see a page's content **only when you call `browser_snapshot`**. That is what keeps secrets out
of this chat:

- **Hands-off screens.** The user acts, you do not call `browser_snapshot` or
  `browser_take_screenshot` until they say "listo" / "done" and the screen has moved on:
  - sign-in, password, 2FA and email-code pages (Oracle, Cloudflare, Google, the CRM);
  - payment, billing or card pages (signup included): stop and let the user decide;
  - the Cloudflare tunnel page **after** naming the tunnel: the user clicks **Save tunnel**,
    copies the install command into their own SSH window (step 7), then clicks **Next**;
  - Oracle **Customer secret keys → Generate** and its one-time dialog;
  - the Google OAuth client **Create** result (client secret) and the Gemini API key dialog.
- Never click a button that reveals a secret; the user clicks it. Never type a secret into any
  field, and never use `browser_evaluate` or `browser_run_code_unsafe` to read a page.
- Read only non-secret values off pages: public IP, region, namespace, team domain, AUD tag.
- Stop before every final **Create / Save / Deploy / Add** and ask "¿Lo creo?" ("Create it?").
- Never open the DNS records of `ascendfund.co`. The only DNS change is the `crm` hostname the
  tunnel adds in step 7.3, after the user says yes.
- If a secret ever appears in a result anyway, say so at once and help the user replace it
  (Cloudflare tunnel → Refresh token; Oracle/Google/Gemini → delete the key and make a new one).
- If a page doesn't match the step (menus change), take a snapshot, pick the closest match and
  say what you chose. If you are stuck after two tries, ask the user to click it and continue.
- The helper keeps its own sign-ins in `%USERPROFILE%\.ascend-browser`, separate from the
  user's normal Edge. At the end, tell them they can delete that folder to sign the robot out.

Without the helper, guide the same clicks in words, as each step describes.

## Steps

### 1. Tools and repo

Required here: `git --version`, `gh --version`, `ssh -V`. If one is missing, Windows PowerShell:
`winget install Git.Git GitHub.cli` (Git includes ssh), then reopen. `git fetch origin` and
`git status`. The repo should be in the user's folder, never under `C:\WINDOWS\system32`.

**Browser helper (optional, recommended).** If the `mcp__playwright__browser_*` tools are not
loaded and `node -v` works, offer it: "I can open a browser window and do the Oracle, Cloudflare
and Google clicks for you; you sign in yourself." On yes, Windows:

```
claude mcp add --scope local playwright -- cmd /c npx -y @playwright/mcp@0.0.83 --browser msedge --snapshot-mode none --user-data-dir "$USERPROFILE/.ascend-browser/profile" --output-dir "$USERPROFILE/.ascend-browser/out"
```

(Mac: drop `cmd /c`, use `--browser chrome` and `"$HOME/.ascend-browser/..."`.) It uses the Edge
already on the PC, so nothing big is downloaded. Then the user types `/exit`, runs `claude`
again and `/go-live`; check `claude mcp list` shows `playwright` connected. Never drop
`--snapshot-mode none`. If it fails (disk, npm), carry on without it.

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

With the helper, `browser_navigate` to https://cloud.oracle.com and let the user sign up or sign
in (hands-off, including any card check). Otherwise guide them there:

1. If new: pick the **home region** nearest to them (cannot be changed later).
2. The user chose to **stay on the free account** (no Pay As You Go). Don't push an upgrade;
   the server size, usage meter and alarm in the next steps handle Oracle's idle rule. Mention
   once that upgrading later is the zero-risk option.

### 4. The server

First make the server's SSH key on this computer (the private half never leaves it):
`mkdir -p ~/.ssh && ssh-keygen -t rsa -b 4096 -N "" -C "ascend-oracle" -f ~/.ssh/ascend_oracle`
(skip if `~/.ssh/ascend_oracle` already exists). Show the **public** half:
`cat ~/.ssh/ascend_oracle.pub` (safe to show; never show the file without `.pub`).

Then Compute → Instances → **Create instance** (with the helper, do these clicks; otherwise
guide them):

- Name `ascend-crm`. Image: **Canonical Ubuntu 24.04** (aarch64). Shape: **Ampere
  VM.Standard.A1.Flex**, **1 OCPU / 3 GB** (small on purpose: normal use then stays above
  Oracle's 20% memory "idle" line). On "out of capacity": another availability domain or later.
- SSH keys: **Paste public keys** → the contents of `~/.ssh/ascend_oracle.pub`.
- Networking: default VCN, **assign a public IPv4 address**. Do not add ingress rules (only SSH
  22 stays open; the site comes through the tunnel).
- Ask "¿Lo creo?", then Create, wait for **Running**, note the **public IP**.
  Test: `ssh -i ~/.ssh/ascend_oracle -o StrictHostKeyChecking=accept-new ubuntu@<IP> 'uname -m && df -h /'`.

### 5. Set up the server

Run over SSH (the branch is `main` once merged in step 2):
`ssh -i ~/.ssh/ascend_oracle ubuntu@<IP> 'curl -fsSL https://raw.githubusercontent.com/dewil95/tutos1/main/deploy/oracle/setup-server.sh -o setup-server.sh && sudo bash setup-server.sh'`
It takes several minutes (installs Node, cloudflared, Litestream, builds the CRM). It ends with
"Done". Check: `ssh ... 'systemctl is-active ascend-crm && curl -s http://127.0.0.1:3000/api/health | head -c 300'`
(status "degraded" is expected until step 9).

### 6. Google: Gmail, Drive and Gemini

With the helper, open each link below and do the clicks; the user signs in to Google (hands-off)
and clicks the final **Create** of the OAuth client and of the Gemini key themselves, because
those screens show secrets.

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

At https://one.dash.cloudflare.com (with the helper, you click; the user signs in, hands-off):

1. If asked, Free plan and team name (e.g. `ascendfund` → `ascendfund.cloudflareaccess.com`).
   If it asks for a card, stop: the user decides.
2. **Networks → Tunnels → Create a tunnel → Cloudflared**, name `ascend-crm`. With the helper,
   type the name and stop: the user clicks **Save tunnel**. The next page shows an install
   command with a token. The user runs on the server, in their own window:
   `ssh -i ~/.ssh/ascend_oracle ubuntu@<IP>` then `sudo cloudflared service install <TOKEN>`,
   then clicks **Next** and says "listo".
   Check: `ssh ... 'systemctl is-active cloudflared'`, and the tunnel shows **Healthy**.
3. Tunnel → **Public hostname → Add**: subdomain `crm`, domain `ascendfund.co`, type **HTTP**, URL
   `127.0.0.1:3000`. This creates the `crm` DNS record: ask before saving.
4. **Access → Applications → Add → Self-hosted** "Ascend CRM", domain `crm.ascendfund.co`;
   policy "Team": **Allow**, **Emails ending in** `@ascendfund.co`; login **One-time PIN**.
5. Another **Self-hosted** app "Ascend CRM public paths": `crm.ascendfund.co/api/v1/*`,
   `crm.ascendfund.co/api/health`, `crm.ascendfund.co/apply/*`,
   `crm.ascendfund.co/api/whatsapp/*`, `crm.ascendfund.co/_next/*`; policy **Bypass**, **Everyone**.
6. "Ascend CRM" app → Overview → **Application Audience (AUD) Tag**: the user keeps it for step 9.
   Check: `curl -s https://crm.ascendfund.co/api/health | head -c 200` answers through the tunnel.

### 8. Backups (Object Storage)

With the helper you click; otherwise guide. Storage → Buckets → **Create bucket**
`ascend-crm-backups` (private). Profile → **Customer secret keys**: type the name `litestream`
and stop; the user clicks **Generate** (secret shown once; the user keeps it for step 9) and
closes the dialog before you continue. The Access key shown in the list is not secret.
Tenancy details → **Object storage namespace**; region id from the region menu (e.g.
`us-ashburn-1`). Endpoint: `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`
(namespace and region are not secret; you may help assemble it).

### 9. Settings on the server

1. Generate the two server secrets on the server, written straight into the file:
   `ssh ... 'sudo sed -i "s|^CRON_SECRET=.*|CRON_SECRET=$(openssl rand -hex 32)|" /etc/ascend-crm/env'`
   For the encryption key the user must keep a copy, so in **their own window**:
   `ssh -i ~/.ssh/ascend_oracle ubuntu@<IP>` then `openssl rand -base64 32` → they save it in their password
   manager → then they paste it in the next step.
2. The user, in their own window on the server: `sudo nano /etc/ascend-crm/env` and fills
   `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
   `GEMINI_API_KEY`, `PII_ENCRYPTION_KEY`, `BACKUP_ENDPOINT`, `BACKUP_REGION`,
   `BACKUP_ACCESS_KEY_ID`, `BACKUP_SECRET_ACCESS_KEY` (Ctrl+O, Enter, Ctrl+X to save).
3. Apply: `ssh ... 'sudo systemctl restart ascend-crm && sudo systemctl enable --now litestream ascend-crm-nightly.timer'`.
4. Check: `curl -s https://crm.ascendfund.co/api/health`: every check `ok` (WhatsApp ones may say
   missing; it is switched off). Backups: `ssh ... 'sleep 20; sudo -u ascend bash -c "set -a; . /etc/ascend-crm/env; set +a; litestream snapshots -config /etc/litestream.yml /var/lib/ascend-crm/crm.db"'`
   lists a snapshot. If a check is missing, return to its step.

### 10. Automatic updates from GitHub

GitHub needs its own key to reach the server:

1. Make a deploy key on this computer: `ssh-keygen -t ed25519 -N "" -C "github-deploy" -f ~/.ssh/ascend_deploy`.
2. Add its public half on the server: `ssh -i ~/.ssh/ascend_oracle ubuntu@<IP> 'cat >> ~/.ssh/authorized_keys' < ~/.ssh/ascend_deploy.pub`.
3. Secrets: `gh secret set ORACLE_HOST --body <IP> --repo dewil95/tutos1`,
   `gh secret set ORACLE_USER --body ubuntu --repo dewil95/tutos1`, and
   `gh secret set ORACLE_SSH_KEY --repo dewil95/tutos1 < ~/.ssh/ascend_deploy` (read from the
   file, never shown).
4. `gh workflow run deploy.yml --ref main`, then `gh run watch <id> --exit-status`.

### 11. First sign-in (in the browser, with the user)

With the helper you can open the pages and click the buttons; the emailed code and Google's
account and "Allow" screens are hands-off.

1. https://crm.ascendfund.co → sign in with the emailed code → **one-time setup** button.
2. Settings → **Connect funding@ascendfund.co** (funding@, allow Gmail and Drive).
3. Settings → Learn from past email → **Connect a mailbox to learn from** → jonas@ (read-only).
4. Settings → **Ascend application**: paste the authorization wording.

### 12. Idle-rule safety net

1. Outside alarm: the user creates a free monitor at https://uptimerobot.com for
   `https://crm.ascendfund.co/api/health` (HTTP(s), every 5 minutes, email alert).
2. Usage meter: `ssh ... 'tail -n 3 /var/lib/ascend-crm/usage.log'` shows samples; Settings →
   Server shows the idle risk. Tell the user to check it after the first week; if it says
   _watch_ or _high_, the README section "Staying clear of Oracle's idle rule" says what to do.
3. Point them to "If the server is stopped or lost" in the README.

### 13. Dry-run test

New deal → upload a made-up application PDF and statement; check the fields, download Ascend's
application, upload a "signed" copy, tick two lenders, Send. Each email appears on the deal
timeline with its To and CC, marked dry run.

Finish with the checklist, anything pending, and reminders: real lender emails stay off until
they set `MCA_EMAIL_DRY_RUN=false` in `/etc/ascend-crm/env` and restart; "Looking after the
server" in the README has status, backup-restore and disk commands.
