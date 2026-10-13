# Ascend CRM

Deal tracking and one-click lender submissions for Ascend Fund (MCA broker / ISO), at
`https://crm.dewilarieldiazbonilla.workers.dev`.

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
- WhatsApp applications are built and **switched off** (section 8).

Everything runs on **Cloudflare** (the app on Workers, the database on D1, sign-in through
Cloudflare Access) plus Google Workspace (Gmail, Drive) and Google Gemini for the AI.
Lender emails stay in **dry-run mode** (written to the deal timeline, not sent) until you turn
it off.

How it fits together: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Research and roadmap:
[`docs/PLAN.md`](docs/PLAN.md).

## Layout

```
apps/web             Next.js app on Cloudflare Workers: pages, API routes, job handlers, wrangler.jsonc
packages/db          Prisma schema, D1 migrations (packages/db/migrations), job queue, seed
packages/domain      Offer math, qualification, bank metrics, lender matching
packages/ai          Gemini (default) / Claude clients, prompts, schemas, evals
packages/connectors  Gmail, Drive, To/CC rules, the house submission email, PDFs
docs/                Plan, architecture, lender matrix CSV, eval guidelines
legacy/              The static tutorial page this repo started as
```

## Run it locally

```bash
pnpm install
pnpm db:migrate:local                  # local D1 database (a file under apps/web/.wrangler)
cp .env.example apps/web/.env.local    # then fill in the values below
pnpm --filter @mca/web dev             # http://localhost:3000 → one-time setup page
```

In `apps/web/.env.local` set at least `PII_ENCRYPTION_KEY` (`openssl rand -base64 32`),
`CRON_SECRET` (`openssl rand -hex 32`) and `DEV_USER_EMAIL=you@ascendfund.co` (stands in for
Cloudflare Access on your machine only). The first visit opens **/setup**, which creates the
team and the lender roster.

To run it the way Cloudflare does: `pnpm cf:build && pnpm --filter @mca/web cf:preview`
(secrets in `apps/web/.dev.vars`).
Checks: `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm cf:build`.

## Go live with Claude Code on your PC (easiest)

Claude Code runs the setup commands for you in your computer's terminal and asks you only for
the sign-ins and the few things Google and Cloudflare make you click. You need a Claude Pro,
Max or Team plan.

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

   Sign in to Claude when the browser opens. Until the Cloudflare pull request is merged, use
   `git clone -b ccr-a084c87c-zub6v3 https://github.com/dewil95/tutos1` instead, so `/go-live`
   is there.

3. **Type `/go-live`.** Claude follows the checklist in
   [`.claude/skills/go-live/SKILL.md`](.claude/skills/go-live/SKILL.md): merge the code, deploy,
   Google, Cloudflare sign-in, secrets, first sign-in and a dry-run test. It never shows or asks
   you to paste keys into the chat: when a key has to be typed, it gives you a command to run in
   a second PowerShell window, which hides what you paste.

The manual steps below do the same thing by hand.

## Go live on Cloudflare (about an hour, once)

You need: the Cloudflare account that already has the $5 Workers plan, admin access to this
GitHub repo, and a Google Workspace admin. The CRM runs on the account's free workers.dev
address, so `ascendfund.co` (website and email, at GoDaddy) is not touched. Never paste keys or
tokens into a chat; type them straight into the settings pages below.

### 1. Let GitHub deploy to Cloudflare

1. Cloudflare dashboard → **My Profile → API Tokens → Create Token** → template **Edit
   Cloudflare Workers**. Add the permission **Account → D1 → Edit**. Limit it to your account
   (zone resources: all zones). Create it and copy it once.
2. Cloudflare dashboard home → your account → copy the **Account ID** (right side, or in the
   URL).
3. GitHub → this repo → **Settings → Secrets and variables → Actions → New repository secret**:
   `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`.

Then merge the pull request with these changes into `main`. From then on, every merge to `main`
runs **Deploy to Cloudflare**
(`.github/workflows/deploy.yml`): it creates the D1 database `ascend-crm` the first time,
applies the database migrations, builds and deploys the Worker `crm` on
`crm.dewilarieldiazbonilla.workers.dev`. You can also start it by hand under **Actions → Deploy to Cloudflare →
Run workflow**. Until steps 3 and 4 are done, the site lets nobody in.

### 2. Google Cloud (owned by the ascendfund.co Workspace)

1. console.cloud.google.com → new project "Ascend CRM" → enable the **Gmail API** and the
   **Google Drive API**.
2. **OAuth consent screen**: user type **Internal** (no Google review needed).
3. **Credentials → Create credentials → OAuth client ID → Web application**, authorized redirect
   URI `https://crm.dewilarieldiazbonilla.workers.dev/api/google/callback`. Keep the client ID and secret for step 4.
