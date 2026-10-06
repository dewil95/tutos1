# Plan: AI-native CRM for MCA Brokers (Ascend Fund)

## Decisions as built (2026-10-06) — these override older wording below

Two change requests from Ascend replaced parts of the original plan. Where a later section
still says "Claude", "BullMQ", "Twilio", "S3" or "Auth.js", read it with these decisions:

| Area                     | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Phones                   | **No calls and no SMS.** Twilio, dialer, call recording, A11 call summaries, voice agent, 10DLC and TCPA quiet hours are out of scope. Communication is email only.                                                                                                                                                                                                                                                                                                                                                                    |
| Hosting                  | **Vercel Hobby** (Next.js app and API) + **Supabase Free** (Postgres with RLS on every table, Auth with Google sign-in for @ascendfund.co only, Cron).                                                                                                                                                                                                                                                                                                                                                                                 |
| Background work          | A `Job` table in Postgres claimed with `FOR UPDATE SKIP LOCKED`; Supabase Cron calls `/api/cron/tick` every 2 minutes; new jobs also run right after a click. No Redis, no worker app.                                                                                                                                                                                                                                                                                                                                                 |
| Files                    | **Google Drive**, one folder per deal (`Ascend CRM/Deals/<Merchant>/Application, Statements, MTD, Stips, Contracts`).                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Email                    | Gmail API on `funding@ascendfund.co` (read + send), one OAuth connection with Drive.                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| AI                       | **Google Gemini API** by default (`gemini-3.1-pro-preview` for A1–A3, `gemini-3-flash-preview` for A8); Claude kept as an optional provider behind the same `LlmClient` interface. Every "Claude Ax" job below runs on the configured provider.                                                                                                                                                                                                                                                                                        |
| Sending                  | **One email per lender.** To = the lender's first address; CC = its other addresses + the team (jonas@, savvy@, david@); **never BCC**. Duplicate guard per merchant × lender. Packages over 18 MB go as Drive links shared only with that lender.                                                                                                                                                                                                                                                                                     |
| Feature set (2026-10-06) | Website API + A5 application reading; bank scrub (per-statement A1, deterministic checks, PDF history + A4 visual hints); internal AI Risk Report (score from code, narrative from Gemini, PDF in Drive "Internal"); lender ranking by appetite + approval history; per-lender PDF watermark; email automation (missing docs, stip chase, lender follow-up; one-click contract request and clawback confirmation). **Not built by decision:** Salesforce (own CRM instead), e-signature (the website captures the signed application). |
| Hosting now (2026-10-06) | Free plans (Vercel Hobby + Supabase Free) while testing with dry-run and sample data. Before real merchant data: Supabase Pro for restorable backups and no pausing, Vercel Pro (Hobby is non-commercial) or a tested move of the app to the existing Cloudflare Workers account. The database stays on Supabase Postgres (not Cloudflare D1). The website on Cloudflare uses the CRM API.                                                                                                                                             |

Diagrams: [`docs/ARCHITECTURE.md`](ARCHITECTURE.md). Website API: [`docs/API.md`](API.md).

Phase order now: **Phase 1** — Supabase + Vercel deploy, Google sign-in, Gmail/Drive connect,
inbox check, Drive folders, lender directory with To/CC, one-click per-lender sending, A8 reply
parsing, deal board with per-lender status (built). **Phase 2** — statement analysis on Gemini
(A1–A3, wired) feeding the positions block, offer confirm screen, stips tracker, commission
ledger with clawback timers. **Phase 3** — renewals, KPI dashboard, deal-desk assistant.

Free-tier caveats: Vercel Hobby is for non-commercial use (move to Pro when the CRM runs the
business); Supabase Free pauses after a week without activity and caps the DB at 500 MB (the
2-minute cron keeps it active; files are in Drive); use a Gemini key from a billing-enabled
project, because free-tier prompts may be used to improve Google products.

## Context (original request, 2026-10-05)

The repo `dewil95/tutos1` currently holds only a small static encrypt/decrypt tutorial page
(`index.html`, `css.css`, `reset.css`, two PNGs). There is no CRM code to reuse, so this is a
greenfield build. The user wants:

1. Deep research on the end-to-end Merchant Cash Advance (MCA) broker / ISO workflow.
2. An inventory of every step that can be automated.
3. An implementation plan for a CRM that uses Anthropic Claude (the Claude API) as the
   automation engine.

Assumptions made (routine judgment calls; flag if wrong):

- Target user: a small-to-mid broker/ISO shop (3–30 seats), US market. Multi-tenant ready
  from day one so it can later be sold to other shops, but the first deployment is one shop.
- Stack: TypeScript end to end (Next.js 15 app + API routes, Postgres via Prisma, BullMQ/Redis
  for background jobs). The existing repo is HTML/JS so TypeScript is the natural fit.
- "Anthropic cloud" = the Anthropic Claude API (first-party), SDK `@anthropic-ai/sdk`.
  Default model `claude-opus-5-5`; `claude-haiku-4-5` for high-volume cheap classification.
- Hosting is not decided; the plan is portable (Docker). Vercel + Neon/Supabase + Upstash is
  the fastest path; AWS ECS/RDS if the shop wants to own the infra.

Open decisions the user may want to override before build starts (defaults in bold):
**TypeScript/Next.js** vs Python/FastAPI; **Dropbox Sign** vs DocuSign at launch; **Twilio
raw** vs keeping an existing dialer (Kixie/JustCall); **Claude-only statement parsing** vs
adding MoneyThumb from day one; hosting target.

