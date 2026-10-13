---
name: go-live
description: Put the Ascend CRM online on Cloudflare from the user's own computer (Windows or Mac), step by step with them - merge to main, deploy, database, Google, Cloudflare Access, secrets, first sign-in. Use when the user types /go-live or asks to set up, launch or deploy the CRM.
disable-model-invocation: true
---

# Go live: Ascend CRM on Cloudflare

You are running in Claude Code on the user's own computer, in their copy of this repo. Walk them
through putting the CRM online at `https://crm.dewilarieldiazbonilla.workers.dev`. The user is not technical: one
step at a time, plain words, say what you are about to do and why, and check each step worked
before the next. Keep a short checklist of the 11 steps and show it when you start and after
each step.

Background: the app is a Cloudflare Worker named `crm` (config `apps/web/wrangler.jsonc`)
with a D1 database `ascend-crm`. It is built and deployed by GitHub Actions
(`.github/workflows/deploy.yml`) on every push to `main`, never built on this computer.
README "Go live on Cloudflare" has the same steps for clicking by hand.

## Safety rules (always)

- **Never print, echo, log, or ask the user to paste into this chat any secret**: API tokens,
  keys, client secrets, the encryption key. Two ways only:
  1. A value the computer generates and nobody needs to see is piped straight into storage,
     e.g. `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put CRON_SECRET`.
  2. A value the user copies from a web page, or must keep, is typed by the user in **their own
     separate terminal window** (open a new PowerShell or Terminal window and `cd` to the repo).
     Give them the exact command to run there; it asks for the value and hides it. Wait for them
     to say "done", then verify (e.g. `npx wrangler secret list` shows the name).
- Do not run commands that display secret values (no `cat .dev.vars`, no `gcloud ... get-key-string`
  without piping it into `wrangler secret put`, no `gh secret list` tricks).
- **Ask before**: merging a pull request, anything that costs money (Google billing), deleting
  anything, or changing DNS. Never touch `ascendfund.co` or `www.ascendfund.co` (the public
  website and email stay at GoDaddy); the CRM lives on the free address
  `crm.dewilarieldiazbonilla.workers.dev`, so no DNS changes are needed.
- Keep `MCA_EMAIL_DRY_RUN` as `"true"` in `apps/web/wrangler.jsonc`. Turning on real lender
  emails is a separate decision for later (README step 7).
- Never commit secrets, `.dev.vars`, `.env*` files or real merchant files.
- If a command fails, read the error, explain it in one plain sentence, and fix what you can.
  Never disable checks or skip a step silently.
- Run all `wrangler` commands from `apps/web` (where `wrangler.jsonc` is).

On Windows, commands run in Git Bash, so `|` pipes and `$(...)` work as written. If `npx`,
`gh` or `gcloud` is "not found", ask the user to close and reopen Claude Code after installing.

## Steps

### 1. Tools and repo

Required: `node -v` (22 or newer), `git --version`, `gh --version`. Optional:
`gcloud --version` (Google Cloud CLI, about 1 GB; step 7 works without it in the browser).
If a required one is missing, tell the user the install line for Windows PowerShell:
`winget install Git.Git OpenJS.NodeJS.LTS GitHub.cli` (Mac: `brew install node git gh`), then
reopen the terminal. If winget fails to download, `winget source reset --force` first, or use the
installer from nodejs.org. If space is short, check it with `Get-PSDrive C` (keep 2 GB free).
The repo should be in the user's folder (e.g. `C:\Users\<name>\tutos1`), never under
`C:\WINDOWS\system32`. Then `git fetch origin` and `git status`.

### 2. GitHub sign-in

`gh auth status`; if not signed in, ask the user to run `gh auth login` in their own terminal
window (GitHub.com, HTTPS, log in with a web browser). Confirm with `gh auth status`.

### 3. The CRM code into `main`

The Cloudflare version lives on branch `ccr-a084c87c-zub6v3` until it is merged.

