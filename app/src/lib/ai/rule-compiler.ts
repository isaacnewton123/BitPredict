import type { Category, ConditionOperator } from "@/lib/domain/constants";
import type { MarketSpec } from "@/lib/domain/market-spec";

interface CityEntry {
  name: string;
  lat: number;
  lon: number;
  tz: string;
  patterns: RegExp[];
}

const CITIES: readonly CityEntry[] = [
  { name: "Washington, D.C., USA", lat: 38.9072, lon: -77.0369, tz: "America/New_York", patterns: [/\bwashington(\s+city|\s*,?\s*d\.?c\.?)?\b/i] },
  { name: "New York City, USA", lat: 40.7128, lon: -74.006, tz: "America/New_York", patterns: [/\bnew\s+york\b/i, /\bnyc\b/i] },
  { name: "London, UK", lat: 51.5074, lon: -0.1278, tz: "Europe/London", patterns: [/\blondon\b/i] },
  { name: "Tokyo, Japan", lat: 35.6762, lon: 139.6503, tz: "Asia/Tokyo", patterns: [/\btokyo\b/i] },
  { name: "Paris, France", lat: 48.8566, lon: 2.3522, tz: "Europe/Paris", patterns: [/\bparis\b/i] },
  { name: "Berlin, Germany", lat: 52.52, lon: 13.405, tz: "Europe/Berlin", patterns: [/\bberlin\b/i] },
  { name: "Dakar, Senegal", lat: 14.7167, lon: -17.4677, tz: "Africa/Dakar", patterns: [/\bdakar\b/i] },
  { name: "Singapore", lat: 1.3521, lon: 103.8198, tz: "Asia/Singapore", patterns: [/\bsingapore\b/i] },
  { name: "Sydney, Australia", lat: -33.8688, lon: 151.2093, tz: "Australia/Sydney", patterns: [/\bsydney\b/i] },
];

const CRYPTO_PAIRS: readonly { re: RegExp; symbol: string; label: string }[] = [
  { re: /\b(btc|bitcoin)\b/i, symbol: "BTCUSDT", label: "BTC/USDT" },
  { re: /\b(eth|ethereum)\b/i, symbol: "ETHUSDT", label: "ETH/USDT" },
  { re: /\b(sol|solana)\b/i, symbol: "SOLUSDT", label: "SOL/USDT" },
  { re: /\b(xrp|ripple)\b/i, symbol: "XRPUSDT", label: "XRP/USDT" },
  { re: /\b(doge|dogecoin)\b/i, symbol: "DOGEUSDT", label: "DOGE/USDT" },
];

