<p align="center">
  <img src="public/brand/bitpredict-logo.jpg" alt="BitPredict logo" width="320">
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
| – | [conceps.md](conceps.md) | Original concept |
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

## Recommended Stack

Next.js + TypeScript · PostgreSQL · `nostr-tools` · `@getalby/sdk` (NWC) · LNbits · LLM with structured JSON output · `zod` · Node cron worker

## Status

📄 Design phase. Documentation complete, implementation not started (see [roadmap](docs/11-mvp-roadmap.md)).