4. **Gemini**: aistudio.google.com → Get API key, in a Google Cloud project **with billing
   enabled** (so statements are never used to train Google's models).

### 3. Sign-in: Cloudflare Access

1. Cloudflare dashboard → **Zero Trust** (free for up to 50 users). Pick a team name, e.g.
   `ascendfund` → your team domain is `ascendfund.cloudflareaccess.com`.
2. **Access → Applications → Add an application → Self-hosted**: name "Ascend CRM", domain
   `crm.dewilarieldiazbonilla.workers.dev`. Policy "Team": **Allow**, include **Emails ending in** `@ascendfund.co`.
   Login method: **One-time PIN** works with no setup (a code by email); add Google later if you
   prefer.
3. Add a second application (or policies) that **bypass** Access for the paths that have their
   own protection: `crm.dewilarieldiazbonilla.workers.dev/api/v1/*` (website API key),
   `crm.dewilarieldiazbonilla.workers.dev/api/health`, `crm.dewilarieldiazbonilla.workers.dev/apply/*` (one-time SSN links) and
   `crm.dewilarieldiazbonilla.workers.dev/api/whatsapp/*` (Meta signature), plus `crm.dewilarieldiazbonilla.workers.dev/_next/*` (the
   app's public scripts and styles, which the SSN page needs). Policy action **Bypass**,
   include **Everyone**.
4. Open the "Ascend CRM" application → **Overview** → copy the **Application Audience (AUD)
   Tag**.

The CRM checks Cloudflare's signed sign-in token on every request and only lets in
`@ascendfund.co` emails that are on the team.

### 4. Secrets

Cloudflare dashboard → **Workers & Pages → crm → Settings → Variables and Secrets → Add**
(type **Secret**), then **Deploy**. (The Worker appears after the first deploy in step 1; run it
by hand if needed.)

| Name                    | Value                                                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `CF_ACCESS_TEAM_DOMAIN` | e.g. `ascendfund.cloudflareaccess.com` (step 3)                                                                               |
| `CF_ACCESS_AUD`         | the Application Audience Tag (step 3)                                                                                         |
| `GOOGLE_CLIENT_ID`      | step 2                                                                                                                        |
| `GOOGLE_CLIENT_SECRET`  | step 2                                                                                                                        |
| `GEMINI_API_KEY`        | step 2                                                                                                                        |
| `PII_ENCRYPTION_KEY`    | `openssl rand -base64 32` (keep a copy in a password manager: without it the saved SSNs and Google connections can't be read) |
| `CRON_SECRET`           | `openssl rand -hex 32`                                                                                                        |

Plain settings (`APP_URL`, `ALLOWED_EMAIL_DOMAIN`, `MCA_EMAIL_DRY_RUN`, `WHATSAPP_ENABLED`, time
budgets) are in `apps/web/wrangler.jsonc` and change with a merge.

Check: `https://crm.dewilarieldiazbonilla.workers.dev/api/health` → every check `ok`.

### 5. First sign-in

1. Open `https://crm.dewilarieldiazbonilla.workers.dev`, sign in with your @ascendfund.co email.
2. The first visit shows **one-time setup**: it creates the team (jonas@, savvy@, david@) and the
   lender roster with each lender's To and CC addresses. You become the admin.
3. **Settings → Connect funding@ascendfund.co**: sign in as funding@ and allow Gmail and Drive.
   The inbox is checked every 2 minutes from then on.
4. **Settings → Learn from past email → Connect a mailbox to learn from**: sign in as
   **jonas@** and allow read-only Gmail access. It reads past submissions and lender replies in
   the background (a few minutes for a few hundred emails); progress shows in Settings and the
   results on the **Lenders** page.
5. **Settings → Ascend application**: paste the authorization wording from Ascend's current
   application (printed above the merchant's signature).

### 6. Test in dry-run mode

1. **New deal → upload a made-up application PDF** (fake names and numbers) and a made-up
   statement.
2. On the deal: check the filled fields, download Ascend's application, upload a "signed" copy,
   tick two lenders and **Send**. Each email appears on the timeline with its exact To and CC,
   marked as dry run.

### 7. Turn on real sending

When the test deals look right, set `MCA_EMAIL_DRY_RUN` to `"false"` in
`apps/web/wrangler.jsonc` and merge. Lender emails then really go out from funding@.

### 8. WhatsApp applications (built, switched off)

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
5. **Cloudflare variables** (Workers → crm → Settings → Variables and Secrets, or
   `npx wrangler secret put NAME` in `apps/web`):
   - `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_BUSINESS_ACCOUNT_ID` (both on the API Setup page)
   - `WHATSAPP_TOKEN` (step 4)
   - `WHATSAPP_APP_SECRET` (App settings → Basic)
   - `WHATSAPP_VERIFY_TOKEN` (any random string, `openssl rand -hex 16`)
   - keep `WHATSAPP_ENABLED` at `"false"` (in `apps/web/wrangler.jsonc`) for now.

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
9. **Turn on.** Set `WHATSAPP_ENABLED` to `"true"` in `wrangler.jsonc` and merge; run the whole flow from your phone to the
   signature, check the signed PDF in Drive, then again in Spanish. Then add the `wa.me` button
   (shown in Settings) to the website.

Cost: Meta charges nothing for replies within 24 hours of the merchant's last message, which is
all the bot sends (two reminders included). Reading one application with Gemini is a few cents.

### Costs and limits

- **Cloudflare Workers Paid** ($5/month, the plan you already have, shared with your other
  app). The CRM needs the paid plan: its code is about 5 MB compressed (free plan limit 3 MB)
  and the background runs use more than the free CPU time. D1 and Access stay within the
  included amounts at Ascend's volume.
- **Gemini**: a few cents per application or statement set; well under $50/month at about 100
  deals a month.
- **Google Workspace**: what you already pay. Gmail sends up to 2,000 messages a day per user.
- Uploads through the CRM are up to 10 MB per click; bigger files can be emailed to funding@ and
  are filed automatically.
- **Backups**: D1 keeps 30 days of point-in-time history (Time Travel), and every file lives in
  Google Drive.
