import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { afterEach, describe, expect, it } from "vitest";
import { app } from "@/app";
import type { FetchLike } from "@/lib/domain/constants";
import {
  buildR2ObjectKey,
  buildR2PublicUrl,
  deleteObjectFromR2,
  getObjectFromR2,
  getR2Config,
  isR2StrictDriver,
  signR2Request,
  uploadObjectToR2,
} from "../r2";

const ENV_KEYS = [
  "STORAGE_DRIVER",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_URL",
  "R2_KEY_PREFIX",
  "R2_ENDPOINT",
] as const;

const savedEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
for (const key of ENV_KEYS) {
  savedEnv[key] = process.env[key];
}
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = savedEnv[key];
    }
  }
});

async function getTestBearerToken(): Promise<string> {
  const chalRes = await app.handle(new Request("http://localhost/api/v1/auth/challenge"));
  const { challenge } = (await chalRes.json()) as { challenge: string };
  const sk = generateSecretKey();
  const loginEvent = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags: [
        ["method", "POST"],
        ["u", "http://localhost/api/v1/auth/nostr"],
        ["challenge", challenge],
      ],
      content: "R2 Upload Test",
    },
    sk,
  );
  const authRes = await app.handle(
    new Request("http://localhost/api/v1/auth/nostr", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event: loginEvent, challenge, is_guest: true }),
    }),
  );
  const authJson = (await authRes.json()) as { token: string };
  return authJson.token;
}

