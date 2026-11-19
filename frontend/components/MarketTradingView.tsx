/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuActivity,
  LuArrowLeft,
  LuCheck,
  LuCircleCheck,
  LuClock,
  LuCodeXml,
  LuCopy,
  LuExternalLink,
  LuFlame,
  LuRadio,
  LuRefreshCw,
  LuScale,
  LuShieldCheck,
  LuSparkles,
  LuWallet,
  LuZap,
} from "react-icons/lu";
import {
  type BackendUserProfile,
  calculateBetQuote,
  canonicalizeJsonBrowser,
  fetchMarketDetailBundle,
  formatSats,
  formatUtcDisplay,
  getApiBase,
  getYesProbability,
  type MarketDetailBundle,
  type MarketItem,
  type MarketSide,
  type MarketTradePoint,
  resolveMarketImageUrl,
  runBackendTrackAResolve,
  sha256HexBrowser,
  type UserPositionItem,
} from "@/lib/bitpredict-data";

type ChartRange = "1H" | "6H" | "1D" | "1W" | "ALL";
type InspectorTab = "rules" | "insight" | "trades" | "oracle";

interface MarketTradingViewProps {
  marketIdOrSlug: string;
  initialSide?: MarketSide;
  user: BackendUserProfile | null;
  userPositions: UserPositionItem[];
  onBack: () => void;
  onPlaceBet: (opts: {
    market: MarketItem;
    side: MarketSide;
    amountSats: number;
  }) => Promise<{ payment_hash: string; simulated: boolean } | null>;
  onRefreshGlobal: () => void;
  onOpenPositions: () => void;
  onNotify: (title: string, subtitle: string) => void;
}

const CHART_W = 720;
const CHART_H = 240;
const PAD_L = 14;
const PAD_R = 46;
const PAD_T = 16;
const PAD_B = 28;

