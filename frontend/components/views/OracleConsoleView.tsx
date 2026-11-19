"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { LuCircleAlert, LuScale, LuShieldCheck } from "react-icons/lu";
import {
  ConfirmActionModal,
  type ConfirmDetailItem,
} from "@/components/shared/ConfirmActionModal";
import {
  formatOracleCondition,
  formatProviderName,
} from "@/components/shared/OracleSpecSummary";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  fetchOracleQueueFromBackend,
  formatPubkeyShort,
  formatSats,
  formatUtcDisplay,
  type MarketItem,
  type OracleQueueEntry,
  submitBackendTrackBDispute,
} from "@/lib/bitpredict-data";

interface OracleConsoleViewProps {
  markets: MarketItem[];
  onRefreshMarkets: () => void;
  onNotify: (title: string, subtitle: string) => void;
}

const PUBLIC_STATUS_LABELS: Record<string, { label: string; className: string }> = {
  OPEN: {
    label: "Open",
    className: "bg-[rgba(104,107,130,0.12)] text-[#484b5e]",
  },
  CLOSED: {
    label: "Betting Closed",
    className: "bg-[rgba(104,107,130,0.12)] text-[#484b5e]",
  },
  PENDING_RESOLUTION: {
    label: "Awaiting Verification",
    className: "bg-[rgba(133,91,251,0.16)] text-[#7132f5]",
  },
  PROPOSED: {
    label: "Challenge Window Active",
    className: "bg-[rgba(20,158,97,0.16)] text-[#026b3f]",
  },
  DISPUTED: {
    label: "Under Arbitration",
    className: "bg-[rgba(220,38,38,0.12)] text-[#b91c1c]",
  },
  SETTLED: {
    label: "Settled",
    className: "bg-[rgba(20,158,97,0.16)] text-[#026b3f]",
  },
};

