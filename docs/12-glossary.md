# 12 — Glossary

| Term | Definition |
| --- | --- |
| **Sats / msat** | Satoshi = 10⁻⁸ BTC. Millisatoshi = 1/1000 sat (Lightning's base unit) |
| **Lightning Network** | Bitcoin layer-2 for instant, low-fee payments using invoices |
| **bolt11** | Standard Lightning invoice string (`lnbc...`) |
| **Payment hash / preimage** | Invoice identifier / secret revealed on payment, which serves as proof of payment |
| **LNbits** | Open-source Lightning wallet/accounts server with a REST API + webhooks. Used as the platform escrow |
| **Lightning Address** | Email-like address (`name@domain`) that resolves to LNURL-pay for receiving payments |
| **LNURL-pay / LNURL-withdraw** | Protocols to request an invoice from a receiver / let a user pull funds |
| **NWC (NIP-47)** | Nostr Wallet Connect: an app sends wallet commands (pay/make invoice) over Nostr relays |
| **Nostr** | Decentralized protocol of signed JSON events relayed by servers (relays) |
| **npub / nsec** | Bech32-encoded public / secret key (NIP-19) |
| **NIP-07** | Browser extension API (`window.nostr`) for signing without exposing the private key |
| **NIP-98** | HTTP authentication using a signed Nostr event |
| **Relay** | Server that stores and forwards Nostr events |
| **Parimutuel** | Betting system where all stakes are pooled and winners split the losing pool in proportion to their stake |
| **Implied probability** | `pool_yes / (pool_yes + pool_no)` |
| **Oracle** | Mechanism that reports a real-world outcome to the market |
| **Track A (`auto_api`)** | Deterministic resolution from a public API |
| **Track B (`nostr_oracle`)** | Human/community resolution via signed Nostr attestations |
| **Optimistic oracle** | A proposed outcome is accepted unless disputed within a challenge window |
| **Challenge window** | Period during which a proposed outcome can be disputed |
| **Bond** | Sats staked by a proposer/disputer, lost if they turn out to be wrong |
| **Betting cutoff** | Last moment bets are accepted. Must be before the outcome is knowable |
| **Deadline (UTC)** | Moment the measured value is defined |
| **Settle delay** | Wait after deadline for data to finalize |
| **VOID** | Market cancelled; all stakes refunded |
| **MarketSpec** | Validated JSON definition of a market produced by the AI creator |
| **Provider Registry** | Server-side allowlist of oracle data sources and request builders |
| **Spec hash** | SHA-256 of canonical MarketSpec JSON, committed in Nostr to prove the spec never changed |
