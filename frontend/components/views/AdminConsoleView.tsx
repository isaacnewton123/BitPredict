"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LuLock,
  LuRefreshCw,
  LuShieldAlert,
  LuShieldCheck,
  LuZap,
} from "react-icons/lu";
import { AdminDisputesPanel } from "@/components/admin/AdminDisputesPanel";
import { AdminFeedsOpsPanel } from "@/components/admin/AdminFeedsOpsPanel";
import { AdminProposalsPanel } from "@/components/admin/AdminProposalsPanel";
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
  type BackendUserProfile,
  fetchOracleQueueFromBackend,
  finalizeBackendTrackBProposal,
  formatSats,
  type MarketItem,
  type OracleQueueEntry,
  ruleBackendDispute,
  runBackendTrackAResolve,
  submitBackendTrackBProposal,
  type TrackBDisputeRecord,
} from "@/lib/bitpredict-data";

type AdminTab = "disputes" | "proposals" | "feeds";

interface PendingConfirmation {
  title: string;
  description: string;
  details: ConfirmDetailItem[];
  warning: string;
  confirmLabel: string;
  tone: "primary" | "success" | "danger";
  actionId: string;
  execute: () => Promise<void>;
}

interface AdminConsoleViewProps {
  user: BackendUserProfile | null;
  markets: MarketItem[];
  seedingDemo: boolean;
  onConnectNwc: () => void;
  onRefreshMarkets: () => void;
  onSeedDemo: () => Promise<void>;
  onNotify: (title: string, subtitle: string) => void;
}

