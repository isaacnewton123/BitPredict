import { createHash } from "node:crypto";
import * as nip19 from "nostr-tools/nip19";
import { getPublicKey } from "nostr-tools/pure";
import { pubkeyToNpub } from "@/lib/auth/npub";

export interface PlatformKeypair {
  secretKey: Uint8Array;
  pubkey: string;
  npub: string;
}

function resolveKeypair(envName: string, devSeed: string): PlatformKeypair {
  const raw = process.env[envName]?.trim();
  let secretKey: Uint8Array;

  if (raw) {
    if (raw.startsWith("nsec1")) {
      const decoded = nip19.decode(raw);
      if (decoded.type !== "nsec") {
        throw new Error(`${envName} nsec is invalid`);
      }
      secretKey = decoded.data;
    } else if (/^[0-9a-f]{64}$/i.test(raw)) {
      secretKey = Uint8Array.from(Buffer.from(raw, "hex"));
    } else {
      throw new Error(`${envName} must be 64-char hex or nsec1...`);
    }
  } else {
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${envName} must be set in production`);
    }
    const digest = createHash("sha256").update(devSeed).digest();
    secretKey = new Uint8Array(digest);
  }

  const pubkey = getPublicKey(secretKey).toLowerCase();
  return {
    secretKey,
    pubkey,
    npub: pubkeyToNpub(pubkey),
  };
}

export function getPlatformKeypair(): PlatformKeypair {
  return resolveKeypair("PLATFORM_NOSTR_SECRET_KEY", "bitpredict-dev-platform-nostr-key");
}

export function getPlatformOracleKeypair(): PlatformKeypair {
  return resolveKeypair("PLATFORM_ORACLE_SECRET_KEY", "bitpredict-dev-platform-oracle-key");
}
