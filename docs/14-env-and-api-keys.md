# Environment Variables & API Keys Guide

BitPredict separates configuration into two environment files:

- [`frontend/.env`](../frontend/.env) — Next.js frontend settings (backend proxy, public API URL, Nostr relays)
- [`app/.env`](../app/.env) — Elysia backend API settings (database, auth secret, Gemini AI, Lightning/LNbits, Nostr keys, oracle parameters)

> **Security note:** `.gitignore` ignores `.env` and `.env.local` in both folders. Keep `.env.example` committed without real secrets, and never commit live admin keys (`LNBITS_ADMIN_KEY`, `PLATFORM_NOSTR_SECRET_KEY`, `AUTH_SECRET`, `DATABASE_AUTH_TOKEN`, `NVIDIA_API_KEY`, or `GEMINI_API_KEY`).

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

### NVIDIA NIM AI (`NVIDIA_API_KEY`) — Free Hosted Option

The AI Market Creator, Market Insight briefs, and Evidence Summarizer support **NVIDIA NIM** (OpenAI-compatible REST API) as well as Google Gemini, falling back cleanly to the deterministic rule compiler when both API keys are blank.

1. Visit **NVIDIA Build**: <https://build.nvidia.com>
2. Sign in and click **Get API Key** on any hosted chat model (for example `nvidia/nemotron-3.5-lightning-30b-a3b`).
3. Copy the key (`nvapi-...`) into `NVIDIA_API_KEY=` in `app/.env` (never commit `app/.env` or paste real keys into `.env.example`).
4. Set:
   - `AI_PROVIDER=nvidia` (or `auto` to prefer NVIDIA NIM when `NVIDIA_API_KEY` is present)
   - `NVIDIA_BASE_URL=https://integrate.api.nvidia.com/v1` (or your self-hosted NIM endpoint)
   - `NVIDIA_MODEL=nvidia/nemotron-3.5-lightning-30b-a3b`

### Google Gemini AI (`GEMINI_API_KEY`) — Optional Alternative

Used when `AI_PROVIDER=gemini`, or when `AI_PROVIDER=auto` and `NVIDIA_API_KEY` is blank.

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

### Cloudflare R2 Image Storage (`R2_*`)

Market cover image uploads (`POST /api/v1/uploads/market-image`) support **Cloudflare R2** object storage via S3-compatible AWS SigV4 requests, falling back to local disk (`app/data/uploads/`) when R2 credentials are blank (`STORAGE_DRIVER=auto`).

1. Open **Cloudflare Dashboard → R2 Object Storage** and click **Create bucket** (e.g. `bitpredict-media`).
2. Copy your **Cloudflare Account ID** from the right sidebar (`R2_ACCOUNT_ID`).
3. Click **Manage R2 API Tokens → Create API token**, choose **Object Read & Write** scoped to your bucket, and copy **Access Key ID** (`R2_ACCESS_KEY_ID`) and **Secret Access Key** (`R2_SECRET_ACCESS_KEY`).
4. To display images directly from Cloudflare's edge CDN: open **Bucket Settings → Public Development URL** (enable `r2.dev`) or connect a **Custom Domain** (e.g. `https://cdn.yourdomain.com`) and set it as `R2_PUBLIC_URL`.
   - If `R2_PUBLIC_URL` is left blank, BitPredict keeps the bucket private and serves uploaded images through `GET /api/v1/uploads/:filename` using signed R2 requests.
5. Set `STORAGE_DRIVER=r2` if you want to enforce R2 and reject uploads when credentials are missing.

| Variable | Description |
| --- | --- |
| `STORAGE_DRIVER` | `auto` (use R2 when configured, else local disk) or `r2` (strictly require Cloudflare R2). |
| `R2_ACCOUNT_ID` | Cloudflare 32-char Account ID used to build `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. |
| `R2_ACCESS_KEY_ID` | R2 S3 API Token Access Key ID. |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API Token Secret Access Key (backend-only secret). |
| `R2_BUCKET_NAME` | Target Cloudflare R2 bucket name. |
| `R2_PUBLIC_URL` | Optional public `r2.dev` or custom CDN `https://` base URL returned directly after upload. |
| `R2_KEY_PREFIX` | Optional object key prefix inside the bucket (defaults to `markets`). |
| `R2_ENDPOINT` | Optional custom S3 endpoint override (e.g. EU/FedRAMP jurisdiction endpoint). |

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
