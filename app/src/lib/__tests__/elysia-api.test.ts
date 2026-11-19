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
});
