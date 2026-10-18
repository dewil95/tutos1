# Ascend CRM

Deal tracking and one-click lender submissions for Ascend Fund (MCA broker / ISO), at
`https://crm.ascendfund.co`.

**The everyday flow**

1. **New deal → upload the merchant's application** (the one they signed with another company,
   PDF or photos). AI reads it and fills in Ascend's application. That file stays with the team
   and is never sent to lenders.
2. On the deal page, **check the details** (anything missing is listed), then **Download
   Ascend's application**: a PDF with an empty signature line.
3. The merchant **signs it** (DocuSign, or on paper); **upload the signed copy**. It is ticked
   for lenders automatically.
4. **Ship the file**: tick the lenders (ranked by fit and by what each lender approved before)
   and send. **One separate email per lender**: the lender's first address in **To**, its other
   addresses and the team in **CC**, never BCC.
5. Lender replies are read by AI and kept as a status row per lender (received, declined with
   reason, offer, stips, contract, funded).

**What else it does**

- Reads the `funding@ascendfund.co` inbox and files every attachment into a Google Drive
  folder per deal; deals the team sends by hand from Gmail are picked up too.
- **Learns from past email** (e.g. jonas@, read-only): past submissions, lender answers,
  positions and balances. The **Lenders** page shows what each lender approved, declined and why,
  typical offers and reply speed, and how the team shops deals.
- Scrubs every bank statement (balance math, missing months, NSFs, negative days, existing
  advances, new funding, signs of PDF editing) and writes an internal AI Risk Report.
- Stamps each lender's copy of the PDFs with a traceable watermark.
- Sends routine emails on its own (missing documents, stip chases, lender follow-ups).
- Takes applications from Ascend's website through an API key ([`docs/API.md`](docs/API.md)).
- WhatsApp applications are built and **switched off** (see "WhatsApp applications" below).

The CRM runs on **one Oracle Cloud server** (Always Free ARM machine): the app, its database
(a SQLite file, backed up continuously to Oracle Object Storage) and the background jobs.
Cloudflare stays only as the front door: your domain, a private tunnel to the server and the
team sign-in (Cloudflare Access), all on Cloudflare's free plan. Gmail and Drive hold the email
and files, and Google Gemini does the AI reading.
Lender emails stay in **dry-run mode** (written to the deal timeline, not sent) until you turn
it off.

How it fits together: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Research and roadmap:
[`docs/PLAN.md`](docs/PLAN.md).

## Layout

```
apps/web             Next.js app (pages, API routes, job handlers); builds to a standalone Node server
packages/db          Prisma schema, SQLite migrations (packages/db/migrations), migration runner, job queue
packages/domain      Offer math, qualification, bank metrics, lender matching
packages/ai          Gemini (default) / Claude clients, prompts, schemas, evals
packages/connectors  Gmail, Drive, To/CC rules, the house submission email, PDFs
deploy/oracle        Server setup script, update script, systemd services, backup config
docs/                Plan, architecture, lender matrix CSV, eval guidelines
legacy/              The static tutorial page this repo started as
```

## Run it locally

```bash
pnpm install
DATABASE_PATH=.data/crm.db pnpm db:migrate   # creates the database file
cp .env.example apps/web/.env.local          # then fill in the values below
pnpm --filter @mca/web dev                   # http://localhost:3000 → one-time setup page
```

In `apps/web/.env.local` set `DATABASE_PATH` to the full path of `.data/crm.db`,
`PII_ENCRYPTION_KEY` (`openssl rand -base64 32`), `CRON_SECRET` (`openssl rand -hex 32`) and
`DEV_USER_EMAIL=you@ascendfund.co` (stands in for Cloudflare Access on your machine only). The
first visit opens **/setup**, which creates the team and the lender roster.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm --filter @mca/web build`.

## Go live with Claude Code on your PC (easiest)

Claude Code runs the setup with you from your computer's terminal: it prepares every command,
connects to the server for you, and asks you only for sign-ins, the few pages Oracle, Google and
Cloudflare make you click, and to type secret values yourself. You need a Claude Pro, Max or
Team plan.

1. **Install the tools.** Open **PowerShell** (Start → type "PowerShell") and run:

   ```powershell
   winget install Git.Git OpenJS.NodeJS.LTS GitHub.cli
   irm https://claude.ai/install.ps1 | iex
   ```

   Keep at least 2 GB free on C: (`Get-PSDrive C` shows it). If winget can't download, run
   `winget source reset --force` and try again. If the installer says `.local\bin` is not in
   your PATH, run this once:

   ```powershell
   [Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";$env:USERPROFILE\.local\bin", "User")
   ```

   Close PowerShell and open it again. `claude --version` should print a version number.
   (Mac: `brew install node git gh`, then `curl -fsSL https://claude.ai/install.sh | bash`.)

