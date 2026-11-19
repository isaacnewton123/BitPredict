import type { VerifiedEvent } from "nostr-tools/pure";

const DEFAULT_RELAYS = [
  "wss://relay.damus.io",
  "wss://nos.lol",
  "wss://relay.nostr.band",
];

function isValidRelayUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol === "wss:") return true;
    return u.protocol === "ws:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
  } catch {
    return false;
  }
}

export function getConfiguredRelays(): string[] {
  const raw = process.env.NOSTR_RELAYS?.trim();
  if (!raw) return DEFAULT_RELAYS;
  const parsed = raw
    .split(",")
    .map((s) => s.trim())
    .filter(isValidRelayUrl);
  return parsed.length > 0 ? parsed : DEFAULT_RELAYS;
}

function publishToSingleRelay(
  relayUrl: string,
  event: VerifiedEvent,
  timeoutMs: number,
): Promise<string | null> {
  if (typeof WebSocket === "undefined") {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    let settled = false;
    let ws: WebSocket | null = null;

    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        ws?.close();
      } catch {
        // ignore close error
      }
      resolve(ok ? relayUrl : null);
    };

    const timer = setTimeout(() => finish(false), timeoutMs);

    try {
      ws = new WebSocket(relayUrl);
      ws.addEventListener("open", () => {
        ws?.send(JSON.stringify(["EVENT", event]));
      });
      ws.addEventListener("message", (msgEv) => {
        try {
          const data = JSON.parse(String(msgEv.data)) as unknown[];
          if (Array.isArray(data) && data[0] === "OK" && data[1] === event.id) {
            finish(data[2] === true);
          }
        } catch {
          // ignore non-JSON relay frame
        }
      });
      ws.addEventListener("error", () => finish(false));
      ws.addEventListener("close", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

export async function broadcastEventToRelays(
  event: VerifiedEvent,
  relays = getConfiguredRelays(),
  opts: { timeoutMs?: number; disabled?: boolean } = {},
): Promise<string[]> {
  const disabled = opts.disabled ?? process.env.NOSTR_PUBLISH_DISABLED === "true";
  if (disabled || relays.length === 0) return [];

  const timeoutMs = opts.timeoutMs ?? 2_000;
  const results = await Promise.allSettled(
    relays.map((url) => publishToSingleRelay(url, event, timeoutMs)),
  );

  return results
    .filter((r): r is PromiseFulfilledResult<string | null> => r.status === "fulfilled")
    .map((r) => r.value)
    .filter((v): v is string => v !== null);
}
