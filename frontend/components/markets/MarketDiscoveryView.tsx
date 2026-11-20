"use client";

import Link from "next/link";
import {
  LuRefreshCw,
  LuSearch,
  LuSearchX,
} from "react-icons/lu";
import { CATEGORY_ICONS } from "@/components/layout/route-utils";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  CATEGORIES,
  type CategoryId,
  formatSats,
  type MarketItem,
} from "@/lib/bitpredict-data";
import { MarketCard } from "./MarketCard";

interface MarketDiscoveryViewProps {
  markets: MarketItem[];
  filteredMarkets: MarketItem[];
  loadingMarkets: boolean;
  backendError: string | null;
  totalPoolVolume: number;
  autoApiCount: number;
  selectedCategory: CategoryId;
  selectedStatus: "all" | "open" | "closed";
  selectedOracle: "all" | "auto_api" | "nostr_oracle";
  searchQuery: string;
  onChangeStatus: (next: "all" | "open" | "closed") => void;
  onChangeOracle: (next: "all" | "auto_api" | "nostr_oracle") => void;
  onChangeSearch: (next: string) => void;
  onReload: () => void;
  onResetFilters: () => void;
}

export function MarketDiscoveryView({
  markets,
  filteredMarkets,
  loadingMarkets,
  backendError,
  totalPoolVolume,
  autoApiCount,
  selectedCategory,
  selectedStatus,
  selectedOracle,
  searchQuery,
  onChangeStatus,
  onChangeOracle,
  onChangeSearch,
  onReload,
  onResetFilters,
}: MarketDiscoveryViewProps) {
  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      {/* Header & Unified Metric Strip */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5 pb-6 border-b border-[#dedee5]">
        <div>
          <h1 className="text-[30px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114]">
            Live Prediction Markets
          </h1>
          <p className="text-[15px] text-[#686b82] mt-1">
            Trade real-world outcomes settled transparently via automated feeds and Nostr oracles.
          </p>
        </div>

        <div className="bg-white border border-[#dedee5] rounded-[14px] shadow-whisper grid grid-cols-3 divide-x divide-[#dedee5] shrink-0">
          <div className="px-3.5 sm:px-5 py-2.5">
            <p className="text-[11px] font-medium text-[#9497a9] uppercase tracking-[0.03em]">
              Markets
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[15px] sm:text-[16px] font-bold text-[#101114] tabular-nums">
              <span className="w-2 h-2 rounded-full bg-[#149e61] shrink-0" />
              <span>{markets.length}</span>
            </p>
          </div>

          <div className="px-3.5 sm:px-5 py-2.5">
            <p className="text-[11px] font-medium text-[#9497a9] uppercase tracking-[0.03em]">
              Total Pool
            </p>
            <p className="mt-0.5 flex items-center gap-1.5 text-[15px] sm:text-[16px] font-bold text-[#101114] tabular-nums whitespace-nowrap">
              <SatsIcon className="w-3.5 h-3.5 shrink-0" />
              <span>{formatSats(totalPoolVolume)}</span>
              <span className="hidden sm:inline text-[12px] font-semibold text-[#686b82]">
                sats
              </span>
            </p>
          </div>

          <div className="px-3.5 sm:px-5 py-2.5">
            <p className="text-[11px] font-medium text-[#9497a9] uppercase tracking-[0.03em]">
              Auto-API
            </p>
            <p className="mt-0.5 text-[15px] sm:text-[16px] font-bold text-[#026b3f] tabular-nums">
              {autoApiCount} feeds
            </p>
          </div>
        </div>
      </div>

      {/* Filter Toolbar: Search + Status + Oracle Track */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 py-5">
        <div className="relative flex-1 lg:max-w-[440px]">
          <LuSearch
            className="w-4 h-4 text-[#9497a9] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
            strokeWidth={2}
          />
          <input
            id="marketSearchInput"
            type="text"
            value={searchQuery}
            onChange={(e) => onChangeSearch(e.target.value)}
            placeholder="Search markets, cities, tickers, or oracles..."
            className="w-full h-[44px] pl-10 pr-4 text-[14px] text-[#101114] placeholder-[#9497a9] bg-white border border-[#dedee5] rounded-[12px] focus:outline-none focus:border-[#7132f5] transition-colors"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          {/* Status Filter */}
          <div
            role="group"
            aria-label="Filter by market status"
            className="inline-flex items-center gap-1 p-1 bg-[rgba(148,151,169,0.08)] rounded-[12px]"
          >
            {(
              [
                ["all", "All"],
                ["open", "Open"],
                ["closed", "Closed"],
              ] as const
            ).map(([statusKey, label]) => {
              const active = selectedStatus === statusKey;
              return (
                <button
                  key={statusKey}
                  type="button"
                  onClick={() => onChangeStatus(statusKey)}
                  className={
                    active
                      ? "px-3 py-1.5 text-[13px] font-semibold rounded-[9px] bg-white text-[#101114] shadow-micro transition-colors cursor-pointer"
                      : "px-3 py-1.5 text-[13px] font-medium rounded-[9px] text-[#686b82] hover:text-[#101114] transition-colors cursor-pointer"
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Oracle Track Filter */}
          <div
            role="group"
            aria-label="Filter by oracle type"
            className="inline-flex items-center gap-1 p-1 bg-[rgba(148,151,169,0.08)] rounded-[12px]"
          >
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
                  onClick={() => onChangeOracle(oracleKey)}
                  className={
                    active
                      ? "px-3 py-1.5 text-[13px] font-semibold rounded-[9px] bg-white text-[#101114] shadow-micro transition-colors cursor-pointer"
                      : "px-3 py-1.5 text-[13px] font-medium rounded-[9px] text-[#686b82] hover:text-[#101114] transition-colors cursor-pointer"
                  }
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Category Chips */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-2 mb-6">
        {CATEGORIES.map((cat) => {
          const isActive = selectedCategory === cat.id;
          const Icon = CATEGORY_ICONS[cat.id];
          const targetHref = cat.id === "All" ? "/" : `/c/${cat.slug}`;
          return (
            <Link
              key={cat.id}
              href={targetHref}
              className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2 text-[13px] font-semibold rounded-[12px] transition-all cursor-pointer ${
                isActive
                  ? "bg-[#7132f5] text-white border border-[#7132f5] shadow-micro"
                  : "bg-white text-[#101114] border border-[#dedee5] hover:border-[#7132f5]/45 hover:bg-[rgba(133,91,251,0.06)] hover:text-[#7132f5]"
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.85} />
              <span>{cat.label}</span>
            </Link>
          );
        })}
      </div>

      {backendError ? (
        <div className="text-center py-14 px-6 border border-[#dedee5] rounded-[16px] bg-white shadow-whisper space-y-4">
          <h3 className="text-[18px] font-semibold text-[#101114]">
            Markets Temporarily Unavailable
          </h3>
          <p className="text-[14px] text-[#686b82] max-w-lg mx-auto">
            {backendError}. We couldn&apos;t load the live market feed right now. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={onReload}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] cursor-pointer"
          >
            <LuRefreshCw className="w-4 h-4" />
            <span>Retry</span>
          </button>
        </div>
      ) : loadingMarkets ? (
        <div
          aria-label="Loading prediction markets"
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5"
        >
          {[0, 1, 2, 3, 4, 5].map((idx) => (
            <div
              key={idx}
              className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 space-y-4 animate-pulse"
            >
              <div className="flex items-start gap-3">
                <div className="w-12 h-12 rounded-[12px] bg-[rgba(148,151,169,0.16)] shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3 w-28 rounded bg-[rgba(148,151,169,0.18)]" />
                  <div className="h-4 w-full rounded bg-[rgba(148,151,169,0.2)]" />
                  <div className="h-4 w-3/4 rounded bg-[rgba(148,151,169,0.16)]" />
                </div>
              </div>
              <div className="space-y-2 pt-1">
                <div className="flex justify-between">
                  <div className="h-3 w-14 rounded bg-[rgba(148,151,169,0.16)]" />
                  <div className="h-3 w-14 rounded bg-[rgba(148,151,169,0.16)]" />
                </div>
                <div className="h-1.5 w-full rounded-full bg-[rgba(148,151,169,0.16)]" />
              </div>
              <div className="grid grid-cols-2 gap-2.5 pt-1">
                <div className="h-10 rounded-[12px] bg-[rgba(148,151,169,0.12)]" />
                <div className="h-10 rounded-[12px] bg-[rgba(148,151,169,0.12)]" />
              </div>
              <div className="pt-3 border-t border-[#dedee5] flex justify-between">
                <div className="h-3 w-20 rounded bg-[rgba(148,151,169,0.16)]" />
                <div className="h-3 w-24 rounded bg-[rgba(148,151,169,0.16)]" />
              </div>
            </div>
          ))}
        </div>
      ) : filteredMarkets.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredMarkets.map((m) => (
            <MarketCard key={m.id} market={m} />
          ))}
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
            Adjust your filters or create a new prediction market with AI.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2.5">
            <button
              type="button"
              onClick={onResetFilters}
              className="px-4 py-2.5 text-[14px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] rounded-[12px] transition-colors cursor-pointer"
            >
              Reset Filters
            </button>
            <Link
              href="/create"
              className="px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
            >
              Open AI Creator
            </Link>
          </div>
        </div>
      )}
    </section>
  );
}
