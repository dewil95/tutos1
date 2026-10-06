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
- Runs on free tiers: Vercel (app), Supabase (database, sign-in, cron), Google Workspace (Gmail, Drive).
  No phone or SMS features, no Salesforce, no e-signature (the website handles the application).

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

### Free-tier limits to know

- Vercel Hobby is licensed for personal, non-commercial use; move to Pro once the CRM runs the business.
- Supabase Free pauses after 7 days without activity (the cron keeps it awake) and holds 500 MB;
  files live in Drive, so the database stays small.
- Uploads through the CRM are limited to about 4 MB per request by Vercel; larger files can be
  emailed to the funding inbox and are filed automatically.
- Gmail sends up to 2,000 messages a day per Workspace user.
