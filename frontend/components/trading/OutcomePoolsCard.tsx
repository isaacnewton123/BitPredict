"use client";

import { SatsIcon } from "@/components/shared/SatsIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  calculateBetQuote,
  formatSats,
  type MarketItem,
  type MarketSide,
} from "@/lib/bitpredict-data";

interface OutcomePoolsCardProps {
  market: MarketItem;
  yesPct: number;
  noPct: number;
  yesExactPct: number;
  noExactPct: number;
  activeSide: MarketSide;
  isOpen: boolean;
  onSelectSide: (side: MarketSide) => void;
}

export function OutcomePoolsCard({
  market,
  yesPct,
  noPct,
  yesExactPct,
  noExactPct,
  activeSide,
  isOpen,
  onSelectSide,
}: OutcomePoolsCardProps) {
  const yesSampleQuote = calculateBetQuote(market, "YES", 1000);
  const noSampleQuote = calculateBetQuote(market, "NO", 1000);

  const rows = [
    {
      side: "YES" as const,
      label: "YES",
      pct: yesExactPct,
      displayPct: yesPct,
      poolSats: market.yesPool,
      mult: yesSampleQuote.multiplier,
      accentBg: "bg-[#149e61]",
      pillClass: "bg-[rgba(20,158,97,0.16)] text-[#026b3f]",
      btnActive: "bg-[#149e61] text-white border-[#149e61]",
      btnIdle:
        "bg-[rgba(20,158,97,0.12)] text-[#026b3f] border-transparent hover:bg-[#149e61] hover:text-white",
    },
    {
      side: "NO" as const,
      label: "NO",
      pct: noExactPct,
      displayPct: noPct,
      poolSats: market.noPool,
      mult: noSampleQuote.multiplier,
      accentBg: "bg-[#dc2626]",
      pillClass: "bg-[rgba(220,38,38,0.12)] text-[#b91c1c]",
      btnActive: "bg-[#dc2626] text-white border-[#dc2626]",
      btnIdle:
        "bg-[rgba(220,38,38,0.10)] text-[#b91c1c] border-transparent hover:bg-[#dc2626] hover:text-white",
    },
  ] as const;

  return (
    <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
      <div className="px-5 py-3.5 border-b border-[#dedee5] flex flex-wrap items-center justify-between gap-2 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
        <span>Outcome Pools (Parimutuel Liquidity)</span>
        {isOpen ? (
          <span>Implied Odds / Payout Multiplier</span>
        ) : (
          <StatusBadge status={market.status} outcome={market.outcome} size="sm" />
        )}
      </div>

      <div className="divide-y divide-[#dedee5]">
        {rows.map((row) => {
          const selected = activeSide === row.side;
          return (
            <div
              key={row.side}
              className={`px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                selected ? "bg-[rgba(133,91,251,0.04)]" : ""
              }`}
            >
              <div className="flex-1 min-w-0 space-y-1.5">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`px-2.5 py-0.5 text-[12px] font-bold rounded-[6px] ${row.pillClass}`}
                    >
                      {row.label}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-[#101114] tabular-nums">
                      <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{formatSats(row.poolSats)} sats staked</span>
                    </span>
                  </div>
                  <span className="text-[13px] font-medium text-[#686b82] tabular-nums">
                    {row.mult}× est.
                  </span>
                </div>

                <div className="w-full h-2 bg-[#dedee5]/70 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${row.accentBg} transition-all duration-300`}
                    style={{ width: `${Math.max(4, row.displayPct)}%` }}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                <span className="text-[20px] font-bold text-[#101114] tabular-nums sm:w-[58px] sm:text-right">
                  {row.pct.toFixed(0)}%
                </span>
                {isOpen && (
                  <button
                    type="button"
                    onClick={() => onSelectSide(row.side)}
                    className={`px-4 py-2 text-[13px] font-semibold rounded-[12px] border transition-colors cursor-pointer ${
                      selected ? row.btnActive : row.btnIdle
                    }`}
                  >
                    Buy {row.label}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
