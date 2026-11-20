"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuActivity,
  LuArrowLeft,
  LuCheck,
  LuClock,
  LuCopy,
  LuRadio,
  LuRefreshCw,
  LuShieldCheck,
} from "react-icons/lu";
import { MarketCover } from "@/components/shared/MarketCover";
import { SatsIcon } from "@/components/shared/SatsIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  type BackendUserProfile,
  fetchMarketDetailBundle,
  formatSats,
  getApiBase,
  getYesProbability,
  type MarketDetailBundle,
  type MarketItem,
  type MarketSide,
  type MarketTradePoint,
  resolveMarketImageUrl,
  type UserPositionItem,
} from "@/lib/bitpredict-data";
import { MarketIntelligenceTabs } from "./trading/MarketIntelligenceTabs";
import { OrderTicketPanel } from "./trading/OrderTicketPanel";
import { OutcomePoolsCard } from "./trading/OutcomePoolsCard";
import { ProbabilityChartCard } from "./trading/ProbabilityChartCard";

interface MarketTradingViewProps {
  marketIdOrSlug: string;
  initialSide?: MarketSide;
  user: BackendUserProfile | null;
  userPositions: UserPositionItem[];
  onPlaceBet: (opts: {
    market: MarketItem;
    side: MarketSide;
    amountSats: number;
  }) => Promise<{ payment_hash: string; simulated: boolean } | null>;
}

