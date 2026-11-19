"use client";

import { useMemo, useState } from "react";
import {
  formatSats,
  formatUtcDisplay,
  type MarketTradePoint,
} from "@/lib/bitpredict-data";

export type ChartRange = "1H" | "6H" | "1D" | "1W" | "ALL";

const CHART_W = 720;
const CHART_H = 240;
const PAD_L = 14;
const PAD_R = 46;
const PAD_T = 16;
const PAD_B = 28;

interface ProbabilityChartCardProps {
  points: MarketTradePoint[];
  yesExactPct: number;
  noExactPct: number;
}

export function ProbabilityChartCard({
  points,
  yesExactPct,
  noExactPct,
}: ProbabilityChartCardProps) {
  const [chartRange, setChartRange] = useState<ChartRange>("ALL");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const visiblePoints = useMemo(() => {
    if (chartRange === "ALL" || points.length <= 2) return points;
    const rangeMs: Record<Exclude<ChartRange, "ALL">, number> = {
      "1H": 3_600_000,
      "6H": 6 * 3_600_000,
      "1D": 24 * 3_600_000,
      "1W": 7 * 24 * 3_600_000,
    };
    const latestTs = Date.parse(points[points.length - 1]?.t ?? "");
    const cutoff = (Number.isFinite(latestTs) ? latestTs : 0) - rangeMs[chartRange];
    const filtered = points.filter((pt) => Date.parse(pt.t) >= cutoff);
    if (filtered.length >= 2) return filtered;
    return points.slice(-Math.min(points.length, 4));
  }, [points, chartRange]);

  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const coords = visiblePoints.map((pt, idx) => {
    const x =
      visiblePoints.length === 1
        ? PAD_L + plotW
        : PAD_L + (idx / (visiblePoints.length - 1)) * plotW;
    const yYes = PAD_T + ((100 - Math.min(100, Math.max(0, pt.yes_pct))) / 100) * plotH;
    const yNo = PAD_T + ((100 - Math.min(100, Math.max(0, pt.no_pct))) / 100) * plotH;
    return { x, yYes, yNo, pt };
  });

  const yesPathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.yYes.toFixed(1)}`)
    .join(" ");
  const noPathD = coords
    .map((c, i) => `${i === 0 ? "M" : "L"} ${c.x.toFixed(1)} ${c.yNo.toFixed(1)}`)
    .join(" ");
  const yesAreaD =
    coords.length > 0
      ? `${yesPathD} L ${coords[coords.length - 1].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(PAD_T + plotH).toFixed(1)} Z`
      : "";

  const inspectedIdx =
    hoverIdx !== null && hoverIdx >= 0 && hoverIdx < coords.length
      ? hoverIdx
      : coords.length - 1;
  const inspected = coords[inspectedIdx] ?? null;
  const firstPct = coords[0]?.pt.yes_pct ?? 50;
  const deltaFromOpen =
    Math.round(((inspected?.pt.yes_pct ?? yesExactPct) - firstPct) * 10) / 10;

  return (
    <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-4">
        <div>
          <div className="flex flex-wrap items-baseline gap-2.5">
            <span className="text-[32px] font-bold leading-none text-[#101114] tabular-nums">
              {(inspected?.pt.yes_pct ?? yesExactPct).toFixed(1)}%
            </span>
            <span className="text-[15px] font-semibold text-[#026b3f]">
              chance YES
            </span>
            <span
              className={`text-[13px] font-semibold tabular-nums ${
                deltaFromOpen >= 0 ? "text-[#026b3f]" : "text-[#dc2626]"
              }`}
            >
              {deltaFromOpen >= 0 ? `▲ +${deltaFromOpen}` : `▼ ${deltaFromOpen}`}%
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-[12px] font-semibold">
            <span className="inline-flex items-center gap-1.5 text-[#026b3f]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#149e61]" />
              <span>YES {(inspected?.pt.yes_pct ?? yesExactPct).toFixed(1)}%</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-[#dc2626]">
              <span className="w-2.5 h-2.5 rounded-full bg-[#dc2626]" />
              <span>NO {(inspected?.pt.no_pct ?? noExactPct).toFixed(1)}%</span>
            </span>
            {inspected && (
              <span className="text-[#686b82] font-normal tabular-nums">
                Pool at point:{" "}
                <strong className="text-[#101114]">
                  {formatSats(inspected.pt.pool_sats)} sats
                </strong>{" "}
                · {formatUtcDisplay(inspected.pt.t)}
              </span>
            )}
          </div>
        </div>

        <div className="inline-flex items-center gap-1 p-1 bg-[rgba(148,151,169,0.08)] rounded-[10px] self-start">
          {(["1H", "6H", "1D", "1W", "ALL"] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setChartRange(r);
                setHoverIdx(null);
              }}
              className={`px-2.5 py-1 text-[12px] font-semibold rounded-[8px] transition-colors cursor-pointer ${
                chartRange === r
                  ? "bg-white text-[#101114] shadow-micro"
                  : "text-[#686b82] hover:text-[#101114]"
              }`}
            >
              {r}
            </button>
          ))}
        </div>
      </div>

      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full h-[220px] sm:h-[250px] overflow-visible select-none"
          onMouseMove={(e) => {
            if (coords.length <= 1) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const relX = ((e.clientX - rect.left) / Math.max(1, rect.width)) * CHART_W;
            let best = 0;
            let bestDist = Infinity;
            coords.forEach((c, idx) => {
              const d = Math.abs(c.x - relX);
              if (d < bestDist) {
                bestDist = d;
                best = idx;
              }
            });
            setHoverIdx(best);
          }}
          onMouseLeave={() => setHoverIdx(null)}
        >
          <defs>
            <linearGradient id="yesAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#149e61" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#149e61" stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {[0, 25, 50, 75, 100].map((pct) => {
            const y = PAD_T + ((100 - pct) / 100) * plotH;
            return (
              <g key={pct}>
                <line
                  x1={PAD_L}
                  x2={CHART_W - PAD_R}
                  y1={y}
                  y2={y}
                  stroke="#dedee5"
                  strokeDasharray={pct === 50 ? "4 4" : undefined}
                  strokeWidth={1}
                />
                <text
                  x={CHART_W - PAD_R + 8}
                  y={y + 4}
                  fontSize={11}
                  fill="#9497a9"
                  fontFamily="monospace"
                >
                  {pct}%
                </text>
              </g>
            );
          })}

          {yesAreaD && <path d={yesAreaD} fill="url(#yesAreaGrad)" />}
          {noPathD && (
            <path
              d={noPathD}
              fill="none"
              stroke="#dc2626"
              strokeOpacity={0.45}
              strokeDasharray="4 4"
              strokeWidth={1.6}
            />
          )}
          {yesPathD && (
            <path
              d={yesPathD}
              fill="none"
              stroke="#149e61"
              strokeWidth={2.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {inspected && (
            <g>
              <line
                x1={inspected.x}
                x2={inspected.x}
                y1={PAD_T}
                y2={PAD_T + plotH}
                stroke="#7132f5"
                strokeOpacity={0.35}
                strokeDasharray="3 3"
              />
              <circle
                cx={inspected.x}
                cy={inspected.yNo}
                r={4}
                fill="#dc2626"
                stroke="#ffffff"
                strokeWidth={1.5}
              />
              <circle
                cx={inspected.x}
                cy={inspected.yYes}
                r={5.5}
                fill="#149e61"
                stroke="#ffffff"
                strokeWidth={2}
              />
            </g>
          )}

          {coords.length >= 2 && (
            <>
              <text x={PAD_L} y={CHART_H - 6} fontSize={11} fill="#9497a9">
                {formatUtcDisplay(coords[0].pt.t)}
              </text>
              <text
                x={CHART_W - PAD_R}
                y={CHART_H - 6}
                textAnchor="end"
                fontSize={11}
                fill="#9497a9"
              >
                Now
              </text>
            </>
          )}
        </svg>
      </div>
    </div>
  );
}
