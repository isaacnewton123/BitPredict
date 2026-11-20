import type { FetchLike } from "@/lib/domain/constants";

export type LightningAddressValidation =
  | { ok: true; address: string; verifiedRemote: boolean; warning?: string }
  | { ok: false; error: string };

const LUD16_REGEX = /^[a-z0-9_.-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

export function isBlockedHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h || h.includes("[") || h.includes("]") || h.includes(":")) return true;
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  ) {
    return true;
  }

  // Block IPv4 loopback, private RFC1918, link-local, CGNAT, and 0.0.0.0 ranges.
  if (
    h === "0.0.0.0" ||
    h.startsWith("127.") ||
    h.startsWith("10.") ||
    h.startsWith("192.168.") ||
    h.startsWith("169.254.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(h)
  ) {
    return true;
  }

  return false;
}

/**
 * Validates a LUD-16 Lightning Address (user@domain) and optionally verifies its LNURL-pay endpoint.
 */
export async function validateLightningAddress(
  raw: string,
  opts: { verifyRemote?: boolean; fetchFn?: FetchLike; allowDemoFallback?: boolean } = {},
): Promise<LightningAddressValidation> {
  const address = raw.trim().toLowerCase();
  if (!address || address.length > 120 || !LUD16_REGEX.test(address)) {
    return { ok: false, error: "Invalid Lightning Address format (expected name@domain)" };
  }

  const [user, domain] = address.split("@");
  if (!user || !domain || domain.includes("..") || domain.startsWith(".") || domain.startsWith("-")) {
    return { ok: false, error: "Invalid Lightning Address domain" };
  }

  if (isBlockedHost(domain)) {
    return { ok: false, error: "Internal or local Lightning Address domains are not allowed" };
  }

  const verifyRemote = opts.verifyRemote ?? true;
  if (!verifyRemote || domain.endsWith(".test") || domain.endsWith(".example")) {
    return { ok: true, address, verifiedRemote: false };
  }

  const url = `https://${domain}/.well-known/lnurlp/${encodeURIComponent(user)}`;
  const fetchImpl = opts.fetchFn ?? fetch;

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(4_000),
    });

    if (!res.ok) {
      return { ok: false, error: `Lightning Address lookup failed (HTTP ${res.status})` };
    }

    const body = (await res.json()) as Record<string, unknown>;
    if (body?.tag !== "payRequest") {
      return { ok: false, error: "Domain did not return a valid LNURL payRequest" };
    }

    if (typeof body.callback !== "string") {
      return { ok: false, error: "LNURL payRequest is missing a callback URL" };
    }

    let callbackUrl: URL;
    try {
      callbackUrl = new URL(body.callback);
    } catch {
      return { ok: false, error: "LNURL payRequest callback is not a valid URL" };
    }
    if (callbackUrl.protocol !== "https:" || isBlockedHost(callbackUrl.hostname)) {
      return { ok: false, error: "LNURL payRequest callback must be a public HTTPS URL" };
    }

    if (
      typeof body.minSendable !== "number" ||
      typeof body.maxSendable !== "number" ||
      body.minSendable < 1 ||
      body.minSendable > body.maxSendable
    ) {
      return { ok: false, error: "LNURL payRequest has invalid min/max sendable bounds" };
    }

    return { ok: true, address, verifiedRemote: true };
  } catch (err) {
    if (opts.allowDemoFallback || process.env.DEMO_MODE === "true") {
      return {
        ok: true,
        address,
        verifiedRemote: false,
        warning: `Saved in demo mode without remote verification (${err instanceof Error ? err.message : "network error"})`,
      };
    }
    return { ok: false, error: "Could not reach Lightning Address domain to verify LNURL-pay" };
  }
}
