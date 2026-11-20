"use client";

import Link from "next/link";
import { LuDatabase, LuRefreshCw, LuShieldCheck } from "react-icons/lu";
import {
  formatOracleCondition,
  formatProviderName,
} from "@/components/shared/OracleSpecSummary";
import { SatsIcon } from "@/components/shared/SatsIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { formatSats, type MarketItem } from "@/lib/bitpredict-data";

interface AdminFeedsOpsPanelProps {
  trackAMarkets: MarketItem[];
  canAct: boolean;
  busyId: string | null;
  seedingDemo: boolean;
  onRequestTrackAResolve: (market: MarketItem) => void;
  onRequestSeedDemo: () => void;
}

/** Automated data-feed status table and workspace operations panel. */
export function AdminFeedsOpsPanel({
  trackAMarkets,
  canAct,
  busyId,
  seedingDemo,
  onRequestTrackAResolve,
  onRequestSeedDemo,
}: AdminFeedsOpsPanelProps) {
  return (
    <div className="space-y-6">
      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
        <div className="px-5 py-4 border-b border-[#dedee5] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <LuShieldCheck className="w-5 h-5 text-[#149e61]" />
            <h2 className="text-[17px] font-bold text-[#101114]">
              Automated Data Feeds ({trackAMarkets.length})
            </h2>
          </div>
          <span className="text-[12px] text-[#686b82]">
            Deterministic public API resolution checks
          </span>
        </div>

        {trackAMarkets.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-[#686b82]">
            No automated data-feed markets found.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[#dedee5] bg-[rgba(148,151,169,0.06)] text-[11px] uppercase tracking-[0.04em] text-[#686b82]">
                  <th className="py-3 px-5 font-semibold">Market</th>
                  <th className="py-3 px-4 font-semibold">Data Source</th>
                  <th className="py-3 px-4 font-semibold">Target Rule</th>
                  <th className="py-3 px-4 font-semibold">Deadline</th>
                  <th className="py-3 px-4 font-semibold">Total Pool</th>
                  <th className="py-3 px-4 font-semibold">Status</th>
                  <th className="py-3 px-5 font-semibold text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dedee5]">
                {trackAMarkets.map((m) => {
                  const providerRaw = String(
                    (m.oracleConfig as { provider?: string }).provider ?? "auto-feed",
                  );
                  const condition = formatOracleCondition(m.oracleConfig) ?? "Auto Check";
                  const resolved = m.status === "SETTLED" || m.status === "RESOLVED";
                  const isBusy = busyId === m.id;

                  return (
                    <tr key={m.id} className="hover:bg-[rgba(148,151,169,0.03)]">
                      <td className="py-3.5 px-5 max-w-[300px]">
                        <Link
                          href={`/m/${encodeURIComponent(m.slug)}`}
                          className="font-semibold text-[#101114] hover:text-[#7132f5] transition-colors line-clamp-2"
                        >
                          {m.question}
                        </Link>
                        <span className="text-[11px] text-[#9497a9]">{m.category}</span>
                      </td>
                      <td className="py-3.5 px-4 text-[#101114] font-medium whitespace-nowrap">
                        {formatProviderName(providerRaw)}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-[#026b3f] whitespace-nowrap tabular-nums">
                        {condition}
                      </td>
                      <td className="py-3.5 px-4 text-[#686b82] whitespace-nowrap">
                        {m.deadline}
                      </td>
                      <td className="py-3.5 px-4 font-semibold text-[#101114] whitespace-nowrap tabular-nums">
                        <span className="inline-flex items-center gap-1.5">
                          <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                          <span>{formatSats(m.yesPool + m.noPool)} sats</span>
                        </span>
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <StatusBadge status={m.status} outcome={m.outcome} size="sm" />
                      </td>
                      <td className="py-3.5 px-5 text-right whitespace-nowrap">
                        {resolved ? (
                          <span className="text-[12px] font-semibold text-[#026b3f]">
                            Completed
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={!canAct || isBusy}
                            onClick={() => onRequestTrackAResolve(m)}
                            className="px-3.5 py-1.5 text-[12px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-45 rounded-[10px] transition-colors cursor-pointer"
                          >
                            {isBusy ? "Resolving..." : "Trigger Resolution"}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Workspace Operations */}
      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 shrink-0 rounded-[12px] bg-[rgba(133,91,251,0.14)] text-[#7132f5] flex items-center justify-center">
            <LuDatabase className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-[16px] font-semibold text-[#101114]">
              Workspace Seed &amp; Operations
            </h3>
            <p className="text-[13px] text-[#686b82] mt-0.5">
              Populate showcase prediction markets across automated feeds and community oracles without overwriting existing markets.
            </p>
          </div>
        </div>

        <button
          type="button"
          disabled={!canAct || seedingDemo}
          onClick={onRequestSeedDemo}
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white disabled:opacity-45 rounded-[12px] transition-colors cursor-pointer"
        >
          <LuRefreshCw className="w-4 h-4" />
          <span>{seedingDemo ? "Loading Showcase..." : "Load Showcase Markets"}</span>
        </button>
      </div>
    </div>
  );
}
