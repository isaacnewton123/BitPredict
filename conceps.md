````markdown
# System Architecture Workflow: Bitcoin AI Prediction Market

This document outlines the end-to-end architecture and workflow for a **Prediction Market** application powered by **Bitcoin Lightning (NWC)**, **Nostr**, and an **AI Prompt-to-Oracle** layer across 9 market categories (_Sports, Politics, Crypto, Esports, Finance, Technology, Economy, Culture, Weather_).

---

## 1. High-Level System Flow

```text
[1. USER LOGIN]
Nostr (NIP-07) + Connect Wallet (NWC / Lightning)
                      │
                      ▼
[2. MARKET CREATION — 🤖 AI LAYER]
User submits a free-text prompt (1 sentence)
  ├── AI validates & removes ambiguity (location, UTC deadline, data source)
  ├── AI classifies into 1 of 9 categories
  └── AI selects Oracle track (Track A: Deterministic API / Track B: Community)
                      │
                      ▼
[3. ACTIVE MARKET & BETTING — ⚡ LIGHTNING LAYER]
Market goes live (broadcasted as a Nostr Note)
  ├── 🤖 AI (Optional): Displays initial probability estimate / insight card
  ├── User chooses a position: YES or NO
  └── User pays bet (Sats) via Lightning Invoice / NWC
                      │
                      ▼
[4. RESOLUTION PHASE — DUAL-TRACK ORACLE]
Market deadline is reached
  ├──► TRACK A: AUTO-RESOLVE (Crypto, Weather, Finance, Tech/GitHub)
  │    Backend queries public API using JSON parameters (No AI involved)
  │
  └──► TRACK B: NOSTR ORACLE (Politics, Culture, Sports, Esports, Economy)
       🤖 AI summarizes latest evidence ──► Oracle Signer / Community verifies & signs outcome
                      │
                      ▼
[5. SETTLEMENT & PAYOUT — ⚡ LIGHTNING LAYER]
Calculate pool payout ratio ──► Auto-stream Sats to winners' Lightning Address / NWC
```
````

---

## 2. Detailed Workflow Stages

### Stage 1: Authentication & Wallet Connection

1. Users sign in using their **Nostr Public Key (`NIP-07` browser extension such as Alby or nos2x)** or a temporary guest keypair.
2. Users connect a Lightning wallet via **NWC (Nostr Wallet Connect)** or provide a _Lightning Address_ to receive automated payouts.
3. No custodial account balance required (non-custodial UX / _pay-per-bet_).

### Stage 2: Market Creation (Primary AI Role)

1. A user enters a free-text prediction prompt in a single input field.

- _Example:_ `"Will the maximum temperature in Washington city reach 19°C tomorrow?"`

2. The backend sends the prompt to an LLM with a strict _System Prompt_ to output **Structured JSON**:

- **Disambiguation:** Locks down exact parameters (`Washington, D.C.`, `lat/lon` coordinates, `UTC` timezone).
- **Categorization:** Maps the market to one of the 9 supported categories.
- **Oracle Routing:** Determines whether the market can be resolved via a deterministic API (`auto_api`) or requires human/community verification (`nostr_oracle`).

3. The user reviews the generated _Market Preview_ and clicks **Publish Market**.
4. The system stores the market in the database and publishes it as a _Nostr Event_ for social discussion.

#### Example AI JSON Output (Track A - Weather)

```json
{
  "title": "Washington, D.C. Max Temperature >= 19°C (Nov 20, 2026)",
  "category": "Weather",
  "resolution_track": "auto_api",
  "rules": "This market resolves to YES if the daily maximum temperature (temperature_2m_max) in Washington, D.C. reaches or exceeds 19.0°C on Nov 20, 2026, based on Open-Meteo API data.",
  "deadline_utc": "2026-11-20T23:59:59Z",
  "oracle_config": {
    "provider": "open-meteo",
    "endpoint": "[https://api.open-meteo.com/v1/forecast](https://api.open-meteo.com/v1/forecast)",
    "params": {
      "latitude": 38.9072,
      "longitude": -77.0369,
      "daily": "temperature_2m_max",
      "date": "2026-11-20"
    },
    "condition": {
      "operator": ">=",
      "threshold": 19.0
    }
  }
}
```

