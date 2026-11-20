"use client";

import Image from "next/image";
import Link from "next/link";
import { LuKeyRound, LuPlus, LuZap } from "react-icons/lu";
import type { AppView, BackendUserProfile } from "@/lib/bitpredict-data";
import { useConnectedWallet } from "@/lib/use-connected-wallet";
import { NAV_ITEMS, VIEW_PATHS } from "./route-utils";

interface AppHeaderProps {
  activeView: AppView;
  user: BackendUserProfile | null;
  connectingWallet: boolean;
  onConnectOrDisconnect: () => void;
}

export function AppHeader({
  activeView,
  user,
  connectingWallet,
  onConnectOrDisconnect,
}: AppHeaderProps) {
  const wallet = useConnectedWallet();

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-sm border-b border-[#dedee5]">
      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 h-[68px] flex items-center justify-between gap-3 sm:gap-4">
        <Link
          href="/"
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
        </Link>

        <nav aria-label="Main Navigation" className="hidden md:flex items-center gap-1.5">
          {NAV_ITEMS.map(({ viewKey, label, Icon }) => {
            const active = activeView === viewKey;
            return (
              <Link
                key={viewKey}
                href={VIEW_PATHS[viewKey]}
                className={
                  active
                    ? "inline-flex items-center gap-2 px-3.5 py-2 text-[14px] font-semibold rounded-[12px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] transition-colors cursor-pointer"
                    : "inline-flex items-center gap-2 px-3.5 py-2 text-[14px] font-semibold rounded-[12px] text-[#686b82] hover:text-[#101114] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
                }
              >
                <Icon className="w-4 h-4" strokeWidth={2} />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2.5 shrink-0">
          <Link
            href="/create"
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-[10px] text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
          >
            <LuPlus className="w-4 h-4" strokeWidth={2.2} />
            <span>Create Market</span>
          </Link>

          {wallet && (
            <Link
              href="/profile"
              title={`Lightning wallet connected: ${wallet.label}`}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-[9px] text-[12px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.14)] hover:bg-[rgba(20,158,97,0.22)] rounded-[12px] transition-colors cursor-pointer"
            >
              <LuZap className="w-3.5 h-3.5" strokeWidth={2.2} />
              <span className="max-w-[110px] truncate">{wallet.label}</span>
            </Link>
          )}

          <button
            type="button"
            disabled={connectingWallet}
            onClick={onConnectOrDisconnect}
            className={
              user
                ? "inline-flex items-center gap-2 px-3.5 py-[10px] text-[13px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] border border-transparent hover:bg-[rgba(20,158,97,0.24)] rounded-[12px] transition-colors cursor-pointer"
                : "inline-flex items-center gap-2 px-3.5 py-[10px] text-[14px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] rounded-[12px] transition-colors cursor-pointer"
            }
          >
            <LuKeyRound className="w-4 h-4" strokeWidth={2} />
            {user ? (
              <span className="font-mono">
                {user.npub.slice(0, 8)}...{user.npub.slice(-4)}
              </span>
            ) : connectingWallet ? (
              <span>Signing...</span>
            ) : (
              <>
                <span className="hidden sm:inline">Sign In with Nostr</span>
                <span className="sm:hidden">Sign In</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Row */}
      <div
        aria-label="Mobile Navigation"
        className="md:hidden border-t border-[#dedee5] px-3 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar bg-white"
      >
        {NAV_ITEMS.map(({ viewKey, label, Icon }) => {
          const active = activeView === viewKey;
          return (
            <Link
              key={viewKey}
              href={VIEW_PATHS[viewKey]}
              className={
                active
                  ? "shrink-0 inline-flex items-center justify-center gap-1.5 py-2 px-3 text-[13px] font-semibold rounded-[12px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] transition-colors cursor-pointer"
                  : "shrink-0 inline-flex items-center justify-center gap-1.5 py-2 px-3 text-[13px] font-semibold rounded-[12px] text-[#686b82] hover:text-[#101114] transition-colors cursor-pointer"
              }
            >
              <Icon className="w-3.5 h-3.5" strokeWidth={2} />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </header>
  );
}
