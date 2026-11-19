import { describe, expect, it } from "vitest";
import { MarketSpecSchema } from "@/lib/domain/market-spec";
import { formatSats, impliedYesProbability } from "@/lib/domain/pool";
import { checkTimeRules } from "@/lib/domain/time-rules";

const VALID_TRACK_A_SPEC = {
  title: "Washington, D.C. max temperature >= 19°C on Nov 20, 2026",
  question: "Will the daily maximum temperature in Washington, D.C. reach 19.0°C on Nov 20, 2026 (local day)?",
  category: "Weather" as const,
  resolution_track: "auto_api" as const,
  rules:
    "Resolves YES if Open-Meteo daily temperature_2m_max for lat 38.9072, lon -77.0369, timezone America/New_York, date 2026-11-20 is >= 19.0. Resolves NO otherwise. VOID if no value is available 24h after resolve time.",
  betting_cutoff_utc: "2026-11-20T05:00:00Z",
  deadline_utc: "2026-11-21T04:59:59Z",
  resolve_after_utc: "2026-11-21T07:00:00Z",
  oracle_config: {
    provider: "open-meteo" as const,
    params: {
      latitude: 38.9072,
      longitude: -77.0369,
      daily: "temperature_2m_max",
      timezone: "America/New_York",
      start_date: "2026-11-20",
      end_date: "2026-11-20",
    },
    value_path: "daily.temperature_2m_max[0]",
    condition: { operator: ">=" as const, threshold: 19.0 },
  },
  assumptions: [
    "'Washington' interpreted as Washington, D.C., USA",
    "'tomorrow' = 2026-11-20 relative to creator's timezone",
    "Day boundaries use local time (America/New_York, UTC-5)",
  ],
  ai_confidence: 0.93,
};

const VALID_TRACK_B_SPEC = {
  title: "Will Team Alpha win the Spring Final?",
  question: "Will Team Alpha defeat Team Beta in the 2026 Spring Final match?",
  category: "Sports" as const,
  resolution_track: "nostr_oracle" as const,
  rules: "Resolves YES if official league standings record Team Alpha as the winner of the Spring Final.",
  betting_cutoff_utc: "2026-11-20T18:00:00Z",
  deadline_utc: "2026-11-20T21:00:00Z",
  resolve_after_utc: "2026-11-20T22:00:00Z",
  oracle_config: {
    signer_policy: "platform_signer" as const,
    suggested_sources: ["https://example.org/official-standings"],
  },
  assumptions: ["Match winner includes overtime if applicable"],
};

describe("MarketSpecSchema", () => {
  it("accepts the valid Track A Washington weather spec", () => {
    const parsed = MarketSpecSchema.safeParse(VALID_TRACK_A_SPEC);
    expect(parsed.success).toBe(true);
  });

  it("accepts a valid Track B nostr_oracle spec", () => {
    const parsed = MarketSpecSchema.safeParse(VALID_TRACK_B_SPEC);
    expect(parsed.success).toBe(true);
  });

  it("rejects a URL smuggled inside oracle_config.params (SSRF guard)", () => {
    const bad = {
      ...VALID_TRACK_A_SPEC,
      oracle_config: {
        ...VALID_TRACK_A_SPEC.oracle_config,
        params: {
          ...VALID_TRACK_A_SPEC.oracle_config.params,
          endpoint: "https://evil.example/api",
        },
      },
    };
    const parsed = MarketSpecSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("rejects mismatched resolution_track vs oracle_config shape", () => {
    const bad = {
      ...VALID_TRACK_A_SPEC,
      oracle_config: {
        signer_policy: "platform_signer",
        suggested_sources: ["National Weather Service"],
      },
    };
    const parsed = MarketSpecSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });

  it("rejects disallowed category/track combinations (e.g. Politics with auto_api)", () => {
    const bad = {
      ...VALID_TRACK_A_SPEC,
      category: "Politics" as const,
    };
    const parsed = MarketSpecSchema.safeParse(bad);
    expect(parsed.success).toBe(false);
  });
});

describe("checkTimeRules", () => {
  const now = new Date("2026-11-19T12:00:00Z");

  it("passes when now < betting_cutoff_utc <= deadline_utc <= resolve_after_utc", () => {
    const violations = checkTimeRules(VALID_TRACK_A_SPEC, { now });
    expect(violations).toEqual([]);
  });

  it("flags betting_cutoff_utc in the past", () => {
    const violations = checkTimeRules(
      {
        betting_cutoff_utc: "2026-11-19T11:59:00Z",
        deadline_utc: "2026-11-20T12:00:00Z",
        resolve_after_utc: "2026-11-20T13:00:00Z",
      },
      { now },
    );
    expect(violations.some((v) => v.field === "betting_cutoff_utc")).toBe(true);
  });

  it("flags betting_cutoff_utc after deadline_utc", () => {
    const violations = checkTimeRules(
      {
        betting_cutoff_utc: "2026-11-21T12:00:00Z",
        deadline_utc: "2026-11-20T12:00:00Z",
        resolve_after_utc: "2026-11-21T13:00:00Z",
      },
      { now },
    );
    expect(violations.some((v) => v.field === "betting_cutoff_utc")).toBe(true);
  });

  it("flags deadline_utc after resolve_after_utc", () => {
    const violations = checkTimeRules(
      {
        betting_cutoff_utc: "2026-11-20T05:00:00Z",
        deadline_utc: "2026-11-21T10:00:00Z",
        resolve_after_utc: "2026-11-21T07:00:00Z",
      },
      { now },
    );
    expect(violations.some((v) => v.field === "resolve_after_utc")).toBe(true);
  });
});

describe("pool helpers", () => {
  it("returns 0.5 implied probability for empty pools", () => {
    expect(impliedYesProbability(0, 0)).toBe(0.5);
  });

  it("returns accurate implied probability for populated pools", () => {
    expect(impliedYesProbability(750_000, 250_000)).toBe(0.75);
    expect(impliedYesProbability(1000n, 3000n)).toBe(0.25);
  });

  it("formats msat values as comma-separated sats strings", () => {
    expect(formatSats(0)).toBe("0");
    expect(formatSats(1_500_000)).toBe("1,500");
    expect(formatSats(1_234_567_999n)).toBe("1,234,567");
  });
});
