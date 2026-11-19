"use client";

import Link from "next/link";
import {
  LuRefreshCw,
  LuSearch,
  LuSearchX,
  LuShieldCheck,
} from "react-icons/lu";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  CATEGORIES,
  type CategoryId,
  formatSats,
  type MarketItem,
} from "@/lib/bitpredict-data";
import { CATEGORY_ICONS } from "@/components/layout/route-utils";
import { MarketCard } from "./MarketCard";

interface MarketDiscoveryViewProps {
  markets: MarketItem[];
  filteredMarkets: MarketItem[];
  loadingMarkets: boolean;
  backendError: string | null;
  totalPoolVolume: number;
  autoApiCount: number;
  selectedCategory: CategoryId;
  selectedOracle: "all" | "auto_api" | "nostr_oracle";
  searchQuery: string;
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
  selectedOracle,
  searchQuery,
  onChangeOracle,
  onChangeSearch,
  onReload,
  onResetFilters,
}: MarketDiscoveryViewProps) {
  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-[#dedee5]">
        <div>
          <h1 className="text-[30px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114]">
            Live Prediction Markets
          </h1>
          <p className="text-[15px] text-[#686b82] mt-1">
            Trade real-world outcomes settled transparently via automated feeds and Nostr oracles.
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
            <SatsIcon className="w-4 h-4 shrink-0" />
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
            onChange={(e) => onChangeSearch(e.target.value)}
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
                onClick={() => onChangeOracle(oracleKey)}
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
          const targetHref = cat.id === "All" ? "/" : `/c/${cat.slug}`;
          return (
            <Link
              key={cat.id}
              href={targetHref}
              className={`shrink-0 inline-flex items-center gap-2 px-3.5 py-2.5 text-[14px] font-medium rounded-[12px] transition-colors cursor-pointer ${
                isActive
                  ? "bg-[#7132f5] text-white"
                  : "bg-[rgba(148,151,169,0.08)] text-[#101114] hover:bg-[rgba(133,91,251,0.16)] hover:text-[#7132f5]"
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
        <div className="text-center py-16 border border-[#dedee5] rounded-[16px] bg-white shadow-whisper text-[14px] text-[#686b82]">
          Loading live prediction markets...
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
