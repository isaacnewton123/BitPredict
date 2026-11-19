import { z } from "zod";
import type { OracleProvider } from "@/lib/domain/constants";
import type { AutoApiOracleConfig } from "@/lib/domain/market-spec";

const dateYmd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD date");

export interface ProviderDefinition<TParams = Record<string, unknown>> {
  id: OracleProvider;
  baseUrl: string;
  description: string;
  paramSchema: z.ZodType<TParams>;
  allowedValuePaths: readonly RegExp[];
  settleDelaySec: number;
  historical: boolean;
  buildUrl(params: TParams): string;
}

const openMeteoDef: ProviderDefinition<{
  latitude: number;
  longitude: number;
  daily: string;
  timezone: string;
  start_date: string;
  end_date: string;
}> = {
  id: "open-meteo",
  baseUrl: "https://api.open-meteo.com/v1/forecast",
  description: "Weather forecasts/observations (latitude, longitude, daily, timezone, start_date, end_date)",
  paramSchema: z
    .object({
      latitude: z.number().min(-90).max(90),
      longitude: z.number().min(-180).max(180),
      daily: z.string().regex(/^[a-z0-9_]+$/).min(1).max(60),
      timezone: z.string().min(1).max(60),
      start_date: dateYmd,
      end_date: dateYmd,
    })
    .strict(),
  allowedValuePaths: [/^daily\.[a-z0-9_]+\[0\]$/],
  settleDelaySec: 7200,
  historical: true,
  buildUrl(p) {
    const qs = new URLSearchParams({
      latitude: String(p.latitude),
      longitude: String(p.longitude),
      daily: p.daily,
      timezone: p.timezone,
      start_date: p.start_date,
      end_date: p.end_date,
    });
    return `${this.baseUrl}?${qs.toString()}`;
  },
};

const binanceDef: ProviderDefinition<{
  symbol: string;
  interval: string;
  startTime?: number;
  limit?: number;
}> = {
  id: "binance",
  baseUrl: "https://api.binance.com/api/v3/klines",
  description: "Crypto spot kline prices (symbol e.g. BTCUSDT, interval e.g. 1m, optional startTime ms, limit)",
  paramSchema: z
    .object({
      symbol: z.string().regex(/^[A-Z0-9]{4,16}$/),
      interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
      startTime: z.number().int().positive().optional(),
      limit: z.number().int().min(1).max(10).optional(),
    })
    .strict(),
  allowedValuePaths: [/^\[0\]\[[1-5]\]$/],
  settleDelaySec: 60,
  historical: true,
  buildUrl(p) {
    const qs = new URLSearchParams({
      symbol: p.symbol,
      interval: p.interval,
      limit: String(p.limit ?? 1),
    });
    if (p.startTime !== undefined) {
      qs.set("startTime", String(p.startTime));
    }
    return `${this.baseUrl}?${qs.toString()}`;
  },
};

const mempoolDef: ProviderDefinition<{
  endpoint: "blocks/tip/height" | "v1/fees/recommended";
}> = {
  id: "mempool",
  baseUrl: "https://mempool.space/api",
  description: "Bitcoin chain tip height and fee rates (endpoint: blocks/tip/height | v1/fees/recommended)",
  paramSchema: z
    .object({
      endpoint: z.enum(["blocks/tip/height", "v1/fees/recommended"]),
    })
    .strict(),
  allowedValuePaths: [/^(\$|fastestFee|halfHourFee|hourFee)$/],
  settleDelaySec: 60,
  historical: false,
  buildUrl(p) {
    return `${this.baseUrl}/${p.endpoint}`;
  },
};

const coingeckoDef: ProviderDefinition<{
  ids: string;
  vs_currencies: string;
}> = {
  id: "coingecko",
  baseUrl: "https://api.coingecko.com/api/v3/simple/price",
  description: "Crypto spot snapshot price (ids e.g. bitcoin, vs_currencies e.g. usd)",
  paramSchema: z
    .object({
      ids: z.string().regex(/^[a-z0-9_-]{1,50}$/),
      vs_currencies: z.string().regex(/^[a-z]{3,5}$/),
    })
    .strict(),
  allowedValuePaths: [/^[a-z0-9_-]+\.[a-z]{3,5}$/],
  settleDelaySec: 0,
  historical: false,
  buildUrl(p) {
    const qs = new URLSearchParams({ ids: p.ids, vs_currencies: p.vs_currencies });
    return `${this.baseUrl}?${qs.toString()}`;
  },
};

const frankfurterDef: ProviderDefinition<{
  date: string;
  from: string;
  to: string;
}> = {
  id: "frankfurter",
  baseUrl: "https://api.frankfurter.app",
  description: "ECB foreign exchange rates (date YYYY-MM-DD or latest, from e.g. USD, to e.g. EUR)",
  paramSchema: z
    .object({
      date: z.union([dateYmd, z.literal("latest")]),
      from: z.string().regex(/^[A-Z]{3}$/),
      to: z.string().regex(/^[A-Z]{3}$/),
    })
    .strict(),
  allowedValuePaths: [/^rates\.[A-Z]{3}$/],
  settleDelaySec: 3600,
  historical: true,
  buildUrl(p) {
    const qs = new URLSearchParams({ from: p.from, to: p.to });
    return `${this.baseUrl}/${p.date}?${qs.toString()}`;
  },
};

