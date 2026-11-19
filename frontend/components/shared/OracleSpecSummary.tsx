"use client";

import { LuCheck, LuDatabase, LuExternalLink, LuScale, LuShieldCheck } from "react-icons/lu";
import { formatUtcDisplay, type OracleTrack } from "@/lib/bitpredict-data";

const PROVIDER_LABELS: Record<string, string> = {
  "open-meteo": "Open-Meteo Weather",
  binance: "Binance Spot Market",
  mempool: "Mempool.space Bitcoin",
  coingecko: "CoinGecko Spot Price",
  frankfurter: "Frankfurter (ECB FX)",
  github: "GitHub Repository API",
  thesportsdb: "TheSportsDB Match Feed",
  opendota: "OpenDota Esports Feed",
};

const VALUE_PATH_LABELS: Record<string, string> = {
  "daily.precipitation_sum[0]": "Daily Precipitation (mm)",
  "daily.temperature_2m_max[0]": "Daily Max Temperature (°C)",
  "daily.temperature_2m_min[0]": "Daily Min Temperature (°C)",
  "daily.rain_sum[0]": "Daily Rainfall (mm)",
  "[0][4]": "Candle Close Price",
  "[0][2]": "Candle High Price",
  "[0][3]": "Candle Low Price",
  "[0][1]": "Candle Open Price",
  fastestFee: "Fastest Fee Rate (sat/vB)",
  halfHourFee: "30-Min Fee Rate (sat/vB)",
  hourFee: "60-Min Fee Rate (sat/vB)",
  $: "Block Tip Height",
  stargazers_count: "Repository Stars",
  forks_count: "Repository Forks",
  open_issues_count: "Open Issues",
  "events[0].intHomeScore": "Home Team Score",
  "events[0].intAwayScore": "Away Team Score",
  "events[0].strStatus": "Match Status",
};

const PARAM_KEY_LABELS: Record<string, string> = {
  latitude: "Latitude",
  longitude: "Longitude",
  start_date: "Start Date",
  end_date: "End Date",
  timezone: "Timezone",
  daily: "Weather Metric",
  symbol: "Trading Pair",
  interval: "Candle Interval",
  startTime: "Window Start",
  limit: "Candle Limit",
  endpoint: "Feed Endpoint",
  owner: "Owner",
  repo: "Repository",
  from: "Base Currency",
  to: "Quote Currency",
  date: "Reference Date",
  ids: "Asset",
  vs_currencies: "Quote Currency",
  id: "Event ID",
  match_id: "Match ID",
};

const OPERATOR_SYMBOLS: Record<string, string> = {
  ">=": "≥",
  "<=": "≤",
  "==": "=",
  "!=": "≠",
  ">": ">",
  "<": "<",
};

const SIGNER_POLICY_LABELS: Record<string, string> = {
  single_allowlisted: "Verified Single Signer (Optimistic Challenge Window)",
  quorum_2_of_3: "2-of-3 Multi-Signer Quorum",
};

