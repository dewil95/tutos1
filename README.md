# Ascend CRM

Deal tracking and one-click lender submissions for Ascend Fund (MCA broker / ISO).

- Reads the `funding@ascendfund.co` inbox and files every attachment into a Google Drive folder per deal.
- Sends a deal to the lenders you tick, **one separate email per lender**: the lender's first address
  in **To**, its other addresses and the team in **CC**, never BCC.
- Reads lender replies with Google Gemini and keeps a status row per lender
  (received, declined with reason, offer, stips, contract, funded).
- Takes applications straight from Ascend's website through an API key ([`docs/API.md`](docs/API.md));
  application PDFs are read by AI to fill the merchant and owner fields.
- Scrubs every bank statement: balance math, missing months, NSFs, negative days, existing advances,
  new funding (stacking) and signs of PDF editing; an internal AI Risk Report sums it up.
- Ranks lenders by appetite and their past approvals, and stamps each lender's copy of the PDFs
  with a traceable watermark.
- Sends routine emails on its own: missing documents, stip chases, lender follow-ups; contract
  requests and clawback confirmations are one click.
- Takes applications on WhatsApp: a merchant sends the signed application they already have from
  another company; the bot fills in Ascend's application from it, asks only what is missing (SSN
  and date of birth through a one-time private link, never in the chat), shows the filled PDF and
  the merchant signs by typing their name and tapping "I agree, sign".
- Runs on free tiers: Vercel (app), Supabase (database, sign-in, cron), Google Workspace (Gmail, Drive),
  Meta's WhatsApp Cloud API. No calls or SMS, no Salesforce.

How it fits together: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Research and roadmap:
[`docs/PLAN.md`](docs/PLAN.md).

## Layout

```
apps/web             Next.js app: deal board, deal page, settings, cron + Google routes, job handlers
packages/db          Prisma schema, migrations (with RLS), job queue, seed (lenders from CSV)
packages/domain      Offer math, qualification, bank metrics, lender matching
packages/ai          Gemini (default) / Claude clients, prompts, schemas, evals
packages/connectors  Gmail, Drive, To/CC rules, the house submission email
docs/                Plan, architecture, lender matrix CSV, eval guidelines
legacy/              The static tutorial page this repo started as
```

## Run it locally

```bash
pnpm install
cp .env.example .env                   # dry-run sending is on by default
docker compose -f infra/docker-compose.yml up -d   # Postgres only
pnpm db:deploy && pnpm db:seed         # schema + Ascend team + lender roster with To/CC
pnpm --filter @mca/web dev             # http://localhost:3000
```

Sign-in needs the Supabase and Google settings below, even locally.
Checks: `pnpm typecheck`, `pnpm test`, `pnpm format:check`, `pnpm --filter @mca/web build`.

## Deploy (free tiers)

### 1. Supabase

1. Create a project. In **Project Settings → Database**, copy the **transaction pooler** string
   (port 6543) as `DATABASE_URL` and the **direct** string (port 5432) as `DIRECT_URL`.
2. From your machine, with those two in `.env`: `pnpm db:deploy && pnpm db:seed`.
   The migration turns on row-level security for every table and removes Data API access,
   so the browser can never read the database directly.
3. **Authentication → Providers → Google**: enable it with the Google OAuth client from step 2.
   **Authentication → URL Configuration**: Site URL = your Vercel URL; add
   `https://YOUR-APP.vercel.app/auth/callback` to the redirect URLs.
4. Copy **Project URL** and the **anon key** to `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 2. Google Cloud (owned by the ascendfund.co Workspace)

1. Create a project, enable the **Gmail API** and **Google Drive API**.
2. OAuth consent screen: user type **Internal** (no Google review needed for Gmail access).
3. Credentials → OAuth client ID → **Web application**, with redirect URIs
   `https://YOUR-APP.vercel.app/api/google/callback` and
   `https://YOUR-PROJECT.supabase.co/auth/v1/callback`.
   Put the ID and secret in `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.
4. Gemini: create an API key in a project **with billing enabled** (`GEMINI_API_KEY`).

### 3. Vercel

1. Import the repo, set **Root Directory** to `apps/web` (framework: Next.js).
2. Add every variable from [`.env.example`](.env.example). Generate secrets with
   `openssl rand -hex 32` (`CRON_SECRET`) and `openssl rand -base64 32` (`PII_ENCRYPTION_KEY`).
3. Deploy, open `/api/health`: every check should say `ok`.
4. Sign in as an admin, open **Settings → Connect funding@ascendfund.co**, and allow Gmail and Drive.

### 4. Supabase Cron (checks the inbox every 2 minutes)

In the Supabase SQL editor:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule('ascend-crm-tick', '*/2 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-APP.vercel.app/api/cron/tick',
    headers := jsonb_build_object('Authorization', 'Bearer YOUR_CRON_SECRET'),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
$$);
```

