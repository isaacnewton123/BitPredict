# 08 — Data Model

PostgreSQL. All amounts are in **millisatoshis (`BIGINT`)**, and all times are `TIMESTAMPTZ` in UTC.

## 1. ER Diagram

```mermaid
erDiagram
    USERS ||--o{ MARKETS : creates
    USERS ||--o{ BETS : places
    MARKETS ||--o{ BETS : has
    MARKETS ||--o{ ORACLE_PROOFS : resolved_by
    MARKETS ||--o{ PROPOSALS : has
    PROPOSALS ||--o{ DISPUTES : challenged_by
    MARKETS ||--o{ PAYOUTS : settles
    USERS ||--o{ PAYOUTS : receives
    MARKETS ||--o{ NOSTR_EVENTS : published_as
    MARKETS ||--o{ AI_RUNS : generated_by
    SIGNERS ||--o{ PROPOSALS : signs

    USERS { text pubkey PK; text lightning_address; text nwc_uri_enc; bool is_guest }
    MARKETS { uuid id PK; text status; text category; text track; jsonb spec; text spec_sha256; bigint pool_yes_msat; bigint pool_no_msat; text outcome }
    BETS { uuid id PK; uuid market_id FK; text user_pubkey FK; text side; bigint amount_msat; text payment_hash; text status }
    ORACLE_PROOFS { uuid id PK; uuid market_id FK; text url; jsonb body; text body_sha256; numeric value }
    PROPOSALS { uuid id PK; uuid market_id FK; text signer_pubkey; text outcome; jsonb nostr_event; timestamptz challenge_ends_at }
    DISPUTES { uuid id PK; uuid proposal_id FK; text disputer_pubkey; text bond_payment_hash; text status }
    PAYOUTS { uuid id PK; uuid market_id FK; text user_pubkey FK; text kind; bigint amount_msat; text status; text preimage }
    SIGNERS { text pubkey PK; text policy; int resolved_count; int disputes_lost }
    NOSTR_EVENTS { text id PK; uuid market_id FK; int kind; jsonb event }
    AI_RUNS { uuid id PK; text purpose; text model; text prompt_sha256; jsonb output }
```

## 2. DDL