2. **Get the code and start Claude Code:**

   ```powershell
   cd $HOME
   git clone https://github.com/dewil95/tutos1
   cd tutos1
   claude
   ```

   Until the Oracle version is merged, use
   `git clone -b ccr-a084c87c-zub6v3 https://github.com/dewil95/tutos1` instead.

3. **Type `/go-live`.** Claude follows [`.claude/skills/go-live/SKILL.md`](.claude/skills/go-live/SKILL.md),
   the same steps as below.

**Optional: let Claude do the clicks.** At the start, `/go-live` offers a browser helper
(Playwright, using the Edge already on your PC). A separate Edge window opens; you sign in to
Oracle, Cloudflare and Google yourself, and Claude fills in the setup pages and stops before
every "Create" to ask you. On screens that show a secret (tunnel token, secret keys, client
secret, Gemini key) you click and copy yourself; Claude doesn't look at those screens. The
helper keeps its sign-ins in `%USERPROFILE%\.ascend-browser`; delete that folder when you're
done to sign it out.

## Go live on Oracle Cloud (about 1–2 hours, once)

What you need: an Oracle Cloud account, your Cloudflare login (the `ascendfund.co` domain is
there), admin access to this GitHub repo, and a Google Workspace admin. Never paste keys or
passwords into a chat; type them on the server or the settings pages below.

### 1. Oracle account