/** Dedicated operator console for dispute arbitration, oracle proposals, and feed controls. */
export function AdminConsoleView({
  user,
  markets,
  seedingDemo,
  onConnectNwc,
  onRefreshMarkets,
  onSeedDemo,
  onNotify,
}: AdminConsoleViewProps) {
  const [activeTab, setActiveTab] = useState<AdminTab>("disputes");
  const [queue, setQueue] = useState<OracleQueueEntry[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirmation | null>(null);
  const [executingConfirm, setExecutingConfirm] = useState(false);

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

  const canActForMarket = (market: MarketItem) =>
    Boolean(user && (user.is_admin || (user.is_guest && market.isDemo)));
  const canSeedDemo = Boolean(user && (user.is_admin || user.is_guest));

  const disputedEntries = queue.filter(
    (e) => e.market.status === "DISPUTED" || e.disputes.some((d) => d.status === "OPEN"),
  );
  const proposalEntries = queue.filter(
    (e) =>
      e.market.status !== "DISPUTED" &&
      e.market.status !== "SETTLED" &&
      e.market.status !== "RESOLVED",
  );
  const trackAMarkets = markets.filter((m) => m.oracleTrack === "auto_api");
  const activeFeedCount = trackAMarkets.filter(
    (m) => m.status !== "SETTLED" && m.status !== "RESOLVED",
  ).length;
  const totalVolume = markets.reduce((sum, m) => sum + m.yesPool + m.noPool, 0);

  async function runConfirmedAction() {
    if (!pendingConfirm) return;
    setExecutingConfirm(true);
    setBusyId(pendingConfirm.actionId);
    try {
      await pendingConfirm.execute();
      setPendingConfirm(null);
    } finally {
      setExecutingConfirm(false);
      setBusyId(null);
    }
  }

  function handleRequestRule(
    entry: OracleQueueEntry,
    dispute: TrackBDisputeRecord,
    outcome: "YES" | "NO" | "INVALID",
  ) {
    const activeProposal =
      entry.proposals.find((p) => p.id === dispute.proposalId) ?? entry.proposals[0];
    const pool = entry.market.yesPool + entry.market.noPool;

    setPendingConfirm({
      title:
        outcome === "INVALID"
          ? "Confirm Arbitration Ruling: Void & Refund"
          : `Confirm Arbitration Ruling: ${outcome}`,
      description:
        "You are issuing a binding arbitration ruling for a disputed community oracle market.",
      details: [
        { label: "Market", value: entry.market.question },
        { label: "Challenged Proposal", value: activeProposal?.outcome ?? "N/A" },
        { label: "Final Ruling", value: outcome === "INVALID" ? "VOID (Refund All)" : outcome },
        { label: "Total Pool", value: `${formatSats(pool)} sats` },
      ],
      warning:
        "This ruling is final. It immediately settles the market, distributes Lightning payouts to winners (or refunds all bets if voided), and returns the dispute bond if upheld.",
      confirmLabel: outcome === "INVALID" ? "Confirm Void & Refund" : `Confirm Rule ${outcome}`,
      tone: outcome === "INVALID" ? "danger" : outcome === "YES" ? "success" : "primary",
      actionId: entry.market.id,
      execute: async () => {
        try {
          await ruleBackendDispute(dispute.id, outcome);
          onRefreshMarkets();
          await loadQueue();
          onNotify(
            `Arbitration Settled: ${outcome}`,
            "Final ruling applied and settlement payouts queued.",
          );
        } catch (err) {
          onNotify(
            "Arbitration Ruling Failed",
            err instanceof Error ? err.message : "Unable to submit ruling",
          );
        }
      },
    });
  }

  function handleRequestPropose(market: MarketItem, outcome: "YES" | "NO") {
    const pool = market.yesPool + market.noPool;
    setPendingConfirm({
      title: `Submit Oracle Proposal (${outcome})`,
      description: "Propose a signed outcome to start the community challenge window.",
      details: [
        { label: "Market", value: market.question },
        { label: "Proposed Outcome", value: outcome },
        { label: "Event Deadline", value: market.deadline },
        { label: "Total Pool", value: `${formatSats(pool)} sats` },
      ],
      warning:
        "Submitting this proposal opens the optimistic challenge window during which community members may file a bonded dispute.",
      confirmLabel: `Submit Proposal (${outcome})`,
      tone: outcome === "YES" ? "success" : "primary",
      actionId: market.id,
      execute: async () => {
        try {
          await submitBackendTrackBProposal(market, outcome);
          onRefreshMarkets();
          await loadQueue();
          onNotify(
            `Proposal Recorded (${outcome})`,
            "Community challenge window is now open.",
          );
        } catch (err) {
          onNotify(
            "Proposal Rejected",
            err instanceof Error ? err.message : "Unable to submit proposal",
          );
        }
      },
    });
  }

  function handleRequestFinalize(market: MarketItem) {
    const entry = queue.find((q) => q.market.id === market.id);
    const activeProp =
      entry?.proposals.find((p) => p.status === "ACTIVE") ?? entry?.proposals[0];
    const pool = market.yesPool + market.noPool;

    setPendingConfirm({
      title: "Finalize Oracle Settlement",
      description: "Close the active proposal challenge window and settle market payouts.",
      details: [
        { label: "Market", value: market.question },
        { label: "Accepted Outcome", value: activeProp?.outcome ?? "Proposed Outcome" },
        { label: "Total Pool", value: `${formatSats(pool)} sats` },
      ],
      warning:
        "Finalizing immediately locks the outcome and distributes automated Lightning payouts to winning participants.",
      confirmLabel: "Finalize Settlement",
      tone: "success",
      actionId: market.id,
      execute: async () => {
        try {
          await finalizeBackendTrackBProposal(market.id);
          onRefreshMarkets();
          await loadQueue();
          onNotify("Market Finalized & Settled", "Winning payouts have been processed.");
        } catch (err) {
          onNotify(
            "Finalization Failed",
            err instanceof Error ? err.message : "Unable to finalize settlement",
          );
        }
      },
    });
  }

  function handleRequestTrackAResolve(market: MarketItem) {
    const providerRaw = String(
      (market.oracleConfig as { provider?: string }).provider ?? "auto-feed",
    );
    const rule = formatOracleCondition(market.oracleConfig) ?? "Deterministic Rule";
    const pool = market.yesPool + market.noPool;

    setPendingConfirm({
      title: "Trigger Automated Feed Resolution",
      description: "Query the configured data source now and settle the market if eligible.",
      details: [
        { label: "Market", value: market.question },
        { label: "Data Source", value: formatProviderName(providerRaw) },
        { label: "Target Rule", value: rule },
        { label: "Total Pool", value: `${formatSats(pool)} sats` },
      ],
      warning:
        "Running resolution fetches the live oracle response, records its cryptographic proof, and settles all winning positions immediately.",
      confirmLabel: "Trigger Resolution",
      tone: "primary",
      actionId: market.id,
      execute: async () => {
        try {
          const res = await runBackendTrackAResolve(market.id);
          onRefreshMarkets();
          await loadQueue();
          onNotify(
            `Feed Settled: ${res.market.outcome ?? "RESOLVED"}`,
            "Verified data proof recorded and payouts queued.",
          );
        } catch (err) {
          onNotify(
            "Feed Resolution Failed",
            err instanceof Error ? err.message : "Unable to resolve feed",
          );
        }
      },
    });
  }

  function handleRequestSeedDemo() {
    setPendingConfirm({
      title: "Load Showcase Markets",
      description: "Seed the workspace with sample prediction markets and pool liquidity.",
      details: [
        { label: "Action", value: "Create missing showcase markets" },
        { label: "Existing Markets", value: "Preserved without overwriting" },
      ],
      warning:
        "New showcase markets will immediately appear on the public discovery board.",
      confirmLabel: "Load Showcase Markets",
      tone: "primary",
      actionId: "seed-demo",
      execute: async () => {
        await onSeedDemo();
        await loadQueue();
      },
    });
  }

  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6">
      {/* Header */}
      <div className="border-b border-[#dedee5] pb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] text-[12px] font-semibold mb-2">
            <LuShieldCheck className="w-3.5 h-3.5" />
            <span>Operator Workspace · Restricted Actions</span>
          </div>
          <h1 className="text-[30px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114]">
            Admin Operations Console
          </h1>
          <p className="text-[15px] text-[#686b82] mt-1">
            Arbitrate disputed markets, submit or finalize oracle proposals, and manage automated resolution feeds.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            onRefreshMarkets();
            loadQueue();
          }}
          className="self-start lg:self-auto inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-[#101114] bg-white border border-[#dedee5] hover:border-[#7132f5] rounded-[12px] transition-colors cursor-pointer"
        >
          <LuRefreshCw className="w-4 h-4 text-[#7132f5]" />
          <span>Refresh Console</span>
        </button>
      </div>

      {/* Admin Access Banner */}
      {!user ? (
        <div className="p-5 rounded-[16px] border border-[rgba(113,50,245,0.28)] bg-[rgba(133,91,251,0.06)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 shrink-0 rounded-[12px] bg-white border border-[#dedee5] flex items-center justify-center text-[#7132f5]">
              <LuLock className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-bold text-[#101114]">
                Admin Authentication Required
              </h2>
              <p className="text-[13px] text-[#686b82] mt-0.5">
                Sign in with an authorized Nostr operator session before issuing rulings or modifying oracle settlements.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onConnectNwc}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
          >
            <LuZap className="w-4 h-4" />
            <span>Connect Account</span>
          </button>
        </div>
      ) : user.is_guest ? (
        <div className="p-4 rounded-[16px] border border-[rgba(113,50,245,0.28)] bg-[rgba(133,91,251,0.06)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-[#5741d8] text-[13px] font-semibold">
            <LuShieldCheck className="w-4 h-4 shrink-0" />
            <span>Demo Sandbox Operator Active</span>
            <span className="font-mono text-[12px] px-2 py-0.5 rounded-[6px] bg-white/80">
              {user.npub.slice(0, 14)}...{user.npub.slice(-6)}
            </span>
          </div>
          <span className="text-[12px] text-[#5741d8]">
            Enabled for Demo Sandbox markets only — live markets remain restricted to operator keys.
          </span>
        </div>
      ) : user.is_admin === false ? (
        <div className="p-4 rounded-[16px] border border-[rgba(220,38,38,0.28)] bg-[rgba(220,38,38,0.06)] flex items-start gap-3">
          <LuShieldAlert className="w-5 h-5 text-[#b91c1c] shrink-0 mt-0.5" />
          <div>
            <p className="text-[14px] font-bold text-[#b91c1c]">Read-Only Session</p>
            <p className="text-[13px] text-[#686b82] mt-0.5">
              Signed-in keypair <span className="font-mono text-[#101114]">{user.npub.slice(0, 14)}...{user.npub.slice(-6)}</span> is not authorized in the platform admin allowlist. Critical actions are disabled.
            </p>
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-[16px] border border-[rgba(20,158,97,0.28)] bg-[rgba(20,158,97,0.08)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-[#026b3f] text-[13px] font-semibold">
            <LuShieldCheck className="w-4 h-4 shrink-0" />
            <span>Authorized Admin Session Active</span>
            <span className="font-mono text-[12px] px-2 py-0.5 rounded-[6px] bg-white/80">
              {user.npub.slice(0, 14)}...{user.npub.slice(-6)}
            </span>
          </div>
          <span className="text-[12px] text-[#026b3f]">
            All critical actions require confirmation before execution.
          </span>
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-4">
          <p className="text-[12px] font-semibold text-[#686b82]">Open Disputes</p>
          <p
            className={`text-[24px] font-bold mt-1 tabular-nums ${
              disputedEntries.length > 0 ? "text-[#b91c1c]" : "text-[#101114]"
            }`}
          >
            {disputedEntries.length}
          </p>
        </div>
        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-4">
          <p className="text-[12px] font-semibold text-[#686b82]">Pending Proposals</p>
          <p className="text-[24px] font-bold text-[#101114] mt-1 tabular-nums">
            {proposalEntries.length}
          </p>
        </div>
        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-4">
          <p className="text-[12px] font-semibold text-[#686b82]">Active Auto-API Feeds</p>
          <p className="text-[24px] font-bold text-[#101114] mt-1 tabular-nums">
            {activeFeedCount}
          </p>
        </div>
        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-4">
          <p className="text-[12px] font-semibold text-[#686b82]">Total Platform Volume</p>
          <p className="inline-flex items-center gap-2 text-[24px] font-bold text-[#026b3f] mt-1 tabular-nums">
            <SatsIcon className="w-5 h-5 shrink-0" />
            <span>
              {formatSats(totalVolume)} <span className="text-[13px] font-semibold">sats</span>
            </span>
          </p>
        </div>
      </div>

      {/* Console Tabs */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[#dedee5] pb-3">
        {(
          [
            ["disputes", `Dispute Arbitration (${disputedEntries.length})`],
            ["proposals", `Oracle Proposals (${proposalEntries.length})`],
            ["feeds", `Automated Feeds & Ops (${trackAMarkets.length})`],
          ] as const
        ).map(([tabId, label]) => {
          const active = activeTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={
                active
                  ? "px-4 py-2 text-[14px] font-semibold rounded-[12px] bg-[#7132f5] text-white transition-colors cursor-pointer"
                  : "px-4 py-2 text-[14px] font-semibold rounded-[12px] bg-[rgba(148,151,169,0.08)] text-[#686b82] hover:text-[#101114] transition-colors cursor-pointer"
              }
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab Content */}
      {loadingQueue && activeTab !== "feeds" ? (
        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-10 text-center text-[14px] text-[#686b82]">
          Loading oracle arbitration queue...
        </div>
      ) : activeTab === "disputes" ? (
        <AdminDisputesPanel
          entries={disputedEntries}
          canActForMarket={canActForMarket}
          busyId={busyId}
          onRequestRule={handleRequestRule}
        />
      ) : activeTab === "proposals" ? (
        <AdminProposalsPanel
          entries={proposalEntries}
          canActForMarket={canActForMarket}
          busyId={busyId}
          onRequestPropose={handleRequestPropose}
          onRequestFinalize={handleRequestFinalize}
        />
      ) : (
        <AdminFeedsOpsPanel
          trackAMarkets={trackAMarkets}
          canActForMarket={canActForMarket}
          canSeedDemo={canSeedDemo}
          busyId={busyId}
          seedingDemo={seedingDemo}
          onRequestTrackAResolve={handleRequestTrackAResolve}
          onRequestSeedDemo={handleRequestSeedDemo}
        />
      )}

      <ConfirmActionModal
        open={pendingConfirm !== null}
        title={pendingConfirm?.title ?? ""}
        description={pendingConfirm?.description ?? ""}
        details={pendingConfirm?.details}
        warning={pendingConfirm?.warning}
        confirmLabel={pendingConfirm?.confirmLabel ?? "Confirm"}
        tone={pendingConfirm?.tone ?? "primary"}
        busy={executingConfirm}
        onConfirm={runConfirmedAction}
        onCancel={() => setPendingConfirm(null)}
      />
    </section>
  );
}