1. `gh pr list --head ccr-a084c87c-zub6v3 --state all`. If an open PR exists, use it. If none
   is open (or only merged ones), and `git log origin/main..origin/ccr-a084c87c-zub6v3 --oneline`
   shows commits, create it:
   `gh pr create --base main --head ccr-a084c87c-zub6v3 --title "Ascend CRM on Cloudflare" --body "Cloudflare (Workers, D1, Access), upload application → Ascend PDF → ship, learn from past email. See README."`
2. `gh pr checks <number> --watch`. All must pass.
3. Ask: "Merge it now? This puts the Cloudflare version on main." Only on yes:
   `gh pr merge <number> --merge`. Then `git checkout main && git pull`.

### 4. Cloudflare sign-in

From `apps/web`: `npx wrangler login` (opens the browser; the user approves). Then
`npx wrangler whoami` shows the account name and **Account ID** (not a secret). Store it for
GitHub: `gh secret set CLOUDFLARE_ACCOUNT_ID --body <account id>`.

### 5. Deploy token for GitHub

GitHub needs its own Cloudflare token (the browser login above stays on this computer).

1. Ask the user to open https://dash.cloudflare.com/profile/api-tokens → **Create Token** →
   template **Edit Cloudflare Workers** → **Use template**. Add permissions:
   **Account · D1 · Edit**. Account resources: their account. Zone resources: **All zones**
   (there are none; the CRM uses the free workers.dev address). Continue → Create Token → **Copy**.
2. In their own terminal window: `gh secret set CLOUDFLARE_API_TOKEN --repo dewil95/tutos1`
   and paste when asked.
3. Verify: `gh secret list --repo dewil95/tutos1` shows both names (values are never shown).

### 6. First deploy

`gh workflow run deploy.yml --ref main`, then find the run with
`gh run list --workflow deploy.yml --limit 1` and `gh run watch <run id> --exit-status`.
On failure: `gh run view <run id> --log-failed`, explain, fix (a token permission is the usual
cause: go back to step 5 and edit the token).
Verify from `apps/web`: `npx wrangler d1 list` shows `ascend-crm`; `npx wrangler deployments list`
shows a deployment. Until steps 8–9 are done the site lets nobody in; that is expected.

### 7. Google: Gmail, Drive and Gemini

If `gcloud` is not installed, do this step in the browser instead (use the user's project id
throughout):

- Create the project at https://console.cloud.google.com/projectcreate (name "Ascend CRM").
- Billing: https://console.cloud.google.com/billing/linkedaccount?project=<id> (ask first, as
  below).
- Enable each API: https://console.cloud.google.com/apis/library/gmail.googleapis.com?project=<id>,
  https://console.cloud.google.com/apis/library/drive.googleapis.com?project=<id> and
  https://console.cloud.google.com/apis/library/generativelanguage.googleapis.com?project=<id>
  → **Enable**.
- Gemini key: https://aistudio.google.com/apikey → **Create API key** → pick the "Ascend CRM"
  project → copy. In their own window, from `apps/web`: `npx wrangler secret put GEMINI_API_KEY`.
- Then item 6 below (the sign-in client) as written.

With `gcloud`:

1. `gcloud auth login` (browser; the user signs in as a Google Workspace admin of ascendfund.co).
2. Project: `gcloud projects create ascend-crm-<4 random digits> --name="Ascend CRM"`, then
   `gcloud config set project <id>`. (If the org requires a folder or the name is taken, try
   another id.)
3. Billing: `gcloud billing projects describe <id>`. If `billingEnabled` is not true, explain
   Gemini needs billing for privacy (a few cents per deal) and ask the user to link a billing
   account at https://console.cloud.google.com/billing/linkedaccount?project=<id>. Do not
   continue with Gemini until it is enabled.
4. `gcloud services enable gmail.googleapis.com drive.googleapis.com generativelanguage.googleapis.com apikeys.googleapis.com`
5. Gemini key, straight into the Worker without showing it (from `apps/web`):
   `gcloud services api-keys create --display-name="Ascend CRM Gemini" --key-id=ascend-crm-gemini --api-target=service=generativelanguage.googleapis.com`
   then
   `gcloud services api-keys get-key-string ascend-crm-gemini --location=global --format="value(keyString)" | npx wrangler secret put GEMINI_API_KEY`