### Stage 3: Active Betting Phase

1. The market remains open until the betting cutoff (`betting_cutoff`).
2. **Pool Mechanism (Parimutuel — Simplest for MVP):**

- All Sats wagered on **YES** go into `pool_yes`.
- All Sats wagered on **NO** go into `pool_no`.
- Live implied probability displayed in the UI: `YES Probability = pool_yes / (pool_yes + pool_no)`.

3. Users select **YES** or **NO**, enter their Sats amount, and pay the _Lightning Invoice_ (1-click via NWC or QR scan).
4. Once the payment webhook confirms settlement, the user's position is recorded in the database.
5. _(Optional)_ An **AI Insight Card** displays a concise summary of current data or forecasts as an informational reference.

### Stage 4: Resolution Phase (Dual-Track Oracle)

Once `deadline_utc` passes, a _Cron Job / Worker_ triggers resolution based on the assigned track:

- **Track A — Auto-Resolve (Deterministic API):**

1. The worker reads `oracle_config` from the database.
2. Executes an HTTP `GET` request to the designated public API (Open-Meteo, Mempool.space, Binance, GitHub).
3. Evaluates the actual returned value against `operator` and `threshold`.
4. Finalizes the outcome (`YES` / `NO`) and stores the raw API response as a transparent audit proof.
5. **Note:** AI is completely excluded from this step to eliminate hallucination risks.

- **Track B — Nostr Community / Optimistic Oracle:**

1. The worker marks the market status as `PENDING_RESOLUTION`.
2. _(Optional)_ An **AI Evidence Summarizer** gathers and summarizes recent news/facts to assist verifiers.
3. An _Oracle Signer_ (or a user staking a Sats bond in an _optimistic_ model) proposes the final outcome (`YES` / `NO`) along with proof links and a cryptographic Nostr signature.
4. If undisputed within the _challenge window_ (e.g., 1 hour in production, or 2 minutes in demo mode), the outcome is locked.

### Stage 5: Settlement & Payout

1. The system calculates each winner's share using the _Parimutuel_ payout formula:

$$\text{User Payout} = \left(\frac{\text{User Stake}}{\text{Winning Pool Total}}\right) \times (\text{Total Market Pool} - \text{Platform Fee})$$

2. If one side of the pool is empty (no counterparty), 100% of Sats are refunded to the bettors.
3. The backend automatically executes payouts via **Lightning (NWC / LNURL-pay)** to each winner and updates the market status to `SETTLED`.

---

## 3. Routing Matrix (9 Categories)

| Category       | Oracle Track                | Primary Data Source (MVP)                         |
| -------------- | --------------------------- | ------------------------------------------------- |
| **Crypto**     | `auto_api`                  | Mempool.space API, Binance Public API, CoinGecko  |
| **Weather**    | `auto_api`                  | Open-Meteo API (Free, no API key required)        |
| **Finance**    | `auto_api`                  | Frankfurter API (FX rates)                        |
| **Technology** | `auto_api` / `nostr_oracle` | GitHub REST API (repo metrics) / Community        |
| **Sports**     | `nostr_oracle` _(or API)_   | TheSportsDB / Oracle Signer Verification          |
| **Esports**    | `nostr_oracle` _(or API)_   | OpenDota / Oracle Signer Verification             |
| **Economy**    | `nostr_oracle`              | Official central bank / agency releases + Signer  |
| **Politics**   | `nostr_oracle`              | Official news sources + Multi-Signer Verification |
| **Culture**    | `nostr_oracle`              | Official event announcements / YouTube + Signer   |

---

## 4. MVP Execution Priorities (Hackathon Scope)

1. **Core Flow:** Nostr Login + AI Market Creator (Prompt-to-JSON) + 9-Category UI.
2. **Payment Layer:** Sats betting via NWC / LNBits using a _Parimutuel Pool_.
3. **Live Demo Track A:** Enable at least **2 Auto-Oracles** (Mempool/BTC Price for fast 5-minute live demo markets + Open-Meteo for weather).
4. **Live Demo Track B:** 1 functional _Resolve & Sign_ flow for Politics/Sports assisted by the AI evidence summary.
5. **Payout Proof:** Automated Lightning payout transaction verifiable live during the pitch.

```

```
