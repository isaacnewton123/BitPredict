<p align="center">
  <img src="frontend/public/brand/bitpredict-logo.jpg" alt="BitPredict logo" width="320">
</p>

# BitPredict — Bitcoin AI Prediction Market

Turn any one-sentence prediction into a bettable market. Bet in **sats over Lightning**. Outcomes are resolved by **deterministic APIs** or **Nostr-signed oracles**, and payouts happen automatically.

```text
Nostr login + NWC  →  AI Prompt-to-Market  →  YES/NO bets (⚡ sats)  →  Dual-track oracle  →  Auto payout (⚡)
```

## Key Ideas

- **Nostr** handles identity (NIP-07), market distribution, and signed outcome attestations.
- **Lightning (NWC / LNbits)** gives pay-per-bet deposits with no account balance, and automatic payouts to a Lightning Address.
- **AI drafts, code decides.** An LLM turns free text into a strict `MarketSpec` (location, UTC deadline, data source, category, oracle track). The AI is **never** used to decide outcomes.
- **Dual-track oracle:**
  - **Track A `auto_api`:** Crypto, Weather, Finance, Tech/GitHub. Resolved with a public API check and a stored raw proof.
  - **Track B `nostr_oracle`:** Politics, Culture, Sports, Esports, Economy. A signer submits an attestation, and it locks if undisputed within the challenge window.
- **Parimutuel pools:** implied P(YES) = `pool_yes / (pool_yes + pool_no)`. Winners split the losing pool. One-sided markets are refunded.

## Documentation

| # | Document | Contents |
| --- | --- | --- |
| – | [00-concept.md](docs/00-concept.md) | Original concept |
| 01 | [Product Overview](docs/01-product-overview.md) | Problem, personas, user stories, scope, metrics |
| 02 | [System Architecture](docs/02-system-architecture.md) | Components, tech stack, end-to-end sequence |
| 03 | [Market Lifecycle](docs/03-market-lifecycle.md) | State machine, timestamps, edge cases |
| 04 | [AI Market Creator](docs/04-ai-market-creator.md) | JSON schema, system prompt, guardrails, concept fixes |
| 05 | [Oracle Design](docs/05-oracle-design.md) | Provider registry, Track A algorithm, Track B optimistic oracle |
| 06 | [Lightning Payments](docs/06-lightning-payments.md) | Bet flow, parimutuel math, payouts, ledger |
| 07 | [Nostr Integration](docs/07-nostr-integration.md) | NIPs, login, event kinds, relays, keys |
| 08 | [Data Model](docs/08-data-model.md) | ER diagram, PostgreSQL DDL |
| 09 | [API Spec](docs/09-api-spec.md) | REST endpoints, errors, rate limits |
| 10 | [Security & Risk](docs/10-security-and-risk.md) | Threat model, custody, legal |
| 11 | [MVP Roadmap & Demo](docs/11-mvp-roadmap.md) | Milestones, demo script, test checklist |
| 12 | [Glossary](docs/12-glossary.md) | Terms |
| 13 | [Brand Identity](docs/13-brand-identity.md) | Name, logo, colors, usage rules |
| 14 | [Env & API Keys](docs/14-env-and-api-keys.md) | `.env` configuration & where to obtain Gemini, LNbits, Turso & Nostr keys |

## Recommended Stack

Next.js + TypeScript · PostgreSQL · `nostr-tools` · `@getalby/sdk` (NWC) · LNbits · LLM with structured JSON output · `zod` · Node cron worker

## Status

✅ **Phases 0–8 MVP complete.** Foundation + stress tests, Nostr Auth, AI Market Creator, Nostr Publishing, Lightning Betting, Track A Auto-API Oracle across all 8 allowlisted providers, Automatic Payouts, Track B Optimistic Oracle & Signer Console, AI Market Insight Cards, mobile navigation, and the idempotent showcase demo seeder (`POST /api/v1/demo/seed` / **⚡ Load Demo Markets**) are implemented and verified — see [roadmap](docs/11-mvp-roadmap.md) and [changelog](CHANGELOG.md).

## Repository Structure

```text
├── app/                # Elysia + Bun backend API (/api/v1/*, Scalar OpenAPI at /openapi, Drizzle/libSQL DB)
├── frontend/           # Next.js 16 Kraken-inspired light UI app (standalone or proxying BACKEND_URL)
├── docs/               # Architecture, lifecycle, oracle specs, exported OpenAPI spec & original concept
└── scalar.config.json  # Scalar Docs 2.0 configuration combining guides & docs/openapi.json
```

## Quick Start

### 1. Backend API & Scalar Docs (`app/`, port `3001`, Bun + Elysia)

```bash
cd app
cp .env.example .env   # pre-populated for local dev; see docs/14-env-and-api-keys.md
bun install
bun run db:migrate
bun run dev
```

Interactive Scalar API Reference is served at `http://localhost:3001/openapi` (OpenAPI 3.1 JSON at `http://localhost:3001/openapi/json`).

Seed the 6 showcase Demo Sandbox markets (`is_demo = true`, idempotent):

```bash
curl -X POST http://localhost:3001/api/v1/demo/seed
```

Run a production runtime migration & start without dev dependencies (or build via [Dockerfile](app/Dockerfile)):

```bash
cd app
bun run src/migrate.ts
bun run src/index.ts
```

Note: In production (`DEMO_MODE=false`), judges and visitors can still select **Use Demo Account** in the Connect modal to trade isolated Demo Sandbox markets with simulated Lightning invoices without touching Live pools or LNbits funds.

Verify backend checks:

```bash
cd app
bun run typecheck
bun run test
bun run test:stress
```

### 2. Frontend App (`frontend/`, port `3000`)

The Next.js frontend lives in `frontend/`, connects directly to the Elysia backend (`NEXT_PUBLIC_API_URL=http://localhost:3001` in `frontend/.env`), and renders the Kraken-inspired light design (`IBM Plex Sans`, crisp white cards, `#7132f5` actions, interactive NWC betting modal, AI Creator studio, Dual-Track Oracle console, and Positions view). See [Env & API Keys](docs/14-env-and-api-keys.md) for all environment options.

```bash
cd frontend
cp .env.example .env   # already configured for http://localhost:3001
npm install
npm run dev
```

Verify frontend checks:

```bash
cd frontend
npx tsc --noEmit
npm run lint
npm run build
```
