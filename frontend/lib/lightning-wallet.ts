import * as nip04 from "nostr-tools/nip04";
import * as nip44 from "nostr-tools/nip44";
import { finalizeEvent, type Event } from "nostr-tools/pure";
import { Relay } from "nostr-tools/relay";

declare global {
  interface Window {
    webln?: {
      enable(): Promise<void>;
      getInfo?(): Promise<{ node?: { alias?: string; pubkey?: string } }>;
      makeInvoice(args: {
        amount?: number | string;
        defaultMemo?: string;
      }): Promise<{ paymentRequest: string }>;
      sendPayment(paymentRequest: string): Promise<{ preimage: string }>;
    };
  }
}

export type ConnectedLightningWallet =
  | { kind: "webln"; label: string }
  | {
      kind: "nwc";
      label: string;
      walletPubkey: string;
      relayUrl: string;
      secretHex: string;
      lud16?: string;
      encryption: "nip44_v2" | "nip04";
    };

const WALLET_STORAGE_KEY = "bp_ln_wallet_v1";
const DEFAULT_NOSTR_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.primal.net",
];

let cachedRawWallet: string | null = null;
let cachedParsedWallet: ConnectedLightningWallet | null = null;
const listeners = new Set<() => void>();

function notifyWalletListeners(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** Subscribes to local Lightning wallet changes across this tab and storage events. */
export function subscribeWallet(listener: () => void): () => void {
  listeners.add(listener);
  if (typeof window === "undefined") {
    return () => listeners.delete(listener);
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === WALLET_STORAGE_KEY) {
      notifyWalletListeners();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** SSR snapshot for hydration-safe external store subscriptions. */
export function getServerWalletSnapshot(): ConnectedLightningWallet | null {
  return null;
}

/** Reads the currently persisted client-side Lightning wallet without breaking SSR hydration. */
export function getConnectedWallet(): ConnectedLightningWallet | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(WALLET_STORAGE_KEY);
  if (raw === cachedRawWallet) {
    return cachedParsedWallet;
  }
  cachedRawWallet = raw;
  if (!raw) {
    cachedParsedWallet = null;
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as ConnectedLightningWallet;
    if (parsed && (parsed.kind === "webln" || parsed.kind === "nwc")) {
      cachedParsedWallet = parsed;
      return cachedParsedWallet;
    }
  } catch {
    // ignore malformed persisted state
  }
  cachedParsedWallet = null;
  return null;
}

function persistConnectedWallet(wallet: ConnectedLightningWallet | null): void {
  if (typeof window === "undefined") return;
  if (wallet) {
    const raw = JSON.stringify(wallet);
    window.localStorage.setItem(WALLET_STORAGE_KEY, raw);
    cachedRawWallet = raw;
    cachedParsedWallet = wallet;
  } else {
    window.localStorage.removeItem(WALLET_STORAGE_KEY);
    cachedRawWallet = null;
    cachedParsedWallet = null;
  }
  notifyWalletListeners();
}

/** Disconnects the saved WebLN or NWC Lightning wallet from this browser. */
export function disconnectLightningWallet(): void {
  persistConnectedWallet(null);
}

/** Returns true if a browser WebLN provider (e.g., Alby) is injected. */
export function isWebLnAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.webln);
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.trim().toLowerCase();
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

/** Connects to a browser WebLN provider and stores it locally for 1-click claims & payments. */
export async function connectWebLnWallet(): Promise<ConnectedLightningWallet> {
  if (typeof window === "undefined" || !window.webln) {
    throw new Error(
      "No WebLN browser extension detected. Install a WebLN wallet like Alby or connect via NWC.",
    );
  }
  await window.webln.enable();
  let label = "Browser WebLN Wallet";
  try {
    const info = await window.webln.getInfo?.();
    const alias = info?.node?.alias?.trim();
    if (alias) label = alias;
  } catch {
    // getInfo is optional on some WebLN providers
  }
  const wallet: ConnectedLightningWallet = { kind: "webln", label };
  persistConnectedWallet(wallet);
  return wallet;
}

/** Parses and validates a NIP-47 `nostr+walletconnect://` connection URI. */
export function parseNwcUri(rawUri: string): {
  walletPubkey: string;
  relayUrl: string;
  secretHex: string;
  lud16?: string;
} {
  const trimmed = rawUri.trim();
  if (!/^nostr\+walletconnect:\/\//i.test(trimmed)) {
    throw new Error("Connection string must start with nostr+walletconnect://");
  }
  // Replace custom scheme temporarily so URL parser handles host + query params consistently
  const normalized = trimmed.replace(/^nostr\+walletconnect:\/\//i, "https://");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error("Malformed Nostr Wallet Connect URI.");
  }

  const walletPubkey = url.hostname.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(walletPubkey)) {
    throw new Error("NWC URI contains an invalid wallet pubkey.");
  }

  const relayUrl = url.searchParams.get("relay")?.trim() ?? "";
  if (!/^wss?:\/\/.+/i.test(relayUrl)) {
    throw new Error("NWC URI must include a valid wss:// relay parameter.");
  }

  const secretHex = url.searchParams.get("secret")?.trim().toLowerCase() ?? "";
  if (!/^[0-9a-f]{64}$/.test(secretHex)) {
    throw new Error("NWC URI contains an invalid secret key.");
  }

  const lud16Raw = url.searchParams.get("lud16")?.trim();
  const lud16 =
    lud16Raw && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(lud16Raw) ? lud16Raw : undefined;

  return { walletPubkey, relayUrl, secretHex, lud16 };
}

