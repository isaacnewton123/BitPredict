# Environment Variables & API Keys Guide

BitPredict separates configuration into two environment files:

- [`frontend/.env`](../frontend/.env) — Next.js frontend settings (backend proxy, public API URL, Nostr relays)
- [`app/.env`](../app/.env) — Elysia backend API settings (database, auth secret, Gemini AI, Lightning/LNbits, Nostr keys, oracle parameters)

> **Security note:** `.gitignore` ignores `.env` and `.env.local` in both folders. Keep `.env.example` committed without real secrets, and never commit live admin keys (`LNBITS_ADMIN_KEY`, `PLATFORM_NOSTR_SECRET_KEY`, `AUTH_SECRET`, `DATABASE_AUTH_TOKEN`, or `GEMINI_API_KEY`).

---

## 1. Frontend (`frontend/.env`)

Copy `frontend/.env.example` to `frontend/.env` (already created with working local defaults):

| Variable | Local Value | Purpose & Where to Get It |
| --- | --- | --- |
| `BACKEND_URL` | `http://localhost:3001` | Server-side Next.js rewrite destination for `/api/v1/*` in `frontend/next.config.ts`. Point to your Elysia backend URL (local or deployed domain). |
| `NEXT_PUBLIC_API_URL` | `http://localhost:3001` | Browser base URL for backend API requests. Set to `http://localhost:3001` for direct CORS requests to `app/`, or `same-origin` to route through Next.js `/api/v1/*` rewrites. |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Public URL where your Next.js app is hosted (local dev is `http://localhost:3000`). |
| `NEXT_PUBLIC_NOSTR_RELAYS` | `wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band` | Comma-separated public WebSocket relays used by browser NIP-07 clients and event pointers. Public relays listed require no API keys. |

---

## 2. Backend (`app/.env`)

Copy `app/.env.example` to `app/.env` (already created with working local `DEMO_MODE=true` defaults). Leave optional integration keys blank in demo mode, or populate them below for live AI, Lightning, Nostr, and remote libSQL.

### Server & Database

| Variable | Local Value | Where to Get It |
| --- | --- | --- |
| `PORT` | `3001` | TCP port for the Elysia server (`app/src/index.ts`). |
| `DATABASE_URL` | `file:./data/bitpredict.db` | Local SQLite works out of the box (no signup needed). For production hosted libSQL on **Turso**: run `turso db create bitpredict` then `turso db show bitpredict --url` (format `libsql://...`). |
| `DATABASE_AUTH_TOKEN` | *(empty locally)* | Leave blank for local SQLite. For **Turso**: run `turso db tokens create bitpredict` (or generate in **Turso Dashboard → Databases → Create Token**). |
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | Must match your frontend URL (used in Nostr announcement links and LNURL callbacks). |

### Authentication Secret

| Variable | Example | How to Generate |
| --- | --- | --- |
| `AUTH_SECRET` | 64-char hex string | Required in production (`NODE_ENV=production`) for HMAC signing auth challenges & session cookies. Generate locally with: `openssl rand -hex 32` or `bun -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

### Google Gemini AI (`GEMINI_API_KEY`)

The AI Market Creator uses Gemini when configured and falls back cleanly to the deterministic rule compiler when empty.

1. Visit **Google AI Studio**: <https://aistudio.google.com/app/apikey>
2. Sign in with your Google account and click **Create API key**.
3. Copy the key (`AIza...`) into `GEMINI_API_KEY=` in `app/.env`.
4. Leave `GEMINI_MODEL=gemini-2.5-flash` (or another supported Gemini Flash/Pro model ID).

### Bitcoin Lightning via LNbits (`LNBITS_*`)

When `LNBITS_URL` and `LNBITS_INVOICE_KEY` are empty with `DEMO_MODE=true`, BitPredict uses built-in simulated BOLT11 invoices & payouts. To process real satoshis over Lightning:

1. Create a wallet on **LNbits** (<https://legend.lnbits.com> for testing/demo or your own self-hosted LND/Core Lightning LNbits server).
2. Open your wallet in the LNbits web UI and click **API info** on the right panel.
3. Copy the values into `app/.env`:
   - `LNBITS_URL` — Base URL of your LNbits server (no trailing slash, e.g. `https://legend.lnbits.com`).
   - `LNBITS_INVOICE_KEY` — **Invoice/read key** (used to create incoming bet invoices and verify payment status).
   - `LNBITS_ADMIN_KEY` — **Admin key** (required **only** on the backend to pay outgoing LNURL-pay/BOLT11 winner payouts).
   - `LNBITS_WEBHOOK_SECRET` — Choose any random hex secret (e.g. `openssl rand -hex 16`) to protect `POST /api/v1/webhooks/lnbits`.

