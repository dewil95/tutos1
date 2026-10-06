# Ascend CRM website API

Ascend's website sends each completed funding application to the CRM. The CRM creates the deal,
the merchant and owners, files the documents in the deal's Google Drive folder and shows it on
the deal board. No one has to re-type anything.

- Base URL: `https://YOUR-APP.vercel.app/api/v1`
- Auth: `Authorization: Bearer ak_live_…`. An admin creates a key in **Settings → Website API**;
  it is shown once. Keep it on the website's server, never in browser JavaScript.
- Body: JSON, at most about 4 MB per request (Vercel limit), 3 MB per file. Larger statements:
  have the merchant email them to `funding@ascendfund.co`; the inbox check files them on the deal.
- Errors: JSON `{ "error": "...", "details": [...] }` with 400 (not JSON), 401 (key), 404,
  413 (file too large), 422 (validation, `details[].path` names the field), 503 (Drive not connected).

## POST /applications

Creates the deal. Re-sending the same `externalId` returns the existing deal (`200`, `created: false`)
instead of creating a second one, so retries are safe.

```bash
curl -X POST https://YOUR-APP.vercel.app/api/v1/applications \
  -H "Authorization: Bearer $ASCEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d @application.json
```

```json
{
  "externalId": "web-1001",
  "business": {
    "legalName": "Sample Bistro LLC",
    "dba": "Sample Bistro",
    "entityType": "LLC",
    "ein": "12-3456789",
    "startDate": "2021-04-01",
    "industry": "Restaurant",
    "phone": "305-555-0100",
    "email": "owner@samplebistro.test",
    "address": { "line1": "1 Main St", "city": "Miami", "state": "FL", "postalCode": "33101" }
  },
  "request": {
    "amount": 25000,
    "useOfFunds": "Inventory",
    "monthlyRevenue": 60000,
    "existingAdvances": [{ "lender": "Sample Capital", "balance": 9000 }]
  },
  "owners": [
    {
      "firstName": "Pat",
      "lastName": "Example",
      "ownershipPct": 100,
      "ssn": "123-45-6789",
      "dob": "1980-02-03",
      "email": "pat@samplebistro.test",
      "phone": "305-555-0101",
      "creditScore": 640
    }
  ],
  "signedAt": "2026-10-01T15:00:00Z",
  "files": [
    {
      "fileName": "Ascend-Fund-Application-Sample-Bistro.pdf",
      "contentType": "application/pdf",
      "type": "APPLICATION",
      "base64": "JVBERi0xLjQK..."
    }
  ]
}
```

Only `externalId` and `business.legalName` are required. Field rules:

| Field                 | Format                                                                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `business.entityType` | `LLC`, `CORP`, `S_CORP`, `SOLE_PROP`, `PARTNERSHIP`, `NONPROFIT`, `OTHER`                                                                         |
| `business.ein`        | `12-3456789` or 9 digits                                                                                                                          |
| dates                 | `YYYY-MM-DD`; `signedAt` is an ISO timestamp                                                                                                      |
| `owners[].ssn`        | `123-45-6789` or 9 digits                                                                                                                         |
| `files[].contentType` | `application/pdf`, `image/jpeg`, `image/png`                                                                                                      |
| `files[].type`        | `APPLICATION`, `BANK_STATEMENT`, `MTD_STATEMENT`, `VOIDED_CHECK`, `DRIVERS_LICENSE`, `TAX_RETURN`, `OTHER` (optional; guessed from the file name) |

Response `201`:

```json
{
  "dealId": "cm…",
  "externalId": "web-1001",
  "created": true,
  "stage": "DOCS_REQUESTED",
  "documents": [
    { "id": "cm…", "fileName": "Ascend-Fund-Application-Sample-Bistro.pdf", "type": "APPLICATION" }
  ]
}
```

What the CRM does with it:

- SSN, date of birth and EIN are encrypted at rest; the CRM screens show only the last 4 digits.
- `existingAdvances` pre-fill the positions block of the lender email.
- Bank statements sent here (or later) are scrubbed automatically.

## POST /deals/{id}/documents

Adds files later (for example statements the merchant uploads after the form). `{id}` is the
`dealId` or your `externalId`.

```json
{
  "files": [
    {
      "fileName": "Chase June 2026.pdf",
      "contentType": "application/pdf",
      "type": "BANK_STATEMENT",
      "base64": "..."
    }
  ]
}
```

An application PDF added here is read by AI (Gemini) to fill any missing fields; differences from
what was already saved are shown to the team rather than overwritten.

## GET /deals/{id}

For a "track your application" page. Lender names are never returned.

```json
{
  "dealId": "cm…",
  "externalId": "web-1001",
  "stage": "SUBMITTED",
  "documents": { "application": true, "bankStatements": 4 },
  "lenders": { "reviewing": 5, "approved": 1, "declined": 2 },
  "updatedAt": "2026-10-06T14:02:11.000Z"
}
```
