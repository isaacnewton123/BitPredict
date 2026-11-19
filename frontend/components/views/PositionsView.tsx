"use client";

import Link from "next/link";
import { useState } from "react";
import { LuKeyRound } from "react-icons/lu";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  type BackendUserProfile,
  formatSats,
  type UserPayoutItem,
  type UserPositionItem,
} from "@/lib/bitpredict-data";
import { useConnectedWallet } from "@/lib/use-connected-wallet";
import { ClaimPayoutModal } from "./ClaimPayoutModal";
import { LightningWalletCard } from "./LightningWalletCard";

interface PositionsViewProps {
  user: BackendUserProfile | null;
  positions: UserPositionItem[];
  payouts: UserPayoutItem[];
  onConnectNwc: () => void;
  onSaveLightningAddress: (addr: string) => Promise<void>;
  onClaimPayout: (payoutId: string, bolt11?: string) => Promise<void>;
  onNotify: (title: string, subtitle: string) => void;
}

export function PositionsView({
  user,
  positions,
  payouts,
  onConnectNwc,
  onSaveLightningAddress,
  onClaimPayout,
  onNotify,
}: PositionsViewProps) {
  const wallet = useConnectedWallet();
  const [pendingClaim, setPendingClaim] = useState<UserPayoutItem | null>(null);

  return (
    <section className="max-w-[960px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6">
      <div className="border-b border-[#dedee5] pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold tracking-[-0.5px] text-[#101114]">
            My Positions &amp; Payouts
          </h1>
          <p className="text-[14px] text-[#686b82] mt-1">
            Track active bets, connect your Lightning wallet for direct claims, and configure optional offline auto-payouts.
          </p>
        </div>

        {!user ? (
          <button
            type="button"
            onClick={onConnectNwc}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] cursor-pointer"
          >
            <LuKeyRound className="w-4 h-4" />
            <span>Sign In with Nostr</span>
          </button>
        ) : (
          <div className="px-4 py-2 rounded-[12px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] text-[13px] font-semibold font-mono">
            {user.npub.slice(0, 14)}...{user.npub.slice(-6)}
          </div>
        )}
      </div>

      <LightningWalletCard
        user={user}
        wallet={wallet}
        onSaveLightningAddress={onSaveLightningAddress}
        onNotify={onNotify}
      />

      {/* Payouts */}
      {payouts.length > 0 && (
        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
          <div className="px-5 py-4 border-b border-[#dedee5]">
            <h2 className="text-[16px] font-semibold text-[#101114]">
              Payouts &amp; Claims ({payouts.length})
            </h2>
          </div>
          <div className="divide-y divide-[#dedee5]">
            {payouts.map((pay) => (
              <div
                key={pay.id}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]">
                      {pay.kind}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[14px] font-bold text-[#101114]">
                      <SatsIcon className="w-4 h-4 shrink-0" />
                      <span>{formatSats(pay.amount_sats)} sats</span>
                    </span>
                  </div>
                  <Link
                    href={`/m/${encodeURIComponent(pay.market.slug || pay.marketId)}`}
                    className="block text-left text-[15px] font-semibold text-[#101114] hover:text-[#7132f5] cursor-pointer"
                  >
                    {pay.market.title}
                  </Link>
                  {pay.preimage && (
                    <p className="text-[11px] text-[#686b82] font-mono break-all">
                      Preimage: {pay.preimage}
                    </p>
                  )}
                </div>

                <div>
                  {pay.status === "CLAIMABLE" || pay.status === "FAILED" ? (
                    <button
                      type="button"
                      onClick={() => setPendingClaim(pay)}
                      className="px-4 py-2 text-[13px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] rounded-[12px] cursor-pointer"
                    >
                      {wallet
                        ? `Claim ${formatSats(pay.amount_sats)} sats to Wallet`
                        : `Claim ${formatSats(pay.amount_sats)} sats`}
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                      {pay.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positions List */}
      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
        <div className="px-5 py-4 border-b border-[#dedee5]">
          <h2 className="text-[16px] font-semibold text-[#101114]">
            Bets Placed ({positions.length})
          </h2>
        </div>

        {positions.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-[#686b82]">
            {user
              ? "No bets placed yet with this Nostr keypair. Place YES/NO wagers on any OPEN market."
              : "Sign in with Nostr to view and manage your active positions."}
          </div>
        ) : (
          <div className="divide-y divide-[#dedee5]">
            {positions.map((pos) => (
              <div
                key={pos.bet_id}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[rgba(148,151,169,0.04)]"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        pos.side === "YES"
                          ? "px-2 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                          : "px-2 py-0.5 text-[11px] font-semibold bg-[rgba(133,91,251,0.16)] text-[#7132f5] rounded-[6px]"
                      }
                    >
                      {pos.side}
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#101114]">
                      <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                      <span>{formatSats(pos.amount_sats)} sats</span>
                    </span>
                    <span className="text-[12px] text-[#9497a9]">· {pos.created_at}</span>
                  </div>
                  <Link
                    href={`/m/${encodeURIComponent(pos.market.slug || pos.market.id)}`}
                    className="block text-left text-[15px] font-semibold text-[#101114] hover:text-[#7132f5] transition-colors cursor-pointer"
                  >
                    {pos.market.title}
                  </Link>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {pos.estimated_payout_sats != null && (
                    <span className="text-[12px] font-semibold text-[#026b3f]">
                      Est. {formatSats(pos.estimated_payout_sats)} sats
                    </span>
                  )}
                  <span className="px-3 py-1.5 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                    {pos.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ClaimPayoutModal
        payout={pendingClaim}
        wallet={wallet}
        onClaim={onClaimPayout}
        onClose={() => setPendingClaim(null)}
        onNotify={onNotify}
      />
    </section>
  );
}