function humanizeToken(raw: string): string {
  return raw
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

/** Formats an internal oracle provider identifier for human display. */
export function formatProviderName(provider: string): string {
  const key = provider.trim().toLowerCase();
  return PROVIDER_LABELS[key] ?? humanizeToken(provider);
}

/** Formats an oracle condition block into a clean comparison string such as ">= 100000". */
export function formatOracleCondition(oracleConfig: Record<string, unknown>): string | null {
  const cond = oracleConfig.condition as
    | { operator?: unknown; threshold?: unknown }
    | undefined;
  if (!cond || cond.operator === undefined || cond.threshold === undefined) {
    return null;
  }
  const op = String(cond.operator);
  const symbol = OPERATOR_SYMBOLS[op] ?? op;
  const threshold =
    typeof cond.threshold === "number"
      ? cond.threshold.toLocaleString("en-US")
      : String(cond.threshold);
  return `${symbol} ${threshold}`;
}

/** Maps a JSON value extraction path into a clear metric label. */
export function formatValuePathLabel(path: string): string {
  if (VALUE_PATH_LABELS[path]) return VALUE_PATH_LABELS[path];
  if (path.startsWith("rates.")) {
    return `Exchange Rate (${path.slice(6)})`;
  }
  const dotParts = path.split(".");
  if (dotParts.length === 2) {
    return `${humanizeToken(dotParts[0])} · ${humanizeToken(dotParts[1].replace(/\[\d+\]/g, ""))}`;
  }
  return humanizeToken(path.replace(/\[\d+\]/g, ""));
}

/** Maps a provider query parameter key into a clear human label. */
export function formatParamKey(key: string): string {
  return PARAM_KEY_LABELS[key] ?? humanizeToken(key);
}

/** Formats a signer verification policy identifier for public display. */
export function formatSignerPolicy(policy: string): string {
  return SIGNER_POLICY_LABELS[policy] ?? humanizeToken(policy);
}

function formatParamValue(key: string, val: unknown): string {
  if (key === "startTime" && typeof val === "number" && val > 1_000_000_000_000) {
    return formatUtcDisplay(new Date(val));
  }
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number") return String(val);
  return String(val ?? "—");
}

interface OracleSpecSummaryProps {
  oracleConfig: Record<string, unknown>;
  oracleTrack?: OracleTrack | string;
}

/** Structured human-readable contract specification display (zero raw JSON). */
export function OracleSpecSummary({ oracleConfig, oracleTrack }: OracleSpecSummaryProps) {
  const isAuto = oracleTrack === "auto_api" || typeof oracleConfig.provider === "string";

  if (isAuto) {
    const provider = String(oracleConfig.provider ?? "auto-feed");
    const valuePath = String(oracleConfig.value_path ?? "");
    const conditionText = formatOracleCondition(oracleConfig) ?? "Deterministic Rule";
    const params =
      oracleConfig.params &&
      typeof oracleConfig.params === "object" &&
      !Array.isArray(oracleConfig.params)
        ? (oracleConfig.params as Record<string, unknown>)
        : {};
    const paramEntries = Object.entries(params);

    return (
      <div className="p-4 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)] space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3 rounded-[10px] bg-white border border-[#dedee5]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
              Data Provider
            </p>
            <p className="text-[13px] font-semibold text-[#101114] mt-1 inline-flex items-center gap-1.5">
              <LuShieldCheck className="w-3.5 h-3.5 text-[#149e61] shrink-0" />
              <span>{formatProviderName(provider)}</span>
            </p>
          </div>

          <div className="p-3 rounded-[10px] bg-white border border-[#dedee5]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
              Measured Metric
            </p>
            <p className="text-[13px] font-semibold text-[#101114] mt-1">
              {valuePath ? formatValuePathLabel(valuePath) : "Configured Metric"}
            </p>
          </div>

          <div className="p-3 rounded-[10px] bg-white border border-[#dedee5]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
              YES Trigger Condition
            </p>
            <p className="text-[13px] font-bold text-[#026b3f] mt-1 tabular-nums">
              {conditionText}
            </p>
          </div>
        </div>

        {paramEntries.length > 0 && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9] mb-2 inline-flex items-center gap-1.5">
              <LuDatabase className="w-3.5 h-3.5 text-[#7132f5]" />
              <span>Locked Feed Parameters</span>
            </p>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {paramEntries.map(([key, value]) => (
                <div
                  key={key}
                  className="px-3 py-2 rounded-[10px] bg-white border border-[#dedee5] flex items-center justify-between gap-3 text-[12px]"
                >
                  <dt className="text-[#686b82]">{formatParamKey(key)}</dt>
                  <dd className="font-semibold text-[#101114] text-right break-words">
                    {formatParamValue(key, value)}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    );
  }

  const signerPolicy = String(oracleConfig.signer_policy ?? "single_allowlisted");
  const sources = Array.isArray(oracleConfig.suggested_sources)
    ? oracleConfig.suggested_sources.map((s) => String(s))
    : [];

  return (
    <div className="p-4 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)] space-y-3.5">
      <div className="p-3 rounded-[10px] bg-white border border-[#dedee5] flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9] inline-flex items-center gap-1.5">
          <LuScale className="w-3.5 h-3.5 text-[#7132f5]" />
          <span>Verification Policy</span>
        </span>
        <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(133,91,251,0.14)] text-[#7132f5] rounded-[8px]">
          {formatSignerPolicy(signerPolicy)}
        </span>
      </div>

      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9] mb-2">
          Official Reference Sources
        </p>
        {sources.length === 0 ? (
          <p className="text-[13px] text-[#686b82]">
            Verified public reporting and primary event announcements.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {sources.map((src) => (
              <li
                key={src}
                className="px-3 py-2 rounded-[10px] bg-white border border-[#dedee5] flex items-center justify-between gap-2 text-[13px]"
              >
                <span className="inline-flex items-center gap-2 text-[#101114] min-w-0">
                  <LuCheck className="w-3.5 h-3.5 text-[#149e61] shrink-0" />
                  <span className="truncate">{src}</span>
                </span>
                {/^https?:\/\//i.test(src) && (
                  <a
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7132f5] hover:underline shrink-0"
                  >
                    <span>Open</span>
                    <LuExternalLink className="w-3 h-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