First deliverable in the repo after approval: Phase 0 scaffold plus a `docs/` folder holding
this plan (`docs/PLAN.md`), the funder appetite matrix template, and the AI eval set layout.

## 0. What the Ascend Fund inbox shows (read 2026-10-05, mailbox jonas@ascendfund.co)

The connected Gmail belongs to **Ascend Fund** (ascendfund.co), an MCA broker/ISO. Workspace was
created 2026-09-22; 276 messages, 95 unread, 122 threads, all in INBOX (no labels, no sent mail
from jonas@ — everything goes out from the shared alias **funding@ascendfund.co**).

**Team seen:** Jonas Abreu (jonas@), Xavier "Savvy" Abreu (savvy@, processor/ISO relations),
David Gonzalez (david@, closer — talks to merchants, negotiates offers), Alfonso (alfonso@, first
week only). Team writes to each other in Spanish. Funder list is a Google Sheet "Lenders".
No CRM, dialer, e-sign or bank-link tool on Ascend's side; DocuSign, DecisionLogic, Streak and
Funding Metrics appear only on funders' side.

**Observed process (one deal = one thread per funder):**

1. Package = `Ascend-Fund-Application-<Merchant>.pdf` + 3–4 monthly statements (+ MTD as
   docx/pdf/photo). ~17 merchants submitted in 13 days, tickets $5K–$39K, mostly 2nd–6th
   position C/D paper (restaurants, nail salon, landscaping, delivery, events, painting,
   sanitation, property mgmt, medical PA). States seen: FL, NY, TX, AZ.
2. Same email sent separately to 5–10 funders, subject `New Deal Submission - <Merchant>`,
   body = "Please see the attached deal for submission." + existing positions as
   `funder: $balance` lines + optional industry / revenue-drop note. Whole team cc'd.
   Duplicates happen (realdripnyc sent 3× with different recipient sets).
