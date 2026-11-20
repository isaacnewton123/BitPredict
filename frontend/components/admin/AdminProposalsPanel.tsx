"use client";

import Link from "next/link";
import { LuScale } from "react-icons/lu";
import { SatsIcon } from "@/components/shared/SatsIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  formatPubkeyShort,
  formatSats,
  type MarketItem,
  type OracleQueueEntry,
} from "@/lib/bitpredict-data";

interface AdminProposalsPanelProps {
  entries: OracleQueueEntry[];
  canActForMarket: (market: MarketItem) => boolean;
  busyId: string | null;
  onRequestPropose: (market: MarketItem, outcome: "YES" | "NO") => void;
  onRequestFinalize: (market: MarketItem) => void;
}

/** Operator panel for proposing and finalizing community oracle outcomes. */
export function AdminProposalsPanel({
  entries,
  canActForMarket,
  busyId,
  onRequestPropose,
  onRequestFinalize,
}: AdminProposalsPanelProps) {
  if (entries.length === 0) {
    return (
      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-10 text-center space-y-2">
        <div className="w-11 h-11 mx-auto rounded-[12px] bg-[rgba(133,91,251,0.14)] text-[#7132f5] flex items-center justify-center">
          <LuScale className="w-5 h-5" />
        </div>
        <h3 className="text-[17px] font-semibold text-[#101114]">No pending oracle proposals</h3>
        <p className="text-[14px] text-[#686b82]">
          Community oracle markets requiring proposals or finalization will appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {entries.map((entry) => {
        const market = entry.market;
        const activeProp =
          entry.proposals.find((p) => p.status === "ACTIVE") ?? entry.proposals[0];
        const isBusy = busyId === market.id;
        const canAct = canActForMarket(market);

        return (
          <article
            key={market.id}
            className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col justify-between gap-4 card-interactive"
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 text-[11px] font-semibold bg-[rgba(104,107,130,0.10)] text-[#484b5e] rounded-[6px]">
                    {market.category}
                  </span>
                  {market.isDemo && (
                    <span className="px-2 py-0.5 text-[10px] font-bold bg-[rgba(133,91,251,0.14)] text-[#7132f5] rounded-[6px]">
                      Demo
                    </span>
                  )}
                </div>
                <StatusBadge status={market.status} outcome={market.outcome} size="sm" />
              </div>

              <Link
                href={`/m/${encodeURIComponent(market.slug)}`}
                className="block text-[17px] font-semibold text-[#101114] hover:text-[#7132f5] leading-[1.35] transition-colors cursor-pointer"
              >
                {market.question}
              </Link>

              <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#686b82]">
                <span>Deadline: {market.deadline}</span>
                <span className="inline-flex items-center gap-1.5 font-semibold text-[#101114] tabular-nums">
                  <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>{formatSats(market.yesPool + market.noPool)} sats pool</span>
                </span>
              </div>

              {entry.evidence && (
                <div className="p-3 rounded-[10px] bg-[rgba(148,151,169,0.08)] border border-[#dedee5] text-[12px] text-[#686b82] space-y-1">
                  <p className="font-semibold text-[#101114]">
                    AI Verification Summary (Advisory)
                  </p>
                  <p>{entry.evidence.summary}</p>
                </div>
              )}

              {activeProp && (
                <div className="p-3 rounded-[10px] bg-[rgba(20,158,97,0.12)] text-[#026b3f] text-[12px] space-y-1">
                  <p className="font-semibold">
                    Active Proposal: {activeProp.outcome}
                  </p>
                  <p className="font-mono text-[11px]">
                    Verifier: {formatPubkeyShort(activeProp.signerPubkey)}
                  </p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[#dedee5] flex flex-wrap items-center gap-2">
              {market.status === "PROPOSED" ? (
                <button
                  type="button"
                  disabled={!canAct || isBusy}
                  onClick={() => onRequestFinalize(market)}
                  className="px-4 py-2 text-[13px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] disabled:opacity-45 rounded-[10px] transition-colors cursor-pointer"
                >
                  Finalize Settlement
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={!canAct || isBusy}
                    onClick={() => onRequestPropose(market, "YES")}
                    className="px-3.5 py-2 text-[13px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white disabled:opacity-45 rounded-[10px] transition-colors cursor-pointer"
                  >
                    Propose YES
                  </button>
                  <button
                    type="button"
                    disabled={!canAct || isBusy}
                    onClick={() => onRequestPropose(market, "NO")}
                    className="px-3.5 py-2 text-[13px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.10)] hover:bg-[#7132f5] hover:text-white disabled:opacity-45 rounded-[10px] transition-colors cursor-pointer"
                  >
                    Propose NO
                  </button>
                </>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