async function detectNwcEncryption(
  relay: Relay,
  walletPubkey: string,
): Promise<"nip44_v2" | "nip04"> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (enc: "nip44_v2" | "nip04") => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub.close();
      resolve(enc);
    };

    const timer = setTimeout(() => done("nip04"), 2500);
    const sub = relay.subscribe(
      [{ kinds: [13194], authors: [walletPubkey], limit: 1 }],
      {
        eoseTimeout: 2000,
        onevent(evt: Event) {
          const encTag = evt.tags.find((t) => t[0] === "encryption")?.[1] ?? "";
          if (encTag.split(/\s+/).includes("nip44_v2")) {
            done("nip44_v2");
          } else {
            done("nip04");
          }
        },
        oneose() {
          done("nip04");
        },
      },
    );
  });
}

/** Sends a NIP-47 request event over the wallet's NWC relay and awaits its encrypted response. */
export async function sendNwcRpc<TResult = Record<string, unknown>>(
  wallet: Extract<ConnectedLightningWallet, { kind: "nwc" }>,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 9000,
): Promise<TResult> {
  const relay = await Relay.connect(wallet.relayUrl, { timeout: 6000 });
  const secretBytes = hexToBytes(wallet.secretHex);
  const payload = JSON.stringify({ method, params });
  const encrypted =
    wallet.encryption === "nip44_v2"
      ? nip44.v2.encrypt(
          payload,
          nip44.v2.utils.getConversationKey(secretBytes, wallet.walletPubkey),
        )
      : nip04.encrypt(secretBytes, wallet.walletPubkey, payload);

  const tags: string[][] = [["p", wallet.walletPubkey]];
  if (wallet.encryption === "nip44_v2") {
    tags.push(["encryption", "nip44_v2"]);
  }

  const reqEvent = finalizeEvent(
    {
      kind: 23194,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: encrypted,
    },
    secretBytes,
  );

  const subRef: { current: { close(): void } | null } = { current: null };
  try {
    const responsePromise = new Promise<TResult>((resolve, reject) => {
      let finished = false;
      const timer = setTimeout(() => {
        if (!finished) {
          finished = true;
          reject(new Error(`NWC wallet timed out responding to ${method}.`));
        }
      }, timeoutMs);

      subRef.current = relay.subscribe(
        [
          {
            kinds: [23195],
            authors: [wallet.walletPubkey],
            "#e": [reqEvent.id],
          },
        ],
        {
          onevent(evt: Event) {
            if (finished) return;
            try {
              const rawContent = evt.content;
              const plaintext = rawContent.includes("?iv=")
                ? nip04.decrypt(secretBytes, wallet.walletPubkey, rawContent)
                : nip44.v2.decrypt(
                    rawContent,
                    nip44.v2.utils.getConversationKey(secretBytes, wallet.walletPubkey),
                  );
              const parsed = JSON.parse(plaintext) as {
                result_type?: string;
                result?: TResult;
                error?: { code?: string; message?: string };
              };
              finished = true;
              clearTimeout(timer);
              if (parsed.error) {
                reject(
                  new Error(
                    parsed.error.message ||
                      `NWC error (${parsed.error.code ?? "UNKNOWN"})`,
                  ),
                );
                return;
              }
              resolve((parsed.result ?? {}) as TResult);
            } catch (err) {
              finished = true;
              clearTimeout(timer);
              reject(
                err instanceof Error
                  ? err
                  : new Error("Failed to decrypt NWC wallet response."),
              );
            }
          },
        },
      );
    });

    await relay.publish(reqEvent);
    return await responsePromise;
  } finally {
    subRef.current?.close();
    relay.close();
  }
}