function validTimezone(tz?: string): string {
  if (!tz) return "UTC";
  try {
    Intl.DateTimeFormat("en-US", { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return "UTC";
  }
}

/** Returns local YYYY-MM-DD in `tz` for a given UTC Date. */
function localYmd(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "2026";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const d = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${y}-${m}-${d}`;
}

/** Converts a local wall-clock time (YYYY-MM-DD HH:mm:ss) in `tz` to a UTC Date. */
function localWallTimeToUtc(ymd: string, hour: number, minute: number, second: number, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const approxUtc = Date.UTC(y, m - 1, d, hour, minute, second);
  // Measure offset at approxUtc via Intl parts
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const p = fmt.formatToParts(new Date(approxUtc));
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  const h = get("hour") === 24 ? 0 : get("hour");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), h, get("minute"), get("second"));
  const offsetMs = asUtc - approxUtc;
  return new Date(approxUtc - offsetMs);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

interface ParsedWindow {
  cutoff: Date;
  deadline: Date;
  dateYmd: string;
  label: string;
  assumption?: string;
}

function resolveTimeWindow(prompt: string, now: Date, tz: string): ParsedWindow {
  // 1) "in N minutes / hours"
  const relMin = /\bin\s+(\d+)\s*(min|minute|minutes|m)\b/i.exec(prompt);
  if (relMin) {
    const mins = Math.max(2, Math.min(24 * 60, Number(relMin[1])));
    const deadline = new Date(now.getTime() + mins * 60_000);
    const cutoffLeadMs = Math.min(60_000, Math.floor((mins * 60_000) / 3));
    const cutoff = new Date(deadline.getTime() - Math.max(60_000, cutoffLeadMs));
    return {
      cutoff: cutoff.getTime() - now.getTime() < 65_000 ? new Date(now.getTime() + 65_000) : cutoff,
      deadline,
      dateYmd: deadline.toISOString().slice(0, 10),
      label: `in ${mins} minutes (${deadline.toISOString()})`,
      assumption: `Relative window '${relMin[0]}' anchored to ${deadline.toISOString()}`,
    };
  }

  const relHours = /\bin\s+(\d+)\s*(hour|hours|hr|hrs|h)\b/i.exec(prompt);
  if (relHours) {
    const hours = Math.max(1, Math.min(720, Number(relHours[1])));
    const deadline = new Date(now.getTime() + hours * 3_600_000);
    const cutoff = new Date(deadline.getTime() - 10 * 60_000);
    return {
      cutoff,
      deadline,
      dateYmd: deadline.toISOString().slice(0, 10),
      label: `in ${hours} hour(s)`,
      assumption: `Relative window '${relHours[0]}' anchored to ${deadline.toISOString()}`,
    };
  }

  // 2) "tomorrow"
  if (/\btomorrow\b/i.test(prompt)) {
    const todayLocal = localYmd(now, tz);
    const tomorrowYmd = addDaysYmd(todayLocal, 1);
    const startUtc = localWallTimeToUtc(tomorrowYmd, 0, 0, 0, tz);
    const endUtc = localWallTimeToUtc(tomorrowYmd, 23, 59, 59, tz);
    const minCutoff = new Date(now.getTime() + 120_000);
    return {
      cutoff: startUtc > minCutoff ? startUtc : minCutoff,
      deadline: endUtc,
      dateYmd: tomorrowYmd,
      label: tomorrowYmd,
      assumption: `'tomorrow' = ${tomorrowYmd} in ${tz}`,
    };
  }

  // 3) Explicit ISO date YYYY-MM-DD
  const isoMatch = /\b(202\d-\d{2}-\d{2})\b/.exec(prompt);
  if (isoMatch) {
    const ymd = isoMatch[1];
    const endUtc = localWallTimeToUtc(ymd, 23, 59, 59, tz);
    const startUtc = localWallTimeToUtc(ymd, 0, 0, 0, tz);
    const minCutoff = new Date(now.getTime() + 120_000);
    const deadline = endUtc > minCutoff ? endUtc : new Date(now.getTime() + 24 * 3_600_000);
    const cutoff = startUtc > minCutoff && startUtc < deadline ? startUtc : new Date(deadline.getTime() - 3_600_000);
    return {
      cutoff: cutoff > minCutoff ? cutoff : minCutoff,
      deadline,
      dateYmd: ymd,
      label: ymd,
    };
  }

  // 4) Default 7-day horizon
  const fallbackYmd = addDaysYmd(localYmd(now, "UTC"), 7);
  const deadline = new Date(`${fallbackYmd}T23:59:59Z`);
  const cutoff = new Date(deadline.getTime() - 3_600_000);
  return {
    cutoff,
    deadline,
    dateYmd: fallbackYmd,
    label: `by ${fallbackYmd}`,
    assumption: `No explicit deadline provided; defaulted to ${fallbackYmd}T23:59:59Z`,
  };
}

function parseOperatorAndNumber(prompt: string, defaultThreshold: number): {
  operator: ConditionOperator;
  threshold: number;
  rawUnit?: string;
} {
  let operator: ConditionOperator = ">=";
  if (/\b(below|under|less\s+than|drop\s+below|fall\s+under|lower\s+than)\b/i.test(prompt)) {
    operator = "<";
  } else if (/\b(above|exceed|more\s+than|over|higher\s+than)\b/i.test(prompt) && !/\b(reach|at\s+least|or\s+more)\b/i.test(prompt)) {
    operator = ">";
  } else if (prompt.includes(">=")) {
    operator = ">=";
  } else if (prompt.includes("<=")) {
    operator = "<=";
  } else if (prompt.includes("==")) {
    operator = "==";
  } else if (/(?:^|\s)>/.test(prompt)) {
    operator = ">";
  } else if (/(?:^|\s)</.test(prompt)) {
    operator = "<";
  }

  // Match numbers (ignoring years 2024..2030 if standalone after "in"/"on"/"by")
  const cleanedForNum = prompt.replace(/\b202\d-\d{2}-\d{2}\b/g, " ").replace(/\bin\s+\d+\s*(min|minute|minutes|hour|hours|h|m|days?)\b/gi, " ");
  const m = /(?:\$|€|£)?\s*(-?\d{1,3}(?:,\d{3})*(?:\.\d+)?|-?\d+(?:\.\d+)?)\s*(k\b|m\b|°?\s*[cf]\b|%)?/i.exec(cleanedForNum);
  if (!m) return { operator, threshold: defaultThreshold };

  let num = Number(m[1].replace(/,/g, ""));
  const unit = (m[2] ?? "").trim().toLowerCase();
  if (unit === "k") num *= 1_000;
  if (unit === "m") num *= 1_000_000;
  return { operator, threshold: num, rawUnit: unit || undefined };
}

function classifyCategory(prompt: string): Category {
  const p = prompt.toLowerCase();
  if (/\b(temp|temperature|rain|rainfall|precip|weather|snow|wind|celsius|fahrenheit|°c|°f|degrees?)\b/i.test(p)) {
    return "Weather";
  }
  if (/\b(github|stars|forks|open\s+issues|repo|repository)\b/i.test(p)) {
    return "Technology";
  }
  if (/\b(btc|bitcoin|eth|ethereum|sol|solana|xrp|doge|crypto|mempool|block\s+height|sat\/vb|halving|altcoin|coingecko)\b/i.test(p)) {
    return "Crypto";
  }
  if (/\b(eur\/usd|usd\/eur|gbp\/usd|usd\/jpy|fx|exchange\s+rate|forex|currency\s+pair|eur|jpy|gbp|chf)\b/i.test(p)) {
    return "Finance";
  }
  if (/\b(github|repo|stars|forks|release|open\s+source|ai\s+model|llm|openai|anthropic|apple|iphone|android|linux|software|launch)\b/i.test(p)) {
    return "Technology";
  }
  if (/\b(dota|opendota|cs2|cs:go|valorant|league\s+of\s+legends|esports?|tournament|ti\d+|major\s+final|lol\s+worlds)\b/i.test(p)) {
    return "Esports";
  }
  if (/\b(nba|nfl|fifa|world\s+cup|champions\s+league|premier\s+league|ufc|f1|formula\s+1|tennis|olympics|match|win\s+the\s+game|afcon|senegal\s+national|thesportsdb)\b/i.test(p)) {
    return "Sports";
  }
  if (/\b(cpi|inflation|fed|federal\s+reserve|interest\s+rate|rate\s+cut|gdp|recession|unemployment|payroll|ecb|central\s+bank)\b/i.test(p)) {
    return "Economy";
  }
  if (/\b(election|president|senate|congress|parliament|bill|law|minister|prime\s+minister|referendum|vote|treaty|sanction|mayor|governor)\b/i.test(p)) {
    return "Politics";
  }
  return "Culture";
}

function cleanTitle(prompt: string): string {
  const trimmed = prompt.trim().replace(/\?+$/, "");
  return trimmed.length > 115 ? `${trimmed.slice(0, 112)}...` : trimmed;
}

export function compilePromptRuleBased(
  prompt: string,
  opts: { now?: Date; timezone?: string } = {},
): MarketSpec {
  const now = opts.now ?? new Date();
  const userTz = validTimezone(opts.timezone);
  const category = classifyCategory(prompt);
  const assumptions: string[] = [];

  if (category === "Weather") {
    const city = CITIES.find((c) => c.patterns.some((re) => re.test(prompt))) ?? CITIES[0];
    if (!CITIES.some((c) => c.patterns.some((re) => re.test(prompt)))) {
      assumptions.push(`City defaulted to ${city.name}`);
    } else {
      assumptions.push(`Location matched to ${city.name}`);
    }
    const win = resolveTimeWindow(prompt, now, city.tz);
    if (win.assumption) assumptions.push(win.assumption);
    assumptions.push(`Day boundaries use local time (${city.tz})`);

    const isRain = /\b(rain|rainfall|precip|precipitation)\b/i.test(prompt);
    const daily = isRain ? "precipitation_sum" : "temperature_2m_max";
    const parsed = parseOperatorAndNumber(prompt, isRain ? 1.0 : 20.0);
    let threshold = parsed.threshold;
    if (!isRain && parsed.rawUnit?.includes("f")) {
      threshold = Number((((threshold - 32) * 5) / 9).toFixed(1));
      assumptions.push(`Converted Fahrenheit threshold to ${threshold}°C`);
    }

    const resolveAfter = new Date(win.deadline.getTime() + 7200 * 1000);
    return {
      title: `${city.name.split(",")[0]} ${isRain ? "Precipitation" : "Max Temp"} ${parsed.operator} ${threshold}${isRain ? "mm" : "°C"} (${win.dateYmd})`,
      question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
      category: "Weather",
      resolution_track: "auto_api",
      rules: `Resolves YES if Open-Meteo daily ${daily} for ${city.name} (${city.lat}, ${city.lon}, ${city.tz}) on ${win.dateYmd} is ${parsed.operator} ${threshold}. Resolves NO otherwise. VOID if data unavailable 24h after resolve time.`,
      betting_cutoff_utc: win.cutoff.toISOString(),
      deadline_utc: win.deadline.toISOString(),
      resolve_after_utc: resolveAfter.toISOString(),
      invalid_conditions: ["Open-Meteo data unavailable 24h after resolve_after_utc"],
      oracle_config: {
        provider: "open-meteo",
        params: {
          latitude: city.lat,
          longitude: city.lon,
          daily,
          timezone: city.tz,
          start_date: win.dateYmd,
          end_date: win.dateYmd,
        },
        value_path: `daily.${daily}[0]`,
        condition: { operator: parsed.operator, threshold },
      },
      assumptions,
      ai_confidence: 0.9,
    };
  }

  if (category === "Crypto") {
    const win = resolveTimeWindow(prompt, now, userTz);
    if (win.assumption) assumptions.push(win.assumption);

    if (/\b(block\s+height|mempool|sat\/vb|fee\s+rate)\b/i.test(prompt)) {
      const isFee = /\b(sat\/vb|fee\s+rate)\b/i.test(prompt);
      const parsed = parseOperatorAndNumber(prompt, isFee ? 20 : 900_000);
      const resolveAfter = new Date(win.deadline.getTime() + 60_000);
      assumptions.push(`Bitcoin chain metric sourced from mempool.space (${isFee ? "fastestFee" : "tip height"})`);
      return {
        title: cleanTitle(prompt),
        question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
        category: "Crypto",
        resolution_track: "auto_api",
        rules: `Resolves YES if mempool.space ${isFee ? "fastestFee (sat/vB)" : "block tip height"} at deadline is ${parsed.operator} ${parsed.threshold}.`,
        betting_cutoff_utc: win.cutoff.toISOString(),
        deadline_utc: win.deadline.toISOString(),
        resolve_after_utc: resolveAfter.toISOString(),
        invalid_conditions: ["Mempool.space API unreachable for 24h"],
        oracle_config: {
          provider: "mempool",
          params: { endpoint: isFee ? "v1/fees/recommended" : "blocks/tip/height" },
          value_path: isFee ? "fastestFee" : "$",
          condition: { operator: parsed.operator, threshold: parsed.threshold },
        },
        assumptions,
        ai_confidence: 0.88,
      };
    }

    if (/\bcoingecko\b/i.test(prompt)) {
      const pair = CRYPTO_PAIRS.find((c) => c.re.test(prompt)) ?? CRYPTO_PAIRS[0];
      const coinIdMap: Record<string, string> = {
        BTCUSDT: "bitcoin",
        ETHUSDT: "ethereum",
        SOLUSDT: "solana",
        XRPUSDT: "ripple",
        DOGEUSDT: "dogecoin",
      };
      const coinId = coinIdMap[pair.symbol] ?? "bitcoin";
      const vsCurrency = /\b(in\s+eur|\/eur|€)\b/i.test(prompt) ? "eur" : "usd";
      const parsed = parseOperatorAndNumber(prompt, 100_000);
      assumptions.push(`Price referenced to CoinGecko ${coinId}/${vsCurrency} simple price`);
      return {
        title: `CoinGecko ${pair.label} ${parsed.operator} ${parsed.threshold.toLocaleString("en-US")} (${win.label})`.slice(0, 120),
        question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
        category: "Crypto",
        resolution_track: "auto_api",
        rules: `Resolves YES if CoinGecko spot price (${coinId}/${vsCurrency}) at ${win.deadline.toISOString()} is ${parsed.operator} ${parsed.threshold}. Resolves NO otherwise.`,
        betting_cutoff_utc: win.cutoff.toISOString(),
        deadline_utc: win.deadline.toISOString(),
        resolve_after_utc: win.deadline.toISOString(),
        invalid_conditions: ["CoinGecko API unavailable for 24h"],
        oracle_config: {
          provider: "coingecko",
          params: { ids: coinId, vs_currencies: vsCurrency },
          value_path: `${coinId}.${vsCurrency}`,
          condition: { operator: parsed.operator, threshold: parsed.threshold },
        },
        assumptions,
        ai_confidence: 0.88,
      };
    }

    const pair = CRYPTO_PAIRS.find((c) => c.re.test(prompt)) ?? CRYPTO_PAIRS[0];
    const parsed = parseOperatorAndNumber(prompt, 100_000);
    const resolveAfter = new Date(win.deadline.getTime() + 60_000);
    assumptions.push(`Price referenced to Binance spot ${pair.label} 1m kline close`);

    return {
      title: `${pair.label} ${parsed.operator} $${parsed.threshold.toLocaleString("en-US")} (${win.label})`.slice(0, 120),
      question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
      category: "Crypto",
      resolution_track: "auto_api",
      rules: `Resolves YES if Binance ${pair.symbol} 1-minute candle close at ${win.deadline.toISOString()} is ${parsed.operator} ${parsed.threshold}. Resolves NO otherwise.`,
      betting_cutoff_utc: win.cutoff.toISOString(),
      deadline_utc: win.deadline.toISOString(),
      resolve_after_utc: resolveAfter.toISOString(),
      invalid_conditions: ["Binance API unavailable for 24h"],
      oracle_config: {
        provider: "binance",
        params: {
          symbol: pair.symbol,
          interval: "1m",
          startTime: win.deadline.getTime(),
          limit: 1,
        },
        value_path: "[0][4]",
        condition: { operator: parsed.operator, threshold: parsed.threshold },
      },
      assumptions,
      ai_confidence: 0.91,
    };
  }

  if (category === "Finance") {
    const win = resolveTimeWindow(prompt, now, userTz);
    if (win.assumption) assumptions.push(win.assumption);
    const pairMatch = /\b([A-Z]{3})\s*\/\s*([A-Z]{3})\b/.exec(prompt.toUpperCase());
    const from = pairMatch?.[1] ?? "EUR";
    const to = pairMatch?.[2] ?? "USD";
    const parsed = parseOperatorAndNumber(prompt, 1.05);
    const resolveAfter = new Date(win.deadline.getTime() + 3600 * 1000);
    assumptions.push(`FX rate ${from}/${to} sourced from ECB via Frankfurter API`);

    return {
      title: `${from}/${to} ${parsed.operator} ${parsed.threshold} (${win.dateYmd})`.slice(0, 120),
      question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
      category: "Finance",
      resolution_track: "auto_api",
      rules: `Resolves YES if Frankfurter ECB reference rate ${from}->${to} on ${win.dateYmd} is ${parsed.operator} ${parsed.threshold}.`,
      betting_cutoff_utc: win.cutoff.toISOString(),
      deadline_utc: win.deadline.toISOString(),
      resolve_after_utc: resolveAfter.toISOString(),
      invalid_conditions: ["ECB rate unavailable on non-business day after 24h fallback"],
      oracle_config: {
        provider: "frankfurter",
        params: { date: win.dateYmd, from, to },
        value_path: `rates.${to}`,
        condition: { operator: parsed.operator, threshold: parsed.threshold },
      },
      assumptions,
      ai_confidence: 0.87,
    };
  }

  if (category === "Technology") {
    const win = resolveTimeWindow(prompt, now, userTz);
    if (win.assumption) assumptions.push(win.assumption);
    const repoMatch = /\b([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\b/.exec(prompt);
    if (repoMatch || /\b(github|stars|forks)\b/i.test(prompt)) {
      const owner = repoMatch?.[1] ?? "bitcoin";
      const repo = repoMatch?.[2] ?? "bitcoin";
      const metric = /\bforks\b/i.test(prompt) ? "forks_count" : "stargazers_count";
      const parsed = parseOperatorAndNumber(prompt, 80_000);
      assumptions.push(`GitHub repository resolved as ${owner}/${repo} (${metric})`);
      return {
        title: `${owner}/${repo} ${metric} ${parsed.operator} ${parsed.threshold}`.slice(0, 120),
        question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
        category: "Technology",
        resolution_track: "auto_api",
        rules: `Resolves YES if GitHub repository ${owner}/${repo} ${metric} at deadline is ${parsed.operator} ${parsed.threshold}.`,
        betting_cutoff_utc: win.cutoff.toISOString(),
        deadline_utc: win.deadline.toISOString(),
        resolve_after_utc: win.deadline.toISOString(),
        invalid_conditions: ["Repository deleted or made private"],
        oracle_config: {
          provider: "github",
          params: { owner, repo },
          value_path: metric,
          condition: { operator: parsed.operator, threshold: parsed.threshold },
        },
        assumptions,
        ai_confidence: 0.88,
      };
    }
  }

  if (category === "Sports" && /\bthesportsdb\b/i.test(prompt)) {
    const idMatch =
      /\b(?:event(?:\s+id)?|id)\s*[:#=]?\s*(\d{1,12})\b/i.exec(prompt) ??
      /\bthesportsdb\s*[:#]?\s*(\d{1,12})\b/i.exec(prompt);
    if (idMatch) {
      const eventId = idMatch[1];
      const win = resolveTimeWindow(prompt, now, userTz);
      if (win.assumption) assumptions.push(win.assumption);
      const cleanedPrompt = prompt.replace(idMatch[0], " ");
      const isAway = /\b(away|visitors?)\b/i.test(prompt);
      const isStatus = /\bstatus\b/i.test(prompt);
      const valuePath = isStatus
        ? "events[0].strStatus"
        : isAway
          ? "events[0].intAwayScore"
          : "events[0].intHomeScore";
      const parsed = parseOperatorAndNumber(cleanedPrompt, 1);
      const condition = isStatus
        ? { operator: "==" as const, threshold: "Match Finished" }
        : { operator: parsed.operator, threshold: parsed.threshold };
      const resolveAfter = new Date(win.deadline.getTime() + 10_800 * 1000);
      assumptions.push(`Sports event #${eventId} resolved via TheSportsDB (${valuePath})`);
      return {
        title: cleanTitle(prompt),
        question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
        category: "Sports",
        resolution_track: "auto_api",
        rules: `Resolves YES if TheSportsDB event ${eventId} field ${valuePath} is ${condition.operator} ${condition.threshold} after ${win.deadline.toISOString()}. Resolves NO otherwise.`,
        betting_cutoff_utc: win.cutoff.toISOString(),
        deadline_utc: win.deadline.toISOString(),
        resolve_after_utc: resolveAfter.toISOString(),
        invalid_conditions: ["TheSportsDB event postponed, cancelled, or missing 24h after resolve time"],
        oracle_config: {
          provider: "thesportsdb",
          params: { id: eventId },
          value_path: valuePath,
          condition,
        },
        assumptions,
        ai_confidence: 0.86,
      };
    }
  }

  if (category === "Esports" && /\bopendota\b/i.test(prompt)) {
    const idMatch =
      /\b(?:match(?:\s+id)?|id|opendota)\s*[:#/=]?\s*(\d{4,16})\b/i.exec(prompt);
    if (idMatch) {
      const matchId = idMatch[1];
      const win = resolveTimeWindow(prompt, now, userTz);
      if (win.assumption) assumptions.push(win.assumption);
      const cleanedPrompt = prompt.replace(idMatch[0], " ");
      const isDuration = /\b(duration|minutes|seconds|last\s+over|longer\s+than)\b/i.test(prompt);
      let valuePath = "radiant_win";
      let condition: { operator: ConditionOperator; threshold: number } = {
        operator: "==",
        threshold: /\b(dire\s+win|radiant\s+lose|no\s+radiant)\b/i.test(prompt) ? 0 : 1,
      };
      if (isDuration) {
        valuePath = "duration";
        const parsed = parseOperatorAndNumber(cleanedPrompt, 2400);
        const seconds =
          /\bmin(?:ute)?s?\b/i.test(cleanedPrompt) && parsed.threshold < 300
            ? Math.round(parsed.threshold * 60)
            : parsed.threshold;
        condition = { operator: parsed.operator, threshold: seconds };
      }
      const resolveAfter = new Date(win.deadline.getTime() + 3_600 * 1000);
      assumptions.push(`Dota 2 match #${matchId} resolved via OpenDota (${valuePath})`);
      return {
        title: cleanTitle(prompt),
        question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
        category: "Esports",
        resolution_track: "auto_api",
        rules: `Resolves YES if OpenDota match ${matchId} field ${valuePath} satisfies ${condition.operator} ${condition.threshold} after ${win.deadline.toISOString()}. Resolves NO otherwise.`,
        betting_cutoff_utc: win.cutoff.toISOString(),
        deadline_utc: win.deadline.toISOString(),
        resolve_after_utc: resolveAfter.toISOString(),
        invalid_conditions: ["OpenDota match id not found or voided after 24h"],
        oracle_config: {
          provider: "opendota",
          params: { match_id: matchId },
          value_path: valuePath,
          condition,
        },
        assumptions,
        ai_confidence: 0.87,
      };
    }
  }

  // Track B (nostr_oracle) for Politics, Economy, Culture, Sports, Esports, and general Tech
  const win = resolveTimeWindow(prompt, now, userTz);
  if (win.assumption) assumptions.push(win.assumption);
  assumptions.push(`Category '${category}' routed to Nostr community oracle with 1h challenge window`);

  const sourcesByCategory: Record<string, string[]> = {
    Politics: ["Official government / electoral commission release", "Associated Press / Reuters"],
    Economy: ["Federal Reserve / Central Bank official press release", "Bureau of Labor Statistics / Eurostat"],
    Sports: ["Official league match report", "BBC Sport / ESPN box score"],
    Esports: ["Liquipedia / HLTV official match page", "Tournament organizer announcement"],
    Technology: ["Official vendor announcement blog", "GitHub / technical release notes"],
    Culture: ["Official event / academy announcement", "Variety / Billboard"],
  };

  const resolveAfter = new Date(win.deadline.getTime() + 3600 * 1000);
  return {
    title: cleanTitle(prompt),
    question: prompt.trim().endsWith("?") ? prompt.trim() : `${prompt.trim()}?`,
    category,
    resolution_track: "nostr_oracle",
    rules: `Resolves YES if credible primary sources confirm the stated outcome before ${win.deadline.toISOString()}. Resolves NO otherwise. VOID if the event is cancelled.`,
    betting_cutoff_utc: win.cutoff.toISOString(),
    deadline_utc: win.deadline.toISOString(),
    resolve_after_utc: resolveAfter.toISOString(),
    invalid_conditions: ["Event cancelled or postponed past resolution window"],
    oracle_config: {
      signer_policy: "platform_signer",
      suggested_sources: sourcesByCategory[category] ?? sourcesByCategory.Culture,
    },
    assumptions,
    ai_confidence: 0.85,
  };
}
