# 02 — System Architecture

## 1. High-Level Flow

```mermaid
flowchart TD
    A["1. Login: Nostr NIP-07 + NWC / Lightning Address"] --> B["2. Market Creation: AI prompt-to-JSON"]
    B --> C["3. Active Market: YES/NO bets via Lightning"]
    C --> D{"4. Resolution track"}
    D -->|auto_api| E["Track A: deterministic API check (no AI)"]
    D -->|nostr_oracle| F["Track B: AI evidence summary + signer attestation + challenge window"]
    E --> G["5. Settlement: parimutuel payout over Lightning"]
    F --> G
```

## 2. Component Diagram

```mermaid
flowchart LR
    subgraph Client["Web Client (browser)"]
        UI["Next.js UI"]
        EXT["NIP-07 extension (Alby / nos2x)"]
        NWCC["NWC connection (user wallet)"]
    end

    subgraph Backend["Backend"]
        API["REST API"]
        AIS["AI Market Service"]
        PAY["Payment Service"]
        ORA["Oracle Worker (cron)"]
        SET["Settlement Worker"]
        NOS["Nostr Publisher"]
        REG["Provider Registry (allowlist)"]
    end

    DB[("PostgreSQL")]
    LLM["LLM provider (structured output)"]
    LN["LNbits / Lightning node"]
    RELAYS["Nostr relays"]
    PUB["Public APIs: Open-Meteo, Mempool, Binance, CoinGecko, Frankfurter, GitHub, TheSportsDB, OpenDota"]

    UI --> API
    UI --> EXT
    UI --> NWCC
    API --> AIS --> LLM
    AIS --> REG
    API --> PAY --> LN
    LN -->|webhook| PAY
    ORA --> REG --> PUB
    ORA --> AIS
    ORA --> SET --> PAY
    API --> NOS --> RELAYS
    ORA --> NOS
    API --> DB
    PAY --> DB
    ORA --> DB
    SET --> DB
    NWCC -.->|pay_invoice| LN
```

## 3. Components

| Component | Responsibility |
| --- | --- |
| **Web Client** | Login, market creator, market list/detail, bet slip, proof viewer, signer console |
| **REST API** | Auth (Nostr signed challenge, NIP-98), market CRUD, bets, disputes |
| **AI Market Service** | Prompt → validated `MarketSpec` JSON; optional insight card and evidence summary. See [04](04-ai-market-creator.md) |
| **Provider Registry** | Allowlisted oracle providers: endpoint templates, param schemas, value extractors. The AI can only pick a `provider` id + params, **never a raw URL** |
| **Payment Service** | Creates invoices, verifies settlement webhooks, sends payouts and refunds. See [06](06-lightning-payments.md) |
| **Oracle Worker** | Polls for markets past their deadline, runs Track A fetches, opens Track B attestation windows. See [05](05-oracle-design.md) |
| **Settlement Worker** | Computes the parimutuel split and queues payouts with retries |
| **Nostr Publisher** | Publishes market announcements, outcome attestations, and settlement notes. See [07](07-nostr-integration.md) |
| **PostgreSQL** | Source of truth for markets, bets, oracle proofs, and payouts. See [08](08-data-model.md) |

## 4. Recommended Tech Stack (MVP)

| Layer | Choice | Notes |
| --- | --- | --- |
| Frontend | Next.js (App Router) + TypeScript + Tailwind | Single repo with API routes, fast to build |
| Nostr | `nostr-tools`, `window.nostr` (NIP-07) | Guest keypair generated client-side |
| Wallet | `@getalby/sdk` (NWC), LNbits REST API | LNbits = platform escrow wallet + webhooks |
| AI | Any LLM with JSON-schema structured output (e.g., Gemini) | Temperature 0, schema-enforced |
| DB | PostgreSQL (or SQLite for a pure hackathon demo) + Prisma/Drizzle | |
| Jobs | Node worker with `node-cron` or BullMQ (Redis) | 10–30 s tick for demo markets |
| Validation | `zod` | Shared schemas between AI output, API, and DB |
| Hosting | Vercel (web) + Fly/Railway (worker + DB) | Worker must run all the time |

## 5. End-to-End Sequence

```mermaid
sequenceDiagram
    actor U as User
    participant W as Web Client
    participant B as Backend
    participant L as LLM
    participant N as LNbits
    participant R as Nostr Relays
    participant P as Public API

    U->>W: Login (NIP-07 sign challenge)
    W->>B: POST /auth/nostr (signed event)
    U->>W: "Will max temp in Washington reach 19°C tomorrow?"
    W->>B: POST /markets/draft
    B->>L: system prompt + user prompt (JSON schema)
    L-->>B: MarketSpec JSON
    B->>B: zod + registry validation
    B-->>W: Market Preview
    U->>W: Publish
    W->>B: POST /markets (spec, signed by creator)
    B->>R: publish market event
    U->>W: Bet YES 1,000 sats
    W->>B: POST /markets/:id/bets
    B->>N: create invoice
    N-->>W: bolt11
    W->>N: pay via NWC (or QR)
    N->>B: webhook: paid
    B->>B: record position, update pools
    Note over B: deadline_utc + settle delay passes
    B->>P: GET (registry-built request)
    P-->>B: raw JSON
    B->>B: evaluate condition, store proof hash
    B->>R: publish outcome attestation
    B->>N: pay winners (LNURL-pay / NWC)
    B->>R: publish settlement note
```

## 6. Deployment Topology

- `web` (stateless): UI + API routes
- `worker` (singleton, or leader-elected): oracle + settlement + payout retries
- `db`: Postgres with daily backups
- Secrets: LNbits admin key, LLM API key, platform Nostr nsec (oracle signer key for house-signed Track A attestations), all kept server-side only.
