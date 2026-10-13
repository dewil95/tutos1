# How the Ascend CRM works

The CRM runs on **Cloudflare**: the app on **Workers**, the database on **D1**, sign-in through
**Cloudflare Access**, and a **Cron Trigger** every 2 minutes for background work. Files live in
**Google Drive**, email goes through the Gmail account `funding@ascendfund.co`, and AI runs on
the **Google Gemini API**. WhatsApp applications are built and switched off. There are no calls
or SMS.

## 1. The pieces

```mermaid
flowchart TB
  team["Ascend team<br/>(browser)"]

  subgraph cf["Cloudflare (Workers Paid)"]
    access["Access<br/>@ascendfund.co only"]
    app["Worker crm (Next.js)<br/>deal board · deal page · lenders · settings"]
    cron["Cron Trigger<br/>every 2 minutes"]
    tick["/api/cron/tick<br/>job runner"]
    db[("D1<br/>deals · lenders · submissions · jobs")]
  end

  subgraph google["Google Workspace"]
    gmail["Gmail<br/>funding@ (read + send)"]
    hist["Gmail<br/>jonas@ (read-only history)"]
    drive["Drive<br/>Ascend CRM / Deals / Merchant"]
  end

  gemini["Gemini API<br/>3.1 Pro · 3 Flash"]
  lenders["Lenders"]
  merchant["Merchant"]

  team --> access --> app
  app --> db
  cron -- "scheduled() → in-process call with CRON_SECRET" --> tick
  tick --> db
  app & tick --> gmail
  tick --> hist
  app & tick --> drive
  app & tick --> gemini
  gmail <--> lenders
  merchant -- "statements, MTD, DL/VC" --> gmail
```

## 1a. From the merchant's application to a signed Ascend application

```mermaid
flowchart LR
  up["New deal: upload the application<br/>signed with another company"] --> keep["Drive, team only<br/>(never sent to lenders)"]
  keep --> a5["A5 App reading (Gemini)<br/>fills merchant, owners, request"]
  a5 --> check["Deal page: check details<br/>missing fields listed, edit form"]
  check --> pdf["Download Ascend's application<br/>empty signature + date lines"]
  pdf --> sign["Merchant signs<br/>(DocuSign or paper)"]
  sign --> signed["Upload the signed copy<br/>= the deal's application"]
  signed --> ship["Ship the file<br/>ticked for lenders by default"]
```

A returning merchant (same legal name and EIN) keeps one record: the new deal moves onto it and
any differences wait on the deal page for a person to choose.

## 1b. Learning from past email

```mermaid
flowchart LR
  j["jonas@ mailbox<br/>Gmail read-only"] --> q["HISTORY_IMPORT<br/>submissions + lender mail<br/>oldest first, resumes each tick"]
  q --> subs["Deals + one row per lender<br/>positions block → balances"]
  q --> a8["A8 reads each lender reply<br/>approved · declined + why · offers · funded"]
  subs & a8 --> book["Lenders page<br/>approval rate, reasons, typical offer,<br/>reply speed, how you shop"]
  book --> rank["Lender ranking on each deal"]
```

The same email read from two mailboxes is stored once (by its Message-ID). Imported history
never triggers follow-ups, stip chases or file downloads, and nothing is ever sent from the
history mailbox.

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

## 4. Background work

A Cloudflare Cron Trigger runs the Worker's `scheduled()` handler every 2 minutes; it calls the
job runner in-process. Work is kept in a `Job` table and each job is a small unit. Clicking
**Send** (or uploading an application) also runs the new jobs right away, in the background of
that request.

```mermaid
sequenceDiagram
  participant C as Cron Trigger
  participant T as /api/cron/tick
  participant DB as D1 Job table
  participant H as Job handlers
  C->>T: scheduled() → POST with Authorization: Bearer CRON_SECRET
  T->>DB: queue INBOX_SYNC (funding@), HISTORY_IMPORT (until done), EMAIL_RULES
  loop until ~4 minutes used
    T->>DB: claim due jobs (conditional update: only one runner wins each job)
    T->>H: SEND_SUBMISSION, INBOX_SYNC, PARSE_REPLY, EMAIL_RULES
    T->>H: APPLICATION_READ, STATEMENT_*, RISK_REPORT, HISTORY_IMPORT (only with 40 s left)
    H-->>DB: done, or retry in 1, 2, 4… minutes (failed after 5 tries)
  end
```

