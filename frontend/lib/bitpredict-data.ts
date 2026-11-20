import * as nip19 from "nostr-tools/nip19";
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate } from "nostr-tools/pure";
import { payInvoiceWithConnectedWallet } from "./lightning-wallet";

export type OracleTrack = "auto_api" | "nostr_oracle";
export type MarketSide = "YES" | "NO";
export type MarketOutcome = "YES" | "NO" | "INVALID" | null;
export type AppView =
  | "markets"
  | "market-detail"
  | "creator"
  | "oracle"
  | "positions"
  | "how-it-works"
  | "admin";

export type CategoryId =
  | "All"
  | "Sports"
  | "Politics"
  | "Crypto"
  | "Esports"
  | "Finance"
  | "Technology"
  | "Economy"
  | "Culture"
  | "Weather";

export interface CategoryMeta {
  id: CategoryId;
  slug: string;
  label: string;
}

export const CATEGORIES: readonly CategoryMeta[] = [
  { id: "All", slug: "all", label: "All" },
  { id: "Sports", slug: "sports", label: "Sports" },
  { id: "Politics", slug: "politics", label: "Politics" },
  { id: "Crypto", slug: "crypto", label: "Crypto" },
  { id: "Esports", slug: "esports", label: "Esports" },
  { id: "Finance", slug: "finance", label: "Finance" },
  { id: "Technology", slug: "technology", label: "Technology" },
  { id: "Economy", slug: "economy", label: "Economy" },
  { id: "Culture", slug: "culture", label: "Culture" },
  { id: "Weather", slug: "weather", label: "Weather" },
] as const;

export function categoryFromSlug(slug: string): CategoryId {
  const lower = slug.toLowerCase();
  const match = CATEGORIES.find((c) => c.slug === lower || c.id.toLowerCase() === lower);
  return match ? match.id : "All";
}

export interface MarketInsightData {
  summary: string;
  data_points: Array<{ label: string; value: string }>;
  sources: string[];
  disclaimer: string;
  model: string;
  generated_at?: string;
}

export interface OracleProofRecord {
  id: string;
  provider: string;
  url: string;
  httpStatus: number | null;
  body: unknown;
  bodySha256: string | null;
  value: string | null;
  fetchedAt: string;
}

export interface TrackBProposalRecord {
  id: string;
  signerPubkey: string;
  outcome: string;
  proofUrls: string[];
  challengeEndsAt: string;
  status: string;
  bondMsat: number;
  nostrEvent: { id?: string } | unknown;
}

export interface TrackBDisputeRecord {
  id: string;
  proposalId: string;
  disputerPubkey: string;
  proofUrls: string[];
  status: string;
  createdAt: string;
}

export interface MarketTradePoint {
  t: string;
  yes_pct: number;
  no_pct: number;
  pool_sats: number;
}

export interface MarketTradeItem {
  id: string;
  side: MarketSide;
  amount_sats: number;
  trader_label: string;
  timestamp: string;
  yes_pct_after: number;
  pool_total_sats_after: number;
}

export interface MarketItem {
  id: string;
  slug: string;
  title: string;
  question: string;
  category: Exclude<CategoryId, "All">;
  oracleTrack: OracleTrack;
  oracleLabel: string;
  rules: string;
  imageUrl: string | null;
  deadline: string;
  bettingCutoffIso: string;
  deadlineIso: string;
  yesPool: number;
  noPool: number;
  feeBps: number;
  status: string;
  outcome: MarketOutcome;
  isDemo: boolean;
  specSha256: string;
  nostrNoteId: string;
  spec: Record<string, unknown>;
  oracleConfig: Record<string, unknown>;
}

export interface MarketDetailBundle {
  market: MarketItem;
  insight: MarketInsightData | null;
  proofs: OracleProofRecord[];
  attestationEvent: Record<string, unknown> | null;
  proposals: TrackBProposalRecord[];
  disputes: TrackBDisputeRecord[];
  recentTrades: MarketTradeItem[];
  probabilityHistory: MarketTradePoint[];
  specVerified: boolean;
  computedSha256: string;
}

export interface BackendUserProfile {
  pubkey: string;
  npub: string;
  lightning_address: string | null;
  is_guest: boolean;
  is_admin?: boolean;
  account_mode?: "live" | "demo";
}