1. Sign up at oracle.com/cloud/free. Pick your **home region** carefully (nearest to you; it
   can't be changed later, and the free servers only exist there).
2. Stay on the free account. Oracle may take back a free server it considers idle; the next
   steps size the server and add a usage meter so that doesn't happen (see "Staying clear of
   Oracle's idle rule" below). If you ever want zero risk, upgrade to Pay As You Go: still $0
   inside the free limits, and idle servers are never reclaimed.

### 2. The server

1. Compute → Instances → **Create instance**:
   - Image: **Canonical Ubuntu 24.04** (the aarch64 / ARM build).
   - Shape: **Ampere → VM.Standard.A1.Flex**, **1 OCPU, 3 GB memory**. Small on purpose: the
     CRM's normal memory use then stays above Oracle's 20% "idle" line, without any fake load
     (a 12 GB server would look idle). If Oracle says "out of capacity", try another
     availability domain or try again later.
   - Boot volume: 50 GB is plenty (free up to 200 GB in total).
   - SSH keys: make one on your computer first (Git Bash or Terminal:
     `ssh-keygen -t rsa -b 4096 -N "" -f ~/.ssh/ascend_oracle`), then choose **Paste public
     keys** and paste the contents of `~/.ssh/ascend_oracle.pub`. (Oracle's **Generate a key
     pair** also works; keep the downloaded private key safe.)
   - Networking: the default VCN with a public IP is fine. **Don't open any ports**: the site
     reaches the server through the Cloudflare Tunnel, so only SSH (22) stays open.
2. Note the **public IP address**.
3. Connect: `ssh -i ~/.ssh/ascend_oracle ubuntu@<public IP>`.

### 3. Set up the server

On the server:

```bash
curl -fsSL https://raw.githubusercontent.com/dewil95/tutos1/main/deploy/oracle/setup-server.sh -o setup-server.sh
sudo bash setup-server.sh
```

It installs Node, the tunnel and the backup tool, creates the `ascend` user, the database folder
(`/var/lib/ascend-crm`) and the services, builds the CRM and starts it on the server only
(127.0.0.1:3000). It turns on automatic security updates. Safe to run again. (Before the Oracle
version is merged, add `BRANCH=ccr-a084c87c-zub6v3` in front of `bash`, and use that branch in
the URL.)

### 4. Google Cloud (Gmail, Drive, Gemini)

1. console.cloud.google.com → new project "Ascend CRM" → enable the **Gmail API** and the
   **Google Drive API**.
2. **OAuth consent screen**: user type **Internal** (no Google review needed).
3. **Credentials → Create credentials → OAuth client ID → Web application**, authorized redirect
   URI `https://crm.ascendfund.co/api/google/callback`. Keep the client ID and secret for step 7.
4. **Gemini**: aistudio.google.com → Get API key, in a Google Cloud project **with billing
   enabled** (so statements are never used to train Google's models).

### 5. Cloudflare: tunnel and sign-in (free)

1. Cloudflare dashboard → **Zero Trust** (free for up to 50 users). Pick a team name, e.g.
   `ascendfund` → your team domain is `ascendfund.cloudflareaccess.com`.
2. **Networks → Tunnels → Create a tunnel** (Cloudflared) named `ascend-crm`. Copy the install
   token it shows, and on the server run `sudo cloudflared service install <TOKEN>`.
3. In the tunnel's **Public hostname** tab: subdomain `crm`, domain `ascendfund.co`, service
   **HTTP** `127.0.0.1:3000`. Cloudflare creates the DNS record.
4. **Access → Applications → Add an application → Self-hosted**: name "Ascend CRM", domain
   `crm.ascendfund.co`. Policy "Team": **Allow**, include **Emails ending in** `@ascendfund.co`.
   Login method: **One-time PIN** works with no setup (a code by email).
5. Add a second application that **bypasses** Access for paths with their own protection:
   `crm.ascendfund.co/api/v1/*` (website API key), `crm.ascendfund.co/api/health`,
   `crm.ascendfund.co/apply/*` (one-time SSN links), `crm.ascendfund.co/api/whatsapp/*` (Meta
   signature) and `crm.ascendfund.co/_next/*` (the app's public scripts and styles). Policy
   action **Bypass**, include **Everyone**.
6. Open the "Ascend CRM" application → **Overview** → copy the **Application Audience (AUD)
   Tag**.

### 6. Backups (Oracle Object Storage, free up to 20 GB)

1. Storage → **Buckets → Create bucket** `ascend-crm-backups` (private, Standard tier).
2. Your profile (top right) → **Customer secret keys → Generate secret key** named "litestream".
   Copy the secret now (shown once) and the **Access key** next to it.
3. Note the **Object storage namespace** (Tenancy details) and your **region** id (e.g.
   `us-ashburn-1`). The endpoint is `https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`.

### 7. Settings on the server

On the server: `sudo nano /etc/ascend-crm/env` and fill in every empty line
([`deploy/oracle/env.example`](deploy/oracle/env.example) explains each one):
`CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`,
`GEMINI_API_KEY`, `PII_ENCRYPTION_KEY` (`openssl rand -base64 32`; **keep a copy in a password
manager**: without it the saved SSNs and Google connections can't be read), `CRON_SECRET`
(`openssl rand -hex 32`) and the five `BACKUP_*` values. Then:

```bash
sudo systemctl restart ascend-crm
sudo systemctl enable --now litestream ascend-crm-nightly.timer
curl -s http://127.0.0.1:3000/api/health      # every check "ok"
```

`https://crm.ascendfund.co/api/health` should show the same from anywhere.

### 8. Updates from GitHub

Each merge to `main` updates the server automatically (**Deploy to Oracle**,
`.github/workflows/deploy.yml`) once these GitHub repository secrets exist (**Settings → Secrets
and variables → Actions**): `ORACLE_HOST` (the public IP), `ORACLE_USER` (`ubuntu`) and
`ORACLE_SSH_KEY` (the private key file's contents). You can also update by hand on the server:
`sudo bash /opt/ascend-crm/deploy/oracle/update.sh`.

### 9. First sign-in

1. Open `https://crm.ascendfund.co`, sign in with your @ascendfund.co email.
2. The first visit shows **one-time setup**: it creates the team (jonas@, savvy@, david@) and the
   lender roster with each lender's To and CC addresses. You become the admin.
3. **Settings → Connect funding@ascendfund.co**: sign in as funding@ and allow Gmail and Drive.
   The inbox is checked every 2 minutes from then on.
4. **Settings → Learn from past email → Connect a mailbox to learn from**: sign in as
   **jonas@** and allow read-only Gmail access.
5. **Settings → Ascend application**: paste the authorization wording from Ascend's current
   application.

### 10. Test in dry-run mode, then turn on sending

1. **New deal → upload a made-up application PDF** and a made-up statement; check the fields,
   download Ascend's application, upload a "signed" copy, tick two lenders and **Send**. Each
   email appears on the timeline with its exact To and CC, marked as dry run.
2. When it looks right: set `MCA_EMAIL_DRY_RUN=false` in `/etc/ascend-crm/env` and
   `sudo systemctl restart ascend-crm`.

### Staying clear of Oracle's idle rule

Oracle may reclaim (stop) a free server when, over 7 days, its CPU (95th percentile), network
and memory all stay under 20%. The CRM handles it this way:

- **Right size**: 1 OCPU / 3 GB, so the system, the CRM, the tunnel and the backup tool keep
  memory above 20% in normal use. A 2 GB swap file (made by the setup script) gives builds room.
- **Usage meter**: every minute the server records CPU and memory the way Oracle judges them.
  **Settings → Server** (and `/api/health`) shows the idle risk: _low_, _watch_ or _high_, with
  the numbers. Check it after the first week. If it says _watch_ or _high_, lower the memory
  (Compute → Instance → Edit → shape, 2 GB) so the same use counts for more, or upgrade the
  account to Pay As You Go.
- **Useful nightly work**: at 3:30 every night the server restores the latest backup into a
  temporary file and checks it is intact (shown under Settings → Server), and tidies the
  database statistics. It proves your backups work.
- **An outside alarm**: create a free monitor at uptimerobot.com for
  `https://crm.ascendfund.co/api/health` (HTTP, every 5 minutes, email alert). If the server
  stops for any reason, you get an email within minutes.

No program runs just to burn CPU or hold memory; that wastes the free resources and could break
if Oracle changes its rules.

### If the server is stopped or lost

- **Stopped (reclaimed or crashed)**: Oracle stops the server, it doesn't delete it. Compute →
  Instances → `ascend-crm` → **Start**. Everything starts on its own (CRM, tunnel, backups,
  timers); check `https://crm.ascendfund.co/api/health`.
- **Lost (new server needed, about 30 minutes)**:
  1. Create a server as in step 2 and run the setup script as in step 3.
  2. Put your settings back in `/etc/ascend-crm/env` (keep a copy of that file's values in your
     password manager, especially `PII_ENCRYPTION_KEY`).
  3. Bring the database back from Object Storage before starting the CRM:

     ```bash
     sudo systemctl stop ascend-crm
     # Only on a brand-new server: remove the empty database the setup script made.
     sudo rm -f /var/lib/ascend-crm/crm.db /var/lib/ascend-crm/crm.db-wal /var/lib/ascend-crm/crm.db-shm
     sudo -u ascend bash -c 'set -a; . /etc/ascend-crm/env; set +a; litestream restore -config /etc/litestream.yml -o /var/lib/ascend-crm/crm.db /var/lib/ascend-crm/crm.db'
     sudo systemctl start ascend-crm
     sudo systemctl enable --now litestream ascend-crm-nightly.timer
     ```

  4. Reconnect the tunnel: Zero Trust → Networks → Tunnels → `ascend-crm` → install command,
     then `sudo cloudflared service install <TOKEN>` on the new server. Update the
     `ORACLE_HOST` GitHub secret to the new IP.
  5. Files are in Google Drive and email in Gmail, so nothing else needs restoring.

### Looking after the server

- **Status:** `systemctl status ascend-crm litestream cloudflared`; logs with
  `sudo journalctl -u ascend-crm -n 100`.
- **Backups:** list them with

  ```bash
  sudo -u ascend bash -c 'set -a; . /etc/ascend-crm/env; set +a; litestream snapshots -config /etc/litestream.yml /var/lib/ascend-crm/crm.db'
  ```

  To roll back to the latest backup on the same server:

  ```bash
  sudo systemctl stop ascend-crm litestream
  sudo -u ascend bash -c 'set -a; . /etc/ascend-crm/env; set +a; litestream restore -config /etc/litestream.yml -o /var/lib/ascend-crm/restored.db /var/lib/ascend-crm/crm.db'
  sudo rm -f /var/lib/ascend-crm/crm.db-wal /var/lib/ascend-crm/crm.db-shm
  sudo -u ascend mv /var/lib/ascend-crm/restored.db /var/lib/ascend-crm/crm.db
  sudo systemctl start litestream ascend-crm
  ```

- **Disk:** `/api/health` shows `diskFreeMb`; keep it above 2,000.
- Security updates install automatically; reboot now and then with `sudo reboot` (the CRM and
  tunnel start on their own).

### WhatsApp applications (built, switched off)

How it works for the merchant: they message Ascend's WhatsApp number (or tap a
`wa.me/<number>?text=Apply` link on the website), pick English or Spanish and send the signed
application they already have from another company, plus bank statements. The CRM reads it,
fills in Ascend's application, asks only for what is missing, sends a private link for the SSN
and date of birth, shows the filled application as a PDF and asks them to type their name and
tap **I agree, sign**. The deal appears on the board with a WhatsApp badge and the signed
`Ascend-Fund-Application-<Merchant>.pdf` ready for lenders. The other company's PDF is kept as
an internal file and is never sent to lenders. Anyone can type _agent_ to get a person; reps
answer from the deal page.

Setup (about an hour, once; the CRM must already be online with funding@ connected, because
the bot saves the merchant's files to Drive):

> **Already have a number in the WhatsApp Business app?** Use it instead of a Telnyx number:
>
> - In the app: Settings → Account → **Delete my account**. A number can't be on the app and on
>   the CRM at the same time.
> - Wait a few minutes, and keep the phone and SIM so you can receive Meta's SMS or call code.
> - Skip step 1, and add that number in step 3.
> - Choose any new 6-digit PIN at Register number (step 7); the app's old two-step PIN goes away
>   with the deleted account.

1. **Number.** A US number in Telnyx (about $1/month), not used in any WhatsApp app on a phone.
   Meta verifies it with a code by SMS or phone call: in Telnyx, forward the number's calls to
   your mobile and choose "phone call" when Meta asks.
2. **Meta Business portfolio** (business.facebook.com) for Ascend Fund: legal name, website
   ascendfund.co, business email and address.
3. **Meta app.** On developers.facebook.com create an app (type _Business_) in that portfolio,
   add the **WhatsApp** product, then _API Setup → Add phone number_ with the Telnyx number and
   the display name "Ascend Fund" (it must match the website, or Meta declines it). Add the
   logo, description, website and email to the WhatsApp profile. Switch the app to **Live** mode.
4. **Permanent token.** Meta Business Settings → System users → add one, give it the app and the
   WhatsApp account, generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
5. **Server settings** (`sudo nano /etc/ascend-crm/env`, then `sudo systemctl restart ascend-crm`):
   - `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_BUSINESS_ACCOUNT_ID` (both on the API Setup page)
   - `WHATSAPP_TOKEN` (step 4)
   - `WHATSAPP_APP_SECRET` (App settings → Basic)
   - `WHATSAPP_VERIFY_TOKEN` (any random string, `openssl rand -hex 16`)
   - keep `WHATSAPP_ENABLED=false` for now.

   Check: `https://<your-app>/api/health` lists each of them as `ok` under `whatsapp`.

6. **Webhook.** Meta app → WhatsApp → Configuration: Callback URL
   `https://<your-app>/api/whatsapp/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN`, then
   subscribe to the **messages** field.
7. **Settings → WhatsApp applications** in the CRM, in order:
   1. **Check connection**: shows the number, the display name and its review status.
   2. **Register number** with a 6-digit PIN you keep (it becomes the number's two-step PIN;
      Meta allows 10 tries per 72 hours).
   3. **Connect webhooks**: without this, Meta may accept the webhook URL but never send messages.
      Press Check connection again: it should list your app.

   Then enter the number (for the website link) and paste the exact authorization wording from
   Ascend's current application, in English and Spanish. Until you do, a default wording is used.

8. **Test in test mode.** Message the number from your own phone with a made-up application PDF.
   With `WHATSAPP_ENABLED=false` the bot's replies only appear on the deal page (marked "not
   sent"), and the file appears in the deal's Drive folder.
9. **Turn on.** Set `WHATSAPP_ENABLED=true` in the settings file and restart the CRM; run the whole flow from your phone to the
   signature, check the signed PDF in Drive, then again in Spanish. Then add the `wa.me` button
   (shown in Settings) to the website.

Cost: Meta charges nothing for replies within 24 hours of the merchant's last message, which is
all the bot sends (two reminders included). Reading one application with Gemini is a few cents.

### Costs and limits

- **Oracle Cloud**: $0 on the Always Free account (the ARM server, 200 GB of disk, 20 GB of
  Object Storage, 10 TB of traffic a month). See "Staying clear of Oracle's idle rule".
- **Cloudflare**: $0 (DNS, the tunnel, and Access for up to 50 users are free).
- **Gemini**: a few cents per application or statement set; well under $50/month at about 100
  deals a month.
- **Google Workspace**: what you already pay. Gmail sends up to 2,000 messages a day per user.
- Uploads through the CRM are up to 10 MB per click; bigger files can be emailed to funding@ and
  are filed automatically.
- **Backups**: the database streams to Object Storage within seconds of each change (30 days
  kept), and every file lives in Google Drive.
