"use client";

import Image from "next/image";
import type { IconType } from "react-icons";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  LuBitcoin,
  LuChartBar,
  LuChartColumn,
  LuCircleCheck,
  LuClock,
  LuCloudSun,
  LuCompass,
  LuCpu,
  LuGamepad2,
  LuLandmark,
  LuLayoutGrid,
  LuPlus,
  LuRadio,
  LuRefreshCw,
  LuSearch,
  LuSearchX,
  LuShieldCheck,
  LuSparkles,
  LuTrendingUp,
  LuTrophy,
  LuWallet,
  LuZap,
} from "react-icons/lu";
import {
  type AppView,
  type BackendUserProfile,
  CATEGORIES,
  type CategoryId,
  claimBackendPayout,
  fetchMarketsFromBackend,
  fetchUserPositionsAndPayouts,
  formatSats,
  getApiBase,
  getCurrentBackendUser,
  getYesProbability,
  loginWithNostrToBackend,
  logoutFromBackend,
  type MarketItem,
  type MarketSide,
  placeAndSettleBackendBet,
  seedDemoMarketsOnBackend,
  type ToastItem,
  updateBackendLightningAddress,
  type UserPayoutItem,
  type UserPositionItem,
} from "@/lib/bitpredict-data";
import { BetModal, MarketInspectorModal } from "./MarketModals";
import {
  CreatorView,
  HowItWorksView,
  OracleConsoleView,
  PositionsView,
} from "./SecondaryViews";

const CATEGORY_ICONS: Record<CategoryId, IconType> = {
  All: LuLayoutGrid,
  Sports: LuTrophy,
  Politics: LuLandmark,
  Crypto: LuBitcoin,
  Esports: LuGamepad2,
  Finance: LuTrendingUp,
  Technology: LuCpu,
  Economy: LuChartBar,
  Culture: LuSparkles,
  Weather: LuCloudSun,
};

interface BitPredictAppProps {
  initialView?: AppView;
  initialCategory?: CategoryId;
  initialMarketIdOrSlug?: string | null;
}