/** Connects and verifies a NIP-47 Nostr Wallet Connect URI, keeping secrets strictly local. */
export async function connectNwcWallet(
  rawUri: string,
): Promise<ConnectedLightningWallet> {
  const parsed = parseNwcUri(rawUri);
  const relay = await Relay.connect(parsed.relayUrl, { timeout: 6000 });
  let encryption: "nip44_v2" | "nip04" = "nip04";
  try {
    encryption = await detectNwcEncryption(relay, parsed.walletPubkey);
  } finally {
    relay.close();
  }

  let relayHost = "NWC Relay";
  try {
    relayHost = new URL(parsed.relayUrl).host;
  } catch {
    // keep default label
  }

  const candidate: Extract<ConnectedLightningWallet, { kind: "nwc" }> = {
    kind: "nwc",
    label: parsed.lud16 || `NWC (${relayHost})`,
    walletPubkey: parsed.walletPubkey,
    relayUrl: parsed.relayUrl,
    secretHex: parsed.secretHex,
    lud16: parsed.lud16,
    encryption,
  };

  try {
    const info = await sendNwcRpc<{ alias?: string }>(candidate, "get_info", {}, 4500);
    if (info?.alias?.trim()) {
      candidate.label = info.alias.trim();
    }
  } catch {
    // Some NWC budgets restrict get_info while still allowing make_invoice / pay_invoice
  }

  persistConnectedWallet(candidate);
  return candidate;
}

/** Requests a BOLT11 receive invoice from the user's connected WebLN or NWC wallet. */
export async function requestInvoiceFromWallet(
  wallet: ConnectedLightningWallet,
  amountSats: number,
  memo: string,
): Promise<{ bolt11: string }> {
  const cleanSats = Math.max(1, Math.floor(amountSats));
  if (wallet.kind === "webln") {
    if (typeof window === "undefined" || !window.webln) {
      throw new Error("WebLN wallet extension is unavailable in this browser.");
    }
    await window.webln.enable();
    const res = await window.webln.makeInvoice({
      amount: cleanSats,
      defaultMemo: memo,
    });
    const invoice = res?.paymentRequest?.trim();
    if (!invoice) {
      throw new Error("WebLN wallet did not return a BOLT11 invoice.");
    }
    return { bolt11: invoice };
  }

  const res = await sendNwcRpc<{ invoice?: string }>(wallet, "make_invoice", {
    amount: cleanSats * 1000,
    description: memo,
  });
  const invoice = res?.invoice?.trim();
  if (!invoice) {
    throw new Error("NWC wallet did not return a BOLT11 invoice.");
  }
  return { bolt11: invoice };
}

