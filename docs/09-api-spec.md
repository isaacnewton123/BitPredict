# 09 — API Specification (REST, v1)

Base URL: `/api/v1`. JSON only. Authenticated routes need a session from Nostr login (or a NIP-98 `Authorization: Nostr <base64 event>` header).

## Auth

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/auth/challenge` | – | Returns `{ challenge, expires_at }` |
| POST | `/auth/nostr` | – | Body: signed kind-27235 event. Returns a session |
| POST | `/auth/logout` | ✓ | |
| GET | `/me` | ✓ | `{ pubkey, lightning_address, is_guest }` |
| PATCH | `/me` | ✓ | Set `lightning_address` (validated via LNURL-pay lookup) |

## Markets

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/markets/draft` | ✓ | `{ prompt, timezone }` → `{ draft_id, spec, assumptions, warnings }` |
| PUT | `/markets/draft/:draft_id` | ✓ | Edited spec, revalidated |
| POST | `/markets` | ✓ | `{ draft_id, creator_signature_event }` → publishes. Returns market + Nostr ids |
| GET | `/markets` | – | Query: `category`, `status`, `track`, `sort=trending|closing|new`, `cursor` |
| GET | `/markets/:id` | – | Spec, pools, implied probability, status, outcome, proofs |
| GET | `/markets/:id/stream` | – | SSE: pool updates, status changes |
| GET | `/markets/:id/insight` | – | Optional AI insight card (cached) |
| GET | `/markets/:id/proof` | – | Track A raw proof + hash / Track B attestation + disputes |

### Example: `POST /markets/draft`

```http
POST /api/v1/markets/draft
{ "prompt": "Will the maximum temperature in Washington city reach 19°C tomorrow?", "timezone": "America/New_York" }
```

```json
{
  "draft_id": "d_7f3a",
  "spec": { "...": "MarketSpec, see 04-ai-market-creator.md" },
  "assumptions": ["'Washington' interpreted as Washington, D.C., USA"],
  "warnings": []
}
```

## Bets

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/markets/:id/bets` | ✓ | `{ side: "YES"|"NO", amount_sats }` → `{ bet_id, bolt11, payment_hash, expires_at }` |
| GET | `/bets/:bet_id` | ✓ | Status: `PENDING|CONFIRMED|EXPIRED|LATE|REFUNDED` |
| GET | `/me/positions` | ✓ | All positions + potential/actual payouts |

## Oracle (Track B)

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/oracle/queue` | signer | Markets in `PENDING_RESOLUTION` + AI evidence summary |
| POST | `/markets/:id/proposals` | signer | `{ nostr_event }` (kind 30079 signed). Returns `{ proposal_id, challenge_ends_at, bond_invoice? }` |
| POST | `/markets/:id/disputes` | ✓ | `{ nostr_event }` → `{ dispute_id, bond_invoice }` |
| POST | `/admin/disputes/:id/rule` | admin | `{ outcome: YES|NO|INVALID }` |

## Payouts

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/me/payouts` | ✓ | List with status |
| POST | `/payouts/:id/claim` | ✓ | `{ bolt11 }` for `CLAIMABLE` payouts (amount must match) |
| GET | `/payouts/:id/lnurlw` | ✓ | LNURL-withdraw for claimable payouts |

## Webhooks (internal)

| Method | Path | Source | Description |
| --- | --- | --- | --- |
| POST | `/webhooks/lnbits` | LNbits | `{ payment_hash }`. Backend re-verifies with LNbits, idempotent |

## Errors

```json
{ "error": { "code": "MARKET_CLOSED", "message": "Betting cutoff has passed." } }
```

| Code | HTTP |
| --- | --- |
| `UNAUTHORIZED` | 401 |
| `VALIDATION_FAILED` | 422 |
| `AI_SPEC_REJECTED` | 422 (includes reason) |
| `MARKET_CLOSED` | 409 |
| `BET_LIMIT` | 422 |
| `SIGNER_NOT_AUTHORIZED` | 403 |
| `RATE_LIMITED` | 429 |

## Rate Limits (MVP)

- `/markets/draft`: 10/min per pubkey (LLM cost)
- `/markets/:id/bets`: 30/min per pubkey
- Public GETs: 120/min per IP