export function BitPredictApp({
  initialView = "markets",
  initialCategory = "All",
  initialMarketIdOrSlug = null,
}: BitPredictAppProps) {
  const [activeView, setActiveView] = useState<AppView>(initialView);
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>(initialCategory);
  const [selectedOracle, setSelectedOracle] = useState<"all" | "auto_api" | "nostr_oracle">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [markets, setMarkets] = useState<MarketItem[]>([]);
  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  const [user, setUser] = useState<BackendUserProfile | null>(null);
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [positions, setPositions] = useState<UserPositionItem[]>([]);
  const [payouts, setPayouts] = useState<UserPayoutItem[]>([]);

  const [betModalMarket, setBetModalMarket] = useState<MarketItem | null>(null);
  const [betSide, setBetSide] = useState<MarketSide>("YES");
  const [betAmount, setBetAmount] = useState(5000);
  const [submittingBet, setSubmittingBet] = useState(false);

  const [inspectorMarketId, setInspectorMarketId] = useState<string | null>(
    initialMarketIdOrSlug ?? null,
  );
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((title: string, subtitle: string) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setToasts((prev) => [...prev, { id, title, subtitle }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const loadMarkets = useCallback(async () => {
    setLoadingMarkets(true);
    setBackendError(null);
    try {
      const data = await fetchMarketsFromBackend();
      setMarkets(data);
    } catch (err) {
      setBackendError(
        err instanceof Error
          ? err.message
          : "Unable to reach Elysia backend API",
      );
    } finally {
      setLoadingMarkets(false);
    }
  }, []);

  const loadSessionAndPortfolio = useCallback(async () => {
    try {
      const current = await getCurrentBackendUser();
      setUser(current);
      if (current) {
        const res = await fetchUserPositionsAndPayouts();
        setPositions(res.positions);
        setPayouts(res.payouts);
      } else {
        setPositions([]);
        setPayouts([]);
      }
    } catch {
      // ignore initial auth hydration error when backend offline
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchMarketsFromBackend()
      .then((data) => {
        if (!active) return;
        setMarkets(data);
        setBackendError(null);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setBackendError(
          err instanceof Error
            ? err.message
            : "Unable to reach Elysia backend API",
        );
      })
      .finally(() => {
        if (active) setLoadingMarkets(false);
      });

    getCurrentBackendUser()
      .then(async (current) => {
        if (!active) return;
        setUser(current);
        if (current) {
          const res = await fetchUserPositionsAndPayouts();
          if (active) {
            setPositions(res.positions);
            setPayouts(res.payouts);
          }
        }
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

  function switchView(next: AppView) {
    setActiveView(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const filteredMarkets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return markets.filter((m) => {
      const matchesCat = selectedCategory === "All" || m.category === selectedCategory;
      const matchesOracle = selectedOracle === "all" || m.oracleTrack === selectedOracle;
      const matchesSearch =
        !q ||
        m.question.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.oracleLabel.toLowerCase().includes(q) ||
        m.rules.toLowerCase().includes(q);
      return matchesCat && matchesOracle && matchesSearch;
    });
  }, [markets, selectedCategory, selectedOracle, searchQuery]);

  const totalPoolVolume = useMemo(
    () => markets.reduce((sum, m) => sum + m.yesPool + m.noPool, 0),
    [markets],
  );
  const autoApiCount = useMemo(
    () => markets.filter((m) => m.oracleTrack === "auto_api").length,
    [markets],
  );

  async function handleConnectOrDisconnect() {
    if (user) {
      await logoutFromBackend();
      setUser(null);
      setPositions([]);
      setPayouts([]);
      showToast("Session Signed Out", "Reconnect Nostr anytime to trade or claim payouts.");
      return;
    }

    setConnectingWallet(true);
    try {
      const logged = await loginWithNostrToBackend();
      setUser(logged.user);
      const res = await fetchUserPositionsAndPayouts();
      setPositions(res.positions);
      setPayouts(res.payouts);
      showToast(
        "Nostr Session Active",
        `${logged.user.npub.slice(0, 12)}...${logged.user.npub.slice(-4)} authenticated`,
      );
    } catch (err) {
      showToast(
        "Login Failed",
        err instanceof Error ? err.message : "Could not authenticate with Elysia backend",
      );
    } finally {
      setConnectingWallet(false);
    }
  }

  async function handleSeedDemo() {
    setSeedingDemo(true);
    try {
      const res = await seedDemoMarketsOnBackend();
      setMarkets(res.markets);
      setBackendError(null);
      showToast(
        "Backend Demo Data Loaded",
        `Created ${res.created_markets}, skipped ${res.skipped_markets}. Total ${res.markets.length} markets.`,
      );
    } catch (err) {
      showToast(
        "Demo Seed Failed",
        err instanceof Error ? err.message : "Could not seed backend demo markets",
      );
    } finally {
      setSeedingDemo(false);
    }
  }

  function openBetModal(market: MarketItem, side: MarketSide) {
    setBetModalMarket(market);
    setBetSide(side);
    setBetAmount(5000);
  }

  async function handleConfirmBet() {
    if (!betModalMarket) return;
    if (betAmount < 10) {
      showToast("Minimum Wager is 10 Sats", "Enter at least 10 sats to place a bet.");
      return;
    }

    setSubmittingBet(true);
    try {
      const res = await placeAndSettleBackendBet({
        marketId: betModalMarket.id,
        side: betSide,
        amountSats: betAmount,
      });
      await Promise.all([loadMarkets(), loadSessionAndPortfolio()]);
      setBetModalMarket(null);
      showToast(
        `Settled ${formatSats(betAmount)} sats on ${betSide}`,
        `Payment ${res.payment_hash.slice(0, 10)}... confirmed in backend ledger.`,
      );
    } catch (err) {
      showToast(
        "Bet Failed",
        err instanceof Error ? err.message : "Could not place Lightning bet",
      );
    } finally {
      setSubmittingBet(false);
    }
  }

  async function handleSaveLightningAddress(addr: string) {
    const trimmed = addr.trim();
    const res = await updateBackendLightningAddress(trimmed || null);
    setUser(res.user);
    showToast(
      "Lightning Address Saved",
      trimmed ? `Payouts routed to ${trimmed}` : "Cleared Lightning payout address",
    );
  }

  async function handleClaimPayout(payoutId: string) {
    await claimBackendPayout(payoutId);
    await loadSessionAndPortfolio();
    showToast("Payout Claimed", "Lightning payout settled via backend claim endpoint.");
  }

  function resetAllFilters() {
    setSelectedCategory("All");
    setSelectedOracle("all");
    setSearchQuery("");
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#101114]">
      {/* 1. STICKY TOP NAVIGATION BAR */}
      <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-[#dedee5]">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-[72px] flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => switchView("markets")}
            aria-label="BitPredict home"
            className="flex items-center shrink-0 focus:outline-none cursor-pointer"
          >
            <Image
              src="/brand/bitpredict-wordmark-light.png"
              alt="BitPredict"
              width={156}
              height={34}
              priority
              className="h-8 w-auto"
            />
          </button>

          <nav aria-label="Main Navigation" className="hidden md:flex items-center gap-1.5">
            {(
              [
                ["markets", "Markets", LuChartColumn],
                ["creator", "AI Creator", LuSparkles],
                ["oracle", "Oracle", LuShieldCheck],
                ["positions", "Positions", LuWallet],
                ["how-it-works", "How It Works", LuCompass],
              ] as const
            ).map(([viewKey, label, Icon]) => {
              const active = activeView === viewKey;
              return (
                <button
                  key={viewKey}
                  type="button"
                  onClick={() => switchView(viewKey)}
                  className={
                    active
                      ? "inline-flex items-center gap-2 px-3.5 py-2 text-[14px] font-semibold rounded-[12px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] transition-colors cursor-pointer"
                      : "inline-flex items-center gap-2 px-3.5 py-2 text-[14px] font-semibold rounded-[12px] text-[#686b82] hover:text-[#101114] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
                  }
                >
                  <Icon className="w-4 h-4" strokeWidth={2} />
                  <span>{label}</span>
                </button>
              );
            })}
          </nav>

          <div className="flex items-center gap-2.5 shrink-0">
            <button
              type="button"
              onClick={() => switchView("creator")}
              className="hidden sm:inline-flex items-center gap-1.5 px-4 py-[10px] text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
            >
              <LuPlus className="w-4 h-4" strokeWidth={2.2} />
              <span>Create Market</span>
            </button>

            <button
              type="button"
              disabled={connectingWallet}
              onClick={handleConnectOrDisconnect}
              className={
                user
                  ? "inline-flex items-center gap-2 px-3.5 py-[10px] text-[13px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] border border-transparent hover:bg-[rgba(20,158,97,0.24)] rounded-[12px] transition-colors cursor-pointer"
                  : "inline-flex items-center gap-2 px-3.5 py-[10px] text-[14px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] rounded-[12px] transition-colors cursor-pointer"
              }
            >
              <LuZap className="w-4 h-4" strokeWidth={2} />
              {user ? (
                <span className="font-mono">
                  {user.npub.slice(0, 10)}...{user.npub.slice(-4)}
                </span>
              ) : (
                <span>{connectingWallet ? "Signing..." : "Connect NWC"}</span>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Navigation Row */}
        <div
          aria-label="Mobile Navigation"
          className="md:hidden border-t border-[#dedee5] px-3 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar bg-white"
        >
          {(
            [
              ["markets", "Markets", LuChartColumn],
              ["creator", "AI Creator", LuSparkles],
              ["oracle", "Oracle", LuShieldCheck],
              ["positions", "Positions", LuWallet],
              ["how-it-works", "How It Works", LuCompass],
            ] as const
          ).map(([viewKey, label, Icon]) => {
            const active = activeView === viewKey;
            return (
              <button
                key={viewKey}
                type="button"
                onClick={() => switchView(viewKey)}
                className={
                  active
                    ? "shrink-0 inline-flex items-center justify-center gap-1.5 py-2 px-3 text-[13px] font-semibold rounded-[12px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] transition-colors cursor-pointer"
                    : "shrink-0 inline-flex items-center justify-center gap-1.5 py-2 px-3 text-[13px] font-semibold rounded-[12px] text-[#686b82] hover:text-[#101114] transition-colors cursor-pointer"
                }
              >
                <Icon className="w-3.5 h-3.5" strokeWidth={2} />
                <span>{label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* MAIN CONTENT VIEWS */}
      <main className="flex-1">
        {activeView === "markets" && (
          <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#dedee5]">
              <div>
                <h1 className="text-[30px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114]">
                  Live Prediction Markets
                </h1>
                <p className="text-[15px] text-[#686b82] mt-1">
                  Loaded directly from Elysia backend ({getApiBase() || "same-origin proxy"}).
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-2 px-3 py-2 bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px]">
                  <span className="w-2 h-2 rounded-full bg-[#149e61]" />
                  <span className="text-[13px] text-[#686b82]">Active Markets:</span>
                  <strong className="text-[14px] font-bold text-[#101114]">
                    {markets.length}
                  </strong>
                </div>

                <div className="inline-flex items-center gap-2 px-3 py-2 bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px]">
                  <LuZap className="w-3.5 h-3.5 text-[#7132f5]" strokeWidth={2} />
                  <span className="text-[13px] text-[#686b82]">Total Pool:</span>
                  <strong className="text-[14px] font-bold text-[#101114]">
                    {formatSats(totalPoolVolume)} sats
                  </strong>
                </div>

                <div className="inline-flex items-center gap-1.5 px-3 py-2 bg-[rgba(20,158,97,0.16)] rounded-[12px]">
                  <LuShieldCheck className="w-3.5 h-3.5 text-[#026b3f]" strokeWidth={2} />
                  <span className="text-[13px] font-semibold text-[#026b3f]">
                    {autoApiCount} Auto-API
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 py-5">
              <div className="relative flex-1 max-w-[460px]">
                <LuSearch
                  className="w-4 h-4 text-[#9497a9] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  strokeWidth={2}
                />
                <input
                  id="marketSearchInput"
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search markets, cities, tickers, or oracles..."
                  className="w-full h-[44px] pl-10 pr-4 text-[14px] text-[#101114] placeholder-[#9497a9] bg-white border border-[#dedee5] rounded-[12px] focus:outline-none focus:border-[#7132f5] transition-colors"
                />
              </div>

              <div className="inline-flex items-center gap-1.5 p-1 bg-[rgba(148,151,169,0.08)] rounded-[12px] self-start md:self-auto">
                {(
                  [
                    ["all", "All Oracles"],
                    ["auto_api", "Auto-API"],
                    ["nostr_oracle", "Nostr Oracle"],
                  ] as const
                ).map(([oracleKey, label]) => {
                  const active = selectedOracle === oracleKey;
                  return (
                    <button
                      key={oracleKey}
                      type="button"
                      onClick={() => setSelectedOracle(oracleKey)}
                      className={
                        active
                          ? "px-3.5 py-2 text-[13px] font-semibold rounded-[10px] bg-white text-[#101114] shadow-micro transition-colors cursor-pointer"
                          : "px-3.5 py-2 text-[13px] font-medium rounded-[10px] text-[#686b82] hover:text-[#101114] transition-colors cursor-pointer"
                      }
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 mb-6">
              {CATEGORIES.map((cat) => {
                const isActive = selectedCategory === cat.id;
                const Icon = CATEGORY_ICONS[cat.id];
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setSelectedCategory(cat.id)}
                    className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2.5 text-[14px] font-medium rounded-[12px] transition-colors cursor-pointer ${
                      isActive
                        ? "bg-[#7132f5] text-white"
                        : "bg-[rgba(148,151,169,0.08)] text-[#101114] hover:bg-[rgba(133,91,251,0.16)] hover:text-[#7132f5]"
                    }`}
                  >
                    <Icon className="w-4 h-4" strokeWidth={1.85} />
                    <span>{cat.label}</span>
                  </button>
                );
              })}
            </div>

            {backendError ? (
              <div className="text-center py-14 px-6 border border-[#dedee5] rounded-[16px] bg-white shadow-whisper space-y-4">
                <h3 className="text-[18px] font-semibold text-[#101114]">
                  Backend API unreachable ({getApiBase() || "/api/v1"})
                </h3>
                <p className="text-[14px] text-[#686b82] max-w-lg mx-auto">
                  {backendError}. Make sure the Elysia backend in <code>app/</code> is running with{" "}
                  <code>bun run dev</code> on port <code>3001</code>.
                </p>
                <button
                  type="button"
                  onClick={loadMarkets}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] cursor-pointer"
                >
                  <LuRefreshCw className="w-4 h-4" />
                  <span>Retry Backend Connection</span>
                </button>
              </div>
            ) : loadingMarkets ? (
              <div className="text-center py-16 border border-[#dedee5] rounded-[16px] bg-white shadow-whisper text-[14px] text-[#686b82]">
                Loading live prediction markets from Elysia backend...
              </div>
            ) : filteredMarkets.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                {filteredMarkets.map((m) => {
                  const yesPct = getYesProbability(m);
                  const noPct = 100 - yesPct;
                  const totalPool = m.yesPool + m.noPool;
                  const isOpen = m.status === "OPEN";

                  return (
                    <article
                      key={m.id}
                      className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col justify-between hover:border-[#9497a9] transition-colors"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2 mb-3.5">
                          <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                            {m.category}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold ${
                              m.oracleTrack === "auto_api"
                                ? "bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                                : "bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]"
                            }`}
                          >
                            {m.oracleTrack === "auto_api" ? (
                              <LuShieldCheck className="w-3.5 h-3.5" strokeWidth={2} />
                            ) : (
                              <LuRadio className="w-3.5 h-3.5" strokeWidth={2} />
                            )}
                            <span>{m.oracleLabel}</span>
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() => setInspectorMarketId(m.id)}
                          className="text-left text-[17px] font-semibold text-[#101114] hover:text-[#7132f5] leading-[1.35] mb-2.5 transition-colors cursor-pointer block"
                        >
                          {m.question}
                        </button>

                        <p className="inline-flex items-center gap-1.5 text-[12px] text-[#9497a9] mb-4">
                          <LuClock className="w-3.5 h-3.5" strokeWidth={2} />
                          <span>{m.deadline}</span>
                        </p>

                        <div className="mb-4">
                          <div className="flex items-center justify-between text-[13px] font-semibold mb-1.5">
                            <span className="text-[#026b3f]">YES {yesPct}%</span>
                            <span className="text-[#686b82]">NO {noPct}%</span>
                          </div>
                          <div className="w-full h-2 bg-[#dedee5] rounded-[6px] overflow-hidden">
                            <div
                              className="h-full bg-[#149e61] rounded-[6px] transition-all duration-300"
                              style={{ width: `${yesPct}%` }}
                            />
                          </div>
                        </div>
                      </div>

                      <div>
                        <div className="grid grid-cols-2 gap-2.5 mb-4">
                          <button
                            type="button"
                            disabled={!isOpen}
                            onClick={() => openBetModal(m, "YES")}
                            className="py-2.5 px-3 text-[14px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white disabled:opacity-45 rounded-[12px] transition-colors cursor-pointer"
                          >
                            Bet YES
                          </button>
                          <button
                            type="button"
                            disabled={!isOpen}
                            onClick={() => openBetModal(m, "NO")}
                            className="py-2.5 px-3 text-[14px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(133,91,251,0.16)] hover:text-[#7132f5] disabled:opacity-45 rounded-[12px] transition-colors cursor-pointer"
                          >
                            Bet NO
                          </button>
                        </div>

                        <div className="pt-3 border-t border-[#dedee5] flex items-center justify-between text-[12px] text-[#686b82]">
                          <span className="inline-flex items-center gap-1 font-semibold text-[#101114]">
                            <LuZap className="w-3.5 h-3.5 text-[#7132f5]" strokeWidth={2} />
                            {formatSats(totalPool)} sats
                          </span>

                          <button
                            type="button"
                            onClick={() => setInspectorMarketId(m.id)}
                            className="text-[12px] font-medium text-[#5741d8] hover:underline cursor-pointer"
                          >
                            Insight &amp; Spec
                          </button>

                          <span className="text-[11px] font-semibold text-[#686b82]">
                            {m.outcome ? `${m.status} · ${m.outcome}` : m.status}
                          </span>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-16 border border-[#dedee5] rounded-[16px] bg-white shadow-whisper">
                <div className="w-12 h-12 mx-auto mb-3 rounded-[12px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] flex items-center justify-center">
                  <LuSearchX className="w-6 h-6" />
                </div>
                <h3 className="text-[18px] font-semibold text-[#101114] mb-1">
                  No matching markets found
                </h3>
                <p className="text-[14px] text-[#686b82] mb-5">
                  Adjust your filters, seed showcase demo markets on the backend, or create one.
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={resetAllFilters}
                    className="px-4 py-2.5 text-[14px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] rounded-[12px] transition-colors cursor-pointer"
                  >
                    Reset Filters
                  </button>
                  <button
                    type="button"
                    disabled={seedingDemo}
                    onClick={handleSeedDemo}
                    className="px-4 py-2.5 text-[14px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white rounded-[12px] transition-colors cursor-pointer"
                  >
                    {seedingDemo ? "Seeding..." : "Load Backend Demo Markets"}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchView("creator")}
                    className="px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
                  >
                    Open AI Creator
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {activeView === "creator" && (
          <CreatorView
            onPublished={async (created) => {
              await loadMarkets();
              setSelectedCategory("All");
              setSelectedOracle("all");
              setSearchQuery("");
              switchView("markets");
              showToast(
                "Market Published Live",
                `"${created.question.slice(0, 48)}..." saved in backend SQLite & Nostr.`,
              );
            }}
            onNotify={showToast}
          />
        )}

        {activeView === "oracle" && (
          <OracleConsoleView
            markets={markets}
            onRefreshMarkets={loadMarkets}
            onNotify={showToast}
          />
        )}

        {activeView === "positions" && (
          <PositionsView
            user={user}
            positions={positions}
            payouts={payouts}
            onConnectNwc={handleConnectOrDisconnect}
            onSaveLightningAddress={handleSaveLightningAddress}
            onClaimPayout={handleClaimPayout}
            onInspectMarket={(marketId) => setInspectorMarketId(marketId)}
          />
        )}

        {activeView === "how-it-works" && (
          <HowItWorksView onSwitchView={switchView} />
        )}
      </main>

      {/* MINIMAL FOOTER */}
      <footer className="bg-white border-t border-[#dedee5] mt-auto">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-7 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => switchView("markets")}
              aria-label="BitPredict home"
              className="flex items-center cursor-pointer"
            >
              <Image
                src="/brand/bitpredict-wordmark-light.png"
                alt="BitPredict"
                width={120}
                height={26}
                className="h-6 w-auto"
              />
            </button>
            <span className="text-[#dedee5]">|</span>
            <span className="text-[13px] text-[#9497a9]">
              Bitcoin Lightning &amp; Nostr Prediction Protocol
            </span>
          </div>

          <nav className="flex flex-wrap items-center justify-center gap-5 text-[13px] font-medium text-[#686b82]">
            <button
              type="button"
              onClick={() => switchView("markets")}
              className="hover:text-[#7132f5] transition-colors cursor-pointer"
            >
              Live Markets
            </button>
            <button
              type="button"
              onClick={() => switchView("creator")}
              className="hover:text-[#7132f5] transition-colors cursor-pointer"
            >
              AI Creator
            </button>
            <button
              type="button"
              onClick={() => switchView("oracle")}
              className="hover:text-[#7132f5] transition-colors cursor-pointer"
            >
              Oracle Queue
            </button>
            <button
              type="button"
              onClick={() => switchView("how-it-works")}
              className="hover:text-[#7132f5] transition-colors cursor-pointer"
            >
              How It Works
            </button>
            <a
              href={`${getApiBase() || "http://localhost:3001"}/openapi`}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-[#7132f5] transition-colors"
            >
              Scalar API Docs
            </a>
          </nav>
        </div>
      </footer>

      {/* LIGHTNING (NWC) BETTING MODAL */}
      <BetModal
        market={betModalMarket}
        side={betSide}
        amount={betAmount}
        submitting={submittingBet}
        walletConnected={Boolean(user)}
        userNpub={user?.npub ?? null}
        onChangeSide={setBetSide}
        onChangeAmount={setBetAmount}
        onConfirm={handleConfirmBet}
        onClose={() => setBetModalMarket(null)}
      />

      {/* CONTRACT, AI INSIGHT & SHA-256 SPEC INSPECTOR MODAL */}
      <MarketInspectorModal
        marketIdOrSlug={inspectorMarketId}
        onClose={() => setInspectorMarketId(null)}
        onOpenBet={openBetModal}
        onRefreshMarkets={loadMarkets}
        onNotify={showToast}
      />

      {/* TOAST NOTIFICATION CONTAINER */}
      <div
        id="toastContainer"
        className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-[360px] w-[calc(100%-2.5rem)]"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-3 p-3.5 bg-white border border-[#dedee5] rounded-[12px] shadow-whisper transition-all duration-200"
          >
            <div className="w-8 h-8 shrink-0 rounded-[8px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] flex items-center justify-center">
              <LuCircleCheck className="w-4 h-4" strokeWidth={2} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-semibold text-[#101114] leading-[1.3]">
                {t.title}
              </p>
              <p className="text-[12px] text-[#686b82] mt-0.5">{t.subtitle}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
