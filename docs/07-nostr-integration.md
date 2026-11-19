# 07 — Nostr Integration

## 1. NIPs Used

| NIP | Purpose |
| --- | --- |
| **NIP-01** | Base event format, signing, relays |
| **NIP-07** | Browser extension login (`window.nostr.getPublicKey()`, `signEvent`) via Alby, nos2x |
| **NIP-19** | `npub` / `nevent` / `naddr` encoding for share links |
| **NIP-98** | HTTP auth: the client signs kind `27235` events to authenticate API calls |
| **NIP-47** | Nostr Wallet Connect: `pay_invoice`, `make_invoice`, `get_info` |
| **NIP-57** | (Optional) zaps on market notes for tipping creators |
| **NIP-78** | Addressable app-specific data (kind `30078`) for structured market specs |
| **NIP-10** | Reply threading, so discussion and attestations reply to the market note |

## 2. Login

1. Client calls `GET /auth/challenge` → `{ challenge, expires_at }`.
2. Client signs a kind `27235` event with the tags `["u", "<api-url>/auth/nostr"]`, `["method","POST"]`, `["challenge", "<challenge>"]`.
3. Backend verifies the signature, the challenge freshness (≤ 60 s), and the URL, then issues a session (HTTP-only cookie, JWT with `sub = pubkey hex`).
4. **Guest mode:** the client generates a keypair (`generateSecretKey()`) and keeps it in `localStorage`, with a warning to back it up. Guest users must set a Lightning Address to receive payouts.

## 3. Event Types Published

All kind numbers below except 1 and 30078 are **proposals** for this app. Check that they don't collide before production.

### 3.1 Market announcement (social): kind `1`

```json
{
  "kind": 1,
  "content": "🔮 New market: Washington, D.C. max temperature ≥ 19°C on Nov 20, 2026?\nYES 50% · Bet in sats ⚡ https://app.example/m/abc123\n#predictionmarket #weather",
  "tags": [
    ["t", "predictionmarket"], ["t", "weather"],
    ["a", "30078:<platform_pubkey>:market:abc123"],
    ["r", "https://app.example/m/abc123"]
  ]
}
```

### 3.2 Market spec (structured, addressable): kind `30078`

```json
{
  "kind": 30078,
  "tags": [
    ["d", "market:abc123"],
    ["category", "Weather"],
    ["track", "auto_api"],
    ["cutoff", "1795150800"],
    ["deadline", "1795237199"],
    ["spec_sha256", "<hash of canonical MarketSpec JSON>"],
    ["p", "<creator_pubkey>"]
  ],
  "content": "<canonical MarketSpec JSON>"
}
```

Signed by the platform key, so anyone can check that the spec never changed after publishing (`spec_sha256`). The creator's pubkey is referenced with `p`, and their own signed publish request is stored in the DB.

### 3.3 Outcome attestation: proposed kind `30079`

```json
{
  "kind": 30079,
  "tags": [
    ["d", "outcome:abc123"],
    ["a", "30078:<platform_pubkey>:market:abc123"],
    ["e", "<market_note_id>", "", "root"],
    ["outcome", "YES"],
    ["spec_sha256", "<hash>"],
    ["proof_sha256", "<sha256 of raw API body>"],
    ["proof", "https://api.open-meteo.com/v1/forecast?..."],
    ["track", "auto_api"]
  ],
  "content": "Resolved YES: temperature_2m_max = 19.4°C (≥ 19.0)."
}
```

- Track A: signed by the **platform oracle key**.
- Track B: signed by the **signer's own key**. The backend checks that the pubkey is on the allowlist for the market's `signer_policy`.

### 3.4 Dispute: proposed kind `30080`

Tags: `a` (market), `e` (attestation being disputed), `bond_payment_hash`, `proof` URLs.

### 3.5 Settlement note: kind `1` reply

A reply to the market note with totals (pool sizes, winners count, total paid, fee) and a link to the proof page.

## 4. Relays

- Publish to ≥ 3 relays (e.g., `wss://relay.damus.io`, `wss://nos.lol`, `wss://relay.nostr.band`) plus an optional self-hosted relay.
- The DB stays the source of truth. Relays are for distribution and public auditability.
- Subscribe to replies (`#e` = market note id) to show discussion in the market page.

## 5. Keys

| Key | Storage | Use |
| --- | --- | --- |
| Platform publisher key | Server secret (env / KMS) | Market specs, announcements |
| Platform oracle key | Separate server secret | Track A attestations |
| Signer keys | Signer's own NIP-07 extension | Track B attestations |
| User keys | User's extension / guest localStorage | Login, publish request, disputes |