6. Gmail/Drive sign-in client (Google has no command for this one). Ask the user to open
   https://console.cloud.google.com/auth/overview?project=<id>:
   - **Get started**: app name "Ascend CRM", support email funding@ascendfund.co, audience
     **Internal**, contact email theirs, agree, Create.
   - **Clients → Create client**: type **Web application**, name "Ascend CRM", authorized
     redirect URI `https://crm.dewilarieldiazbonilla.workers.dev/api/google/callback`, Create.
   - In their own terminal window, from `apps/web`: `npx wrangler secret put GOOGLE_CLIENT_ID`
     (paste the Client ID), then `npx wrangler secret put GOOGLE_CLIENT_SECRET` (paste the
     secret).

### 8. Sign-in for the team: Cloudflare Access

Wrangler cannot create Access apps, so guide the clicks at https://one.dash.cloudflare.com:

1. If asked, pick the **Free** plan and a team name (e.g. `ascendfund`); the team domain is
   `<team>.cloudflareaccess.com`.
2. Access → Applications → **Add an application → Self-hosted**: name "Ascend CRM", domain
   `crm.dewilarieldiazbonilla.workers.dev`; policy "Team": action **Allow**, include **Emails ending in**
   `@ascendfund.co`; login method **One-time PIN**. Save.
3. Add another **Self-hosted** application "Ascend CRM public paths" with destinations
   `crm.dewilarieldiazbonilla.workers.dev/api/v1/*`, `crm.dewilarieldiazbonilla.workers.dev/api/health`, `crm.dewilarieldiazbonilla.workers.dev/apply/*`,
   `crm.dewilarieldiazbonilla.workers.dev/api/whatsapp/*`, `crm.dewilarieldiazbonilla.workers.dev/_next/*`; policy action **Bypass**,
   include **Everyone**. Save.
4. Team domain (not secret), from `apps/web`:
   `printf '%s' '<team>.cloudflareaccess.com' | npx wrangler secret put CF_ACCESS_TEAM_DOMAIN`
5. The "Ascend CRM" app → Overview → **Application Audience (AUD) Tag**: the user copies it and
   runs in their own window, from `apps/web`: `npx wrangler secret put CF_ACCESS_AUD`.

### 9. Encryption key and cron secret

1. The encryption key protects saved SSNs and Google connections; the user must keep a copy.
   In their own window: `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`
   → they save the printed value in their password manager, then from `apps/web`:
   `npx wrangler secret put PII_ENCRYPTION_KEY` and paste it.
2. Cron secret (nobody needs to see it), you run from `apps/web`:
   `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))" | npx wrangler secret put CRON_SECRET`
3. Verify: `npx wrangler secret list` shows `CF_ACCESS_TEAM_DOMAIN`, `CF_ACCESS_AUD`,
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`, `PII_ENCRYPTION_KEY`,
   `CRON_SECRET`.

### 10. Check

`curl -s https://crm.dewilarieldiazbonilla.workers.dev/api/health`: every check should be `ok` (WhatsApp ones may
say missing; that is fine, it is switched off). If a check is missing, go back to its step.
New secrets take effect right away; if in doubt, re-run `gh workflow run deploy.yml --ref main`.

### 11. First sign-in (in the browser, with the user)

1. Open https://crm.dewilarieldiazbonilla.workers.dev, sign in with the emailed code → **one-time setup** button.
2. Settings → **Connect funding@ascendfund.co** (sign in as funding@, allow Gmail and Drive).
3. Settings → Learn from past email → **Connect a mailbox to learn from** → jonas@ (read-only).
4. Settings → **Ascend application**: paste the authorization wording from Ascend's current
   application.
5. Test in dry-run: New deal → upload a made-up application PDF and statement; check the
   fields, download Ascend's application, upload a "signed" copy, tick two lenders, Send. Each
   email appears on the deal timeline with its To and CC, marked dry run.

Finish with the checklist, what is still pending, and a reminder: real lender emails stay off
until they decide to set `MCA_EMAIL_DRY_RUN` to `"false"` (README step 7).
