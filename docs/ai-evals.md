# AI eval set layout

Every AI job in `packages/ai` (A1–A15 in `PLAN.md`) ships with a golden eval set. CI runs the
evals for any job whose prompt or schema changed and fails the build when accuracy drops below the
thresholds in `packages/ai/evals/thresholds.json`.

## Directory layout

```
packages/ai/evals/
  thresholds.json              per-job pass/fail thresholds
  run.ts                       eval runner (pnpm --filter @mca/ai eval -- <job>)
  data/
    a1-statement-extraction/
      cases.json               list of { id, input: { files: [...] }, expected: {...} }
      <case-id>/
        statement-01.pdf       anonymised bank statement pages  (git-ignored)
        expected.json          hand-labelled monthly rows + metrics
    a2-position-detection/
      cases.json               input = A1 rows, expected = positions[]
    a3-pre-underwriting/
      cases.json               input = metrics + app, expected = grade + flags
    a8-reply-parsing/
      cases.json               input = funder email text, expected = intent + offer fields
                               (seeded with 24 cases modelled on the Ascend Fund inbox:
                               5 approval formats, 6 decline styles, acks, stips, contract,
                               funding call, funded + clawback, follow-ups, marketing)
  results/                     last run output per job (git-ignored)
```

## Rules

- **Never commit real merchant data.** PDFs/PNGs under `data/` are git-ignored. Anonymise by
  replacing names, account numbers and addresses before adding a case; keep the numbers intact
  because the numbers are what we test.
- Each case needs `expected.json` written by a human, not copied from a model run.
- Minimum set sizes before a job can be promoted from _Draft_ to _Auto_ (see PLAN.md §2):
  A1 ≥ 30 statement packs, A2 ≥ 30, A3 ≥ 30, A8 ≥ 100 emails.
- Thresholds (initial): A1 field accuracy on deposits/ending balance ≥ 98%, NSF count exact
  ≥ 95%; A2 position recall ≥ 95%, precision ≥ 90%; A8 intent accuracy ≥ 97%.
- Every eval run records model, prompt version, tokens and cost so regressions and cost drift
  are visible together.

## Running

```bash
pnpm --filter @mca/ai eval -- a1-statement-extraction
pnpm --filter @mca/ai eval -- all
```

Requires `GEMINI_API_KEY` (default provider). To compare providers, run the same set with
`MCA_AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. Runs use the same `createLlmClient()` as
production, so structured output, retries and cost reporting are exercised. Use real statements
only with a key from a billing-enabled project, and never commit them (see `.gitignore`).