3. Funder replies: Mazal auto-ack "SUBMISSION RECEIVED / FILE IN REVIEW"; Zlur auto-ack then
   auto-decline within ~5 min; Loan23 portal auto-rejection with reason ("Black list, State -
   texas"); human declines: "Pass - very bad balances", "low revenue", "Does not meet minimum
   true revenue $30k/mo" (Cashable), "big drop in rev" (TurboCap), "Low revenue, 1st position,
   in debt settlement" (Hard Rock), "multiple advances in both businesses" (Instagreen),
   "Declining deposits / Merchant took new funding in MTD" (Zlur, post-signing).
   Mazal forwards passes to **Fundzilla** for alternative pricing.
4. Approval formats (5 distinct, all plain text in email):
   - Mazal/Fundzilla grid: approval amount, # payments, daily; rows `payment | rate | commission $ | points` up to 16 pts.
   - Loan23 table: purchase price, RTR, origination 8 %, UCC $400, wire, net funding, daily payment, term 80/100/120 business days, broker fee 10–14 %.
   - TurboCap list: `15K 40 Days` then `factor | fee % | pts` rows 1.399–1.699 / 6–18 pts.
   - Instagreen 5 lines: Funding / Rate / Daily / Payback / Term.
   - Zlur "Updated offer": OFFER / FEES / NET FUNDING / DAILY PAYMENTS / factor / commission %.
5. Negotiation: David pre-sells to merchant ("This deal is already sold at $8,000 / 1.50 / 95
   days"), asks funders to bump amounts; funders answer "we are at max", chase with "how is our
   offer, what do you need to get this closed?", "Deal is in competition, first to sign docs wins!".
6. Closing: Ascend emails "Please send contracts for $X the 1.49 and 95 days to <merchant
   email>, see attached DL/VC" (driver licence + voided check photos). Funder asks for merchant
   phone, sends DocuSign + DecisionLogic code, "Contract Has Been Sent", "Contract Has Been
   Signed", Ascend replies "DL done", final review, funding call ("FC"), then
   **"DEAL FUNDED! Amount $5,000 Commission $650"** with a 20-day clawback clause that the ISO
   must confirm by reply before commission is released.
7. Stips arrive as funder questions in-thread ("Where is payments to expansion?") or portal
   links (Funding Metrics: "4 months required for NY, received 3", link expires in 2 weeks).

**Funder roster actually used (submission addresses):** Mazal Funders (subs@, iso@, nate@;
→ Fundzilla), Zlur (Submissions@zlur.com, contracts@), Loan23 (portal + underwriting@),
Instagreen Capital (submit@), Nitro Advance (subs@), CapNova Funding (submit@), VOX Funding
(submissions@), TMR Now (uw@), Lendini / Funding Metrics portal (submissions@lendini.com), Palisades
Advance (UW@; 2nd–10th position, $10K–$2M, $45K min revenue, 1 yr TIB, max 5 NSF/mo, up to 12 pts,
no credit check, max 150 days), Credora Capital (uw@), Cashable Funding (Submissions@; $30K true
revenue min), TurboCap (misfits@), Hard Rock Financial (subs@).

**Pain points visible:** 6–10 hand-sent emails per deal; status scattered across threads;
offers in 5 formats read by eye; merchant never received DocuSign (wrong email); stip link
buried in inbox; commission/clawback terms as free text; one funded deal = 52-message thread;
funders closed for holidays stall deals; duplicate submissions.

**Consequences for the plan (applied below):**

- Phase 1 leads with the **inbox**, not statement extraction: sync `funding@ascendfund.co`,
  create a `Deal` from each outgoing `New Deal Submission - <Merchant>`, attach every funder
  thread as a `Submission`, and run A8 reply parsing for ack / decline(+reason) / stip /
  approval / contract sent / signed / funded. This alone removes most of the re-keying.
- A8 offer parser needs golden cases for all 5 observed formats; eval set can be built from
  this mailbox immediately (≈10 approvals, ≈20 declines already available).
- Funder directory is seeded from the roster above with observed appetite rules and the
  "forwards to Fundzilla" behaviour modelled as a secondary `FunderProgram`.
- Submission composer must reproduce the exact house email (subject, body, positions block,
  cc list) and block duplicate sends to the same funder for the same merchant.
- Closing checklist: contract-request template (amount, factor, term, merchant email + phone,
  DL + VC attached), DecisionLogic code tracking, funding-call scheduling, funded-email →
  `Commission` with `clawbackWindowEndsAt` = funded + 20 days (Fundzilla) and a required
  "confirm clawback policy" reply.
- Pre-sold price (`soldAmount`, `soldFactor`, `soldTermDays`) is a first-class field on `Deal`
  because Ascend commits to the merchant before approval.
- Positions block in the submission body is exactly the A2 output; generate it.
- UI copy should be bilingual-ready (English/Spanish).
- This section was synced into `docs/PLAN.md` on 2026-10-05.

## 1. MCA broker workflow (research findings)

Brokers/ISOs originate ~70–80% of US MCA volume; average advance ≈ $65K (2025). The deal
lifecycle below is the state machine the CRM implements. Numbers are industry ranges from
deBanked, DailyFunder, funder guidelines and broker training content (sources in the
research appendix at the end).

| Stage                               | What happens                                                                                                                                                                                        | Key facts / numbers                                                                                                                                                                                                                                                                  | Who                     |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- |
| **1. Lead sourcing**                | UCC lists, aged leads, live transfers, web forms, referral partners (CPAs, POS vendors)                                                                                                             | Lead cost: raw data $0.02–$0.20, UCC/trigger $0.20–$15, exclusive $50–$120, live transfer $80–$200. Exclusive leads: 35–55% contact, 1.5–2.5% close. Sub-5-minute response ≈ 100x more likely to connect; 78% of buyers go with first responder                                      | Opener / SDR            |
| **2. Intake & qualification**       | Standard app: legal name, DBA, entity, EIN, NAICS, TIB, requested amount, use of funds, owners ≥20% (SSN, DOB), monthly revenue, card volume, existing positions                                    | Floors: 6+ months TIB, $10–15K/mo revenue, FICO ~500+ soft pull, 0–1 existing positions (2 max). Restricted industries: cannabis, adult, gambling, firearms, lenders/MSBs, crypto, nonprofits                                                                                        | Opener                  |
| **3. Document collection**          | Signed app + 3–6 months (usually 4) full business bank statements + voided check + DL; larger/weaker files add tax returns, P&L, A/R aging, processing statements, MTD                              | E-sign (DocuSign/PandaDoc), bank-link (Plaid/DecisionLogic). Chasing documents is the #1 reason deals stall                                                                                                                                                                          | Opener / Processor      |
| **4. Pre-underwriting**             | Read statements: avg daily balance, monthly deposits & count, NSFs, negative days, transfers vs true revenue, existing MCA debits (daily/weekly equal debits to lender-like payees)                 | Rules of thumb: ADB ≥ 5% of monthly deposits; <3 NSF/90d = A paper; grades A–D by FICO, NSFs, TIB, revenue. **20–30 min manual per file.** First-position advance ≈ 0.75–1.5x avg monthly deposits, capped ~10–25% of annual revenue. Factor 1.15–1.49, term 3–18 mo, holdback 5–20% | Processor / in-house UW |
| **5. Funder matching & submission** | Pick 2–4 funders from matrix (paper tier, position appetite, industry, state, min/max). Email PDF package (subject `Merchant / ISO`) or key into funder portal                                      | Shotgunning → backdooring + multiple hard pulls (2 yrs on credit). Approvals in 2–24h. Declines: positions, low ADB, NSFs, industry, TIB, altered docs                                                                                                                               | Processor               |
| **6. Offers & negotiation**         | Offer sheet: funded amt, factor, payback (RTR), term, frequency, payment, fees, net funded. Broker marks up buy rate → sell rate, paid in points                                                    | 1 point = 1% of funded. Typical 8–15 pts first position (cap ~12–15), renewals 5–10. PSF to merchant tolerated ~3–5%, must be disclosed in several states. Stips: voided check, ID, articles, lease/landlord, MTD, tax returns, bank login                                           | Closer                  |
| **7. Closing & funding**            | Funder generates contract (e-sign), stips cleared, funding call confirming terms + no new positions, bank verification (Plaid/DecisionLogic), wire, UCC-1 filed same day, ACH starts 1–2 days later | Same-day funding if signed before ~11am–2pm ET. Commission paid within days. **Clawback 30 days norm (45–90 aggressive)** on early default                                                                                                                                           | Closer / Processor      |
| **8. Post-funding**                 | Track paid-down %, renewal eligibility, defaults/clawbacks, reconcile commission statements, referral asks                                                                                          | Renewal eligibility at **50–60% paid in**; renewals are the highest-margin deals (zero CAC). ISO agreements vary on renewal commission                                                                                                                                               | Closer / Admin          |

**Roles:** openers/SDRs, closers/funding managers, processors/funding coordinators, in-house
pre-screener, admin. **KPIs:** contact rate, app-in rate, submission rate, submission→approval,
approval→funding, time-to-fund, avg points/deal, renewal capture, clawback rate.

**Top pain points reported** (DailyFunder, deBanked): manual statement review; re-keying into
funder portals and copying replies out of email; chasing stips; slow follow-up losing deals;
backdooring; funders changing terms / slow commissions; clawbacks; missed renewals; rising
multi-state compliance cost.

## 2. Automation inventory — what Claude / code can do at each step

Legend: **Auto** = runs with no human in loop; **Draft** = AI produces, human approves;
**Assist** = AI surfaces info, human acts. Column "Mechanism" says whether it is plain code,
a vendor API, or a Claude call (job IDs refer to §6).

| Stage      | Task                                                                                                           | Level                               | Mechanism                                    |
| ---------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------- |
| Lead       | Import & normalise CSV/UCC/web-form/Zapier leads                                                               | Auto                                | code                                         |
| Lead       | Dedupe against merchants/owners, fuzzy match                                                                   | Auto                                | code + Claude A12                            |
| Lead       | DNC + litigator scrub, consent record, timezone/quiet hours                                                    | Auto                                | PossibleNOW API + code                       |
| Lead       | Enrich: SOS status, Google Places, website, industry → NAICS, estimated revenue                                | Auto                                | Cobalt/Middesk + Places + Claude A12         |
| Lead       | Lead score + routing (round-robin by score/territory)                                                          | Auto                                | Claude A12 + code                            |
| Lead       | Speed-to-lead: instant SMS/email acknowledgement within 60 s of web form, callback task                        | Auto (template)                     | Twilio + code                                |
| Lead       | Cold-outreach sequences (email/SMS cadence)                                                                    | Draft → Auto (v2)                   | Claude A10 + Twilio/Gmail                    |
| Intake     | Pre-fill application from enrichment; merchant self-serve portal                                               | Auto                                | code                                         |
| Intake     | OCR a photographed/handwritten app into fields                                                                 | Auto (with confidence)              | Claude A5                                    |
| Intake     | Hard-rule qualification (TIB, revenue, industry, positions) with explanation                                   | Auto                                | code (`packages/domain`)                     |
| Intake     | Call summary, objections, next step, CRM field updates                                                         | Draft                               | Claude A11                                   |
| Docs       | Request missing docs, send magic-link upload, chase on cadence                                                 | Auto (template)                     | code + Claude A10 drafts                     |
| Docs       | Classify every uploaded file (statement / app / ID / check / tax) and detect month, bank, account              | Auto                                | Claude A1                                    |
| Docs       | Completeness check: 4 full months, all pages, correct account                                                  | Auto                                | Claude A1 + code                             |
| Docs       | Bank-link instead of PDFs                                                                                      | Auto                                | Plaid / DecisionLogic                        |
| Docs       | Tamper/fraud hints (fonts, alignment, metadata, missing pages)                                                 | Assist                              | Claude A4 (+ MoneyThumb Thumbprint optional) |
| Pre-UW     | Extract monthly deposits, count, ADB, NSFs, negative days, transfers, recurring debits                         | Auto (human verify screen)          | Claude A1                                    |
| Pre-UW     | Detect existing MCA positions, guess funder, est. balance                                                      | Auto                                | Claude A2 + descriptor dictionary            |
| Pre-UW     | True-revenue adjustment (exclude transfers, loan proceeds, owner injections)                                   | Auto                                | Claude A1/A3                                 |
| Pre-UW     | Paper grade, red flags, max advance estimate, offer range                                                      | Assist                              | code metrics + Claude A3                     |
| Pre-UW     | Offer calculator (factor/payback/term/holdback/payment/points)                                                 | Auto                                | code                                         |
| Match      | Filter funders by appetite rules; rank with rationale; anti-shotgun limit                                      | Assist                              | code + Claude A6                             |
| Match      | Package submission (merge PDFs, watermark with ISO + funder name for backdoor tracing, name files)             | Auto                                | code                                         |
| Match      | Draft submission email per funder template                                                                     | Draft → Auto                        | Claude A7                                    |
| Match      | Push to funder portal                                                                                          | Auto                                | Playwright connector (phase 3) / API         |
| Match      | Parse funder replies → status, decline reason, offer fields, stips                                             | Auto (offer fields human-confirmed) | Claude A8                                    |
| Match      | SLA timers: nudge funder if no response in X hours                                                             | Auto                                | code + A7 draft                              |
| Offer      | Normalise offers, compute cost of capital, APR estimate (CA/NY)                                                | Auto                                | code                                         |
| Offer      | Side-by-side comparison + merchant-friendly explanation + talking points                                       | Draft                               | Claude A9                                    |
| Offer      | Suggest sell rate within funder cap; commission preview                                                        | Assist                              | code                                         |
| Stips      | Track stips per offer, chase merchant, mark cleared from uploads                                               | Auto                                | code + Claude A1 (classify) + A10            |
| Close      | Generate funding-call checklist; record call; summary                                                          | Draft                               | Claude A11                                   |
| Close      | Disclosure delivery log + content check (state, APR, matches offer)                                            | Auto (check)                        | code + Claude A15                            |
| Close      | Mark funded from funder email/portal; create commission receivable                                             | Auto                                | Claude A8 + code                             |
| Post       | Clawback window timer; alert on default notice                                                                 | Auto                                | code + A8                                    |
| Post       | Reconcile commission statements vs expected points                                                             | Auto (exceptions to human)          | Claude A1-style extraction + code            |
| Post       | Renewal eligibility (paid-down %) alerts, renewal outreach drafts                                              | Auto / Draft                        | code + A14 batch + A10                       |
| Post       | Referral ask after funding                                                                                     | Draft                               | A10                                          |
| Mgmt       | KPI dashboard, weekly digest, pipeline hygiene ("stale deals")                                                 | Auto                                | code + A14                                   |
| Mgmt       | Deal-desk copilot ("why is this stuck?", "which funders fit?")                                                 | Assist                              | Claude A13 Tool Runner                       |
| Compliance | Consent/opt-out enforcement, quiet hours, recording announcement, registration numbers on docs, 4-yr retention | Auto                                | code                                         |

What stays human in v1: the credit/funder decision, sending anything to a merchant that
commits terms, final approval of extracted statement numbers, and any outbound message
outside pre-approved templates.

## 3. Existing tooling landscape & integration surface

### 3.1 Incumbents (what we compete with / learn from)

| Vendor                                                                       | Target                 | Price signal                         | Gap we exploit                                                 |
| ---------------------------------------------------------------------------- | ---------------------- | ------------------------------------ | -------------------------------------------------------------- |
| Centrex                                                                      | brokers, small funders | ~$25/user/mo modular, ~$9K/yr all-in | no AI, weak e-sign, weak tasks/forecasting                     |
| Cloudsquare Broker (Salesforce)                                              | brokers                | $75/user + SF license + $7.5K impl.  | 20+ funder API connectors but far too expensive for 3–10 seats |
| MCA Suite                                                                    | brokers/funders        | quote                                | dated UI, heavy manual entry                                   |
| LendingWise                                                                  | multi-vertical brokers | $600/mo / 5 users                    | generalist, rules-based "AI"                                   |
| Onyx IQ, LendSaaS, MCA Track, Fundingo                                       | funders                | $75K/yr enterprise tier              | funder platforms, not broker CRMs                              |
| New AI entrants (MCA Pilot, mcacrm.ai, Kaaj AI, Statement Shield, FinexusAI) | brokers                | mostly unproven                      | point solutions, not the full pipeline                         |

Forum consensus (DailyFunder threads): "Centrex for value, Salesforce+Cloudsquare if budget,
HubSpot/Pipedrive/GoHighLevel if small." Top complaints: re-keying into funder portals, stale
deal status, backdooring, manual statement review, commissions in spreadsheets.

Realistic price envelope for the product: **$100–$200/seat/month all-in** if it replaces dialer

- SMS platform + manual statement review; usage pass-through for statement parsing is accepted.

### 3.2 Integration surface the CRM must expose (v1 picks in bold)

| Capability             | Options                                                                                                                                                                                                                              | v1 decision                                                                                                                                      |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bank statement parsing | **Claude PDF/vision (in-house)**, MoneyThumb (~$0.20/pg, MCA categories, Thumbprint fraud), Heron ($499/mo), Ocrolus ($0.50–$2/pg), Inscribe                                                                                         | Claude first; MoneyThumb Thumbprint as optional fraud second-opinion                                                                             |
| Bank-link (live data)  | **Plaid** ($1.50–$2/link), DecisionLogic (MCA-standard), Finicity, Flinks                                                                                                                                                            | Plaid; DecisionLogic connector in phase 3 (funders ask for it)                                                                                   |
| E-sign                 | **DocuSign** ($600/yr dev plan), Dropbox Sign ($75/mo), PandaDoc                                                                                                                                                                     | Dropbox Sign for cost at launch, DocuSign adapter behind same interface                                                                          |
| Dialer / voice         | Kixie, JustCall, Aircall, PhoneBurner; **Twilio Voice** raw                                                                                                                                                                          | Twilio Voice + recording; Kixie webhook import for shops that keep their dialer                                                                  |
| SMS                    | **Twilio** ($0.0083/seg + 10DLC: brand $4.50, vetting $41.50, campaign $15)                                                                                                                                                          | Twilio; 10DLC registration is a launch blocker, start it week 1                                                                                  |
| Email                  | **Gmail API** (free) / Microsoft Graph; SendGrid for bulk                                                                                                                                                                            | Gmail/Graph per-rep mailbox sync (needed for funder reply parsing)                                                                               |
| Funder submission      | Email (default, universal); funder portals (Kapitus, Rapid, OnDeck…); bilateral APIs (only via Cloudsquare today: Bitty, Credibly, Fora, Forward, Kapitus, OnDeck, Rapid, Mulligan, CAN, Expansion, Loot, VOX…); Lendflow aggregator | Templated email + reply parsing in v1; browser-automation (Playwright) connectors for top 5 portals in phase 3; direct APIs as partnerships land |
| Business verification  | **Cobalt Intelligence** or Middesk (SOS), OpenCorporates, Google Places                                                                                                                                                              | Cobalt/Middesk SOS + Google Places                                                                                                               |
| UCC data               | state SOS bulk (CO, VT free), Apify scrapers (19–28 states), LexisNexis/CLEAR per-search                                                                                                                                             | Phase 3; start with CSV import of purchased UCC lists                                                                                            |
| Credit                 | iSoftpull / CRS / Array soft-pull resellers; Experian Business                                                                                                                                                                       | Phase 3, soft-pull reseller behind an interface                                                                                                  |
| DNC / litigator scrub  | PossibleNOW DNCSolution ($200–$450/mo, real-time API), DNC.com, Blacklist Alliance                                                                                                                                                   | PossibleNOW QuickCheck at lead-import time                                                                                                       |
| Calendar               | Google Calendar API (free), Calendly                                                                                                                                                                                                 | Google Calendar                                                                                                                                  |

Key fact: **there is no industry-standard funder submission schema or public funder API docs.**
Every API is a bilateral deal. The CRM therefore needs its own normalized `Submission` and
`Offer` schema and a pluggable `FunderConnector` interface (email / portal-RPA / API).

## 4. Compliance constraints that shape the design

- **Commercial financing disclosure states (11 as of 2026):** CA, CT, FL, GA, KS, LA, MO, NY,
  TX, UT, VA. CA and NY require estimated APR. The funder issues the disclosure; the **broker
  must transmit it and keep timestamped proof of delivery** (NY 23 NYCRR 600: 4-year retention,
  evidence of broker transmission time). Design: immutable `DisclosureDelivery` audit records
  with hash of document + send timestamp + channel.
- **Broker registration states:** NY, CT, VA, MO, TX (TX OCCC registration deadline
  2026-12-31). Design: per-tenant registration numbers stored and printed on outbound docs.
- **TCPA / DNC:** FCC one-to-one consent rule vacated (11th Cir., Jan 2025) but state
  mini-TCPAs and the FCC revocation rule (Apr 2025) apply. Design: consent capture per lead
  (source, timestamp, text), real-time DNC + litigator scrub on import, STOP/opt-out
  handling on every SMS, quiet-hours enforcement by lead timezone.
- **A2P 10DLC:** mandatory brand + campaign registration before any SMS; financial-services
  campaigns get extra vetting. Start registration in week 1.
- **Call recording:** 12 all-party-consent states; always play a recording announcement.
- **Data security:** bank statements, SSNs, DL images. Encrypt at rest (per-tenant KMS key),
  signed short-lived URLs, field-level encryption for SSN/DOB, full audit log, role-based
  access, retention policy (default 4 years to satisfy NY).
- **AI guardrails:** Claude never makes a credit decision or sends an outbound message
  unsupervised in v1. Every AI output is a _draft_ or _score with reasoning_ that a human
  approves, except for pure data extraction and internal notifications.

## 5. Target architecture

Monorepo (pnpm workspaces + Turborepo) in this repository; the tutorial files move to
`legacy/` so history is preserved.

```
apps/
  web/            Next.js 15 (App Router) — UI + REST/route handlers, Auth.js, tRPC
  worker/         BullMQ workers — all async AI jobs, integrations, schedulers
packages/
  db/             Prisma schema + migrations (Postgres 16, pgvector, row-level tenant_id)
  ai/             Claude client, prompts, Zod output schemas, eval harness
  connectors/     FunderConnector, ESignProvider, BankLinkProvider, TelephonyProvider, ...
  domain/         pure business logic: offer math, qualification rules, commission calc
  ui/             shared shadcn/ui components
infra/
  docker-compose.yml (postgres, redis, mailhog, minio)   terraform/ (later)
```

Core data model (Prisma):

- `Tenant`, `User` (roles: admin, manager, opener, closer, processor, read_only)
- `Lead` → `Merchant` (business) + `Owner`(s) (people, PII encrypted) ; `Consent`
- `Deal` (state machine, see §1) with `DealStage`, `DealEvent` (append-only timeline)
- `Document` (S3/minio object, type, sha256, `DocumentExtraction` JSON, fraud flags)
- `BankAnalysis` (per statement set: monthly rows, metrics, detected MCA positions)
- `Position` (existing advances detected: funder guess, daily/weekly amount, est. balance)
- `Funder`, `FunderProgram` (appetite rules: min revenue, min TIB, max positions,
  industries, states, paper grade), `FunderContact`
- `Submission` (deal × funder, channel, status, decline reason, SLA timers)
- `Offer` (normalized: advance, factor, payback, term, frequency, payment, fees, buy rate,
  sell rate, commission, stips[])
- `Stipulation` (required doc/condition, status, owner, chase cadence)
- `Contract`, `DisclosureDelivery` (immutable), `Funding`
- `Commission` (expected / received / clawback window / clawed back), `Renewal` (eligibility
  date, paid-down %)
- `Activity` (calls, SMS, emails, notes — one table, typed), `Task`, `Sequence` / `SequenceStep`
- `AiRun` (every Claude call: model, prompt version, tokens, cost, latency, input hash,
  output, human verdict) — powers evals and cost reporting

Infra defaults: Postgres (Neon or RDS), Redis (Upstash or ElastiCache), S3-compatible object
store, Vercel or ECS for web, Fly.io/ECS for workers. Everything Dockerised so the shop can
self-host.

## 6. Claude integration design

All Claude calls live in `packages/ai`, go through one `callClaude()` wrapper that records an
`AiRun`, applies prompt caching, retries on 429/5xx with the SDK's typed errors, and sends the
`fallbacks: "default"` safeguard parameter. Models: `claude-opus-5-5` (adaptive thinking is
always on; set `output_config.effort` explicitly per task) for anything judgment-heavy,
`claude-haiku-4-5` for high-volume classification. No forced `tool_choice` (returns 400 on
Opus 5.5); use `strict: true` tools or `output_config.format` structured outputs instead.

| #   | AI job                           | Surface                                                                                   | Model / effort              | Inputs → output                                                                                                                             |
| --- | -------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A1  | Bank statement extraction        | `messages.parse` + PDF `document` block (base64 or Files API), Zod schema                 | opus-5-5 / high             | PDF pages → monthly rows (deposits, count, ending/avg daily balance, NSFs, negative days, transfers-out, recurring debits with descriptors) |
| A2  | MCA position detection           | structured output over A1 rows + funder descriptor dictionary                             | opus-5-5 / medium           | → `Position[]` with confidence, estimated remaining balance                                                                                 |
| A3  | Pre-underwriting summary & grade | structured output; rules in `packages/domain` compute metrics, Claude explains + flags    | opus-5-5 / high             | metrics + app → paper grade A–D, red flags, max advance estimate, suggested funders                                                         |
| A4  | Document QA / fraud hints        | vision over statement pages: font mismatch, misaligned columns, missing pages, month gaps | opus-5-5 / high             | → flags[] for human review (MoneyThumb Thumbprint optional 2nd opinion)                                                                     |
| A5  | Application OCR                  | vision over signed app PDF/photo                                                          | opus-5-5 / medium           | → Merchant/Owner fields, confidence per field                                                                                               |
| A6  | Funder matching                  | `packages/domain` hard filters (appetite rules) → Claude ranks top N with rationale       | opus-5-5 / medium           | → ranked `FunderProgram[]` + why                                                                                                            |
| A7  | Submission email drafting        | text gen with per-funder template + deal facts                                            | haiku-4-5 / low             | → subject/body following `Merchant / ISO` convention                                                                                        |
| A8  | Inbound email/SMS parsing        | classification + extraction on every synced message                                       | haiku-4-5 (opus for offers) | → intent (offer / decline / stip request / question), `Offer` fields, `Stipulation[]`, auto-update `Submission` status                      |
| A9  | Offer comparison for merchant    | structured output                                                                         | opus-5-5 / medium           | multiple `Offer`s → plain-English comparison, cost of capital, recommended pick, talking points                                             |
| A10 | Stip chase & follow-up drafts    | text gen, human approves (v1) → auto-send for low-risk templates (v2)                     | haiku-4-5                   | → SMS/email drafts in rep's voice                                                                                                           |
| A11 | Call summary + next action       | transcript (Twilio/Deepgram) → structured output                                          | opus-5-5 / low              | → summary, sentiment, objections, follow-up task, CRM field updates (proposed)                                                              |
| A12 | Lead scoring & dedupe            | Haiku classification on import                                                            | haiku-4-5                   | → score, duplicate candidates                                                                                                               |
| A13 | Deal-desk copilot                | Tool Runner (`betaZodTool`) with read-only CRM tools + write tools gated by confirmation  | opus-5-5 / high             | rep asks "what's blocking the Smith deal?" → answer with citations to records                                                               |
| A14 | Nightly batch jobs               | Message Batches API (50% cost)                                                            | opus/haiku                  | renewal-eligibility review, pipeline hygiene, weekly manager digest                                                                         |
| A15 | Disclosure sanity check          | structured output over funder-issued disclosure                                           | opus-5-5 / medium           | → state detected, required fields present?, APR present for CA/NY, mismatches vs `Offer`                                                    |

Prompt engineering rules: stable system prompt + funder dictionary first with
`cache_control` (1h TTL), volatile deal data last; every schema has `additionalProperties:false`;
every output includes `confidence` and `evidence` (page/line refs) so the UI can show
provenance; eval set per job in `packages/ai/evals` built from real anonymised deals, run in CI
against a golden set before any prompt change ships.

Cost estimate (order of magnitude, Opus 5.5 at $4/$20 per MTok): a 6-statement set
(~30 pages ≈ 45K tokens) ≈ $0.20–$0.40 for A1+A2+A3+A4; inbound message triage on Haiku
< $0.005 each; a 100-deal/month shop spends well under $100/month on Claude.

## 7. Implementation phases

Each phase is shippable on its own; the shop can start using phase 1 immediately.

### Phase 0 — Foundation (week 1–2)

- Monorepo scaffold, Prisma schema above, Auth.js (email + Google), tenant RLS, S3 docs,
  BullMQ worker, `AiRun` logging, `callClaude()` wrapper, CI (lint, typecheck, vitest,
  Playwright smoke). Move tutorial files to `legacy/`.
- Kick off A2P 10DLC brand/campaign registration and Twilio number provisioning (long lead).

### Phase 1 — Inbox-first pipeline + document intelligence (week 3–6)

- **Gmail sync of `funding@ascendfund.co`** (Google Workspace domain-wide delegation or
  OAuth on the group): backfill the 122 existing threads, then incremental history sync.
  Outgoing `New Deal Submission - <Merchant>` → `Deal` + `Merchant` (dedupe by name) +
  `Document`s from attachments; each funder recipient → `Submission(channel=EMAIL)`.
- **A8 reply parsing** on every inbound message: ack / decline(reason) / stip / approval
  (5 formats) / contract-sent / contract-signed / funded(amount, commission, clawback days).
  Human-confirm screen for approvals; everything else auto-applies. Golden set from the
  mailbox (docs/ai-evals.md).
- Funder directory seeded from the observed roster (§0) incl. submission addresses, cc rules,
  appetite notes and Mazal→Fundzilla routing.
- Submission composer: pick funders, house template, positions block (A2 output), attachments,
  duplicate guard, one click → N emails via Gmail API from the alias.
- Lead import (CSV/UCC list, web form, Zapier webhook) with dedupe (A12) and DNC scrub.
- Deal board with the stage state machine; tasks; activity timeline; notes.
- Document upload + merchant upload portal (magic link) + e-sign of application.
- **A1–A5**: statement extraction, position detection, pre-underwriting summary, fraud hints,
  application OCR. Human "verify" screen with page-side-by-side evidence.
- Offer calculator in `packages/domain` (factor, payback, term, holdback, daily/weekly
  payment, buy/sell rate, commission points).

### Phase 2 — Submissions, offers, communications (week 7–10) — removes re-keying

- Funder directory + appetite rules + A6 matching with rationale; anti-shotgun guard
  (max N concurrent submissions, exclusivity windows).
- Email submission connector (Gmail/Graph) with templates (A7), attachment packaging, thread
  tracking; **A8 reply parsing auto-updates submission status and creates Offers/Stips**.
- Offer comparison (A9), stip tracker with chase sequences (A10, human-approved sends).
- Twilio SMS/voice with consent + quiet hours + recording announcement; A11 call summaries.
- Disclosure delivery log + A15 check; commission ledger with clawback windows.

### Phase 3 — Automation depth (week 11–16)

- Portal connectors (Playwright) for top 5 funders; Plaid bank-link; DecisionLogic.
- Renewal engine (A14 batch): paid-down % tracking, eligibility alerts, auto-draft renewal
  outreach.
- Deal-desk copilot (A13) with Tool Runner; manager digest; KPI dashboard (contact rate,
  app-in, sub→approval, approval→funding, avg points, renewal %).
- Auto-send for low-risk sequences once eval precision > agreed threshold.

### Phase 4 — Scale / SaaS (post-launch)

- Multi-tenant billing (Stripe), per-tenant Twilio subaccounts, SOC2-style controls,
  funder API partnerships, voice agent (Retell/Vapi) for inbound qualification.

## 8. Verification

- **Unit:** `packages/domain` offer math and qualification rules (vitest, table-driven,
  including factor/APR conversions for CA/NY).
- **AI evals:** golden set of ≥30 anonymised statement packs with hand-labelled monthly
  metrics and positions; CI asserts field-level accuracy ≥ 98% on deposits/balances and
  position recall ≥ 95% before merging prompt changes. Reply-parsing eval: ≥100 real funder
  emails labelled offer/decline/stip.
- **Integration:** docker-compose stack; Playwright e2e: import lead → upload statements →
  verify extraction → match funders → send submission to Mailhog → simulate funder reply →
  Offer created → mark funded → commission row appears.
- **Compliance checks:** automated tests that an SMS cannot be queued without consent or
  outside quiet hours; disclosure delivery record is immutable; PII fields are encrypted in DB
  dumps.
- **Cost/latency:** `AiRun` dashboard; alert if daily Claude spend > budget or cache hit
  rate < 70%.
- **Pilot:** run phase 1 alongside the shop's current process on 20 real deals; compare
  extraction time (target: 30 min manual → < 3 min with verify) and submission turnaround.

## Appendix — key research sources

Workflow & economics: deBanked "Business Finance Brokers in 2025", "Getting Backdoored? Put
Your Mark on the Docs" (2025), "Commission Chargebacks"; funderintel MCA glossary and
licensing posts; mcadirectory.io ISO program / positions / tech-stack guides (2026); Monetafi
ISO playbook 2026; Nav "What's your paper grade"; Capstone MCA underwriting guide; Bay Street
Lending MCA guide; Logic Advance and Elite Funders submission checklists; DailyFunder threads
on clawbacks, backdooring, CRM recommendations (18243, 13319, 20592, 22727, 26325); lead-cost
data from MCA Leads Pro, MasterMCA, Lead Slaps; speed-to-lead from LeanData/Apten.

Compliance: Venable "State commercial financing disclosure laws" (Mar 2026); Mayer Brown on
Texas HB 700; OCCC rules proposal (Feb 2026); NY DFS 23 NYCRR 600; Utah DFI FAQ (2026);
Va. Code § 6.2-2230; Alston on GA/FL/CT/KS/LA; Kelley Drye and DNC.com on the 11th Circuit
TCPA ruling and FCC revocation rule; Goodwin on CFPB 1071 MCA exclusion (May 2026); NY AG
Yellowstone judgment (Jan 2025); FTC Safeguards Rule.

Tooling: Cloudsquare lender-API announcements (deBanked 2024–2026: Bitty, Credibly, Forward,
VOX); Ocrolus docs (Book summary, Detect); MoneyThumb PDF Insights / Thumbprint; Heron Data
MCA case study; Inscribe on Bedrock; Twilio 10DLC pricing/requirements; PossibleNOW DNC
Solution; Cobalt Intelligence vs Middesk; LendingWise, Centrex, MCA Suite, Onyx IQ pricing
pages and G2/Capterra reviews.

Research caveat: several industry domains (deBanked, DailyFunder, Ocrolus, MoneyThumb,
state .gov) were blocked by the sandbox proxy, so some figures come from search-index excerpts
rather than full-page reads. Numbers marked as ranges should be validated with the shop's own
funder agreements before they are hard-coded.
