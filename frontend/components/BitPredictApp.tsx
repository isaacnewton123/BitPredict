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
  type PlaceBetOutcome,
  seedDemoMarketsOnBackend,
  setPendingTradeSide,
  type ToastItem,
  updateBackendLightningAddress,
  type UserPayoutItem,
  type UserPositionItem,
} from "@/lib/bitpredict-data";
import { fetchNostrProfileLud16, syncWalletWithAccount } from "@/lib/lightning-wallet";
import { useConnectedWallet } from "@/lib/use-connected-wallet";
import { ConnectAccountModal } from "./auth/ConnectAccountModal";
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

  const [selectedStatus, setSelectedStatus] = useState<"all" | "open" | "closed">("all");
  const [selectedOracle, setSelectedOracle] = useState<"all" | "auto_api" | "nostr_oracle">("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [user, setUser] = useState<BackendUserProfile | null>(() => getCachedUser());
  const activeEnv: "live" | "demo" = user?.is_guest ? "demo" : "live";

  const [markets, setMarkets] = useState<MarketItem[]>(() => getCachedMarkets(activeEnv) ?? []);
  const [loadingMarkets, setLoadingMarkets] = useState(() => getCachedMarkets(activeEnv) === null);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [seedingDemo, setSeedingDemo] = useState(false);

  const wallet = useConnectedWallet();
  const [connectingWallet, setConnectingWallet] = useState(false);
  const [connectModalOpen, setConnectModalOpen] = useState(false);
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

  const loadMarkets = useCallback(
    async (envOverride?: "live" | "demo") => {
      const targetEnv = envOverride ?? activeEnv;
      setLoadingMarkets(true);
      setBackendError(null);
      try {
        const data = await fetchMarketsFromBackend(targetEnv);
        setMarkets(data);
      } catch (err) {
        setBackendError(
          err instanceof Error ? err.message : "Unable to connect to the market service",
        );
      } finally {
        setLoadingMarkets(false);
      }
    },
    [activeEnv],
  );

  const loadSessionAndPortfolio = useCallback(async () => {
    try {
      const current = await getCurrentBackendUser();
      syncWalletWithAccount(current);
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
    fetchMarketsFromBackend(activeEnv)
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

    return () => {
      active = false;
    };
  }, [activeEnv]);

  useEffect(() => {
    let active = true;
    getCurrentBackendUser()
      .then(async (current) => {
        if (!active) return;
        syncWalletWithAccount(current);
        setUser(current);
        if (current) {
          if (current.is_guest) {
            const cachedDemo = getCachedMarkets("demo");
            setMarkets(cachedDemo ?? []);
            setLoadingMarkets(cachedDemo === null);
          }
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

  const envMarkets = useMemo(
    () => markets.filter((m) => (activeEnv === "demo" ? m.isDemo : !m.isDemo)),
    [markets, activeEnv],
  );

  const filteredMarkets = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return envMarkets.filter((m) => {
      const matchesCat = selectedCategory === "All" || m.category === selectedCategory;
      const matchesStatus =
        selectedStatus === "all" ||
        (selectedStatus === "open" ? m.status === "OPEN" : m.status !== "OPEN");
      const matchesOracle = selectedOracle === "all" || m.oracleTrack === selectedOracle;
      const matchesSearch =
        !q ||
        m.question.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        m.oracleLabel.toLowerCase().includes(q) ||
        m.rules.toLowerCase().includes(q);
      return matchesCat && matchesStatus && matchesOracle && matchesSearch;
    });
  }, [envMarkets, selectedCategory, selectedStatus, selectedOracle, searchQuery]);

  const totalPoolVolume = useMemo(
    () => envMarkets.reduce((sum, m) => sum + m.yesPool + m.noPool, 0),
    [envMarkets],
  );
  const autoApiCount = useMemo(
    () => envMarkets.filter((m) => m.oracleTrack === "auto_api").length,
    [envMarkets],
  );

  async function handleLoginMode(mode: "live" | "demo") {
    setConnectingWallet(true);
    try {
      const logged = await loginWithNostrToBackend(mode);
      syncWalletWithAccount(logged.user);
      setUser(logged.user);

      const cached = getCachedMarkets(mode);
      setMarkets(cached ?? []);
      setLoadingMarkets(cached === null);

      const [nextMarkets, res] = await Promise.all([
        fetchMarketsFromBackend(mode),
        fetchUserPositionsAndPayouts(),
      ]);
      setMarkets(nextMarkets);
      setLoadingMarkets(false);
      setBackendError(null);
      setPositions(res.positions);
      setPayouts(res.payouts);
      showToast(
        mode === "demo" ? "Demo Sandbox Account Active" : "Live Nostr Account Active",
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
      throw err;
    } finally {
      setConnectingWallet(false);
    }
  }

  async function handleLogout() {
    await logoutFromBackend();
    setUser(null);
    setPositions([]);
    setPayouts([]);
    const liveCached = getCachedMarkets("live");
    setMarkets(liveCached ?? []);
    setLoadingMarkets(liveCached === null);
    showToast("Session Signed Out", "Connect a Live Nostr or Demo Account anytime.");
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
  }): Promise<PlaceBetOutcome | null> {
    if (!user) {
      setConnectModalOpen(true);
      showToast(
        "Connect Account Required",
        "Select Live Nostr or Demo Account before placing a bet.",
      );
      return null;
    }
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
      if (res.status === "settled") {
        await Promise.all([loadMarkets(), loadSessionAndPortfolio()]);
        showToast(
          res.simulated
            ? `Demo Wager Settled · ${formatSats(opts.amountSats)} sats on ${opts.side}`
            : `Settled ${formatSats(opts.amountSats)} sats on ${opts.side}`,
          `Payment ${res.payment_hash.slice(0, 10)}... confirmed in the market pool.`,
        );
      } else {
        showToast(
          "Lightning Invoice Ready",
          "Scan the QR code or open in your wallet to confirm the bet.",
        );
      }
      return res;
    } catch (err) {
      showToast(
        "Bet Failed",
        err instanceof Error ? err.message : "Could not place Lightning bet",
      );
      return null;
    }
  }

  async function handleLiveInvoiceSettled(opts: {
    market: MarketItem;
    side: MarketSide;
    amountSats: number;
    paymentHash: string;
  }) {
    await Promise.all([loadMarkets(), loadSessionAndPortfolio()]);
    showToast(
      `Settled ${formatSats(opts.amountSats)} sats on ${opts.side}`,
      `Payment ${opts.paymentHash.slice(0, 10)}... confirmed in ${opts.market.title.slice(0, 32)}.`,
    );
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
    setSelectedStatus("all");
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
        onOpenConnectModal={() => setConnectModalOpen(true)}
        onSwitchToLive={() => setConnectModalOpen(true)}
      />

      <main className="flex-1">
        {activeView === "markets" && (
          <MarketDiscoveryView
            markets={envMarkets}
            filteredMarkets={filteredMarkets}
            loadingMarkets={loadingMarkets}
            backendError={backendError}
            activeEnv={activeEnv}
            totalPoolVolume={totalPoolVolume}
            autoApiCount={autoApiCount}
            selectedCategory={selectedCategory}
            selectedStatus={selectedStatus}
            selectedOracle={selectedOracle}
            searchQuery={searchQuery}
            onChangeStatus={setSelectedStatus}
            onChangeOracle={setSelectedOracle}
            onChangeSearch={setSearchQuery}
            onReload={loadMarkets}
            onResetFilters={resetAllFilters}
            onOpenConnectModal={() => setConnectModalOpen(true)}
          />
        )}

        {activeView === "market-detail" && selectedMarketSlug && (
          <MarketTradingView
            marketIdOrSlug={selectedMarketSlug}
            initialSide={selectedTradeSide}
            user={user}
            userPositions={positions}
            onPlaceBet={handlePlaceTerminalBet}
            onInvoiceSettled={handleLiveInvoiceSettled}
            onOpenConnectModal={() => setConnectModalOpen(true)}
            onSwitchAccountMode={handleLoginMode}
            onNotify={showToast}
          />
        )}

        {activeView === "creator" && (
          <CreatorView
            user={user}
            onOpenConnectModal={() => setConnectModalOpen(true)}
            onPublished={async (created) => {
              await loadMarkets(created.isDemo ? "demo" : "live");
              setSelectedStatus("all");
              setSelectedOracle("all");
              setSearchQuery("");
              setPendingTradeSide(created.slug, "YES");
              router.push(`/m/${encodeURIComponent(created.slug)}`);
              showToast(
                created.isDemo ? "Demo Sandbox Market Published" : "Market Published Live",
                `"${created.question.slice(0, 48)}..." is now live for ${
                  created.isDemo ? "Demo Sandbox" : "Lightning"
                } trading.`,
              );
            }}
            onNotify={showToast}
          />
        )}

        {activeView === "oracle" && (
          <OracleConsoleView
            markets={envMarkets}
            activeEnv={activeEnv}
            onRefreshMarkets={loadMarkets}
            onNotify={showToast}
          />
        )}

        {activeView === "positions" && (
          <PositionsView
            user={user}
            positions={positions}
            payouts={payouts}
            onConnectNwc={() => setConnectModalOpen(true)}
            onSaveLightningAddress={handleSaveLightningAddress}
            onClaimPayout={handleClaimPayout}
            onNotify={showToast}
          />
        )}

        {activeView === "admin" && (
          <AdminConsoleView
            user={user}
            markets={envMarkets}
            activeEnv={activeEnv}
            seedingDemo={seedingDemo}
            onConnectNwc={() => setConnectModalOpen(true)}
            onRefreshMarkets={loadMarkets}
            onSeedDemo={handleSeedDemo}
            onNotify={showToast}
          />
        )}

        {activeView === "how-it-works" && <HowItWorksView />}
      </main>

      <AppFooter />

      <ConnectAccountModal
        open={connectModalOpen}
        user={user}
        wallet={wallet}
        busy={connectingWallet}
        onSelectMode={handleLoginMode}
        onLogout={handleLogout}
        onClose={() => setConnectModalOpen(false)}
      />

      <ToastStack toasts={toasts} />
    </div>
  );
}