```sql
CREATE TYPE market_status AS ENUM (
  'DRAFT','OPEN','CLOSED','RESOLVING','PENDING_RESOLUTION','PROPOSED',
  'DISPUTED','RESOLVED','VOID','SETTLING','SETTLED');
CREATE TYPE market_category AS ENUM (
  'Sports','Politics','Crypto','Esports','Finance','Technology','Economy','Culture','Weather');
CREATE TYPE resolution_track AS ENUM ('auto_api','nostr_oracle');
CREATE TYPE outcome AS ENUM ('YES','NO','INVALID');
CREATE TYPE side AS ENUM ('YES','NO');

CREATE TABLE users (
  pubkey            TEXT PRIMARY KEY,               -- hex
  lightning_address TEXT,
  nwc_uri_enc       BYTEA,                          -- encrypted at rest; only if user opts in to server-side payouts
  is_guest          BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE markets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug               TEXT UNIQUE NOT NULL,
  creator_pubkey     TEXT NOT NULL REFERENCES users(pubkey),
  status             market_status NOT NULL DEFAULT 'DRAFT',
  category           market_category NOT NULL,
  track              resolution_track NOT NULL,
  title              TEXT NOT NULL,
  spec               JSONB NOT NULL,                -- full MarketSpec
  spec_sha256        TEXT NOT NULL,
  betting_cutoff     TIMESTAMPTZ NOT NULL,
  deadline_utc       TIMESTAMPTZ NOT NULL,
  resolve_after      TIMESTAMPTZ NOT NULL,
  pool_yes_msat      BIGINT NOT NULL DEFAULT 0,
  pool_no_msat       BIGINT NOT NULL DEFAULT 0,
  fee_bps            INT NOT NULL DEFAULT 200,
  outcome            outcome,
  resolved_at        TIMESTAMPTZ,
  nostr_note_id      TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (betting_cutoff <= deadline_utc AND deadline_utc <= resolve_after)
);
CREATE INDEX ON markets (status, resolve_after);
CREATE INDEX ON markets (category, status);

CREATE TABLE bets (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id        UUID NOT NULL REFERENCES markets(id),
  user_pubkey      TEXT NOT NULL REFERENCES users(pubkey),
  side             side NOT NULL,
  amount_msat      BIGINT NOT NULL CHECK (amount_msat > 0),
  payment_hash     TEXT UNIQUE NOT NULL,
  bolt11           TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'PENDING',   -- PENDING|CONFIRMED|EXPIRED|LATE|REFUNDED
  paid_at          TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ON bets (market_id, status);

CREATE TABLE oracle_proofs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id     UUID NOT NULL REFERENCES markets(id),
  provider      TEXT NOT NULL,
  url           TEXT NOT NULL,
  http_status   INT,
  body          JSONB,
  body_sha256   TEXT,
  value         NUMERIC,
  fetched_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE signers (
  pubkey          TEXT PRIMARY KEY,
  policy          TEXT NOT NULL,          -- platform_signer | multisig member | bonded
  active          BOOLEAN NOT NULL DEFAULT true,
  resolved_count  INT NOT NULL DEFAULT 0,
  disputes_lost   INT NOT NULL DEFAULT 0
);

CREATE TABLE proposals (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id         UUID NOT NULL REFERENCES markets(id),
  signer_pubkey     TEXT NOT NULL,
  outcome           outcome NOT NULL,
  proof_urls        TEXT[] NOT NULL,
  nostr_event       JSONB NOT NULL,
  bond_msat         BIGINT DEFAULT 0,
  challenge_ends_at TIMESTAMPTZ NOT NULL,
  status            TEXT NOT NULL DEFAULT 'ACTIVE',  -- ACTIVE|ACCEPTED|DISPUTED|REJECTED
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE disputes (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id        UUID NOT NULL REFERENCES proposals(id),
  disputer_pubkey    TEXT NOT NULL,
  bond_payment_hash  TEXT UNIQUE,
  proof_urls         TEXT[] NOT NULL,
  nostr_event        JSONB NOT NULL,
  status             TEXT NOT NULL DEFAULT 'OPEN',   -- OPEN|UPHELD|REJECTED
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE payouts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id      UUID NOT NULL REFERENCES markets(id),
  user_pubkey    TEXT NOT NULL REFERENCES users(pubkey),
  kind           TEXT NOT NULL,             -- WIN|REFUND|BOND_RETURN
  amount_msat    BIGINT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED|SENDING|SENT|FAILED|CLAIMABLE
  attempts       INT NOT NULL DEFAULT 0,
  bolt11         TEXT,
  payment_hash   TEXT,
  preimage       TEXT,
  last_error     TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_id, user_pubkey, kind)
);

CREATE TABLE ledger_entries (
  id          BIGSERIAL PRIMARY KEY,
  account     TEXT NOT NULL,      -- escrow | market:<id> | fees | user:<pubkey>
  amount_msat BIGINT NOT NULL,    -- +credit / -debit
  ref_type    TEXT NOT NULL,      -- bet|payout|refund|fee|dust
  ref_id      UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE nostr_events (
  id         TEXT PRIMARY KEY,
  market_id  UUID REFERENCES markets(id),
  kind       INT NOT NULL,
  event      JSONB NOT NULL,
  relays_ok  TEXT[],
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE ai_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purpose        TEXT NOT NULL,     -- market_spec|insight|evidence
  market_id      UUID REFERENCES markets(id),
  model          TEXT NOT NULL,
  prompt_sha256  TEXT NOT NULL,
  input          JSONB NOT NULL,
  output         JSONB,
  valid          BOOLEAN,
  latency_ms     INT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 3. Concurrency Notes

- Update pools with `UPDATE markets SET pool_yes_msat = pool_yes_msat + $1 WHERE id = $2 AND status = 'OPEN' AND now() < betting_cutoff`. If 0 rows change, the bet is late and gets refunded.
- Status transitions use `UPDATE ... WHERE status = '<expected>'` so two workers can't both handle the same market.
- Payouts use `SELECT ... FOR UPDATE SKIP LOCKED` for worker concurrency.
