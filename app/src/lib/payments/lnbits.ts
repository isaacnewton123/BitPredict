import { createHash, randomBytes } from "node:crypto";
import { isBlockedHost } from "@/lib/auth/lightning-address";
import type { FetchLike } from "@/lib/domain/constants";

export interface SettlementConfig {
  platformFeeBps: number;
  payoutMaxRetries: number;
}

export function getSettlementConfig(): SettlementConfig {
  const feeRaw = Number(process.env.PLATFORM_FEE_BPS);
  const retryRaw = Number(process.env.PAYOUT_MAX_RETRIES);
  return {
    platformFeeBps: Number.isFinite(feeRaw) && feeRaw >= 0 && feeRaw <= 2000 ? Math.floor(feeRaw) : 200,
    payoutMaxRetries: Number.isFinite(retryRaw) && retryRaw >= 1 && retryRaw <= 10 ? Math.floor(retryRaw) : 3,
  };
}

export interface BetLimits {
  minBetSats: number;
  maxBetSats: number;
  invoiceExpirySec: number;
}

export function getBetLimits(): BetLimits {
  const parseNum = (raw: string | undefined, fallback: number, min: number) => {
    const n = Number(raw);
    return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
  };
  return {
    minBetSats: parseNum(process.env.MIN_BET_SATS, 10, 1),
    maxBetSats: parseNum(process.env.MAX_BET_SATS, 100_000, 10),
    invoiceExpirySec: parseNum(process.env.INVOICE_EXPIRY_SEC, 600, 30),
  };
}

export interface CreatedInvoice {
  paymentHash: string;
  bolt11: string;
  simulated: boolean;
}

