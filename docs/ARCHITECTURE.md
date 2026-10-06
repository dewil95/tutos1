# How the Ascend CRM works

The CRM runs on free tiers: the app on **Vercel**, the database, sign-in and scheduler on
**Supabase**, files in **Google Drive**, email through the **Gmail** account
`funding@ascendfund.co`, and AI on the **Google Gemini API**. There is no phone or SMS part.

## 1. The pieces

```mermaid
flowchart TB
  team["Ascend team<br/>(browser, Google sign-in)"]

  subgraph vercel["Vercel (Hobby)"]
    app["Next.js app<br/>deal board · deal page · settings"]
    tick["/api/cron/tick<br/>job runner"]
  end

  subgraph supa["Supabase (Free)"]
    db[("Postgres<br/>deals · lenders · submissions · jobs<br/>RLS on every table")]
    auth["Auth<br/>Google, @ascendfund.co only"]
    cron["Cron (pg_cron + pg_net)<br/>every 2 minutes"]
  end

  subgraph google["Google Workspace"]
    gmail["Gmail<br/>funding@ascendfund.co"]
    drive["Drive<br/>Ascend CRM / Deals / Merchant"]
  end

  gemini["Gemini API<br/>3.1 Pro · 3 Flash"]
  lenders["Lenders"]
  merchant["Merchant"]

  team --> app
  app --> auth
  app --> db
  cron -- "POST + secret" --> tick
  tick --> db
  app & tick --> gmail
  app & tick --> drive
  tick --> gemini
  gmail <--> lenders
  merchant -- "statements, MTD, DL/VC" --> gmail
```

## 2. Ship the file: one email per lender

```mermaid
flowchart TD
  a["Merchant emails documents to funding@"] --> b["Inbox check (every 2 min)<br/>files attachments into the deal's Drive folder"]
  r["Rep uploads on the deal page"] --> b2["Saved to the same Drive folder"]
  b --> c
  b2 --> c
  c["Deal page<br/>application + latest 4 statements pre-checked"] --> d["Rep ticks lenders<br/>each row shows its exact To and CC"]
  d --> e["Send to selected lenders"]
  e --> f["One job per lender"]
  f --> g1["Email to Lender A"]
  f --> g2["Email to Lender B"]
  f --> g3["Email to Lender C"]
  g1 & g2 & g3 --> h["Lender replies land in funding@"]
  h --> i["Gemini (A8) reads the reply<br/>received · declined + reason · offer · stips · funded"]
  i --> j["Per-lender status row on the deal"]
```

How each email is addressed (example with two lenders from the roster):

```mermaid
flowchart LR
  deal["Deal: New Deal Submission - Sample Bistro LLC"]
  deal --> m["Email 1 — Mazal Funders<br/>To: subs@mazalfunders.com<br/>CC: iso@mazalfunders.com, nate@mazalfunders.com,<br/>jonas@, savvy@, david@ascendfund.co"]
  deal --> z["Email 2 — Zlur<br/>To: submissions@zlur.com<br/>CC: jonas@, savvy@, david@ascendfund.co"]
  nob["No BCC, ever.<br/>No lender sees another lender."]
  m -.- nob
  z -.- nob
```

Rules, all enforced in code (`packages/connectors/src/recipients.ts`):

- The lender's first address goes in **To**; its other addresses go in **CC**, then the team.
- Addresses are de-duplicated without regard to case; the sending mailbox is never copied.
- A lender with no address, or picked twice, stops the whole batch before anything is sent.
- A lender already sent this merchant is greyed out (backdoor and duplicate guard).
- Packages over 18 MB go as Drive links shared with that lender's addresses only.
- With `MCA_EMAIL_DRY_RUN` on (the default), the email is written to the deal timeline instead
  of being sent.

## 3. Deal lifecycle

```mermaid
sequenceDiagram
  autonumber
  participant M as Merchant
  participant CRM as Ascend CRM
  participant L as Lender
  M->>CRM: Application + bank statements (email or upload)
  CRM->>CRM: Files into Drive, optional AI statement analysis
  CRM->>L: New Deal Submission (one email per lender)
  L-->>CRM: Received / In review
  L-->>CRM: Declined (reason) or Approval grid
  CRM->>CRM: Gemini reads the offer, rep confirms numbers
  CRM->>L: Send contracts for $X at factor / term (DL + VC)
  L-->>M: DocuSign + bank verification
  L-->>CRM: Contract signed · funding call
  L-->>CRM: DEAL FUNDED, amount and commission
  CRM->>CRM: Commission expected, clawback window starts
```

## 4. Background work on free hosting

Vercel Hobby only runs crons once a day, so Supabase Cron calls the app every 2 minutes. Work is
kept in a `Job` table and each job is a small unit, so a call always finishes inside Vercel's
time limit. Clicking **Send** also runs the new jobs right away.