export function MarketTradingView({
  marketIdOrSlug,
  initialSide = "YES",
  user,
  userPositions,
  onBack,
  onPlaceBet,
  onRefreshGlobal,
  onOpenPositions,
  onNotify,
}: MarketTradingViewProps) {
  const [loadedState, setLoadedState] = useState<{
    key: string;
    bundle: MarketDetailBundle | null;
    error: string | null;
  } | null>(null);

  const [streamOverlay, setStreamOverlay] = useState<{
    marketId: string;
    yesPool: number;
    noPool: number;
    status: string;
    outcome: MarketItem["outcome"];
    point: MarketTradePoint;
  } | null>(null);
  const [sseConnected, setSseConnected] = useState(false);

  const [sideState, setSideState] = useState<{ key: string; side: MarketSide }>({
    key: marketIdOrSlug,
    side: initialSide,
  });
  const [amount, setAmount] = useState(5000);
  const [submittingBet, setSubmittingBet] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const [chartRange, setChartRange] = useState<ChartRange>("ALL");
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<InspectorTab>("rules");

  const [digestState, setDigestState] = useState<{
    key: string;
    digest: string;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [copiedNote, setCopiedNote] = useState(false);

  const activeSide: MarketSide =
    sideState.key === marketIdOrSlug ? sideState.side : initialSide;

  const setOrderSide = (nextSide: MarketSide) => {
    setSideState({ key: marketIdOrSlug, side: nextSide });
  };

  const refreshBundle = useCallback(async () => {
    try {
      const fresh = await fetchMarketDetailBundle(marketIdOrSlug);
      setLoadedState({ key: marketIdOrSlug, bundle: fresh, error: null });
    } catch (err) {
      setLoadedState({
        key: marketIdOrSlug,
        bundle: null,
        error: err instanceof Error ? err.message : "Failed to load market",
      });
    }
  }, [marketIdOrSlug]);

  useEffect(() => {
    let active = true;
    fetchMarketDetailBundle(marketIdOrSlug)
      .then((res) => {
        if (active) {
          setLoadedState({ key: marketIdOrSlug, bundle: res, error: null });
        }
      })
      .catch((err: unknown) => {
        if (active) {
          setLoadedState({
            key: marketIdOrSlug,
            bundle: null,
            error: err instanceof Error ? err.message : "Failed to load market detail",
          });
        }
      });

    return () => {
      active = false;
    };
  }, [marketIdOrSlug]);

  const activeEntry = loadedState?.key === marketIdOrSlug ? loadedState : null;
  const bundle = activeEntry?.bundle ?? null;
  const error = activeEntry?.error ?? null;
  const loading = !activeEntry;
  const activeMarketId = bundle?.market.id ?? null;

  useEffect(() => {
    if (!activeMarketId || typeof EventSource === "undefined") return;
    const base = getApiBase();
    const es = new EventSource(
      `${base}/api/v1/markets/${encodeURIComponent(activeMarketId)}/stream`,
      { withCredentials: true },
    );

    es.onopen = () => {
      setSseConnected(true);
    };

    es.onmessage = (evt) => {
      setSseConnected(true);
      try {
        const data = JSON.parse(evt.data) as {
          market_id?: string;
          pool_yes_msat?: number;
          pool_no_msat?: number;
          status?: string;
          outcome?: MarketItem["outcome"];
          updated_at?: string;
        };
        const yesSats = Math.floor(Number(data.pool_yes_msat ?? 0) / 1000);
        const noSats = Math.floor(Number(data.pool_no_msat ?? 0) / 1000);
        const tot = yesSats + noSats;
        const yesPct = tot > 0 ? Math.round((yesSats / tot) * 1000) / 10 : 50;
        setStreamOverlay({
          marketId: activeMarketId,
          yesPool: yesSats,
          noPool: noSats,
          status: String(data.status ?? "OPEN"),
          outcome: data.outcome ?? null,
          point: {
            t: data.updated_at ?? new Date().toISOString(),
            yes_pct: yesPct,
            no_pct: Math.round((100 - yesPct) * 10) / 10,
            pool_sats: tot,
          },
        });
      } catch {
        // ignore keepalive / non-json frames
      }
    };

    es.onerror = () => {
      setSseConnected(false);
    };

    return () => {
      setSseConnected(false);
      es.close();
    };
  }, [activeMarketId]);

  const liveMarket: MarketItem | null = useMemo(() => {
    if (!bundle) return null;
    if (streamOverlay && streamOverlay.marketId === bundle.market.id) {
      return {
        ...bundle.market,
        yesPool: streamOverlay.yesPool,
        noPool: streamOverlay.noPool,
        status: streamOverlay.status,
        outcome: streamOverlay.outcome,
      };
    }
    return bundle.market;
  }, [bundle, streamOverlay]);

  const chartPoints: MarketTradePoint[] = useMemo(() => {
    if (!bundle || !liveMarket) return [];
    const base = [...bundle.probabilityHistory];
    if (base.length === 0) {
      const yp = getYesProbability(liveMarket);
      base.push(
        { t: liveMarket.bettingCutoffIso, yes_pct: 50, no_pct: 50, pool_sats: 0 },
        {
          t: liveMarket.deadlineIso || liveMarket.bettingCutoffIso,
          yes_pct: yp,
          no_pct: 100 - yp,
          pool_sats: liveMarket.yesPool + liveMarket.noPool,
        },
      );
    } else if (streamOverlay && streamOverlay.marketId === liveMarket.id) {
      const last = base[base.length - 1];
      if (last.pool_sats !== streamOverlay.point.pool_sats || last.yes_pct !== streamOverlay.point.yes_pct) {
        base.push(streamOverlay.point);
      }
    }

    if (chartRange === "ALL") return base;
    const rangeMs: Record<Exclude<ChartRange, "ALL">, number> = {
      "1H": 3_600_000,
      "6H": 6 * 3_600_000,
      "1D": 24 * 3_600_000,
      "1W": 7 * 24 * 3_600_000,
    };
    const latestTs = Date.parse(base[base.length - 1]?.t ?? "");
    const cutoff = (Number.isFinite(latestTs) ? latestTs : 0) - rangeMs[chartRange];
    const filtered = base.filter((pt) => Date.parse(pt.t) >= cutoff);
    if (filtered.length >= 2) return filtered;
    return base.slice(-Math.min(base.length, 4));
  }, [bundle, liveMarket, streamOverlay, chartRange]);

  const myMarketPositions = useMemo(
    () =>
      liveMarket
        ? userPositions.filter((p) => p.market.id === liveMarket.id || p.market.slug === liveMarket.slug)
        : [],
    [liveMarket, userPositions],
  );

  const browserDigest = digestState?.key === marketIdOrSlug ? digestState.digest : null;

  async function handleCopyLink() {
    const shareUrl =
      typeof window !== "undefined" ? window.location.href : "";
    await navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  }

  async function handleCopyNote() {
    if (!liveMarket) return;
    await navigator.clipboard?.writeText(liveMarket.nostrNoteId).catch(() => undefined);
    setCopiedNote(true);
    setTimeout(() => setCopiedNote(false), 1800);
  }

  async function handleVerifySha() {
    if (!liveMarket) return;
    const digest = await sha256HexBrowser(canonicalizeJsonBrowser(liveMarket.spec));
    setDigestState({ key: marketIdOrSlug, digest });
  }

  async function handleRunTrackA() {
    if (!liveMarket) return;
    setResolving(true);
    try {
      const res = await runBackendTrackAResolve(liveMarket.id);
      await refreshBundle();
      onRefreshGlobal();
      onNotify(
        `Resolved: ${res.market.outcome ?? "SETTLED"}`,
        `Proof SHA-256 ${res.proof.bodySha256?.slice(0, 12) ?? ""}... saved in backend DB.`,
      );
    } catch (err) {
      onNotify(
        "Track A Check Failed",
        err instanceof Error ? err.message : "Unable to resolve market",
      );
    } finally {
      setResolving(false);
    }
  }

  async function handleSubmitTicket() {
    if (!liveMarket) return;
    const cleanAmount = Math.max(10, Math.floor(amount || 0));
    setSubmittingBet(true);
    try {
      const result = await onPlaceBet({
        market: liveMarket,
        side: activeSide,
        amountSats: cleanAmount,
      });
      if (result) {
        setLastTxHash(result.payment_hash);
        await refreshBundle();
      }
    } finally {
      setSubmittingBet(false);
    }
  }

  if (loading) {
    return (
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#686b82] hover:text-[#101114] mb-6 cursor-pointer"
        >
          <LuArrowLeft className="w-4 h-4" />
          <span>Back to Markets</span>
        </button>
        <div className="bg-white border border-[#dedee5] rounded-[16px] p-12 text-center text-[15px] text-[#686b82] shadow-whisper">
          Loading trading terminal, live order pools, and oracle proofs...
        </div>
      </section>
    );
  }

  if (error || !bundle || !liveMarket) {
    return (
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#686b82] hover:text-[#101114] cursor-pointer"
        >
          <LuArrowLeft className="w-4 h-4" />
          <span>Back to Markets</span>
        </button>
        <div className="bg-white border border-[#dedee5] rounded-[16px] p-8 text-center space-y-4 shadow-whisper">
          <h2 className="text-[20px] font-bold text-[#101114]">Market Unavailable</h2>
          <p className="text-[14px] text-[#686b82]">
            {error ?? "Could not find this market in the Elysia backend."}
          </p>
          <button
            type="button"
            onClick={refreshBundle}
            className="inline-flex items-center gap-2 px-4 py-2 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] cursor-pointer"
          >
            <LuRefreshCw className="w-4 h-4" />
            <span>Retry</span>
          </button>
        </div>
      </section>
    );
  }

  const totalPool = liveMarket.yesPool + liveMarket.noPool;
  const yesPct = getYesProbability(liveMarket);
  const noPct = 100 - yesPct;
  const yesExactPct =
    totalPool > 0 ? Math.round((liveMarket.yesPool / totalPool) * 1000) / 10 : 50;
  const noExactPct = Math.round((100 - yesExactPct) * 10) / 10;

  const yesSampleQuote = calculateBetQuote(liveMarket, "YES", 1000);
  const noSampleQuote = calculateBetQuote(liveMarket, "NO", 1000);
  const ticketQuote = calculateBetQuote(liveMarket, activeSide, amount);
  const estReturnSats = ticketQuote.estPayoutSats - Math.max(10, Math.floor(amount || 0));
  const estReturnPct =
    amount > 0 ? Math.round((estReturnSats / Math.max(10, Math.floor(amount))) * 1000) / 10 : 0;

  const isOpen = liveMarket.status === "OPEN";
  const coverSrc = resolveMarketImageUrl(liveMarket);

  // SVG chart coordinates
  const plotW = CHART_W - PAD_L - PAD_R;
  const plotH = CHART_H - PAD_T - PAD_B;
  const coords = chartPoints.map((pt, idx) => {
    const x =
      chartPoints.length === 1
        ? PAD_L + plotW
        : PAD_L + (idx / (chartPoints.length - 1)) * plotW;
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
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5">
      {/* Top Action & Breadcrumb Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 text-[13px]">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(133,91,251,0.16)] hover:text-[#7132f5] rounded-[10px] transition-colors cursor-pointer"
          >
            <LuArrowLeft className="w-4 h-4" />
            <span>Markets</span>
          </button>
          <span className="text-[#9497a9]">/</span>
          <span className="font-semibold text-[#686b82]">{liveMarket.category}</span>
          <span className="hidden sm:inline text-[#9497a9]">/</span>
          <span className="hidden sm:inline font-mono text-[12px] text-[#9497a9] truncate max-w-[220px]">
            {liveMarket.slug}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold rounded-[8px] ${
              sseConnected
                ? "bg-[rgba(20,158,97,0.14)] text-[#026b3f]"
                : "bg-[rgba(104,107,130,0.12)] text-[#686b82]"
            }`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                sseConnected ? "bg-[#149e61] animate-pulse" : "bg-[#9497a9]"
              }`}
            />
            <span>{sseConnected ? "Live Pool Stream" : "Live Snapshot"}</span>
          </span>

          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-[#686b82] hover:text-[#101114] bg-white border border-[#dedee5] rounded-[10px] cursor-pointer"
          >
            {copiedLink ? <LuCheck className="w-3.5 h-3.5 text-[#149e61]" /> : <LuCopy className="w-3.5 h-3.5" />}
            <span>{copiedLink ? "Copied" : "Share"}</span>
          </button>

          <button
            type="button"
            onClick={refreshBundle}
            aria-label="Refresh market"
            className="p-1.5 text-[#686b82] hover:text-[#7132f5] bg-white border border-[#dedee5] rounded-[10px] cursor-pointer"
          >
            <LuRefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main 2-Column Trading Terminal */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN (8 cols): Header, Probability Chart, Outcome Rows, Tabs */}
        <div className="lg:col-span-8 space-y-5 min-w-0">
          {/* Market Header Card */}
          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <img
                src={coverSrc}
                alt={liveMarket.question}
                className="w-16 h-16 rounded-[14px] object-cover border border-[#dedee5] bg-[rgba(148,151,169,0.08)] shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="px-2.5 py-0.5 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                    {liveMarket.category}
                  </span>
                  <span
                    className={
                      liveMarket.oracleTrack === "auto_api"
                        ? "inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                        : "inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]"
                    }
                  >
                    {liveMarket.oracleTrack === "auto_api" ? (
                      <LuShieldCheck className="w-3.5 h-3.5" />
                    ) : (
                      <LuRadio className="w-3.5 h-3.5" />
                    )}
                    <span>{liveMarket.oracleLabel}</span>
                  </span>
                  <span
                    className={`px-2.5 py-0.5 text-[11px] font-semibold rounded-[6px] ${
                      isOpen
                        ? "bg-[rgba(133,91,251,0.16)] text-[#7132f5]"
                        : "bg-[rgba(104,107,130,0.14)] text-[#484b5e]"
                    }`}
                  >
                    {liveMarket.status}
                    {liveMarket.outcome ? ` · ${liveMarket.outcome}` : ""}
                  </span>
                </div>

                <h1 className="text-[22px] sm:text-[26px] font-bold text-[#101114] leading-[1.25] tracking-[-0.4px]">
                  {liveMarket.question}
                </h1>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[#686b82]">
                  <span className="inline-flex items-center gap-1.5">
                    <LuFlame className="w-4 h-4 text-[#7132f5]" />
                    <strong className="text-[#101114] tabular-nums">
                      {formatSats(totalPool)} sats
                    </strong>
                    <span>Pool Vol.</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <LuClock className="w-4 h-4 text-[#9497a9]" />
                    <span>{liveMarket.deadline}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <LuActivity className="w-4 h-4 text-[#149e61]" />
                    <span>{bundle.recentTrades.length} confirmed trades</span>
                  </span>
                  <span>Fee {(liveMarket.feeBps / 100).toFixed(0)}% losing pool</span>
                </div>
              </div>
            </div>
          </div>

          {/* Interactive Probability Chart Card (Polymarket / Binance Terminal Style) */}
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
                      Pool at point: <strong className="text-[#101114]">{formatSats(inspected.pt.pool_sats)} sats</strong>{" "}
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

          {/* Outcome Liquidity & Quick Select Rows */}
          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
            <div className="px-5 py-3.5 border-b border-[#dedee5] flex items-center justify-between text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
              <span>Outcome Pools (Parimutuel Liquidity)</span>
              <span>Implied Odds / Payout Multiplier</span>
            </div>

            <div className="divide-y divide-[#dedee5]">
              {(
                [
                  {
                    side: "YES" as const,
                    label: "YES",
                    pct: yesExactPct,
                    displayPct: yesPct,
                    poolSats: liveMarket.yesPool,
                    mult: yesSampleQuote.multiplier,
                    accentBg: "bg-[#149e61]",
                    pillClass: "bg-[rgba(20,158,97,0.16)] text-[#026b3f]",
                    btnActive: "bg-[#149e61] text-white border-[#149e61]",
                    btnIdle: "bg-[rgba(20,158,97,0.12)] text-[#026b3f] border-transparent hover:bg-[#149e61] hover:text-white",
                  },
                  {
                    side: "NO" as const,
                    label: "NO",
                    pct: noExactPct,
                    displayPct: noPct,
                    poolSats: liveMarket.noPool,
                    mult: noSampleQuote.multiplier,
                    accentBg: "bg-[#dc2626]",
                    pillClass: "bg-[rgba(220,38,38,0.12)] text-[#b91c1c]",
                    btnActive: "bg-[#dc2626] text-white border-[#dc2626]",
                    btnIdle: "bg-[rgba(220,38,38,0.10)] text-[#b91c1c] border-transparent hover:bg-[#dc2626] hover:text-white",
                  },
                ] as const
              ).map((row) => {
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
                          <span className={`px-2.5 py-0.5 text-[12px] font-bold rounded-[6px] ${row.pillClass}`}>
                            {row.label}
                          </span>
                          <span className="text-[14px] font-semibold text-[#101114] tabular-nums">
                            {formatSats(row.poolSats)} sats staked
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

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-[20px] font-bold text-[#101114] tabular-nums w-[58px] text-right">
                        {row.pct.toFixed(0)}%
                      </span>
                      <button
                        type="button"
                        disabled={!isOpen}
                        onClick={() => setOrderSide(row.side)}
                        className={`px-4 py-2 text-[13px] font-semibold rounded-[10px] border transition-colors cursor-pointer disabled:opacity-45 ${
                          selected ? row.btnActive : row.btnIdle
                        }`}
                      >
                        Buy {row.label}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Tabbed Intelligence, Trade Tape & Verification Panel */}
          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
            <div className="px-4 sm:px-5 pt-3 border-b border-[#dedee5] flex items-center gap-1 overflow-x-auto no-scrollbar">
              {(
                [
                  ["rules", "Rules & Resolution"],
                  ["insight", "AI Market Insight"],
                  ["trades", `Trade Tape (${bundle.recentTrades.length})`],
                  ["oracle", "Oracle & Spec Proof"],
                ] as const
              ).map(([tabId, label]) => {
                const active = activeTab === tabId;
                return (
                  <button
                    key={tabId}
                    type="button"
                    onClick={() => setActiveTab(tabId)}
                    className={`shrink-0 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 transition-colors cursor-pointer ${
                      active
                        ? "border-[#7132f5] text-[#7132f5]"
                        : "border-transparent text-[#686b82] hover:text-[#101114]"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="p-5 sm:p-6">
              {activeTab === "rules" && (
                <div className="space-y-4">
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#101114] mb-1.5">
                      Settlement Rules
                    </h3>
                    <p className="text-[14px] text-[#686b82] leading-[1.6]">
                      {liveMarket.rules}
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
                        1 · Betting Cutoff
                      </p>
                      <p className="text-[13px] font-semibold text-[#101114] mt-1">
                        {formatUtcDisplay(liveMarket.bettingCutoffIso)}
                      </p>
                    </div>
                    <div className="p-3 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
                        2 · Event Deadline
                      </p>
                      <p className="text-[13px] font-semibold text-[#101114] mt-1">
                        {liveMarket.deadline}
                      </p>
                    </div>
                    <div className="p-3 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)]">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
                        3 · Resolve After
                      </p>
                      <p className="text-[13px] font-semibold text-[#101114] mt-1">
                        {formatUtcDisplay(String(liveMarket.spec.resolve_after_utc ?? ""))}
                      </p>
                    </div>
                  </div>

                  {Array.isArray(liveMarket.spec.assumptions) && liveMarket.spec.assumptions.length > 0 && (
                    <div>
                      <p className="text-[12px] font-semibold text-[#101114] mb-2">
                        Locked Ambiguity Assumptions
                      </p>
                      <ul className="space-y-1.5 text-[13px] text-[#686b82]">
                        {(liveMarket.spec.assumptions as string[]).map((a) => (
                          <li key={a} className="flex items-start gap-2">
                            <span className="w-1.5 h-1.5 rounded-full bg-[#7132f5] mt-2 shrink-0" />
                            <span>{a}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {liveMarket.oracleTrack === "auto_api" &&
                    liveMarket.status !== "SETTLED" &&
                    liveMarket.status !== "RESOLVED" && (
                      <div className="pt-2">
                        <button
                          type="button"
                          disabled={resolving}
                          onClick={handleRunTrackA}
                          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] disabled:opacity-60 rounded-[10px] cursor-pointer"
                        >
                          <LuShieldCheck className="w-4 h-4" />
                          <span>
                            {resolving ? "Running Auto-API Oracle..." : "Run Track A Auto-API Check"}
                          </span>
                        </button>
                      </div>
                    )}
                </div>
              )}

              {activeTab === "insight" && (
                <div className="space-y-4">
                  {bundle.insight ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] text-[12px] font-semibold">
                          <LuSparkles className="w-3.5 h-3.5" />
                          <span>{bundle.insight.model}</span>
                        </span>
                        <span className="text-[12px] text-[#686b82]">
                          {bundle.insight.disclaimer}
                        </span>
                      </div>
                      <p className="text-[14px] text-[#101114] leading-[1.6]">
                        {bundle.insight.summary}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {bundle.insight.data_points.map((dp) => (
                          <div
                            key={dp.label}
                            className="p-3 rounded-[10px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)]"
                          >
                            <p className="text-[11px] font-semibold text-[#9497a9]">{dp.label}</p>
                            <p className="text-[13px] font-semibold text-[#101114] mt-0.5 break-words">
                              {dp.value}
                            </p>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap items-center gap-3 text-[12px]">
                        {bundle.insight.sources.map((src) =>
                          src.startsWith("http") ? (
                            <a
                              key={src}
                              href={src}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-[#7132f5] hover:underline font-medium"
                            >
                              <span>{src}</span>
                              <LuExternalLink className="w-3 h-3" />
                            </a>
                          ) : (
                            <span key={src} className="text-[#686b82]">
                              {src}
                            </span>
                          ),
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="text-[14px] text-[#686b82]">
                      AI Market Insight is not available for this market yet.
                    </p>
                  )}
                </div>
              )}

              {activeTab === "trades" && (
                <div>
                  {bundle.recentTrades.length === 0 ? (
                    <p className="text-[14px] text-[#686b82] py-4">
                      No confirmed Lightning bets recorded yet — place the first wager on the ticket!
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-[13px]">
                        <thead>
                          <tr className="border-b border-[#dedee5] text-[11px] uppercase tracking-[0.04em] text-[#9497a9]">
                            <th className="py-2 pr-4 font-semibold">Side</th>
                            <th className="py-2 pr-4 font-semibold">Amount</th>
                            <th className="py-2 pr-4 font-semibold">Trader</th>
                            <th className="py-2 pr-4 font-semibold">YES Odds After</th>
                            <th className="py-2 font-semibold">Time</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#dedee5]">
                          {bundle.recentTrades.map((t) => (
                            <tr key={t.id}>
                              <td className="py-2.5 pr-4">
                                <span
                                  className={`px-2 py-0.5 text-[11px] font-bold rounded-[6px] ${
                                    t.side === "YES"
                                      ? "bg-[rgba(20,158,97,0.16)] text-[#026b3f]"
                                      : "bg-[rgba(220,38,38,0.12)] text-[#b91c1c]"
                                  }`}
                                >
                                  {t.side}
                                </span>
                              </td>
                              <td className="py-2.5 pr-4 font-semibold text-[#101114] tabular-nums">
                                {formatSats(t.amount_sats)} sats
                              </td>
                              <td className="py-2.5 pr-4 font-mono text-[12px] text-[#686b82]">
                                {t.trader_label}
                              </td>
                              <td className="py-2.5 pr-4 font-semibold text-[#101114] tabular-nums">
                                {t.yes_pct_after.toFixed(1)}% YES
                              </td>
                              <td className="py-2.5 text-[#9497a9]">
                                {formatUtcDisplay(t.timestamp)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )}

              {activeTab === "oracle" && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#5741d8]">
                      <LuCodeXml className="w-4 h-4" />
                      <span>Committed MarketSpec &amp; SHA-256 Proof</span>
                    </span>
                    <button
                      type="button"
                      onClick={handleVerifySha}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white rounded-[8px] transition-colors cursor-pointer"
                    >
                      <LuCircleCheck className="w-3.5 h-3.5" />
                      <span>Verify Spec SHA-256</span>
                    </button>
                  </div>

                  <pre className="p-3.5 text-[12px] leading-[1.5] text-[#101114] bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px] overflow-x-auto font-mono">
                    {JSON.stringify(liveMarket.oracleConfig, null, 2)}
                  </pre>

                  <div className="space-y-1.5 text-[12px]">
                    <div className="flex items-center justify-between gap-2 text-[#686b82]">
                      <span>Backend Spec SHA-256 ({bundle.specVerified ? "Verified" : "Hash"}):</span>
                      <code className="font-mono text-[11px] text-[#101114] truncate max-w-[360px]">
                        {liveMarket.specSha256}
                      </code>
                    </div>
                    {browserDigest && (
                      <div className="flex items-center justify-between gap-2 text-[#026b3f]">
                        <span>
                          Browser WebCrypto Match:{" "}
                          {browserDigest === liveMarket.specSha256 ? "VERIFIED" : "COMPUTED"}
                        </span>
                        <code className="font-mono text-[11px] truncate max-w-[340px]">
                          {browserDigest}
                        </code>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2 text-[#686b82]">
                      <span>Nostr Announcement Note:</span>
                      <button
                        type="button"
                        onClick={handleCopyNote}
                        className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5741d8] hover:underline cursor-pointer"
                      >
                        <span className="truncate max-w-[260px]">{liveMarket.nostrNoteId}</span>
                        {copiedNote ? <LuCheck className="w-3.5 h-3.5" /> : <LuCopy className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {bundle.proofs.length > 0 && (
                    <div className="pt-3 border-t border-[#dedee5] space-y-2">
                      <p className="text-[12px] font-semibold text-[#101114]">
                        Recorded Track A Oracle Proofs ({bundle.proofs.length})
                      </p>
                      {bundle.proofs.map((proof) => (
                        <div
                          key={proof.id}
                          className="p-3 rounded-[10px] bg-[rgba(20,158,97,0.12)] text-[12px] text-[#026b3f] space-y-1"
                        >
                          <div className="font-semibold">
                            Provider: {proof.provider} · Extracted Value: {proof.value ?? "N/A"}
                          </div>
                          <div className="font-mono text-[11px] break-all">{proof.url}</div>
                          {proof.bodySha256 && (
                            <div className="font-mono text-[11px] break-all">
                              Body SHA-256: {proof.bodySha256}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {bundle.proposals.length > 0 && (
                    <div className="pt-3 border-t border-[#dedee5] space-y-2">
                      <p className="text-[12px] font-semibold text-[#101114] inline-flex items-center gap-1.5">
                        <LuScale className="w-3.5 h-3.5 text-[#7132f5]" />
                        <span>Track B Nostr Proposals ({bundle.proposals.length})</span>
                      </p>
                      {bundle.proposals.map((p) => (
                        <div
                          key={p.id}
                          className="p-3 rounded-[10px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)] text-[12px] space-y-1"
                        >
                          <div className="font-semibold text-[#101114]">
                            Outcome: {p.outcome} ({p.status})
                          </div>
                          <div className="font-mono text-[11px] text-[#686b82] truncate">
                            Signer: {p.signerPubkey}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN (4 cols): Sticky Polymarket / Binance Style Trading Order Ticket */}
        <aside className="lg:col-span-4 lg:sticky lg:top-[84px] space-y-4">
          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 space-y-4">
            <div className="flex items-center gap-3 pb-3.5 border-b border-[#dedee5]">
              <img
                src={coverSrc}
                alt=""
                className="w-10 h-10 rounded-[10px] object-cover border border-[#dedee5] shrink-0"
              />
              <div className="min-w-0">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#7132f5]">
                  Buy Position · Lightning
                </p>
                <p className="text-[13px] font-semibold text-[#101114] truncate">
                  {liveMarket.title}
                </p>
              </div>
            </div>

            {/* YES / NO Side Tabs */}
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                disabled={!isOpen}
                onClick={() => setOrderSide("YES")}
                className={`py-3 px-3 rounded-[12px] text-[14px] font-bold border transition-all cursor-pointer disabled:opacity-45 ${
                  activeSide === "YES"
                    ? "bg-[#149e61] text-white border-[#149e61] shadow-micro"
                    : "bg-[rgba(20,158,97,0.12)] text-[#026b3f] border-transparent hover:bg-[rgba(20,158,97,0.2)]"
                }`}
              >
                YES {yesPct}%
              </button>
              <button
                type="button"
                disabled={!isOpen}
                onClick={() => setOrderSide("NO")}
                className={`py-3 px-3 rounded-[12px] text-[14px] font-bold border transition-all cursor-pointer disabled:opacity-45 ${
                  activeSide === "NO"
                    ? "bg-[#dc2626] text-white border-[#dc2626] shadow-micro"
                    : "bg-[rgba(220,38,38,0.10)] text-[#b91c1c] border-transparent hover:bg-[rgba(220,38,38,0.18)]"
                }`}
              >
                NO {noPct}%
              </button>
            </div>

            {/* Stake Amount Input */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="tradeAmountInput"
                  className="text-[12px] font-semibold text-[#686b82]"
                >
                  Amount (sats)
                </label>
                <span className="text-[11px] font-medium text-[#9497a9]">
                  10 – 100,000 sats
                </span>
              </div>
              <div className="relative">
                <input
                  id="tradeAmountInput"
                  type="number"
                  min={10}
                  max={100000}
                  step={10}
                  value={amount}
                  onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
                  className="w-full h-[50px] px-4 pr-16 text-[20px] font-bold text-[#101114] tabular-nums bg-white border border-[#dedee5] rounded-[12px] focus:outline-none focus:border-[#7132f5]"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[#686b82]">
                  SATS
                </span>
              </div>

              <div className="mt-2.5 grid grid-cols-4 gap-1.5">
                {[1000, 5000, 10000, 50000].map((preset) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => setAmount(preset)}
                    className={`py-1.5 text-[12px] font-semibold rounded-[8px] transition-colors cursor-pointer ${
                      amount === preset
                        ? "bg-[rgba(133,91,251,0.16)] text-[#7132f5]"
                        : "bg-[rgba(148,151,169,0.08)] text-[#686b82] hover:text-[#101114]"
                    }`}
                  >
                    {preset >= 1000 ? `${preset / 1000}k` : preset}
                  </button>
                ))}
              </div>
            </div>

            {/* Live Parimutuel Quote Box */}
            <div className="p-3.5 rounded-[12px] bg-[rgba(148,151,169,0.06)] border border-[#dedee5] space-y-2 text-[13px]">
              <div className="flex items-center justify-between text-[#686b82]">
                <span>Implied Odds</span>
                <span className="font-semibold text-[#101114] tabular-nums">
                  {activeSide === "YES" ? yesExactPct.toFixed(1) : noExactPct.toFixed(1)}% {activeSide}
                </span>
              </div>
              <div className="flex items-center justify-between text-[#686b82]">
                <span>Est. Multiplier</span>
                <span className="font-semibold text-[#101114] tabular-nums">
                  {ticketQuote.multiplier}×
                </span>
              </div>
              <div className="flex items-center justify-between text-[#686b82]">
                <span>Fee ({(liveMarket.feeBps / 100).toFixed(0)}% losing pool)</span>
                <span className="font-medium text-[#101114] tabular-nums">
                  {formatSats(ticketQuote.feeSats)} sats
                </span>
              </div>
              <div className="pt-2 border-t border-[#dedee5] flex items-center justify-between">
                <span className="font-semibold text-[#101114]">Est. Payout if {activeSide}</span>
                <div className="text-right">
                  <p className="text-[15px] font-bold text-[#026b3f] tabular-nums">
                    {formatSats(ticketQuote.estPayoutSats)} sats
                  </p>
                  <p className="text-[11px] font-semibold text-[#149e61] tabular-nums">
                    +{formatSats(Math.max(0, estReturnSats))} sats (+{Math.max(0, estReturnPct)}%)
                  </p>
                </div>
              </div>
            </div>

            {/* Wallet / Signer Status & Primary CTA */}
            <div className="text-[12px] text-[#686b82] flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5">
                <LuWallet className="w-3.5 h-3.5 text-[#7132f5]" />
                <span>{user ? "Signed in as" : "Auto guest Nostr wallet ready"}</span>
              </span>
              {user && (
                <code className="font-mono text-[11px] text-[#101114]">
                  {user.npub.slice(0, 12)}...
                </code>
              )}
            </div>

            <button
              type="button"
              disabled={!isOpen || submittingBet || amount < 10}
              onClick={handleSubmitTicket}
              className="w-full py-3.5 px-4 text-[15px] font-bold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:bg-[rgba(148,151,169,0.35)] rounded-[12px] transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <LuZap className="w-4 h-4" />
              <span>
                {!isOpen
                  ? `Trading Closed (${liveMarket.status})`
                  : submittingBet
                    ? "Settling Lightning Invoice..."
                    : `Buy ${activeSide} · ${formatSats(Math.max(10, Math.floor(amount || 0)))} sats`}
              </span>
            </button>

            {lastTxHash && (
              <div className="p-3 rounded-[10px] bg-[rgba(20,158,97,0.14)] text-[#026b3f] text-[12px] space-y-0.5">
                <p className="font-semibold">Lightning invoice settled into pool</p>
                <p className="font-mono text-[11px] truncate">
                  Payment hash: {lastTxHash}
                </p>
              </div>
            )}
          </div>

          {/* Active User Position Card */}
          {myMarketPositions.length > 0 && (
            <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-[14px] font-bold text-[#101114]">
                  Your Positions ({myMarketPositions.length})
                </h3>
                <button
                  type="button"
                  onClick={onOpenPositions}
                  className="text-[12px] font-semibold text-[#7132f5] hover:underline cursor-pointer"
                >
                  View Portfolio
                </button>
              </div>
              <div className="space-y-2">
                {myMarketPositions.map((pos) => (
                  <div
                    key={pos.bet_id}
                    className="p-2.5 rounded-[10px] bg-[rgba(148,151,169,0.06)] border border-[#dedee5] flex items-center justify-between text-[12px]"
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 font-bold rounded-[6px] ${
                          pos.side === "YES"
                            ? "bg-[rgba(20,158,97,0.16)] text-[#026b3f]"
                            : "bg-[rgba(220,38,38,0.12)] text-[#b91c1c]"
                        }`}
                      >
                        {pos.side}
                      </span>
                      <span className="font-semibold text-[#101114] tabular-nums">
                        {formatSats(pos.amount_sats)} sats
                      </span>
                    </div>
                    <span className="text-[#026b3f] font-semibold tabular-nums">
                      {pos.estimated_payout_sats != null
                        ? `Est. ${formatSats(pos.estimated_payout_sats)}`
                        : pos.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}
