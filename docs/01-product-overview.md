# 01 — Product Overview (PRD)

> Source concept: [`conceps.md`](../conceps.md)

## 1. Summary

**BitPredict** is a prediction market where anyone can turn a one-sentence question into a bettable market, wager **satoshis over Lightning**, and get paid out automatically when the outcome is known.

Three pillars:

| Pillar | Role |
| --- | --- |
| **Nostr** | Identity (NIP-07 login), social distribution of markets, cryptographically signed oracle attestations |
| **Bitcoin Lightning (NWC / LNbits)** | Pay-per-bet deposits and automatic payouts, no account top-ups |
| **AI Prompt-to-Oracle** | Converts free text into a strict, unambiguous, machine-resolvable market spec. **The AI never decides outcomes.** |

## 2. Problem

- Existing prediction markets need KYC'd accounts, stablecoin deposits, or a high minimum bet, and only list markets the platform picked.
- Creating a market people can actually resolve is hard: questions written by users are ambiguous ("Washington" — which one? "tomorrow" — in which timezone? According to which source?).
- Resolution is often opaque or slow.

## 3. Solution

1. **Prompt → Market:** an LLM disambiguates the question (location, UTC deadline, data source), classifies it into 1 of 9 categories, and picks a resolution track.
2. **Bet in sats:** YES/NO parimutuel pools, paid with a Lightning invoice (1-click with NWC).
3. **Dual-track oracle:**
   - **Track A (auto_api):** deterministic public API check, with the raw response stored as proof.
   - **Track B (nostr_oracle):** an oracle signer proposes a signed outcome, which locks if no one disputes it within a challenge window.
4. **Auto-payout:** winners receive sats at their Lightning Address / NWC wallet.

## 4. Target Users

| Persona | Need |
| --- | --- |
| **Bettor** | Bet small amounts fast without sign-up friction |
| **Market Creator** | Launch a market about anything in under 30 seconds |
| **Oracle Signer** | Earn fees/reputation by attesting to outcomes honestly |
| **Nostr community** | Discuss and share markets natively in their clients |

## 5. Market Categories (9)

Sports · Politics · Crypto · Esports · Finance · Technology · Economy · Culture · Weather
(Routing per category: see [05-oracle-design.md](05-oracle-design.md#routing-matrix)).

## 6. Core User Stories

| ID | As a… | I want to… | So that… |
| --- | --- | --- | --- |
| US-01 | visitor | log in with my Nostr extension (or a guest key) | I don't need a new account |
| US-02 | user | connect NWC or enter a Lightning Address | I can bet in 1 click and get paid automatically |
| US-03 | creator | type a 1-sentence prediction | AI turns it into a precise market preview |
| US-04 | creator | review and edit the preview, then publish | I can fix anything the AI got wrong |
| US-05 | bettor | see live implied probability | I know the crowd's odds |
| US-06 | bettor | choose YES/NO, enter sats, pay invoice | my position is recorded after payment confirms |
| US-07 | bettor | see an optional AI insight card | I have context (marked as informational only) |
| US-08 | anyone | see the oracle proof (raw API response or signed Nostr event) | I can check the result myself |
| US-09 | signer | propose an outcome with proof links and my signature | Track B markets resolve |
| US-10 | bettor | dispute a proposed outcome within the window | wrong outcomes can be challenged |
| US-11 | winner | receive sats automatically | I don't have to claim manually |
| US-12 | bettor | get refunded if nobody bet on the other side | I'm never stuck in a market with no counterparty |

## 7. Goals & Success Metrics (Hackathon)

| Goal | Metric |
| --- | --- |
| Markets that resolve without ambiguity | ≥ 95% of AI-generated specs pass schema + provider validation |
| Fast creation | Prompt → published in < 30 s |
| Real money flow | ≥ 1 live Lightning payout shown during the pitch |
| Both oracle tracks | ≥ 2 Track A providers + 1 Track B resolve-and-sign flow working |

## 8. Out of Scope (MVP)

- Order book / AMM pricing (parimutuel only)
- Multi-outcome (non-binary) markets
- Fiat on-ramps
- Fully trustless escrow (e.g., DLCs). The MVP holds funds in escrow during a market's lifetime, see [10-security-and-risk.md](10-security-and-risk.md).
- Mobile native apps

## 9. Key Design Principles

1. **AI drafts, deterministic code decides.** LLM output is always validated against a schema and an allowlisted provider registry.
2. **Every outcome has proof.** Either a raw API payload + hash, or a signed Nostr event.
3. **Refund over guess.** If data is missing or the market is invalid or one-sided, refund.
4. **Minimal friction.** No passwords, no deposits, pay per bet.