/** Pays a BOLT11 invoice via the connected wallet if present; returns null if none connected. */
export async function payInvoiceWithConnectedWallet(
  bolt11: string,
): Promise<{ preimage: string } | null> {
  const wallet = getConnectedWallet();
  if (!wallet) return null;

  if (wallet.kind === "webln") {
    if (typeof window === "undefined" || !window.webln) return null;
    await window.webln.enable();
    const res = await window.webln.sendPayment(bolt11);
    return { preimage: res.preimage ?? "" };
  }

  const res = await sendNwcRpc<{ preimage?: string }>(wallet, "pay_invoice", {
    invoice: bolt11,
  });
  return { preimage: res?.preimage ?? "" };
}

function getConfiguredRelays(): string[] {
  const raw = process.env.NEXT_PUBLIC_NOSTR_RELAYS?.trim();
  if (!raw) return DEFAULT_NOSTR_RELAYS;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^wss?:\/\//i.test(s));
  return list.length > 0 ? list : DEFAULT_NOSTR_RELAYS;
}

/** Fetches the user's `lud16` Lightning Address from their public Nostr `kind 0` metadata. */
export async function fetchNostrProfileLud16(pubkeyHex: string): Promise<string | null> {
  const author = pubkeyHex.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(author)) return null;

  const relays = getConfiguredRelays();
  const queryRelay = async (relayUrl: string): Promise<string | null> => {
    let relay: Relay | null = null;
    const subRef: { current: { close(): void } | null } = { current: null };
    try {
      relay = await Relay.connect(relayUrl, { timeout: 2500 });
      const activeRelay = relay;
      return await new Promise<string | null>((resolve) => {
        let settled = false;
        let latestCreated = -1;
        let latestLud16: string | null = null;

        const finish = (val: string | null) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(val);
        };

        const timer = setTimeout(() => finish(latestLud16), 3000);
        subRef.current = activeRelay.subscribe([{ kinds: [0], authors: [author], limit: 3 }], {
          eoseTimeout: 2200,
          onevent(evt: Event) {
            try {
              const meta = JSON.parse(evt.content) as { lud16?: unknown };
              if (
                typeof meta.lud16 === "string" &&
                /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(meta.lud16.trim()) &&
                evt.created_at >= latestCreated
              ) {
                latestCreated = evt.created_at;
                latestLud16 = meta.lud16.trim();
              }
            } catch {
              // ignore non-JSON kind 0 metadata
            }
          },
          oneose() {
            finish(latestLud16);
          },
        });
      });
    } catch {
      return null;
    } finally {
      subRef.current?.close();
      relay?.close();
    }
  };

  const results = await Promise.all(relays.slice(0, 3).map((u) => queryRelay(u)));
  return results.find((r) => Boolean(r)) ?? null;
}

const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";

function bech32Polymod(values: number[]): number {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk;
}

function bech32HrpExpand(hrp: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) >> 5);
  out.push(0);
  for (let i = 0; i < hrp.length; i++) out.push(hrp.charCodeAt(i) & 31);
  return out;
}

function convertToFiveBitWords(bytes: Uint8Array): number[] {
  const words: number[] = [];
  let acc = 0;
  let bits = 0;
  for (const value of bytes) {
    acc = (acc << 8) | value;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) {
    words.push((acc << (5 - bits)) & 31);
  }
  return words;
}

/** Encodes a plain HTTPS callback URL into an uppercase Bech32 `LNURL1...` string. */
export function encodeLnurlBech32(url: string): string {
  const hrp = "lnurl";
  const data = convertToFiveBitWords(new TextEncoder().encode(url));
  const polymod = bech32Polymod([...bech32HrpExpand(hrp), ...data, 0, 0, 0, 0, 0, 0]) ^ 1;
  const checksum: number[] = [];
  for (let p = 0; p < 6; p++) {
    checksum.push((polymod >> (5 * (5 - p))) & 31);
  }
  const encoded = [...data, ...checksum].map((w) => BECH32_CHARSET[w]).join("");
  return `${hrp}1${encoded}`.toUpperCase();
}