const githubDef: ProviderDefinition<{
  owner: string;
  repo: string;
}> = {
  id: "github",
  baseUrl: "https://api.github.com/repos",
  description: "GitHub repository metrics (owner, repo; value_path: stargazers_count | forks_count | open_issues_count)",
  paramSchema: z
    .object({
      owner: z.string().regex(/^[A-Za-z0-9_.-]{1,39}$/),
      repo: z.string().regex(/^[A-Za-z0-9_.-]{1,100}$/),
    })
    .strict(),
  allowedValuePaths: [/^(stargazers_count|forks_count|open_issues_count)$/],
  settleDelaySec: 0,
  historical: false,
  buildUrl(p) {
    return `${this.baseUrl}/${encodeURIComponent(p.owner)}/${encodeURIComponent(p.repo)}`;
  },
};

const theSportsDbDef: ProviderDefinition<{
  id: string | number;
}> = {
  id: "thesportsdb",
  baseUrl: "https://www.thesportsdb.com/api/v1/json/3/lookupevent.php",
  description: "Sports event lookup by id (value_path: events[0].intHomeScore | intAwayScore | strStatus)",
  paramSchema: z
    .object({
      id: z.union([z.string().regex(/^\d{1,12}$/), z.number().int().positive()]),
    })
    .strict(),
  allowedValuePaths: [/^events\[0\]\.(intHomeScore|intAwayScore|strStatus)$/],
  settleDelaySec: 10800,
  historical: true,
  buildUrl(p) {
    const qs = new URLSearchParams({ id: String(p.id) });
    return `${this.baseUrl}?${qs.toString()}`;
  },
};

const openDotaDef: ProviderDefinition<{
  match_id: string | number;
}> = {
  id: "opendota",
  baseUrl: "https://api.opendota.com/api/matches",
  description: "Dota 2 match result by match_id (value_path: radiant_win | duration)",
  paramSchema: z
    .object({
      match_id: z.union([z.string().regex(/^\d{1,16}$/), z.number().int().positive()]),
    })
    .strict(),
  allowedValuePaths: [/^(radiant_win|duration)$/],
  settleDelaySec: 3600,
  historical: true,
  buildUrl(p) {
    return `${this.baseUrl}/${encodeURIComponent(String(p.match_id))}`;
  },
};

const PROVIDER_MAP: Record<OracleProvider, ProviderDefinition<never>> = {
  "open-meteo": openMeteoDef as ProviderDefinition<never>,
  binance: binanceDef as ProviderDefinition<never>,
  mempool: mempoolDef as ProviderDefinition<never>,
  coingecko: coingeckoDef as ProviderDefinition<never>,
  frankfurter: frankfurterDef as ProviderDefinition<never>,
  github: githubDef as ProviderDefinition<never>,
  thesportsdb: theSportsDbDef as ProviderDefinition<never>,
  opendota: openDotaDef as ProviderDefinition<never>,
};

export function getProviderDefinition(id: OracleProvider): ProviderDefinition<Record<string, unknown>> {
  return PROVIDER_MAP[id] as unknown as ProviderDefinition<Record<string, unknown>>;
}

export type RegistryValidationResult =
  | { ok: true; auditUrl: string; settleDelaySec: number }
  | { ok: false; errors: string[] };

export function validateAutoApiAgainstRegistry(config: AutoApiOracleConfig): RegistryValidationResult {
  const def = PROVIDER_MAP[config.provider] as unknown as ProviderDefinition<Record<string, unknown>> | undefined;
  if (!def) {
    return { ok: false, errors: [`Provider "${config.provider}" is not on the allowlist`] };
  }

  const errors: string[] = [];
  const parsedParams = def.paramSchema.safeParse(config.params);
  if (!parsedParams.success) {
    for (const issue of parsedParams.error.issues) {
      errors.push(`params.${issue.path.join(".") || "root"}: ${issue.message}`);
    }
  }

  if (config.provider === "open-meteo" && parsedParams.success) {
    const start = String(parsedParams.data.start_date);
    const end = String(parsedParams.data.end_date);
    if (start > end) {
      errors.push("params.start_date must be on or before params.end_date");
    }
  }

  const pathAllowed = def.allowedValuePaths.some((re) => re.test(config.value_path));
  if (!pathAllowed) {
    errors.push(`value_path "${config.value_path}" is not allowed for provider "${config.provider}"`);
  }

  if (errors.length > 0 || !parsedParams.success) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    auditUrl: def.buildUrl(parsedParams.data),
    settleDelaySec: def.settleDelaySec,
  };
}

export function getProviderRegistrySummary(): string {
  return (Object.values(PROVIDER_MAP) as ProviderDefinition<unknown>[])
    .map((p) => `- ${p.id} (settleDelay=${p.settleDelaySec}s, historical=${p.historical}): ${p.description}`)
    .join("\n");
}
