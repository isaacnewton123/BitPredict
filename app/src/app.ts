import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { authRoutes } from "./routes/auth";
import { marketRoutes } from "./routes/markets";
import { settlementRoutes } from "./routes/settlement";

export const app = new Elysia({ name: "bitpredict-api" })
  .use(cors({ origin: true, credentials: true }))
  .use(
    openapi({
      path: "/openapi",
      provider: "scalar",
      scalar: {
        theme: "purple",
      },
      documentation: {
        info: {
          title: "BitPredict API",
          version: "1.0.0",
          description:
            "BitPredict REST API powered by Elysia & Scalar — Bitcoin Lightning betting, NIP-98/NIP-07 Nostr auth, AI Prompt-to-Oracle compilation, and Dual-Track Oracle settlement.",
        },
        tags: [
          { name: "Auth & Profile", description: "NIP-07 / NIP-98 Nostr authentication and LUD-16 profiles" },
          { name: "Markets & Betting", description: "Market listings, publishing, Lightning invoices, and SSE streams" },
          { name: "AI Studio", description: "AI Prompt-to-Oracle compiler and non-binding Market Insights" },
          { name: "Oracles", description: "Track A Auto-API proofs and Track B Optimistic Oracle proposals/disputes" },
          { name: "Settlement & Ops", description: "LNbits webhooks, payouts, LNURL-withdraw, and demo seeding" },
        ],
        components: {
          securitySchemes: {
            cookieAuth: {
              type: "apiKey",
              in: "cookie",
              name: "bp_session",
            },
            bearerAuth: {
              type: "http",
              scheme: "bearer",
            },
          },
        },
      },
    }),
  )
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 422;
      return {
        error: {
          code: "VALIDATION_FAILED",
          message: error instanceof Error ? error.message : "Validation failed",
        },
      };
    }
    if (code === "NOT_FOUND") {
      set.status = 404;
      return {
        error: {
          code: "NOT_FOUND",
          message: "Route not found",
        },
      };
    }
  })
  .get(
    "/",
    () => ({
      name: "BitPredict Backend API (Elysia)",
      status: "ok",
      docs: "/openapi",
      openapi_spec: "/openapi/json",
      api_base: "/api/v1",
    }),
    {
      detail: {
        summary: "API health & documentation entrypoints",
        tags: ["Settlement & Ops"],
      },
    },
  )
  .get(
    "/docs",
    ({ redirect }) => redirect("/openapi", 302),
    {
      detail: {
        hide: true,
      },
    },
  )
  .use(authRoutes)
  .use(marketRoutes)
  .use(settlementRoutes);

export type App = typeof app;
