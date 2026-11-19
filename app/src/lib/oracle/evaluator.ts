import type { ConditionOperator, Side } from "@/lib/domain/constants";

export type ExtractedValue = number | string | boolean;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const EPSILON = 1e-9;

function tokenizePath(valuePath: string): Array<string | number> {
  const tokens: Array<string | number> = [];
  const re = /([A-Za-z0-9_$]+)|\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(valuePath)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1]);
    } else if (match[2] !== undefined) {
      tokens.push(Number(match[2]));
    }
  }
  return tokens;
}

export function extractValueAtPath(body: unknown, valuePath: string): ExtractedValue | null {
  const trimmed = valuePath.trim();
  if (!trimmed) return null;

  let current: unknown = body;
  if (trimmed !== "$") {
    const tokens = tokenizePath(trimmed);
    if (tokens.length === 0) return null;

    for (const token of tokens) {
      if (current === null || current === undefined || typeof current !== "object") {
        return null;
      }
      if (typeof token === "number") {
        if (!Array.isArray(current) || token < 0 || token >= current.length) {
          return null;
        }
        current = current[token];
      } else {
        if (Array.isArray(current) || FORBIDDEN_KEYS.has(token)) {
          return null;
        }
        current = (current as Record<string, unknown>)[token];
      }
    }
  }

  if (typeof current === "number") {
    return Number.isFinite(current) ? current : null;
  }
  if (typeof current === "string" || typeof current === "boolean") {
    return current;
  }
  return null;
}

function toNumber(v: ExtractedValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  const s = v.trim();
  if (!s) return null;
  if (s === "true") return 1;
  if (s === "false") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function evaluateOracleCondition(
  actual: ExtractedValue,
  condition: { operator: ConditionOperator; threshold: number | string },
): Side {
  const nActual = toNumber(actual);
  const nThreshold = toNumber(condition.threshold);

  if (nActual !== null && nThreshold !== null) {
    const eq = Math.abs(nActual - nThreshold) <= EPSILON;
    switch (condition.operator) {
      case ">":
        return nActual > nThreshold + EPSILON ? "YES" : "NO";
      case ">=":
        return nActual >= nThreshold - EPSILON ? "YES" : "NO";
      case "<":
        return nActual < nThreshold - EPSILON ? "YES" : "NO";
      case "<=":
        return nActual <= nThreshold + EPSILON ? "YES" : "NO";
      case "==":
        return eq ? "YES" : "NO";
      case "!=":
        return !eq ? "YES" : "NO";
    }
  }

  const sActual = String(actual).trim();
  const sThreshold = String(condition.threshold).trim();
  if (condition.operator === "==") return sActual === sThreshold ? "YES" : "NO";
  if (condition.operator === "!=") return sActual !== sThreshold ? "YES" : "NO";
  return "NO";
}