A send that crashes after Gmail accepted it is never sent twice: the job marks the submission
"sending" first, and a retry looks in Sent before trying again. D1 has no multi-step
transactions, so every job is written to end in the same state if it is run again.

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

## 7. WhatsApp applications

The merchant sends the signed application they already have from another company. The bot fills
in Ascend's application from it and the merchant signs Ascend's application by typing their name.
The other company's signature is never copied, and its PDF stays internal.

```mermaid
sequenceDiagram
  autonumber
  participant M as Merchant (WhatsApp)
  participant W as /api/whatsapp/webhook
  participant B as Chat job
  participant R as PDF reader (A5, Gemini)
  participant P as Private page /apply/…
  M->>W: "Hi" · picks English / Español
  M->>W: Other company's signed application (PDF or photos) + statements
  W->>B: message stored once (signature checked), job queued
  B->>R: read the application
  R-->>B: fields + SSN/DOB (encrypted) · file marked internal only
  B->>M: "I just need 2 more details" → one question at a time
  B->>M: one-time link for SSN and date of birth
  M->>P: SSN + DOB (never typed in the chat)
  B->>M: filled Ascend application (PDF, SSN hidden) · Looks good / Fix something
  M->>B: types full name · taps "I agree, sign"
  B->>B: signed PDF → Drive, deal filled (same path as the website API),<br/>ApplicationSignature row (name, phone, consent text, message ids, PDF hash)
  B->>M: signed copy
```

- Every inbound message and every background result (PDF read, private page, reminder) is a
  `WhatsAppMessage` row handled in order by one `WHATSAPP_MESSAGE` job per chat, so two things
  never change the same chat at once.
- The bot asks only required fields the PDF left empty; values the reader or the answer parser
  was unsure of are read back for a yes/no. "back", "fix" and "agent" work at any point.
- Two reminders inside WhatsApp's free 24-hour window (after 2 h and 20 h); after a day the chat
  is marked "went quiet" on the board and the team follows up.
- With `WHATSAPP_ENABLED` off, replies are written to the chat on the deal page instead of being
  sent.

## Where things live in the code

| Concern                                      | Path                                                                 |
| -------------------------------------------- | -------------------------------------------------------------------- |
| To/CC rules                                  | `packages/connectors/src/recipients.ts`                              |
| House email (subject, body, positions block) | `packages/connectors/src/funder/email.ts`                            |
| Gmail and Drive clients                      | `packages/connectors/src/email/gmail.ts`, `storage/drive.ts`         |
| Job queue                                    | `packages/db/src/jobs.ts`                                            |
| Background jobs (send, inbox, scrub, report) | `apps/web/src/server/jobs/`                                          |
| Website API                                  | `apps/web/src/app/api/v1/`, `docs/API.md`                            |
| Bank scrub checks, risk score, lender rank   | `packages/domain/src/scrub.ts`, `riskScore.ts`, `funderMatch.ts`     |
| Watermark, PDF checks, report PDF            | `packages/connectors/src/pdf/`                                       |
| Email automation                             | `apps/web/src/server/email/`, `server/jobs/emailRules.ts`            |
| WhatsApp bot, questions, signature           | `apps/web/src/server/whatsapp/`, `app/api/whatsapp/webhook/`         |
| WhatsApp Cloud API client, application PDF   | `packages/connectors/src/whatsapp/`, `pdf/application.ts`            |
| Deal page                                    | `apps/web/src/app/deals/[id]/`                                       |
| Ascend application (fill, PDF, signed copy)  | `apps/web/src/server/ascendApplication.ts`, `app/deals/new/`         |
| History import, lender playbook              | `server/jobs/historyImport.ts`, `server/playbook.ts`, `app/lenders/` |
| Sign-in (Cloudflare Access)                  | `apps/web/src/server/auth.ts`                                        |
| Worker entry, cron, bindings                 | `apps/web/worker.ts`, `apps/web/wrangler.jsonc`                      |
| Gemini client                                | `packages/ai/src/providers/gemini.ts`                                |
| Database schema and D1 migrations            | `packages/db/prisma/`, `packages/db/migrations/`                     |