describe("Cloudflare R2 S3 Storage Client & Upload Routes", () => {
  it("parses R2 config, derives endpoint, strips trailing slashes, and builds keys/URLs", () => {
    expect(getR2Config({})).toBeNull();
    expect(isR2StrictDriver({ STORAGE_DRIVER: "r2" })).toBe(true);
    expect(isR2StrictDriver({ STORAGE_DRIVER: "auto" })).toBe(false);

    const cfg = getR2Config({
      R2_ACCOUNT_ID: "acct123456",
      R2_ACCESS_KEY_ID: "key-abc",
      R2_SECRET_ACCESS_KEY: "sec-xyz",
      R2_BUCKET_NAME: "bitpredict-media",
      R2_PUBLIC_URL: "https://cdn.example.com/",
      R2_KEY_PREFIX: "/covers/",
    });
    expect(cfg).toEqual({
      endpoint: "https://acct123456.r2.cloudflarestorage.com",
      bucket: "bitpredict-media",
      accessKeyId: "key-abc",
      secretAccessKey: "sec-xyz",
      publicUrl: "https://cdn.example.com",
      keyPrefix: "covers",
    });

    const overrideCfg = getR2Config({
      R2_ENDPOINT: "https://acct123.eu.r2.cloudflarestorage.com/",
      R2_ACCESS_KEY_ID: "k",
      R2_SECRET_ACCESS_KEY: "s",
      R2_BUCKET_NAME: "b",
      R2_PUBLIC_URL: "http://insecure.invalid",
    });
    expect(overrideCfg?.endpoint).toBe("https://acct123.eu.r2.cloudflarestorage.com");
    expect(overrideCfg?.publicUrl).toBeNull();
    expect(overrideCfg?.keyPrefix).toBe("markets");

    const key = buildR2ObjectKey("sample.png", "covers");
    expect(key).toBe("covers/sample.png");
    expect(buildR2PublicUrl("https://cdn.example.com/", key)).toBe(
      "https://cdn.example.com/covers/sample.png",
    );
  });

  it("signs AWS SigV4 requests and executes PUT/GET/DELETE via FetchLike", async () => {
    const cfg = getR2Config({
      R2_ACCOUNT_ID: "acct999",
      R2_ACCESS_KEY_ID: "AKIAEXAMPLE",
      R2_SECRET_ACCESS_KEY: "secret-example",
      R2_BUCKET_NAME: "media",
    })!;

    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const signed = signR2Request(cfg, {
      method: "PUT",
      key: "markets/test.png",
      body: png,
      contentType: "image/png",
      now: new Date("2026-11-20T12:00:00Z"),
    });

    expect(signed.url).toBe("https://acct999.r2.cloudflarestorage.com/media/markets/test.png");
    expect(signed.headers["x-amz-date"]).toBe("20261120T120000Z");
    expect(signed.headers["x-amz-content-sha256"]).toMatch(/^[0-9a-f]{64}$/);
    expect(signed.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAEXAMPLE\/20261120\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );

    const bucketStore = new Map<string, { bytes: Uint8Array; type: string; etag: string }>();
    const mockFetch: FetchLike = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "PUT") {
        const bodyBuf = init?.body as Buffer;
        bucketStore.set(url, {
          bytes: new Uint8Array(bodyBuf),
          type: (init?.headers as Record<string, string>)["Content-Type"],
          etag: '"etag-123"',
        });
        return new Response(null, { status: 200, headers: { etag: '"etag-123"' } });
      }
      if (method === "GET") {
        const obj = bucketStore.get(url);
        if (!obj) return new Response("Not Found", { status: 404 });
        return new Response(Buffer.from(obj.bytes), {
          status: 200,
          headers: { "content-type": obj.type, etag: obj.etag },
        });
      }
      if (method === "DELETE") {
        bucketStore.delete(url);
        return new Response(null, { status: 204 });
      }
      return new Response(null, { status: 405 });
    };

    const putRes = await uploadObjectToR2(
      cfg,
      { key: "markets/test.png", body: png, contentType: "image/png" },
      mockFetch,
    );
    expect(putRes).toEqual({ ok: true, key: "markets/test.png", etag: '"etag-123"' });

    const getRes = await getObjectFromR2(cfg, "markets/test.png", mockFetch);
    expect(getRes.ok).toBe(true);
    if (getRes.ok) {
      expect(getRes.contentType).toBe("image/png");
      expect(getRes.etag).toBe('"etag-123"');
      expect(Array.from(getRes.bytes)).toEqual(Array.from(png));
    }

    const delRes = await deleteObjectFromR2(cfg, "markets/test.png", mockFetch);
    expect(delRes).toEqual({ ok: true });
    const missingRes = await getObjectFromR2(cfg, "markets/test.png", mockFetch);
    expect(missingRes.ok).toBe(false);
  });

  it("uploads directly to Cloudflare R2 and serves via public CDN URL or signed backend proxy", async () => {
    const token = await getTestBearerToken();
    const dummyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);

    // 1. Strict STORAGE_DRIVER=r2 rejects missing config with 503
    process.env.STORAGE_DRIVER = "r2";
    delete process.env.R2_ACCOUNT_ID;
    delete process.env.R2_BUCKET_NAME;
    const missingForm = new FormData();
    missingForm.append("file", new File([dummyPng], "cover.png", { type: "image/png" }));
    const missingRes = await app.handle(
      new Request("http://localhost/api/v1/uploads/market-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: missingForm,
      }),
    );
    expect(missingRes.status).toBe(503);

    // Mock R2 object storage in memory
    const r2Objects = new Map<string, { bytes: Uint8Array; type: string; etag: string }>();
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      if (url.startsWith("https://acct-r2-test.r2.cloudflarestorage.com/")) {
        if (method === "PUT") {
          const bodyBuf = init?.body as Buffer;
          const headers = (init?.headers ?? {}) as Record<string, string>;
          r2Objects.set(url, {
            bytes: new Uint8Array(bodyBuf),
            type: headers["Content-Type"] ?? "image/png",
            etag: '"r2-etag-1"',
          });
          return new Response(null, { status: 200, headers: { etag: '"r2-etag-1"' } });
        }
        if (method === "GET") {
          const obj = r2Objects.get(url);
          if (!obj) return new Response("NoSuchKey", { status: 404 });
          return new Response(Buffer.from(obj.bytes), {
            status: 200,
            headers: { "content-type": obj.type, etag: obj.etag },
          });
        }
      }
      return originalFetch(input, init);
    }) as typeof fetch;

    process.env.R2_ACCOUNT_ID = "acct-r2-test";
    process.env.R2_ACCESS_KEY_ID = "key-id";
    process.env.R2_SECRET_ACCESS_KEY = "secret-key";
    process.env.R2_BUCKET_NAME = "bitpredict-media";
    process.env.R2_KEY_PREFIX = "markets";

    // 2. Public R2 CDN mode (R2_PUBLIC_URL configured)
    process.env.R2_PUBLIC_URL = "https://pub-bitpredict.r2.dev";
    const pubForm = new FormData();
    pubForm.append("file", new File([dummyPng], "public-cover.png", { type: "image/png" }));
    const pubRes = await app.handle(
      new Request("http://localhost/api/v1/uploads/market-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: pubForm,
      }),
    );
    expect(pubRes.status).toBe(201);
    const pubJson = (await pubRes.json()) as {
      url: string;
      filename: string;
      key: string;
      storage: string;
      mime: string;
    };
    expect(pubJson.storage).toBe("r2");
    expect(pubJson.key).toBe(`markets/${pubJson.filename}`);
    expect(pubJson.url).toBe(`https://pub-bitpredict.r2.dev/markets/${pubJson.filename}`);

    // 3. Private R2 bucket mode (no R2_PUBLIC_URL -> returns /api/v1/uploads/:filename & GET proxies from R2)
    delete process.env.R2_PUBLIC_URL;
    const privForm = new FormData();
    privForm.append("file", new File([dummyPng], "private-cover.png", { type: "image/png" }));
    const privRes = await app.handle(
      new Request("http://localhost/api/v1/uploads/market-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: privForm,
      }),
    );
    expect(privRes.status).toBe(201);
    const privJson = (await privRes.json()) as {
      url: string;
      filename: string;
      key: string;
      storage: string;
    };
    expect(privJson.storage).toBe("r2");
    expect(privJson.url).toBe(`/api/v1/uploads/${privJson.filename}`);

    const serveRes = await app.handle(new Request(`http://localhost${privJson.url}`));
    expect(serveRes.status).toBe(200);
    expect(serveRes.headers.get("content-type")).toBe("image/png");
    expect(serveRes.headers.get("etag")).toBe('"r2-etag-1"');
    const servedBytes = new Uint8Array(await serveRes.arrayBuffer());
    expect(Array.from(servedBytes)).toEqual(Array.from(dummyPng));
  });
});
