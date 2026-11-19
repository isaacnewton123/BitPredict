"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type AppView,
  type BackendUserProfile,
  type CategoryId,
  claimBackendPayout,
  consumePendingTradeSide,
  fetchMarketsFromBackend,
  fetchUserPositionsAndPayouts,
  formatSats,
  getCachedMarkets,
  getCachedUser,
  getCurrentBackendUser,
  loginWithNostrToBackend,
  logoutFromBackend,
  type MarketItem,
  type MarketSide,
  placeAndSettleBackendBet,
  seedDemoMarketsOnBackend,
  setPendingTradeSide,
  type ToastItem,
  updateBackendLightningAddress,
  type UserPayoutItem,
  type UserPositionItem,
} from "@/lib/bitpredict-data";
import { fetchNostrProfileLud16 } from "@/lib/lightning-wallet";
import { AppFooter } from "./layout/AppFooter";
import { AppHeader } from "./layout/AppHeader";
import { parseRouteState } from "./layout/route-utils";
import { ToastStack } from "./layout/ToastStack";
import { MarketDiscoveryView } from "./markets/MarketDiscoveryView";
import { MarketTradingView } from "./MarketTradingView";
import { AdminConsoleView } from "./views/AdminConsoleView";
import { CreatorView } from "./views/CreatorView";
import { HowItWorksView } from "./views/HowItWorksView";
import { OracleConsoleView } from "./views/OracleConsoleView";
import { PositionsView } from "./views/PositionsView";

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
  const router = useRouter();
  const pathname = usePathname();
  const routeState = parseRouteState(pathname, {
    view: initialMarketIdOrSlug ? "market-detail" : initialView,
    category: initialCategory,
    slug: initialMarketIdOrSlug ?? null,
  });

  const activeView = routeState.view;
  const selectedCategory = routeState.category;
  const selectedMarketSlug = routeState.slug;
  const selectedTradeSide: MarketSide = selectedMarketSlug
    ? (consumePendingTradeSide(selectedMarketSlug) ?? "YES")
    : "YES";

  const [selectedOracle, setSelectedOracle] = useState<"all" | "auto_api" | "nostr_oracle">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [markets, setMarkets] = useState<MarketItem[]>(() => getCachedMarkets() ?? []);
  const [loadingMarkets, setLoadingMarkets] = useState(() => getCachedMarkets() === null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  const [user, setUser] = useState<BackendUserProfile | null>(() => getCachedUser());
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [positions, setPositions] = useState<UserPositionItem[]>([]);
  const [payouts, setPayouts] = useState<UserPayoutItem[]>([]);

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
        err instanceof Error ? err.message : "Unable to connect to the market service",
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
          err instanceof Error ? err.message : "Unable to connect to the market service",
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
      if (!logged.user.is_guest && !logged.user.lightning_address) {
        fetchNostrProfileLud16(logged.user.pubkey)
          .then(async (lud16) => {
            if (!lud16) return;
            const updated = await updateBackendLightningAddress(lud16).catch(() => null);
            if (updated?.user) {
              setUser(updated.user);
              showToast(
                "Imported Lightning Address from Nostr Profile",
                `Offline auto-payouts enabled for ${lud16}`,
              );
            }
          })
          .catch(() => undefined);
      }
    } catch (err) {
      showToast(
        "Login Failed",
        err instanceof Error ? err.message : "Could not complete Nostr authentication",
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
        "Showcase Markets Loaded",
        `Created ${res.created_markets}, skipped ${res.skipped_markets}. Total ${res.markets.length} markets.`,
      );
    } catch (err) {
      showToast(
        "Showcase Load Failed",
        err instanceof Error ? err.message : "Could not load showcase markets",
      );
    } finally {
      setSeedingDemo(false);
    }
  }

  async function handlePlaceTerminalBet(opts: {
    market: MarketItem;
    side: MarketSide;
    amountSats: number;
  }): Promise<{ payment_hash: string; simulated: boolean } | null> {
    if (opts.amountSats < 10) {
      showToast("Minimum Wager is 10 Sats", "Enter at least 10 sats to place a bet.");
      return null;
    }

    try {
      const res = await placeAndSettleBackendBet({
        marketId: opts.market.id,
        side: opts.side,
        amountSats: opts.amountSats,
      });
      await Promise.all([loadMarkets(), loadSessionAndPortfolio()]);
      showToast(
        `Settled ${formatSats(opts.amountSats)} sats on ${opts.side}`,
        `Payment ${res.payment_hash.slice(0, 10)}... confirmed in the market pool.`,
      );
      return { payment_hash: res.payment_hash, simulated: res.simulated };
    } catch (err) {
      showToast(
        "Bet Failed",
        err instanceof Error ? err.message : "Could not place Lightning bet",
      );
      return null;
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

  async function handleClaimPayout(payoutId: string, bolt11?: string) {
    await claimBackendPayout(payoutId, bolt11);
    await loadSessionAndPortfolio();
    showToast("Payout Claimed", "Lightning payout has been settled to your wallet.");
  }

  function resetAllFilters() {
    setSelectedOracle("all");
    setSearchQuery("");
    if (selectedCategory !== "All") {
      router.push("/");
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-white text-[#101114]">
      <AppHeader
        activeView={activeView}
        user={user}
        connectingWallet={connectingWallet}
        onConnectOrDisconnect={handleConnectOrDisconnect}
      />

      <main className="flex-1">
        {activeView === "markets" && (
          <MarketDiscoveryView
            markets={markets}
            filteredMarkets={filteredMarkets}
            loadingMarkets={loadingMarkets}
            backendError={backendError}
            totalPoolVolume={totalPoolVolume}
            autoApiCount={autoApiCount}
            selectedCategory={selectedCategory}
            selectedOracle={selectedOracle}
            searchQuery={searchQuery}
            onChangeOracle={setSelectedOracle}
            onChangeSearch={setSearchQuery}
            onReload={loadMarkets}
            onResetFilters={resetAllFilters}
          />
        )}

        {activeView === "market-detail" && selectedMarketSlug && (
          <MarketTradingView
            marketIdOrSlug={selectedMarketSlug}
            initialSide={selectedTradeSide}
            user={user}
            userPositions={positions}
            onPlaceBet={handlePlaceTerminalBet}
          />
        )}

        {activeView === "creator" && (
          <CreatorView
            onPublished={async (created) => {
              await loadMarkets();
              setSelectedOracle("all");
              setSearchQuery("");
              setPendingTradeSide(created.slug, "YES");
              router.push(`/m/${encodeURIComponent(created.slug)}`);
              showToast(
                "Market Published Live",
                `"${created.question.slice(0, 48)}..." is now live for Lightning trading.`,
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
            onNotify={showToast}
          />
        )}

        {activeView === "admin" && (
          <AdminConsoleView
            user={user}
            markets={markets}
            seedingDemo={seedingDemo}
            onConnectNwc={handleConnectOrDisconnect}
            onRefreshMarkets={loadMarkets}
            onSeedDemo={handleSeedDemo}
            onNotify={showToast}
          />
        )}

        {activeView === "how-it-works" && <HowItWorksView />}
      </main>

      <AppFooter />

      <ToastStack toasts={toasts} />
    </div>
  );
}