export function MarketTradingView({
  marketIdOrSlug,
  initialSide = "YES",
  user,
  userPositions,
  onPlaceBet,
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
  const [copiedLink, setCopiedLink] = useState(false);

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
      if (
        last.pool_sats !== streamOverlay.point.pool_sats ||
        last.yes_pct !== streamOverlay.point.yes_pct
      ) {
        base.push(streamOverlay.point);
      }
    }
    return base;
  }, [bundle, liveMarket, streamOverlay]);

  const myMarketPositions = useMemo(
    () =>
      liveMarket
        ? userPositions.filter(
            (p) => p.market.id === liveMarket.id || p.market.slug === liveMarket.slug,
          )
        : [],
    [liveMarket, userPositions],
  );

  async function handleCopyLink() {
    const shareUrl = typeof window !== "undefined" ? window.location.href : "";
    await navigator.clipboard?.writeText(shareUrl).catch(() => undefined);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 1800);
  }

  async function handleSubmitTicket(amountSats: number) {
    if (!liveMarket) return null;
    const result = await onPlaceBet({
      market: liveMarket,
      side: activeSide,
      amountSats,
    });
    if (result) {
      await refreshBundle();
    }
    return result;
  }

  if (loading) {
    return (
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#686b82] hover:text-[#101114] cursor-pointer"
        >
          <LuArrowLeft className="w-4 h-4" />
          <span>Back to Markets</span>
        </Link>
        <div
          aria-label="Loading market trading terminal"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start animate-pulse"
        >
          <div className="lg:col-span-8 space-y-5">
            <div className="bg-white border border-[#dedee5] rounded-[16px] p-6 space-y-4 shadow-whisper">
              <div className="flex items-start gap-4">
                <div className="w-16 h-16 rounded-[14px] bg-[rgba(148,151,169,0.16)] shrink-0" />
                <div className="flex-1 space-y-2.5">
                  <div className="h-4 w-44 rounded bg-[rgba(148,151,169,0.16)]" />
                  <div className="h-6 w-full rounded bg-[rgba(148,151,169,0.2)]" />
                  <div className="h-4 w-2/3 rounded bg-[rgba(148,151,169,0.14)]" />
                </div>
              </div>
            </div>
            <div className="bg-white border border-[#dedee5] rounded-[16px] p-6 h-[320px] shadow-whisper" />
          </div>
          <div className="lg:col-span-4 bg-white border border-[#dedee5] rounded-[16px] p-6 h-[380px] shadow-whisper" />
        </div>
      </section>
    );
  }

  if (error || !bundle || !liveMarket) {
    return (
      <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-4">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-[14px] font-semibold text-[#686b82] hover:text-[#101114] cursor-pointer"
        >
          <LuArrowLeft className="w-4 h-4" />
          <span>Back to Markets</span>
        </Link>
        <div className="bg-white border border-[#dedee5] rounded-[16px] p-8 text-center space-y-4 shadow-whisper">
          <h2 className="text-[20px] font-bold text-[#101114]">Market Unavailable</h2>
          <p className="text-[14px] text-[#686b82]">
            {error ?? "This market could not be found or is currently unavailable."}
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
  const isOpen = liveMarket.status === "OPEN";
  const coverSrc = resolveMarketImageUrl(liveMarket);

  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 text-[13px]">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(133,91,251,0.14)] hover:text-[#7132f5] rounded-[10px] transition-colors cursor-pointer"
          >
            <LuArrowLeft className="w-4 h-4" />
            <span>Markets</span>
          </Link>
          <span className="text-[#dedee5]" aria-hidden="true">
            /
          </span>
          <span className="font-semibold text-[#686b82]">{liveMarket.category}</span>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold rounded-[8px] ${
              sseConnected
                ? "bg-[rgba(20,158,97,0.14)] text-[#026b3f]"
                : "bg-[rgba(104,107,130,0.10)] text-[#686b82]"
            }`}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                sseConnected ? "bg-[#149e61] animate-pulse" : "bg-[#9497a9]"
              }`}
            />
            <span>{sseConnected ? "Live Stream" : "Snapshot"}</span>
          </span>

          <button
            type="button"
            onClick={handleCopyLink}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-[#686b82] hover:text-[#101114] bg-white border border-[#dedee5] rounded-[10px] cursor-pointer"
          >
            {copiedLink ? (
              <LuCheck className="w-3.5 h-3.5 text-[#149e61]" />
            ) : (
              <LuCopy className="w-3.5 h-3.5" />
            )}
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

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-8 space-y-5 min-w-0">
          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-start gap-4">
              <MarketCover
                imageUrl={coverSrc}
                category={liveMarket.category}
                alt={liveMarket.question}
                size="lg"
              />
              <div className="flex-1 min-w-0">
                <div className="flex flex-wrap items-center gap-2 mb-2.5">
                  <span className="px-2.5 py-0.5 text-[11px] font-semibold bg-[rgba(104,107,130,0.10)] text-[#484b5e] rounded-[6px]">
                    {liveMarket.category}
                  </span>
                  <span
                    className={
                      liveMarket.oracleTrack === "auto_api"
                        ? "inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.14)] text-[#026b3f] rounded-[6px]"
                        : "inline-flex items-center gap-1 px-2.5 py-0.5 text-[11px] font-semibold bg-[rgba(104,107,130,0.10)] text-[#484b5e] rounded-[6px]"
                    }
                  >
                    {liveMarket.oracleTrack === "auto_api" ? (
                      <LuShieldCheck className="w-3.5 h-3.5" />
                    ) : (
                      <LuRadio className="w-3.5 h-3.5" />
                    )}
                    <span>{liveMarket.oracleLabel}</span>
                  </span>
                  <StatusBadge
                    status={liveMarket.status}
                    outcome={liveMarket.outcome}
                    size="sm"
                  />
                </div>

                <h1 className="text-[22px] sm:text-[26px] font-bold text-[#101114] leading-[1.25] tracking-[-0.4px]">
                  {liveMarket.question}
                </h1>

                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-[#686b82]">
                  <span className="inline-flex items-center gap-1.5">
                    <SatsIcon className="w-4 h-4 shrink-0" />
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

          <ProbabilityChartCard
            points={chartPoints}
            yesExactPct={yesExactPct}
            noExactPct={noExactPct}
          />

          <OutcomePoolsCard
            market={liveMarket}
            yesPct={yesPct}
            noPct={noPct}
            yesExactPct={yesExactPct}
            noExactPct={noExactPct}
            activeSide={activeSide}
            isOpen={isOpen}
            onSelectSide={setOrderSide}
          />

          <MarketIntelligenceTabs
            marketIdOrSlug={marketIdOrSlug}
            liveMarket={liveMarket}
            bundle={bundle}
          />
        </div>

        <OrderTicketPanel
          market={liveMarket}
          coverSrc={coverSrc}
          activeSide={activeSide}
          yesPct={yesPct}
          noPct={noPct}
          yesExactPct={yesExactPct}
          noExactPct={noExactPct}
          isOpen={isOpen}
          user={user}
          myMarketPositions={myMarketPositions}
          onSelectSide={setOrderSide}
          onSubmitBet={handleSubmitTicket}
        />
      </div>
    </section>
  );
}
