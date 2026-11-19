import fs from "node:fs";
import path from "node:path";
import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { app } from "@/app";

describe("Elysia HTTP API & Scalar OpenAPI Docs", () => {
  it("serves Scalar API Reference UI at /openapi and OpenAPI 3.1 JSON at /openapi/json", async () => {
    const uiRes = await app.handle(new Request("http://localhost/openapi"));
    expect(uiRes.status).toBe(200);
    const html = await uiRes.text();
    expect(html.toLowerCase()).toContain("scalar");

    const specRes = await app.handle(new Request("http://localhost/openapi/json"));
    expect(specRes.status).toBe(200);
    const spec = (await specRes.json()) as {
      openapi?: string;
      info?: { title?: string; version?: string };
      paths?: Record<string, unknown>;
    };
    expect(spec.info?.title).toBe("BitPredict API");
    expect(spec.paths).toBeDefined();
    expect(spec.paths?.["/api/v1/markets"]).toBeDefined();
    expect(spec.paths?.["/api/v1/auth/challenge"]).toBeDefined();
    expect(spec.paths?.["/api/v1/auth/nostr"]).toBeDefined();
    expect(spec.paths?.["/api/v1/markets/{id}/insight"]).toBeDefined();
    expect(spec.paths?.["/api/v1/oracle/queue"]).toBeDefined();
    expect(spec.paths?.["/api/v1/demo/seed"]).toBeDefined();
    expect(spec.paths?.["/api/v1/uploads/market-image"]).toBeDefined();
    expect(spec.paths?.["/api/v1/uploads/{filename}"]).toBeDefined();
  });

  it("handles auth challenge, unauthorized rejection on /api/v1/me, and market listing", async () => {
    const challengeRes = await app.handle(
      new Request("http://localhost/api/v1/auth/challenge"),
    );
    expect(challengeRes.status).toBe(200);
    const challengeJson = (await challengeRes.json()) as { challenge?: string; expires_at?: string };
    expect(typeof challengeJson.challenge).toBe("string");
    expect(challengeJson.challenge!.length).toBeGreaterThan(10);

    const meRes = await app.handle(new Request("http://localhost/api/v1/me"));
    expect(meRes.status).toBe(401);
    const meJson = (await meRes.json()) as { error?: { code?: string } };
    expect(meJson.error?.code).toBe("UNAUTHORIZED");

    const marketsRes = await app.handle(new Request("http://localhost/api/v1/markets"));
    expect(marketsRes.status).toBe(200);
    const marketsJson = (await marketsRes.json()) as { markets?: unknown[] };
    expect(Array.isArray(marketsJson.markets)).toBe(true);
  });

  it("validates, stores, and serves market cover images and exposes market activity history", async () => {
    const dummyPng = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    const unauthForm = new FormData();
    unauthForm.append("file", new File([dummyPng], "cover.png", { type: "image/png" }));
    const unauthRes = await app.handle(
      new Request("http://localhost/api/v1/uploads/market-image", {
        method: "POST",
        body: unauthForm,
      }),
    );
    expect(unauthRes.status).toBe(401);

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
        content: "Elysia Upload Test",
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
    expect(authRes.status).toBe(200);
    const { token } = (await authRes.json()) as { token: string };

    const badForm = new FormData();
    badForm.append("file", new File(["<svg>not allowed</svg>"], "bad.svg", { type: "image/svg+xml" }));
    const badRes = await app.handle(
      new Request("http://localhost/api/v1/uploads/market-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: badForm,
      }),
    );
    expect(badRes.status).toBe(415);

    const goodForm = new FormData();
    goodForm.append("file", new File([dummyPng], "cover.png", { type: "image/png" }));
    const goodRes = await app.handle(
      new Request("http://localhost/api/v1/uploads/market-image", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: goodForm,
      }),
    );
    expect(goodRes.status).toBe(201);
    const uploaded = (await goodRes.json()) as { url: string; filename: string; mime: string };
    expect(uploaded.url).toBe(`/api/v1/uploads/${uploaded.filename}`);
    expect(uploaded.mime).toBe("image/png");

    try {
      const getImgRes = await app.handle(new Request(`http://localhost${uploaded.url}`));
      expect(getImgRes.status).toBe(200);
      expect(getImgRes.headers.get("content-type")).toBe("image/png");
    } finally {
      const p = path.resolve(process.cwd(), "data/uploads", uploaded.filename);
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }

    let listJson = (await (await app.handle(new Request("http://localhost/api/v1/markets"))).json()) as {
      markets: Array<{ slug: string }>;
    };
    if (listJson.markets.length === 0) {
      await app.handle(new Request("http://localhost/api/v1/demo/seed", { method: "POST" }));
      listJson = (await (await app.handle(new Request("http://localhost/api/v1/markets"))).json()) as {
        markets: Array<{ slug: string }>;
      };
    }
    expect(listJson.markets.length).toBeGreaterThan(0);

    const detailRes = await app.handle(
      new Request(`http://localhost/api/v1/markets/${listJson.markets[0].slug}`),
    );
    expect(detailRes.status).toBe(200);
    const detailJson = (await detailRes.json()) as {
      recent_trades?: unknown[];
      probability_history?: unknown[];
    };
    expect(Array.isArray(detailJson.recent_trades)).toBe(true);
    expect(Array.isArray(detailJson.probability_history)).toBe(true);
    expect(detailJson.probability_history!.length).toBeGreaterThanOrEqual(2);
  });
});
