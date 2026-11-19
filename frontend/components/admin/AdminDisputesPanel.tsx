"use client";

import Link from "next/link";
import { LuExternalLink, LuGavel, LuShieldCheck } from "react-icons/lu";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  formatPubkeyShort,
  formatSats,
  formatUtcDisplay,
  type OracleQueueEntry,
  type TrackBDisputeRecord,
} from "@/lib/bitpredict-data";

interface AdminDisputesPanelProps {
  entries: OracleQueueEntry[];
  canAct: boolean;
  busyId: string | null;
  onRequestRule: (
    entry: OracleQueueEntry,
    dispute: TrackBDisputeRecord,
    outcome: "YES" | "NO" | "INVALID",
  ) => void;
}

/** Arbitration queue panel for challenged community oracle proposals. */
export function AdminDisputesPanel({
  entries,
  canAct,
  busyId,
  onRequestRule,
}: AdminDisputesPanelProps) {
  if (entries.length === 0) {
    return (
      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-10 text-center space-y-2">
        <div className="w-11 h-11 mx-auto rounded-[12px] bg-[rgba(20,158,97,0.14)] text-[#026b3f] flex items-center justify-center">
          <LuShieldCheck className="w-5 h-5" />
        </div>
        <h3 className="text-[17px] font-semibold text-[#101114]">No active disputes</h3>
        <p className="text-[14px] text-[#686b82]">
          All community oracle proposals are clear. Disputed markets will appear here for ruling.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
      {entries.map((entry) => {
        const market = entry.market;
        const openDispute =
          entry.disputes.find((d) => d.status === "OPEN") ?? entry.disputes[0];
        const challengedProposal =
          entry.proposals.find((p) => p.id === openDispute?.proposalId) ??
          entry.proposals[0];
        const totalPool = market.yesPool + market.noPool;
        const isBusy = busyId === market.id;

        return (
          <article
            key={market.id}
            className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col justify-between gap-4"
          >
            <div className="space-y-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                    {market.category}
                  </span>
                  <span className="px-2.5 py-1 text-[11px] font-semibold bg-[rgba(220,38,38,0.12)] text-[#b91c1c] rounded-[6px]">
                    Under Dispute
                  </span>
                </div>
                <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#101114] tabular-nums">
                  <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>{formatSats(totalPool)} sats pool</span>
                </span>
              </div>

              <Link
                href={`/m/${encodeURIComponent(market.slug)}`}
                className="block text-[17px] font-semibold text-[#101114] hover:text-[#7132f5] leading-[1.35] transition-colors cursor-pointer"
              >
                {market.question}
              </Link>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)] space-y-1.5 text-[12px]">
                  <p className="font-semibold text-[#101114]">Challenged Proposal</p>
                  {challengedProposal ? (
                    <>
                      <p className="text-[#686b82]">
                        Outcome:{" "}
                        <strong className="text-[#101114]">{challengedProposal.outcome}</strong>
                      </p>
                      <p className="text-[#686b82]">
                        Signer:{" "}
                        <span className="font-mono text-[#101114]">
                          {formatPubkeyShort(challengedProposal.signerPubkey)}
                        </span>
                      </p>
                      <p className="text-[#686b82]">
                        Challenge End:{" "}
                        <span className="text-[#101114]">
                          {formatUtcDisplay(challengedProposal.challengeEndsAt)}
                        </span>
                      </p>
                    </>
                  ) : (
                    <p className="text-[#686b82]">No active proposal metadata recorded.</p>
                  )}
                </div>

                <div className="p-3 rounded-[12px] border border-[rgba(220,38,38,0.22)] bg-[rgba(220,38,38,0.04)] space-y-1.5 text-[12px]">
                  <p className="font-semibold text-[#b91c1c]">Open Dispute Filing</p>
                  {openDispute ? (
                    <>
                      <p className="text-[#686b82]">
                        Challenger:{" "}
                        <span className="font-mono text-[#101114]">
                          {formatPubkeyShort(openDispute.disputerPubkey)}
                        </span>
                      </p>
                      <p className="text-[#686b82]">
                        Filed:{" "}
                        <span className="text-[#101114]">
                          {formatUtcDisplay(openDispute.createdAt)}
                        </span>
                      </p>
                      {openDispute.proofUrls.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-0.5">
                          {openDispute.proofUrls.map((url) =>
                            /^https?:\/\//i.test(url) ? (
                              <a
                                key={url}
                                href={url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[#7132f5] hover:underline font-medium"
                              >
                                <span>Dispute Proof</span>
                                <LuExternalLink className="w-3 h-3" />
                              </a>
                            ) : (
                              <span key={url} className="text-[#686b82] truncate">
                                {url}
                              </span>
                            ),
                          )}
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-[#686b82]">Dispute filing details unavailable.</p>
                  )}
                </div>
              </div>

              {entry.evidence && (
                <div className="p-3 rounded-[12px] bg-[rgba(148,151,169,0.08)] border border-[#dedee5] text-[12px] text-[#686b82] space-y-1">
                  <p className="font-semibold text-[#101114]">
                    AI Verification Summary (Advisory)
                  </p>
                  <p>{entry.evidence.summary}</p>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-[#dedee5] flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[#686b82]">
                <LuGavel className="w-3.5 h-3.5 text-[#7132f5]" />
                <span>Arbitration Ruling</span>
              </span>

              {openDispute ? (
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    disabled={!canAct || isBusy}
                    onClick={() => onRequestRule(entry, openDispute, "YES")}
                    className="px-3.5 py-2 text-[13px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] disabled:opacity-45 rounded-[10px] transition-colors cursor-pointer"
                  >
                    Rule YES
                  </button>
                  <button
                    type="button"
                    disabled={!canAct || isBusy}
                    onClick={() => onRequestRule(entry, openDispute, "NO")}
                    className="px-3.5 py-2 text-[13px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-45 rounded-[10px] transition-colors cursor-pointer"
                  >
                    Rule NO
                  </button>
                  <button
                    type="button"
                    disabled={!canAct || isBusy}
                    onClick={() => onRequestRule(entry, openDispute, "INVALID")}
                    className="px-3.5 py-2 text-[13px] font-semibold text-[#b91c1c] bg-[rgba(220,38,38,0.10)] hover:bg-[#dc2626] hover:text-white disabled:opacity-45 rounded-[10px] transition-colors cursor-pointer"
                  >
                    Void &amp; Refund
                  </button>
                </div>
              ) : (
                <span className="text-[12px] text-[#9497a9]">Missing open dispute record</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