```mermaid
sequenceDiagram
  participant C as Supabase Cron
  participant T as /api/cron/tick
  participant DB as Postgres Job table
  participant H as Job handlers
  C->>T: POST with Authorization: Bearer CRON_SECRET
  T->>DB: queue INBOX_SYNC per mailbox and EMAIL_RULES per tenant (one live job each)
  loop until ~45 s used
    T->>DB: claim due jobs (FOR UPDATE SKIP LOCKED)
    T->>H: SEND_SUBMISSION, INBOX_SYNC, PARSE_REPLY, EMAIL_RULES
    T->>H: APPLICATION_READ, STATEMENT_EXTRACT, STATEMENT_SCRUB, RISK_REPORT (only with 40 s left)
    H-->>DB: done, or retry in 1, 2, 4… minutes (failed after 5 tries)
  end
```

A send that crashes after Gmail accepted it is never sent twice: the job marks the submission
"sending" first, and a retry looks in Sent before trying again.

## 5. From application to Risk Report

The website posts each application to the CRM API (`docs/API.md`); statements can also arrive by
email or upload. Each file starts its own job, so nothing waits on a long request.

```mermaid
flowchart LR
  web["Ascend website<br/>POST /api/v1/applications"] --> deal["Deal + merchant + owners<br/>SSN / DOB / EIN encrypted"]
  mail["Email to funding@"] --> files
  up["Upload on deal page"] --> files
  web --> files["Files in the deal's Drive folder"]
  files -- application PDF --> a5["A5 App reading<br/>Gemini 3.1 Pro<br/>fills empty fields, flags differences"]
  files -- each statement --> a1["A1 Extraction<br/>one job per file"]
  files -- each statement --> chk["PDF history check<br/>+ A4 visual check (Flash)"]
  a1 & chk --> scrub["Bank scrub (code)<br/>balance math, gaps, NSFs,<br/>negative days, stacking, holdback"]
  scrub --> a2["A2 Positions<br/>Gemini 3.1 Pro"]
  a2 --> risk["Risk score (code)<br/>+ narrative (Gemini)<br/>internal only"]
  risk --> rank["Lender ranking<br/>appetite + approval history"]
  a5 & a1 & a2 & risk -.-> run[("AiRun log<br/>model, tokens, cost<br/>SSN/DOB masked")]
```

Lender replies go through A8 (Gemini 3 Flash) to update each lender's status row.

## 6. Watermarks and email automation

Every PDF in a lender's copy of the package is stamped on each page ("Submitted by Ascend Fund
to <Lender> only · date · Ref <tag>") and carries the tag in its metadata. The tag is stored on
that lender's submission, so a file that turns up elsewhere shows whose copy it was.

| Email                 | To                              | When                                   | Default                         |
| --------------------- | ------------------------------- | -------------------------------------- | ------------------------------- |
| Missing documents     | merchant                        | deal waiting on application/statements | automatic, up to 3, a day apart |
| Stip chase            | merchant                        | a lender asked for something           | automatic, up to 3, a day apart |
| Lender follow-up      | lender, same thread, same To/CC | no reply a day after sending           | automatic, once, weekdays       |
| Contract request      | lender, same thread             | rep clicks on an approved row          | one click, DL/VC attached       |
| Clawback confirmation | lender, same thread             | funded email asks for it               | one click                       |

All of them can be edited or turned off in Settings, skip merchants marked "no automated
emails", follow dry-run mode, and never use BCC.

The AI provider sits behind one interface, so Gemini can be swapped for Claude with one setting:

```mermaid
classDiagram
  class LlmClient {
    <<interface>>
    provider
    structured(job, system, content, schema)
  }
  class GeminiClient {
    default
    responseJsonSchema
    PDFs inline or Files API
  }
  class ClaudeClient {
    optional
    MCA_AI_PROVIDER=anthropic
  }
  LlmClient <|.. GeminiClient
  LlmClient <|.. ClaudeClient
```

## Where things live in the code

| Concern                                      | Path                                                             |
| -------------------------------------------- | ---------------------------------------------------------------- |
| To/CC rules                                  | `packages/connectors/src/recipients.ts`                          |
| House email (subject, body, positions block) | `packages/connectors/src/funder/email.ts`                        |
| Gmail and Drive clients                      | `packages/connectors/src/email/gmail.ts`, `storage/drive.ts`     |
| Job queue                                    | `packages/db/src/jobs.ts`                                        |
| Background jobs (send, inbox, scrub, report) | `apps/web/src/server/jobs/`                                      |
| Website API                                  | `apps/web/src/app/api/v1/`, `docs/API.md`                        |
| Bank scrub checks, risk score, lender rank   | `packages/domain/src/scrub.ts`, `riskScore.ts`, `funderMatch.ts` |
| Watermark, PDF checks, report PDF            | `packages/connectors/src/pdf/`                                   |
| Email automation                             | `apps/web/src/server/email/`, `server/jobs/emailRules.ts`        |
| Deal page                                    | `apps/web/src/app/deals/[id]/`                                   |
| Gemini client                                | `packages/ai/src/providers/gemini.ts`                            |
| Database schema and RLS                      | `packages/db/prisma/`                                            |
