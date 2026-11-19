import { z } from "zod";
import {
  CATEGORIES,
  CONDITION_OPERATORS,
  ORACLE_PROVIDERS,
  RESOLUTION_TRACKS,
  SIGNER_POLICIES,
} from "./constants";
import { getCategory } from "./categories";

/**
 * MarketSpec — the validated contract produced by the AI Market Creator.
 * Mirrors docs/04-ai-market-creator.md §2.
 */

const isoDateTime = z.string().datetime({ offset: true });

/** Rejects anything that looks like a URL, so the AI can't smuggle endpoints into params (SSRF guard). */
const noUrl = (v: unknown): boolean =>
  typeof v !== "string" || !/^[a-z][a-z0-9+.-]*:\/\//i.test(v.trim());

const paramValue = z
  .union([z.string().max(200), z.number(), z.boolean()])
  .refine(noUrl, { message: "URLs are not allowed in oracle params" });

export const ConditionSchema = z.object({
  operator: z.enum(CONDITION_OPERATORS),
  threshold: z.union([z.number(), z.string().max(100)]),
});

export const AutoApiOracleConfigSchema = z
  .object({
    provider: z.enum(ORACLE_PROVIDERS),
    params: z.record(z.string(), paramValue),
    value_path: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[A-Za-z0-9_.\[\]$]+$/, "value_path may only contain identifiers, dots and [index]"),
    condition: ConditionSchema,
  })
  .strict();

export const NostrOracleConfigSchema = z
  .object({
    signer_policy: z.enum(SIGNER_POLICIES),
    suggested_sources: z.array(z.string().max(300)).min(1).max(10),
  })
  .strict();

export const MarketSpecSchema = z
  .object({
    title: z.string().min(5).max(120),
    question: z.string().min(5).max(200),
    category: z.enum(CATEGORIES),
    resolution_track: z.enum(RESOLUTION_TRACKS),
    rules: z.string().min(10).max(1000),
    betting_cutoff_utc: isoDateTime,
    deadline_utc: isoDateTime,
    resolve_after_utc: isoDateTime,
    invalid_conditions: z.array(z.string().max(300)).max(10).default([]),
    oracle_config: z.union([AutoApiOracleConfigSchema, NostrOracleConfigSchema]),
    assumptions: z.array(z.string().max(300)).max(20).default([]),
    ai_confidence: z.number().min(0).max(1).optional(),
  })
  .superRefine((spec, ctx) => {
    const isAuto = "provider" in spec.oracle_config;
    if (spec.resolution_track === "auto_api" && !isAuto) {
      ctx.addIssue({ code: "custom", path: ["oracle_config"], message: "auto_api track requires provider/params/value_path/condition" });
    }
    if (spec.resolution_track === "nostr_oracle" && isAuto) {
      ctx.addIssue({ code: "custom", path: ["oracle_config"], message: "nostr_oracle track requires signer_policy/suggested_sources" });
    }
    if (!getCategory(spec.category).allowedTracks.includes(spec.resolution_track)) {
      ctx.addIssue({ code: "custom", path: ["resolution_track"], message: `${spec.resolution_track} is not allowed for ${spec.category}` });
    }
  });

export type MarketSpec = z.infer<typeof MarketSpecSchema>;
export type AutoApiOracleConfig = z.infer<typeof AutoApiOracleConfigSchema>;
export type NostrOracleConfig = z.infer<typeof NostrOracleConfigSchema>;

export function isAutoApiConfig(c: MarketSpec["oracle_config"]): c is AutoApiOracleConfig {
  return "provider" in c;
}