export interface UserPositionItem {
  bet_id: string;
  side: MarketSide;
  amount_sats: number;
  status: string;
  paid_at: string | null;
  created_at: string;
  estimated_payout_sats: number | null;
  market: {
    id: string;
    slug: string;
    title: string;
    category: string;
    status: string;
    outcome: string | null;
    isDemo: boolean;
  };
}

export interface UserPayoutItem {
  id: string;
  marketId: string;
  kind: string;
  amount_sats: number;
  status: string;
  attempts: number;
  preimage: string | null;
  lastError: string | null;
  market: {
    id: string;
    slug: string;
    title: string;
    status: string;
    outcome: string | null;
    isDemo: boolean;
  };
}

export interface DraftResponse {
  draft_id: string;
  slug: string;
  spec: Record<string, unknown>;
  spec_sha256: string;
  audit_url: string | null;
  assumptions: string[];
  warnings: string[];
  model?: string;
}

export interface OracleQueueEntry {
  market: MarketItem;
  evidence: {
    summary: string;
    leaning: string;
    sources: string[];
    model: string;
  } | null;
  proposals: TrackBProposalRecord[];
  disputes: TrackBDisputeRecord[];
}

export interface ToastItem {
  id: string;
  title: string;
  subtitle: string;
}

declare global {
  interface Window {
    nostr?: {
      getPublicKey(): Promise<string>;
      signEvent(event: EventTemplate): Promise<EventTemplate & { id: string; pubkey: string; sig: string }>;
    };
  }
}

const TOKEN_STORAGE_KEY = "bp_session_token";
const GUEST_SK_STORAGE_KEY = "bp_guest_sk_hex";
const SIGNER_SK_STORAGE_KEY = "bp_demo_signer_sk_hex";

let cachedMarkets: MarketItem[] | null = null;
let cachedUser: BackendUserProfile | null = null;
let pendingTradeSide: { slug: string; side: MarketSide } | null = null;

export function getCachedMarkets(): MarketItem[] | null {
  return cachedMarkets;
}

export function getCachedUser(): BackendUserProfile | null {
  return cachedUser;
}

export function setPendingTradeSide(slug: string, side: MarketSide): void {
  pendingTradeSide = { slug, side };
}

export function consumePendingTradeSide(slug: string): MarketSide | null {
  return pendingTradeSide && pendingTradeSide.slug === slug
    ? pendingTradeSide.side
    : null;
}

export function getApiBase(): string {
  const raw = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (!raw || raw === "same-origin" || raw === "/") {
    return "";
  }
  return raw.replace(/\/+$/, "");
}

function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

function setStoredToken(token: string | null) {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function getOrCreateLocalKeypair(storageKey: string): { secretKey: Uint8Array; pubkey: string; npub: string } {
  let sk: Uint8Array | null = null;
  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(storageKey);
    if (saved && /^[0-9a-f]{64}$/i.test(saved)) {
      sk = hexToBytes(saved);
    }
  }
  if (!sk) {
    sk = generateSecretKey();
    if (typeof window !== "undefined") {
      window.localStorage.setItem(storageKey, bytesToHex(sk));
    }
  }
  const pubkey = getPublicKey(sk).toLowerCase();
  return {
    secretKey: sk,
    pubkey,
    npub: nip19.npubEncode(pubkey),
  };
}

export function formatSats(num: number): string {
  return Number(num).toLocaleString("en-US");
}

export function formatPubkeyShort(pubkey: string): string {
  const clean = pubkey.trim();
  if (clean.length <= 20) return clean;
  return `${clean.slice(0, 10)}...${clean.slice(-6)}`;
}

