import { createHash, createHmac } from "node:crypto";
import type { FetchLike } from "@/lib/domain/constants";

export interface R2Config {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicUrl: string | null;
  keyPrefix: string;
}

export type R2UploadResult =
  | { ok: true; key: string; etag: string | null }
  | { ok: false; status: number; error: string };

export type R2GetResult =
  | { ok: true; bytes: Uint8Array; contentType: string; etag: string | null }
  | { ok: false; status: number; error: string };

export type R2DeleteResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

/** Returns true when Cloudflare R2 storage is explicitly enforced instead of auto fallback. */
export function isR2StrictDriver(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.STORAGE_DRIVER?.trim().toLowerCase() === "r2";
}

/** Reads Cloudflare R2 S3-compatible configuration from env, returning null when incomplete. */
export function getR2Config(
  env: Record<string, string | undefined> = process.env,
): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const explicitEndpoint = env.R2_ENDPOINT?.trim().replace(/\/+$/, "");
  const endpoint = explicitEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");
  const bucket = env.R2_BUCKET_NAME?.trim() ?? "";
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim() ?? "";

  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) {
    return null;
  }

  const rawPublic = env.R2_PUBLIC_URL?.trim().replace(/\/+$/, "") ?? "";
  const publicUrl = /^https:\/\/[^\s]+$/i.test(rawPublic) ? rawPublic : null;
  const rawPrefix = env.R2_KEY_PREFIX?.trim() ?? "markets";
  const keyPrefix = rawPrefix.replace(/^\/+|\/+$/g, "");

  return {
    endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    publicUrl,
    keyPrefix,
  };
}

/** Builds a normalized R2 object key under the configured prefix. */
export function buildR2ObjectKey(filename: string, keyPrefix = "markets"): string {
  const cleanName = filename.replace(/^\/+/, "");
  const cleanPrefix = keyPrefix.replace(/^\/+|\/+$/g, "");
  return cleanPrefix ? `${cleanPrefix}/${cleanName}` : cleanName;
}

/** Joins the configured public R2 base URL with an object key. */
export function buildR2PublicUrl(publicUrl: string, key: string): string {
  const cleanBase = publicUrl.replace(/\/+$/, "");
  const encodedPath = key
    .split("/")
    .filter(Boolean)
    .map((seg) => encodeURIComponent(seg))
    .join("/");
  return `${cleanBase}/${encodedPath}`;
}

function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function hmacSha256(key: string | Uint8Array, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function encodeS3Path(key: string): string {
  return key
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

/** Signs an S3-compatible Cloudflare R2 request using AWS Signature Version 4. */
export function signR2Request(
  cfg: Pick<R2Config, "endpoint" | "bucket" | "accessKeyId" | "secretAccessKey">,
  opts: {
    method: "PUT" | "GET" | "DELETE";
    key: string;
    body?: Uint8Array;
    contentType?: string;
    now?: Date;
  },
): { url: string; headers: Record<string, string> } {
  const endpointUrl = new URL(cfg.endpoint);
  const encodedBucket = encodeURIComponent(cfg.bucket);
  const encodedKey = encodeS3Path(opts.key);
  const canonicalUri = `/${encodedBucket}/${encodedKey}`;
  const fullUrl = `${endpointUrl.origin}${canonicalUri}`;

  const now = opts.now ?? new Date();
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = iso.slice(0, 8);
  const region = "auto";
  const service = "s3";

  const payloadHash = sha256Hex(opts.body ?? new Uint8Array());
  const headersToSign: Record<string, string> = {
    host: endpointUrl.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": iso,
  };
  if (opts.contentType) {
    headersToSign["content-type"] = opts.contentType;
  }

  const sortedKeys = Object.keys(headersToSign).sort();
  const canonicalHeaders = sortedKeys.map((k) => `${k}:${headersToSign[k]}\n`).join("");
  const signedHeaders = sortedKeys.join(";");

  const canonicalRequest = [
    opts.method,
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    iso,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const kDate = hmacSha256(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, "aws4_request");
  const signature = hmacSha256(kSigning, stringToSign).toString("hex");

  const authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const requestHeaders: Record<string, string> = {
    Authorization: authorization,
    "x-amz-date": iso,
    "x-amz-content-sha256": payloadHash,
  };
  if (opts.contentType) {
    requestHeaders["Content-Type"] = opts.contentType;
  }

  return { url: fullUrl, headers: requestHeaders };
}

/** Uploads binary bytes to Cloudflare R2 with immutable public cache headers. */
export async function uploadObjectToR2(
  cfg: R2Config,
  opts: {
    key: string;
    body: Uint8Array;
    contentType: string;
    cacheControl?: string;
  },
  fetchFn: FetchLike = fetch,
): Promise<R2UploadResult> {
  const signed = signR2Request(cfg, {
    method: "PUT",
    key: opts.key,
    body: opts.body,
    contentType: opts.contentType,
  });

  const headers: Record<string, string> = {
    ...signed.headers,
    "Cache-Control": opts.cacheControl ?? "public, max-age=31536000, immutable",
  };

  try {
    const res = await fetchFn(signed.url, {
      method: "PUT",
      headers,
      body: Buffer.from(opts.body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        error: text.slice(0, 240) || `R2 upload failed with HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      key: opts.key,
      etag: res.headers.get("etag"),
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Failed to reach Cloudflare R2",
    };
  }
}

/** Downloads an object from Cloudflare R2 for authenticated/proxy image display. */
export async function getObjectFromR2(
  cfg: R2Config,
  key: string,
  fetchFn: FetchLike = fetch,
): Promise<R2GetResult> {
  const signed = signR2Request(cfg, { method: "GET", key });
  try {
    const res = await fetchFn(signed.url, {
      method: "GET",
      headers: signed.headers,
    });
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: `R2 fetch failed with HTTP ${res.status}`,
      };
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    return {
      ok: true,
      bytes,
      contentType: res.headers.get("content-type") ?? "application/octet-stream",
      etag: res.headers.get("etag"),
    };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Failed to fetch object from Cloudflare R2",
    };
  }
}

/** Deletes an object from Cloudflare R2. */
export async function deleteObjectFromR2(
  cfg: R2Config,
  key: string,
  fetchFn: FetchLike = fetch,
): Promise<R2DeleteResult> {
  const signed = signR2Request(cfg, { method: "DELETE", key });
  try {
    const res = await fetchFn(signed.url, {
      method: "DELETE",
      headers: signed.headers,
    });
    if (!res.ok && res.status !== 204) {
      return {
        ok: false,
        status: res.status,
        error: `R2 delete failed with HTTP ${res.status}`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      status: 502,
      error: err instanceof Error ? err.message : "Failed to delete object from Cloudflare R2",
    };
  }
}