### Nostr Keys & Relays (`PLATFORM_*`, `NOSTR_*`, `ORACLE_*`)

Outside `production` (`NODE_ENV !== "production"`), deterministic development keypairs are derived automatically if omitted. For production deployments:

Generate fresh Nostr keypairs (32-byte private key hex + matching x-only public key hex) using Bun inside `app/`:

```bash
cd app
bun -e "import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'; const sk = generateSecretKey(); const hex = Buffer.from(sk).toString('hex'); console.log({ secret_hex: hex, pubkey_hex: getPublicKey(sk) });"
```

| Variable | Description |
| --- | --- |
| `PLATFORM_NOSTR_SECRET_KEY` | 64-char hex or `nsec1...` key used by the backend to sign `kind 30078` Market Specs, `kind 1` Announcements, and Settlement Notes. |
| `PLATFORM_ORACLE_SECRET_KEY` | Separate 64-char hex or `nsec1...` key used exclusively to sign `kind 30079` Track A outcome attestations. |
| `ORACLE_SIGNER_PUBKEYS` | Comma-separated 64-char hex Nostr pubkeys (or `npub1...`) allowed to submit Track B proposals (`kind 30079`). Empty in `DEMO_MODE=true` allows demo signers. |
| `ADMIN_PUBKEYS` | Comma-separated 64-char hex Nostr pubkeys (or `npub1...`) authorized to call `POST /api/v1/admin/disputes/:id/rule`. |
| `NOSTR_RELAYS` | Comma-separated relay URLs (`wss://relay.damus.io,wss://nos.lol,wss://relay.nostr.band`). |
| `NOSTR_PUBLISH_DISABLED` | Set `true` for fast offline development/testing, or `false` to broadcast real signed events to `NOSTR_RELAYS`. |

### Betting, Settlement & Track B Parameters

| Variable | Default | Meaning |
| --- | --- | --- |
| `MIN_BET_SATS` | `10` | Minimum allowed wager per bet in satoshis. |
| `MAX_BET_SATS` | `100000` | Maximum allowed single wager in satoshis. |
| `INVOICE_EXPIRY_SEC` | `600` | BOLT11 invoice expiry time in seconds (bounded by time remaining until `betting_cutoff_utc`). |
| `PLATFORM_FEE_BPS` | `200` | Fee charged on the losing pool in basis points (`200` = `2%`). |
| `PAYOUT_MAX_RETRIES` | `3` | Outgoing LNURL-pay delivery attempts before falling back to `CLAIMABLE` manual/LNURL-withdraw claim. |
| `CHALLENGE_WINDOW_SEC` | `3600` | Track B optimistic challenge duration in seconds (`3600` = 1h; fast `120s` when `DEMO_MODE=true`). |
| `DISPUTE_BOND_SATS` | `1000` | Lightning bond invoice amount required to submit a `kind 30080` dispute. |
| `DEMO_MODE` | `true` | Enables `/api/v1/demo/seed`, simulated LNbits invoices/payouts when keys are blank, and fast oracle demo resolution triggers. Set `false` in production! |

---

## 3. Verifying Your Local Setup

After verifying `frontend/.env` and `app/.env`:

1. Start the Elysia backend (`http://localhost:3001` & Scalar docs at `/openapi`):
   ```bash
   cd app
   bun run dev
   ```
2. Start the Next.js frontend (`http://localhost:3000`):
   ```bash
   cd frontend
   npm run dev
   ```
3. Visit <http://localhost:3000> — the frontend will fetch `/api/v1/markets` directly from `app/` (and automatically trigger `POST /api/v1/demo/seed` if the SQLite DB is empty).