export function formatUtcDisplay(iso: string | Date | undefined): string {
  if (!iso) return "TBD UTC";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function getYesProbability(market: Pick<MarketItem, "yesPool" | "noPool">): number {
  const total = market.yesPool + market.noPool;
  if (total <= 0) return 50;
  return Math.round((market.yesPool / total) * 100);
}

export function calculateBetQuote(
  market: Pick<MarketItem, "yesPool" | "noPool" | "feeBps">,
  side: MarketSide,
  amountSats: number,
): { feeSats: number; estPayoutSats: number; multiplier: string } {
  const stakeSats = Math.max(10, Math.floor(amountSats || 0));
  const feeBps = market.feeBps ?? 200;
  const currentWinPool = side === "YES" ? market.yesPool : market.noPool;
  const currentLosePool = side === "YES" ? market.noPool : market.yesPool;
  const winPoolAfter = currentWinPool + stakeSats;
  const profitSats =
    winPoolAfter > 0
      ? Math.floor((stakeSats / winPoolAfter) * currentLosePool * ((10_000 - feeBps) / 10_000))
      : 0;
  const estPayoutSats = stakeSats + profitSats;
  const estFeeSats = Math.round((feeBps / 10_000) * currentLosePool * (stakeSats / Math.max(1, winPoolAfter)));
  const multiplier = stakeSats > 0 ? (estPayoutSats / stakeSats).toFixed(2) : "1.00";
  return { feeSats: estFeeSats, estPayoutSats, multiplier };
}

function sortKeysRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysRecursively);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[k];
      if (v !== undefined) out[k] = sortKeysRecursively(v);
    }
    return out;
  }
  return value;
}

export function canonicalizeJsonBrowser(value: unknown): string {
  return JSON.stringify(sortKeysRecursively(value));
}