/** Public Oracle Transparency Board showing automated feed status and community proposals. */
export function OracleConsoleView({
  markets,
  onRefreshMarkets,
  onNotify,
}: OracleConsoleViewProps) {
  const [queue, setQueue] = useState<OracleQueueEntry[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [disputingId, setDisputingId] = useState<string | null>(null);
  const [pendingDisputeEntry, setPendingDisputeEntry] = useState<OracleQueueEntry | null>(null);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const items = await fetchOracleQueueFromBackend();
      setQueue(items);
    } catch {
      setQueue([]);
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchOracleQueueFromBackend()
      .then((items) => {
        if (active) setQueue(items);
      })
      .catch(() => {
        if (active) setQueue([]);
      })
      .finally(() => {
        if (active) setLoadingQueue(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const trackAMarkets = markets.filter((m) => m.oracleTrack === "auto_api");
  const disputedCount = queue.filter((q) => q.market.status === "DISPUTED").length;

  async function confirmChallengeProposal() {
    if (!pendingDisputeEntry) return;
    const entry = pendingDisputeEntry;
    const activeProposal =
      entry.proposals.find((p) => p.status === "ACTIVE") ?? entry.proposals[0];
    const proposalEventId =
      (activeProposal?.nostrEvent as { id?: string } | undefined)?.id ?? "0".repeat(64);

    setDisputingId(entry.market.id);
    try {
      await submitBackendTrackBDispute(entry.market, proposalEventId);
      setPendingDisputeEntry(null);
      onRefreshMarkets();
      await loadQueue();
      onNotify(
        "Dispute Filed",
        "Challenge recorded. Settlement is paused pending independent arbitration.",
      );
    } catch (err) {
      onNotify(
        "Dispute Rejected",
        err instanceof Error ? err.message : "Unable to challenge proposal",
      );
    } finally {
      setDisputingId(null);
    }
  }

  const pendingProposal = pendingDisputeEntry
    ? pendingDisputeEntry.proposals.find((p) => p.status === "ACTIVE") ??
      pendingDisputeEntry.proposals[0]
    : undefined;

  const disputeDetails: ConfirmDetailItem[] = pendingDisputeEntry
    ? [
        { label: "Market", value: pendingDisputeEntry.market.question },
        { label: "Proposed Outcome", value: pendingProposal?.outcome ?? "Proposed" },
        {
          label: "Challenge Deadline",
          value: pendingProposal
            ? formatUtcDisplay(pendingProposal.challengeEndsAt)
            : pendingDisputeEntry.market.deadline,
        },
        {
          label: "Total Pool",
          value: `${formatSats(pendingDisputeEntry.market.yesPool + pendingDisputeEntry.market.noPool)} sats`,
        },
      ]
    : [];

  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      <div className="border-b border-[#dedee5] pb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] text-[12px] font-semibold mb-2">
            <LuShieldCheck className="w-3.5 h-3.5" />
            <span>Dual-Track Resolution Transparency</span>
          </div>
          <h1 className="text-[30px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114]">
            Oracle Status &amp; Verification
          </h1>
          <p className="text-[15px] text-[#686b82] mt-1">
            Live resolution tracking for automated data feeds and community-verified prediction markets.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-3.5 py-2 bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px] text-[13px] text-[#686b82]">
            Automated Feeds: <strong className="text-[#101114]">{trackAMarkets.length}</strong>
          </div>
          <div className="px-3.5 py-2 bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px] text-[13px] text-[#686b82]">
            Community Markets: <strong className="text-[#101114]">{queue.length}</strong>
          </div>
          <div className="px-3.5 py-2 bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px] text-[13px] text-[#686b82]">
            Under Arbitration: <strong className="text-[#101114]">{disputedCount}</strong>
          </div>
        </div>
      </div>

      {/* Community Oracle Markets */}
      <div className="space-y-4">
        <h2 className="text-[20px] font-bold text-[#101114] flex items-center gap-2">
          <LuScale className="w-5 h-5 text-[#7132f5]" />
          <span>Community Oracle Markets</span>
        </h2>

        {loadingQueue ? (
          <p className="text-[14px] text-[#686b82]">Loading oracle verification status...</p>
        ) : queue.length === 0 ? (
          <p className="text-[14px] text-[#686b82]">
            No active community oracle markets awaiting resolution.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {queue.map((entry) => {
              const m = entry.market;
              const activeProp =
                entry.proposals.find((p) => p.status === "ACTIVE") ?? entry.proposals[0];
              const statusBadge = PUBLIC_STATUS_LABELS[m.status] ?? {
                label: m.status,
                className: "bg-[rgba(104,107,130,0.12)] text-[#484b5e]",
              };
              const isDisputing = disputingId === m.id;

              return (
                <article
                  key={m.id}
                  className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                        {m.category}
                      </span>
                      <span
                        className={`px-2.5 py-1 text-[11px] font-semibold rounded-[6px] ${statusBadge.className}`}
                      >
                        {statusBadge.label}
                      </span>
                    </div>

                    <Link
                      href={`/m/${encodeURIComponent(m.slug)}`}
                      className="block text-left text-[17px] font-semibold text-[#101114] hover:text-[#7132f5] leading-[1.35] transition-colors cursor-pointer"
                    >
                      {m.question}
                    </Link>

                    <div className="flex flex-wrap items-center gap-4 text-[12px] text-[#686b82]">
                      <span>Deadline: {m.deadline}</span>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-[#101114] tabular-nums">
                        <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                        <span>{formatSats(m.yesPool + m.noPool)} sats pool</span>
                      </span>
                    </div>

                    {entry.evidence && (
                      <div className="p-3 rounded-[10px] bg-[rgba(148,151,169,0.08)] border border-[#dedee5] text-[12px] text-[#686b82] space-y-1">
                        <p className="font-semibold text-[#101114]">
                          AI Research Brief (Advisory)
                        </p>
                        <p>{entry.evidence.summary}</p>
                      </div>
                    )}

                    {activeProp && (
                      <div className="p-3 rounded-[10px] bg-[rgba(20,158,97,0.12)] text-[#026b3f] text-[12px] space-y-1">
                        <p className="font-semibold">
                          Proposed Outcome: {activeProp.outcome}
                        </p>
                        <p className="font-mono text-[11px]">
                          Verifier: {formatPubkeyShort(activeProp.signerPubkey)}
                        </p>
                        <p className="text-[11px]">
                          Challenge Deadline: {formatUtcDisplay(activeProp.challengeEndsAt)}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="pt-3 border-t border-[#dedee5] flex flex-wrap items-center justify-between gap-2">
                    <Link
                      href={`/m/${encodeURIComponent(m.slug)}`}
                      className="text-[13px] font-semibold text-[#686b82] hover:text-[#7132f5] transition-colors"
                    >
                      View Market Terminal
                    </Link>

                    {m.status === "PROPOSED" ? (
                      <button
                        type="button"
                        disabled={isDisputing}
                        onClick={() => setPendingDisputeEntry(entry)}
                        className="px-3.5 py-2 text-[13px] font-semibold text-[#b91c1c] bg-[rgba(220,38,38,0.10)] hover:bg-[#dc2626] hover:text-white rounded-[10px] transition-colors cursor-pointer"
                      >
                        Challenge Proposal
                      </button>
                    ) : m.status === "DISPUTED" ? (
                      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#b91c1c]">
                        <LuCircleAlert className="w-3.5 h-3.5" />
                        <span>Under Arbitration Review</span>
                      </span>
                    ) : (
                      <span className="text-[12px] font-medium text-[#9497a9]">
                        Awaiting event deadline
                      </span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Automated Data Feeds */}
      <div className="space-y-4">
        <h2 className="text-[20px] font-bold text-[#101114] flex items-center gap-2">
          <LuShieldCheck className="w-5 h-5 text-[#149e61]" />
          <span>Automated Data Feeds</span>
        </h2>

        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
          {trackAMarkets.length === 0 ? (
            <div className="p-8 text-center text-[14px] text-[#686b82]">
              No automated data-feed markets active right now.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[#dedee5] bg-[rgba(148,151,169,0.06)] text-[11px] uppercase tracking-[0.04em] text-[#686b82]">
                    <th className="py-3 px-5 font-semibold">Market</th>
                    <th className="py-3 px-4 font-semibold">Data Source</th>
                    <th className="py-3 px-4 font-semibold">Target Condition</th>
                    <th className="py-3 px-4 font-semibold">Deadline</th>
                    <th className="py-3 px-4 font-semibold">Pool</th>
                    <th className="py-3 px-5 font-semibold text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#dedee5]">
                  {trackAMarkets.map((m) => {
                    const providerRaw = String(
                      (m.oracleConfig as { provider?: string }).provider ?? "auto-feed",
                    );
                    const condition = formatOracleCondition(m.oracleConfig) ?? "Auto Check";
                    const resolved = m.status === "SETTLED" || m.status === "RESOLVED";
                    return (
                      <tr key={m.id} className="hover:bg-[rgba(148,151,169,0.03)]">
                        <td className="py-3.5 px-5 max-w-[320px]">
                          <Link
                            href={`/m/${encodeURIComponent(m.slug)}`}
                            className="font-semibold text-[#101114] hover:text-[#7132f5] transition-colors line-clamp-2"
                          >
                            {m.question}
                          </Link>
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
                        <td className="py-3.5 px-5 text-right whitespace-nowrap">
                          <span
                            className={
                              resolved
                                ? "px-2.5 py-1 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                                : "px-2.5 py-1 text-[11px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[6px]"
                            }
                          >
                            {resolved ? `Settled · ${m.outcome ?? "DONE"}` : "Monitoring"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <ConfirmActionModal
        open={pendingDisputeEntry !== null}
        title="Challenge Proposed Outcome"
        description="Submit a dispute to halt automatic settlement and escalate this market for arbitration."
        details={disputeDetails}
        warning="Filing a dispute pauses automatic settlement and escalates this market for independent admin arbitration."
        confirmLabel="File Dispute"
        tone="danger"
        busy={disputingId !== null}
        onConfirm={confirmChallengeProposal}
        onCancel={() => setPendingDisputeEntry(null)}
      />
    </section>
  );
}