export async function createLightningInvoice(opts: {
  amountSats: number;
  memo: string;
  expirySec: number;
  webhookUrl?: string;
  fetchFn?: FetchLike;
}): Promise<CreatedInvoice> {
  const baseUrl = process.env.LNBITS_URL?.trim().replace(/\/+$/, "");
  const invoiceKey = process.env.LNBITS_INVOICE_KEY?.trim();

  if (baseUrl && invoiceKey) {
    const fetchImpl = opts.fetchFn ?? fetch;
    const res = await fetchImpl(`${baseUrl}/api/v1/payments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": invoiceKey,
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        out: false,
        amount: opts.amountSats,
        memo: opts.memo.slice(0, 120),
        expiry: opts.expirySec,
        webhook: opts.webhookUrl,
      }),
    });

    if (!res.ok) {
      throw new Error(`LNbits invoice creation failed (HTTP ${res.status})`);
    }

    const data = (await res.json()) as {
      payment_hash?: string;
      payment_request?: string;
      bolt11?: string;
    };
    const bolt11 = data.payment_request ?? data.bolt11;
    if (!data.payment_hash || !bolt11) {
      throw new Error("LNbits returned incomplete invoice payload");
    }

    return {
      paymentHash: data.payment_hash,
      bolt11,
      simulated: false,
    };
  }

  if (process.env.DEMO_MODE === "false") {
    throw new Error("LNBITS_URL and LNBITS_INVOICE_KEY must be configured when DEMO_MODE is disabled");
  }

  const paymentHash = randomBytes(32).toString("hex");
  return {
    paymentHash,
    bolt11: `lnbcsim${opts.amountSats}0n1p${paymentHash.slice(0, 24)}`,
    simulated: true,
  };
}

export interface VerifyPaymentResult {
  paid: boolean;
  preimage?: string;
}

export async function verifyLightningPayment(
  paymentHash: string,
  opts: { bolt11?: string; fetchFn?: FetchLike } = {},
): Promise<VerifyPaymentResult> {
  const baseUrl = process.env.LNBITS_URL?.trim().replace(/\/+$/, "");
  const invoiceKey = process.env.LNBITS_INVOICE_KEY?.trim();

  if (baseUrl && invoiceKey) {
    const fetchImpl = opts.fetchFn ?? fetch;
    const res = await fetchImpl(`${baseUrl}/api/v1/payments/${encodeURIComponent(paymentHash)}`, {
      method: "GET",
      headers: { "X-Api-Key": invoiceKey },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      return { paid: false };
    }
    const data = (await res.json()) as { paid?: boolean; preimage?: string };
    return {
      paid: data.paid === true,
      preimage: typeof data.preimage === "string" ? data.preimage : undefined,
    };
  }

  if (opts.bolt11?.startsWith("lnbcsim") && process.env.DEMO_MODE !== "false") {
    const preimage = createHash("sha256").update(`sim:${paymentHash}`).digest("hex");
    return { paid: true, preimage };
  }

  return { paid: false };
}

export type RequestLnurlInvoiceResult =
  | { ok: true; bolt11: string; simulated: boolean }
  | { ok: false; error: string };

export async function requestInvoiceFromLightningAddress(
  address: string,
  amountMsat: number,
  opts: { fetchFn?: FetchLike } = {},
): Promise<RequestLnurlInvoiceResult> {
  const normalized = address.trim().toLowerCase();
  const [user, domain] = normalized.split("@");
  if (!user || !domain || isBlockedHost(domain)) {
    return { ok: false, error: "Invalid or blocked Lightning Address" };
  }
  if (!Number.isInteger(amountMsat) || amountMsat < 1000) {
    return { ok: false, error: "Payout amount is below 1 satoshi minimum" };
  }

  const baseUrl = process.env.LNBITS_URL?.trim();
  const adminKey = process.env.LNBITS_ADMIN_KEY?.trim();
  const useRemote =
    Boolean(opts.fetchFn) ||
    (Boolean(baseUrl && adminKey) && !domain.endsWith(".test") && !domain.endsWith(".example"));

  if (useRemote) {
    const fetchImpl = opts.fetchFn ?? fetch;
    try {
      const metaRes = await fetchImpl(
        `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(6_000),
        },
      );
      if (!metaRes.ok) {
        return { ok: false, error: `LNURL lookup failed (HTTP ${metaRes.status})` };
      }
      const meta = (await metaRes.json()) as {
        tag?: string;
        callback?: string;
        minSendable?: number;
        maxSendable?: number;
      };
      if (meta.tag !== "payRequest" || typeof meta.callback !== "string") {
        return { ok: false, error: "Invalid LNURL payRequest metadata" };
      }
      const cbUrl = new URL(meta.callback);
      if (cbUrl.protocol !== "https:" || isBlockedHost(cbUrl.hostname)) {
        return { ok: false, error: "Unsafe LNURL callback URL" };
      }
      if (
        typeof meta.minSendable === "number" &&
        typeof meta.maxSendable === "number" &&
        (amountMsat < meta.minSendable || amountMsat > meta.maxSendable)
      ) {
        return { ok: false, error: "Payout amount outside receiver LNURL bounds" };
      }

      const sep = meta.callback.includes("?") ? "&" : "?";
      const invRes = await fetchImpl(`${meta.callback}${sep}amount=${amountMsat}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      });
      if (!invRes.ok) {
        return { ok: false, error: `LNURL callback failed (HTTP ${invRes.status})` };
      }
      const invBody = (await invRes.json()) as { pr?: string; reason?: string };
      if (typeof invBody.pr !== "string" || !invBody.pr.trim()) {
        return { ok: false, error: invBody.reason ?? "LNURL callback returned no invoice" };
      }
      return { ok: true, bolt11: invBody.pr.trim(), simulated: false };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "LNURL request failed" };
    }
  }

  if (process.env.DEMO_MODE === "false") {
    return { ok: false, error: "LNBITS_URL and LNBITS_ADMIN_KEY must be configured for payouts" };
  }

  const hash = createHash("sha256").update(`out:${normalized}:${amountMsat}:${Date.now()}`).digest("hex");
  return {
    ok: true,
    bolt11: `lnbcsimout${Math.floor(amountMsat / 1000)}0n1p${hash.slice(0, 24)}`,
    simulated: true,
  };
}

export type PayInvoiceResult =
  | { ok: true; paymentHash: string; preimage: string; simulated: boolean }
  | { ok: false; error: string };

export async function payLightningInvoice(
  bolt11: string,
  opts: { fetchFn?: FetchLike } = {},
): Promise<PayInvoiceResult> {
  const trimmed = bolt11.trim();
  if (!trimmed) {
    return { ok: false, error: "Missing bolt11 invoice" };
  }

  const baseUrl = process.env.LNBITS_URL?.trim().replace(/\/+$/, "");
  const adminKey = process.env.LNBITS_ADMIN_KEY?.trim();

  if ((opts.fetchFn || (baseUrl && adminKey)) && !trimmed.startsWith("lnbcsim")) {
    if (!baseUrl || !adminKey) {
      return { ok: false, error: "LNBITS_URL and LNBITS_ADMIN_KEY are required to pay live invoices" };
    }
    const fetchImpl = opts.fetchFn ?? fetch;
    try {
      const res = await fetchImpl(`${baseUrl}/api/v1/payments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": adminKey,
        },
        signal: AbortSignal.timeout(12_000),
        body: JSON.stringify({ out: true, bolt11: trimmed }),
      });
      if (!res.ok) {
        return { ok: false, error: `LNbits payout failed (HTTP ${res.status})` };
      }
      const data = (await res.json()) as {
        payment_hash?: string;
        checking_id?: string;
        preimage?: string;
      };
      const paymentHash = data.payment_hash ?? data.checking_id ?? createHash("sha256").update(trimmed).digest("hex");
      return {
        ok: true,
        paymentHash,
        preimage: data.preimage ?? "",
        simulated: false,
      };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "LNbits payout request failed" };
    }
  }

  if (process.env.DEMO_MODE === "false") {
    return { ok: false, error: "Simulated payouts are disabled when DEMO_MODE=false" };
  }

  return {
    ok: true,
    paymentHash: createHash("sha256").update(`pay:${trimmed}`).digest("hex"),
    preimage: createHash("sha256").update(`preimage:${trimmed}`).digest("hex"),
    simulated: true,
  };
}