export async function sha256HexBrowser(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function resolveMarketImageUrl(
  market: Pick<MarketItem, "imageUrl">,
): string | null {
  const raw = market.imageUrl?.trim();
  if (raw) {
    if (raw.startsWith("/api/v1/uploads/")) {
      return `${getApiBase()}${raw}`;
    }
    if (raw.startsWith("https://")) {
      return raw;
    }
  }
  return null;
}

export function mapBackendMarket(raw: Record<string, unknown>): MarketItem {
  const spec = (raw.spec ?? {}) as Record<string, unknown>;
  const track: OracleTrack = raw.track === "auto_api" ? "auto_api" : "nostr_oracle";
  const yesPool = Math.floor(Number(raw.poolYesMsat ?? 0) / 1000);
  const noPool = Math.floor(Number(raw.poolNoMsat ?? 0) / 1000);
  const deadlineIso = String(spec.deadline_utc ?? raw.deadlineUtc ?? "");
  const cutoffIso = String(spec.betting_cutoff_utc ?? raw.bettingCutoff ?? "");
  const rawImage = typeof spec.image_url === "string" && spec.image_url.trim() ? spec.image_url.trim() : null;

  return {
    id: String(raw.id),
    slug: String(raw.slug),
    title: String(spec.question ?? raw.title ?? ""),
    question: String(spec.question ?? raw.title ?? ""),
    category: String(raw.category ?? "Crypto") as Exclude<CategoryId, "All">,
    oracleTrack: track,
    oracleLabel: track === "auto_api" ? "Auto-API" : "Nostr Oracle",
    rules: String(spec.rules ?? ""),
    imageUrl: rawImage,
    deadline: formatUtcDisplay(deadlineIso),
    bettingCutoffIso: cutoffIso,
    deadlineIso,
    yesPool,
    noPool,
    feeBps: Number(raw.feeBps ?? 200),
    status: String(raw.status ?? "OPEN"),
    outcome: (raw.outcome === "YES" || raw.outcome === "NO" || raw.outcome === "INVALID"
      ? raw.outcome
      : null),
    isDemo: Boolean(raw.isDemo),
    specSha256: String(raw.specSha256 ?? ""),
    nostrNoteId: String(raw.nostrNoteId ?? raw.slug),
    spec,
    oracleConfig: (spec.oracle_config ?? {}) as Record<string, unknown>,
  };
}

async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = getApiBase();
  const token = getStoredToken();
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const res = await fetch(`${base}${path}`, {
    ...init,
    headers,
    credentials: "include",
    cache: "no-store",
  });

  const payload = await res.json().catch(() => null);
  if (!res.ok) {
    const msg =
      (payload as { error?: { message?: string }; reason?: string } | null)?.error?.message ??
      (payload as { reason?: string } | null)?.reason ??
      `Request failed (HTTP ${res.status})`;
    const err = new Error(msg) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  return payload as T;
}

export async function fetchMarketsFromBackend(): Promise<MarketItem[]> {
  const res = await apiRequest<{ markets: Array<Record<string, unknown>> }>("/api/v1/markets");
  if (res.markets.length === 0) {
    // Auto-seed showcase demo data in backend database on first run when DB is empty
    await apiRequest("/api/v1/demo/seed", { method: "POST" }).catch(() => null);
    const seeded = await apiRequest<{ markets: Array<Record<string, unknown>> }>("/api/v1/markets");
    cachedMarkets = seeded.markets.map(mapBackendMarket);
    return cachedMarkets;
  }
  cachedMarkets = res.markets.map(mapBackendMarket);
  return cachedMarkets;
}

export async function seedDemoMarketsOnBackend(): Promise<{
  created_markets: number;
  skipped_markets: number;
  markets: MarketItem[];
}> {
  const res = await apiRequest<{ created_markets: number; skipped_markets: number }>(
    "/api/v1/demo/seed",
    { method: "POST" },
  );
  const list = await apiRequest<{ markets: Array<Record<string, unknown>> }>("/api/v1/markets");
  const mapped = list.markets.map(mapBackendMarket);
  cachedMarkets = mapped;
  return {
    created_markets: res.created_markets,
    skipped_markets: res.skipped_markets,
    markets: mapped,
  };
}

export async function fetchMarketDetailBundle(idOrSlug: string): Promise<MarketDetailBundle> {
  const [detailRes, insightRes, proofRes] = await Promise.all([
    apiRequest<{
      market: Record<string, unknown>;
      recent_trades?: MarketTradeItem[];
      probability_history?: MarketTradePoint[];
      spec_verification: { computed_sha256: string; verified: boolean };
    }>(`/api/v1/markets/${encodeURIComponent(idOrSlug)}`),
    apiRequest<{ insight: MarketInsightData }>(
      `/api/v1/markets/${encodeURIComponent(idOrSlug)}/insight`,
    ).catch(() => ({ insight: null })),
    apiRequest<{
      proofs: OracleProofRecord[];
      attestation_event: { event?: Record<string, unknown> } | null;
      proposals: TrackBProposalRecord[];
      disputes: TrackBDisputeRecord[];
    }>(`/api/v1/markets/${encodeURIComponent(idOrSlug)}/proof`).catch(() => ({
      proofs: [],
      attestation_event: null,
      proposals: [],
      disputes: [],
    })),
  ]);

  return {
    market: mapBackendMarket(detailRes.market),
    insight: insightRes.insight,
    proofs: proofRes.proofs ?? [],
    attestationEvent: (proofRes.attestation_event?.event ?? null) as Record<string, unknown> | null,
    proposals: proofRes.proposals ?? [],
    disputes: proofRes.disputes ?? [],
    recentTrades: detailRes.recent_trades ?? [],
    probabilityHistory: detailRes.probability_history ?? [],
    specVerified: detailRes.spec_verification?.verified ?? false,
    computedSha256: detailRes.spec_verification?.computed_sha256 ?? "",
  };
}

export async function getCurrentBackendUser(): Promise<BackendUserProfile | null> {
  if (!getStoredToken()) {
    cachedUser = null;
    return null;
  }
  try {
    const res = await apiRequest<{ user: BackendUserProfile }>("/api/v1/me");
    cachedUser = res.user;
    return res.user;
  } catch {
    setStoredToken(null);
    cachedUser = null;
    return null;
  }
}

export async function loginWithNostrToBackend(
  mode: "live" | "demo" = "demo",
): Promise<{
  user: BackendUserProfile;
  token: string;
}> {
  if (mode === "live") {
    if (typeof window === "undefined" || !window.nostr) {
      throw new Error(
        "No Nostr browser extension (NIP-07) detected. Install Alby or nos2x, or use a Demo Account.",
      );
    }
  }

  const { challenge } = await apiRequest<{ challenge: string }>("/api/v1/auth/challenge");
  const base = getApiBase() || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");
  const authUrl = `${base}/api/v1/auth/nostr`;
  const createdAt = Math.floor(Date.now() / 1000);
  const template: EventTemplate = {
    kind: 27235,
    created_at: createdAt,
    tags: [
      ["method", "POST"],
      ["u", authUrl],
      ["challenge", challenge],
    ],
    content: `BitPredict login challenge: ${challenge}`,
  };

  const isGuest = mode === "demo";
  const signedEvent =
    mode === "live"
      ? await window.nostr!.signEvent(template)
      : finalizeEvent(template, getOrCreateLocalKeypair(GUEST_SK_STORAGE_KEY).secretKey);

  const res = await apiRequest<{ user: BackendUserProfile; token: string }>(
    "/api/v1/auth/nostr",
    {
      method: "POST",
      body: JSON.stringify({ event: signedEvent, is_guest: isGuest }),
    },
  );
  setStoredToken(res.token);
  cachedUser = res.user;
  return res;
}

export async function logoutFromBackend(): Promise<void> {
  await apiRequest("/api/v1/auth/logout", { method: "POST" }).catch(() => null);
  setStoredToken(null);
  cachedUser = null;
}

export async function ensureBackendSession(): Promise<BackendUserProfile> {
  const existing = await getCurrentBackendUser();
  if (existing) return existing;
  throw new Error("Please connect a Live Nostr or Demo Account first.");
}

export async function uploadMarketImage(file: File): Promise<{
  url: string;
  filename: string;
  key?: string;
  storage?: "r2" | "local";
  mime: string;
  size: number;
}> {
  await ensureBackendSession();
  const form = new FormData();
  form.append("file", file);
  return apiRequest<{
    url: string;
    filename: string;
    key?: string;
    storage?: "r2" | "local";
    mime: string;
    size: number;
  }>("/api/v1/uploads/market-image", {
    method: "POST",
    body: form,
  });
}

export async function createBackendMarketDraft(
  prompt: string,
  timezone?: string,
  imageUrl?: string,
): Promise<DraftResponse> {
  await ensureBackendSession();
  return apiRequest<DraftResponse>("/api/v1/markets/draft", {
    method: "POST",
    body: JSON.stringify({
      prompt,
      timezone,
      ...(imageUrl?.trim() ? { image_url: imageUrl.trim() } : {}),
    }),
  });
}

export async function updateBackendMarketDraftSpec(
  draftId: string,
  spec: Record<string, unknown>,
): Promise<DraftResponse> {
  await ensureBackendSession();
  return apiRequest<DraftResponse>(`/api/v1/markets/draft/${encodeURIComponent(draftId)}`, {
    method: "PUT",
    body: JSON.stringify({ spec }),
  });
}

export async function publishBackendMarketDraft(
  draftId: string,
): Promise<{ market: MarketItem }> {
  await ensureBackendSession();
  const res = await apiRequest<{ market: Record<string, unknown> }>("/api/v1/markets", {
    method: "POST",
    body: JSON.stringify({ draft_id: draftId }),
  });
  return { market: mapBackendMarket(res.market) };
}

export type PlaceBetOutcome =
  | {
      status: "settled";
      bet_id: string;
      payment_hash: string;
      pool_yes_msat: number;
      pool_no_msat: number;
      simulated: boolean;
    }
  | {
      status: "awaiting_payment";
      bet_id: string;
      payment_hash: string;
      bolt11: string;
      expires_at: string;
      qr_data_url: string | null;
      simulated: false;
    };

export async function confirmBackendBet(betId: string): Promise<{
  status: string;
  idempotent: boolean;
  pool_yes_msat: number;
  pool_no_msat: number;
}> {
  return apiRequest(`/api/v1/bets/${encodeURIComponent(betId)}/confirm`, {
    method: "POST",
  });
}

export async function placeAndSettleBackendBet(opts: {
  marketId: string;
  side: MarketSide;
  amountSats: number;
}): Promise<PlaceBetOutcome> {
  await ensureBackendSession();
  const order = await apiRequest<{
    bet_id: string;
    payment_hash: string;
    bolt11: string;
    expires_at: string;
    simulated: boolean;
    qr_data_url?: string | null;
  }>(`/api/v1/markets/${encodeURIComponent(opts.marketId)}/bets`, {
    method: "POST",
    body: JSON.stringify({ side: opts.side, amount_sats: opts.amountSats }),
  });

  if (order.simulated) {
    const confirmed = await confirmBackendBet(order.bet_id);
    return {
      status: "settled",
      bet_id: order.bet_id,
      payment_hash: order.payment_hash,
      pool_yes_msat: confirmed.pool_yes_msat,
      pool_no_msat: confirmed.pool_no_msat,
      simulated: true,
    };
  }

  const walletPaid = order.bolt11
    ? await payInvoiceWithConnectedWallet(order.bolt11)
    : null;

  if (walletPaid !== null) {
    const confirmed = await confirmBackendBet(order.bet_id);
    return {
      status: "settled",
      bet_id: order.bet_id,
      payment_hash: order.payment_hash,
      pool_yes_msat: confirmed.pool_yes_msat,
      pool_no_msat: confirmed.pool_no_msat,
      simulated: false,
    };
  }

  return {
    status: "awaiting_payment",
    bet_id: order.bet_id,
    payment_hash: order.payment_hash,
    bolt11: order.bolt11,
    expires_at: order.expires_at,
    qr_data_url: order.qr_data_url ?? null,
    simulated: false,
  };
}

export async function fetchUserPositionsAndPayouts(): Promise<{
  positions: UserPositionItem[];
  payouts: UserPayoutItem[];
}> {
  const user = await getCurrentBackendUser();
  if (!user) return { positions: [], payouts: [] };

  const [posRes, payRes] = await Promise.all([
    apiRequest<{ positions: Array<Record<string, unknown>> }>("/api/v1/me/positions"),
    apiRequest<{ payouts: Array<Record<string, unknown>> }>("/api/v1/me/payouts"),
  ]);

  const positions: UserPositionItem[] = posRes.positions.map((p) => {
    const mkt = (p.market ?? {}) as Record<string, unknown>;
    return {
      bet_id: String(p.bet_id),
      side: (p.side === "NO" ? "NO" : "YES") as MarketSide,
      amount_sats: Math.floor(Number(p.amount_msat ?? 0) / 1000),
      status: String(p.status ?? "CONFIRMED"),
      paid_at: p.paid_at ? formatUtcDisplay(String(p.paid_at)) : null,
      created_at: formatUtcDisplay(String(p.created_at)),
      estimated_payout_sats:
        p.estimated_payout_msat != null
          ? Math.floor(Number(p.estimated_payout_msat) / 1000)
          : null,
      market: {
        id: String(mkt.id ?? ""),
        slug: String(mkt.slug ?? ""),
        title: String(mkt.title ?? ""),
        category: String(mkt.category ?? ""),
        status: String(mkt.status ?? ""),
        outcome: mkt.outcome ? String(mkt.outcome) : null,
        isDemo: Boolean(mkt.isDemo),
      },
    };
  });

  const payouts: UserPayoutItem[] = payRes.payouts.map((p) => {
    const mkt = (p.market ?? {}) as Record<string, unknown>;
    return {
      id: String(p.id),
      marketId: String(p.marketId ?? ""),
      kind: String(p.kind ?? "WIN"),
      amount_sats: Math.floor(Number(p.amountMsat ?? 0) / 1000),
      status: String(p.status ?? "QUEUED"),
      attempts: Number(p.attempts ?? 0),
      preimage: p.preimage ? String(p.preimage) : null,
      lastError: p.lastError ? String(p.lastError) : null,
      market: {
        id: String(mkt.id ?? ""),
        slug: String(mkt.slug ?? ""),
        title: String(mkt.title ?? ""),
        status: String(mkt.status ?? ""),
        outcome: mkt.outcome ? String(mkt.outcome) : null,
        isDemo: Boolean(mkt.isDemo),
      },
    };
  });

  return { positions, payouts };
}

export async function updateBackendLightningAddress(
  lightningAddress: string | null,
): Promise<{ user: BackendUserProfile; verified_remote: boolean; warning: string | null }> {
  await ensureBackendSession();
  return apiRequest("/api/v1/me", {
    method: "PATCH",
    body: JSON.stringify({ lightning_address: lightningAddress }),
  });
}

export function getPayoutLnurlWithdrawUrl(payoutId: string): string {
  const base =
    getApiBase() ||
    (typeof window !== "undefined" ? window.location.origin : "http://localhost:3001");
  return `${base}/api/v1/payouts/${encodeURIComponent(payoutId)}/lnurlw`;
}

export async function claimBackendPayout(payoutId: string, bolt11?: string): Promise<void> {
  await ensureBackendSession();
  const cleanBolt11 = bolt11?.trim();
  await apiRequest(`/api/v1/payouts/${encodeURIComponent(payoutId)}/claim`, {
    method: "POST",
    body: JSON.stringify(cleanBolt11 ? { bolt11: cleanBolt11 } : {}),
  });
}

export async function fetchOracleQueueFromBackend(): Promise<OracleQueueEntry[]> {
  const res = await apiRequest<{
    queue: Array<{
      market: Record<string, unknown>;
      evidence: OracleQueueEntry["evidence"];
      proposals: TrackBProposalRecord[];
      disputes: TrackBDisputeRecord[];
    }>;
  }>("/api/v1/oracle/queue?include_open=true");

  return res.queue.map((q) => ({
    market: mapBackendMarket(q.market),
    evidence: q.evidence,
    proposals: q.proposals ?? [],
    disputes: q.disputes ?? [],
  }));
}

export async function runBackendTrackAResolve(marketId: string): Promise<{
  market: MarketItem;
  proof: OracleProofRecord;
}> {
  const res = await apiRequest<{
    market: Record<string, unknown>;
    proof: OracleProofRecord;
  }>("/api/v1/oracle/tick", {
    method: "POST",
    body: JSON.stringify({ market_id: marketId, force_demo_resolve: true }),
  });
  return { market: mapBackendMarket(res.market), proof: res.proof };
}

export async function submitBackendTrackBProposal(
  market: MarketItem,
  outcome: "YES" | "NO",
): Promise<void> {
  // Uses a dedicated local signer keypair in DEMO_MODE so it stays distinct from bettor pubkeys
  const signer = getOrCreateLocalKeypair(SIGNER_SK_STORAGE_KEY);
  const sources = (market.oracleConfig.suggested_sources as string[] | undefined) ?? [];
  const validProofUrl =
    sources.find((s) => /^https?:\/\//i.test(s)) ??
    `https://bitpredict.local/proof/${encodeURIComponent(market.slug)}`;

  const event = finalizeEvent(
    {
      kind: 30079,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["d", `outcome:${market.slug}`],
        ["outcome", outcome],
        ["spec_sha256", market.specSha256],
        ["proof", validProofUrl],
      ],
      content: `Proposed ${outcome} for ${market.slug}`,
    },
    signer.secretKey,
  );

  await apiRequest(`/api/v1/markets/${encodeURIComponent(market.id)}/proposals`, {
    method: "POST",
    body: JSON.stringify({ nostr_event: event, force_ready_in_demo: true }),
  });
}

export async function finalizeBackendTrackBProposal(marketId: string): Promise<void> {
  await apiRequest("/api/v1/oracle/tick", {
    method: "POST",
    body: JSON.stringify({ market_id: marketId, force_finalize_proposal: true }),
  });
}

export async function submitBackendTrackBDispute(
  market: MarketItem,
  proposalEventId: string,
): Promise<void> {
  const current = await ensureBackendSession();
  const template: EventTemplate = {
    kind: 30080,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ["d", `dispute:${market.slug}`],
      ["e", proposalEventId, "", "reply"],
      ["proof", `https://bitpredict.local/dispute/${encodeURIComponent(market.slug)}`],
    ],
    content: "Challenging outcome proposal during optimistic challenge window",
  };

  const event =
    !current.is_guest && typeof window !== "undefined" && window.nostr
      ? await window.nostr.signEvent(template)
      : finalizeEvent(
          template,
          getOrCreateLocalKeypair(GUEST_SK_STORAGE_KEY).secretKey,
        );

  await apiRequest(`/api/v1/markets/${encodeURIComponent(market.id)}/disputes`, {
    method: "POST",
    body: JSON.stringify({ nostr_event: event }),
  });
}

export async function ruleBackendDispute(
  disputeId: string,
  outcome: "YES" | "NO" | "INVALID",
): Promise<{ market: MarketItem }> {
  await ensureBackendSession();
  const res = await apiRequest<{
    market: Record<string, unknown>;
    dispute: TrackBDisputeRecord;
    proposal: TrackBProposalRecord;
  }>(`/api/v1/admin/disputes/${encodeURIComponent(disputeId)}/rule`, {
    method: "POST",
    body: JSON.stringify({ outcome }),
  });
  return { market: mapBackendMarket(res.market) };
}
