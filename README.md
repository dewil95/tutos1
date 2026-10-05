# MCA CRM

AI-native CRM for Merchant Cash Advance brokers / ISOs, built on the Anthropic Claude API.
The full research, automation inventory and phased plan live in [`docs/PLAN.md`](docs/PLAN.md).

## Layout

```
apps/web          Next.js app (deal board, API routes)
apps/worker       BullMQ worker (statement analysis pipeline A1→A2→A3)
packages/db       Prisma schema + client (Postgres)
packages/domain   Pure business logic: offer math, qualification, bank metrics, funder matching
packages/ai       Claude client wrapper, Zod output schemas, prompts, eval harness
packages/connectors  Interfaces for funders, e-sign, bank-link, telephony, email, DNC
infra/            docker-compose for local Postgres, Redis, MinIO, Mailhog
docs/             Plan, funder appetite matrix template, eval guidelines
legacy/           The original static tutorial page this repo started as
```

## Getting started

```bash
pnpm install
cp .env.example .env            # add ANTHROPIC_API_KEY
docker compose -f infra/docker-compose.yml up -d
pnpm db:generate
pnpm db:migrate                 # creates the schema (see packages/db/prisma/migrations/README.md)
pnpm dev                        # web on :3000, worker in the same terminal
```

Checks: `pnpm typecheck`, `pnpm test`, `pnpm format:check`.
AI evals (needs an API key): `pnpm --filter @mca/ai eval -- all`.

## Status

Phase 0 (foundation) of the plan. See `docs/PLAN.md` §7 for what comes next.
