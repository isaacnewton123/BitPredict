import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    env: {
      DEMO_MODE: "true",
      LNBITS_URL: "",
      LNBITS_INVOICE_KEY: "",
      LNBITS_ADMIN_KEY: "",
      LNBITS_WEBHOOK_SECRET: "",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