Vercel also calls the same route once a day (`apps/web/vercel.json`) as a fallback.

### 5. Go live

Try a few deals with `MCA_EMAIL_DRY_RUN=true`: each "sent" email appears on the deal timeline
with its exact To and CC. When it looks right, set `MCA_EMAIL_DRY_RUN=false` in Vercel and redeploy.

### 6. WhatsApp applications (optional)

How it works for the merchant: they message Ascend's WhatsApp number (or tap a
`wa.me/<number>?text=Apply` link on the website), pick English or Spanish and send the signed
application they already have from another company, plus bank statements. The CRM reads it,
fills in Ascend's application, asks only for what is missing, sends a private link for the SSN
and date of birth, shows the filled application as a PDF and asks them to type their name and
tap **I agree, sign**. The deal appears on the board with a WhatsApp badge and the signed
`Ascend-Fund-Application-<Merchant>.pdf` ready for lenders. The other company's PDF is kept as
an internal file and is never sent to lenders. Anyone can type _agent_ to get a person; reps
answer from the deal page.

Setup (about an hour, once):

1. **Number.** Buy a US number in Telnyx (about $1/month). Don't use it in the WhatsApp app on a
   phone. Meta verifies it with a code by SMS or phone call: in Telnyx, forward the number's calls
   to your mobile and choose "phone call" when Meta asks.
2. **Meta app.** On developers.facebook.com create an app (type _Business_) linked to Ascend's
   Meta Business account, add the **WhatsApp** product, then _API Setup → Add phone number_ with
   the Telnyx number and the display name "Ascend Fund". Meta reviews the display name.
3. **Permanent token.** Meta Business Settings → System users → add one, give it the app and the
   WhatsApp account, generate a token with `whatsapp_business_messaging` and
   `whatsapp_business_management`.
4. **Vercel environment variables** (then redeploy): `WHATSAPP_PHONE_NUMBER_ID` (API Setup page),
   `WHATSAPP_TOKEN` (step 3), `WHATSAPP_APP_SECRET` (App settings → Basic),
   `WHATSAPP_VERIFY_TOKEN` (any random string, `openssl rand -hex 16`), `APP_URL` (the CRM's
   public address; the private SSN/DOB links use it), and keep `WHATSAPP_ENABLED=false` for now.
5. **Webhook.** Meta app → WhatsApp → Configuration: Callback URL
   `https://<your-app>/api/whatsapp/webhook`, Verify token = `WHATSAPP_VERIFY_TOKEN`, then
   subscribe to the **messages** field.
6. **Settings → WhatsApp applications** in the CRM: enter the number (for the website link) and
   paste the exact authorization wording from Ascend's current application, in English and
   Spanish. Until you do, a default wording is used.
7. **Test.** Message the number from your own phone. With `WHATSAPP_ENABLED=false` the bot's
   replies only appear on the deal page (marked "not sent"). When the flow looks right, set
   `WHATSAPP_ENABLED=true` and redeploy; the bot now answers on WhatsApp.

Cost: Meta charges nothing for replies within 24 hours of the merchant's last message, which is
all the bot sends (two reminders included). Reading one application with Gemini is a few cents.

### Free plans while testing, and when to upgrade

The CRM runs on free plans while you test with dry-run mode and sample deals. Your website can
stay on Cloudflare; it only talks to the CRM through `/api/v1` with an API key. Before real
merchant data goes in:

- [ ] **Supabase Pro** (about $25/month): daily backups you can restore, no pausing, 8 GB.
      The free plan has no restorable backups, pauses after 7 days without activity (the cron
      keeps it awake) and holds 500 MB; files live in Drive, but the AI results stored per deal
      can fill that within a year at around 100 deals a month.
- [ ] **Vercel Pro** (about $20/month): Hobby is licensed for personal, non-commercial use only.
      (Alternative: host the app on your existing Cloudflare Workers account; that is a migration
      to test first.)
- [ ] **Gemini key from a billing-enabled Google Cloud project**, so statements are not used to
      improve Google's products.
- [ ] A few deals in dry-run mode look right, then set `MCA_EMAIL_DRY_RUN=false`.

Limits that stay on any plan: uploads through the CRM are about 4 MB per request (Vercel), larger
files can be emailed to the funding inbox and are filed automatically; Gmail sends up to 2,000
messages a day per Workspace user.
