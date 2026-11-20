"use client";

import Link from "next/link";
import { useState } from "react";
import { LuArrowRight, LuWallet, LuZap } from "react-icons/lu";
import { ConfirmActionModal } from "@/components/shared/ConfirmActionModal";
import { MarketCover } from "@/components/shared/MarketCover";
import { SatsIcon } from "@/components/shared/SatsIcon";
import { StatusBadge } from "@/components/shared/StatusBadge";
import {
  type BackendUserProfile,
  calculateBetQuote,
  formatSats,
  type MarketItem,
  type MarketSide,
  type UserPositionItem,
} from "@/lib/bitpredict-data";
import { useConnectedWallet } from "@/lib/use-connected-wallet";

interface OrderTicketPanelProps {
  market: MarketItem;
  coverSrc: string | null;
  activeSide: MarketSide;
  yesPct: number;
  noPct: number;
  yesExactPct: number;
  noExactPct: number;
  isOpen: boolean;
  user: BackendUserProfile | null;
  myMarketPositions: UserPositionItem[];
  onSelectSide: (side: MarketSide) => void;
  onSubmitBet: (amountSats: number) => Promise<{ payment_hash: string; simulated: boolean } | null>;
}

export function OrderTicketPanel({
  market,
  coverSrc,
  activeSide,
  yesPct,
  noPct,
  yesExactPct,
  noExactPct,
  isOpen,
  user,
  myMarketPositions,
  onSelectSide,
  onSubmitBet,
}: OrderTicketPanelProps) {
  const wallet = useConnectedWallet();
  const [amount, setAmount] = useState(5000);
  const [submittingBet, setSubmittingBet] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [lastTxHash, setLastTxHash] = useState<string | null>(null);

  const cleanAmount = Math.max(10, Math.floor(amount || 0));
  const ticketQuote = calculateBetQuote(market, activeSide, amount);
  const estReturnSats = ticketQuote.estPayoutSats - cleanAmount;
  const estReturnPct = amount > 0 ? Math.round((estReturnSats / cleanAmount) * 1000) / 10 : 0;
  const totalPoolSats = market.yesPool + market.noPool;
  const normalizedStatus = market.status.trim().toUpperCase();
  const isResolvedOrSettled =
    normalizedStatus === "SETTLED" || normalizedStatus === "RESOLVED";
  const isVoided = normalizedStatus === "VOID" || market.outcome === "INVALID";
  const closedSummaryText = isVoided
    ? "This market was voided. All confirmed wagers are eligible for full refund."
    : isResolvedOrSettled
      ? `This market has settled${market.outcome ? ` with outcome ${market.outcome}` : ""}. Winning payouts can be viewed or claimed in your portfolio.`
      : "Trading has closed for this market while oracle resolution is underway.";

  async function handleConfirm() {
    setSubmittingBet(true);
    try {
      const res = await onSubmitBet(cleanAmount);
      if (res) {
        setLastTxHash(res.payment_hash);
      }
    } finally {
      setSubmittingBet(false);
      setConfirmOpen(false);
    }
  }

  return (
    <aside className="lg:col-span-4 lg:sticky lg:top-[84px] space-y-4">
      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 space-y-4">
        <div className="flex items-center gap-3 pb-3.5 border-b border-[#dedee5]">
          <MarketCover
            imageUrl={coverSrc}
            category={market.category}
            size="sm"
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#7132f5]">
              {isOpen ? "Buy Position · Lightning" : "Market State"}
            </p>
            <p className="text-[13px] font-semibold text-[#101114] truncate">
              {market.title}
            </p>
          </div>
        </div>

        {!isOpen ? (
          <div className="space-y-4">
            <div className="p-4 rounded-[12px] bg-[rgba(148,151,169,0.06)] border border-[#dedee5] space-y-2.5">
              <StatusBadge status={market.status} outcome={market.outcome} size="md" />
              <p className="text-[13px] text-[#686b82] leading-[1.55]">
                {closedSummaryText}
              </p>
            </div>

            <dl className="p-3.5 rounded-[12px] bg-[rgba(148,151,169,0.04)] border border-[#dedee5] space-y-2 text-[13px]">
              <div className="flex items-center justify-between text-[#686b82]">
                <span>Final YES Odds</span>
                <span className="font-bold text-[#101114] tabular-nums">
                  {yesExactPct.toFixed(1)}% YES
                </span>
              </div>
              <div className="flex items-center justify-between text-[#686b82]">
                <span>Total Pool</span>
                <span className="inline-flex items-center gap-1.5 font-bold text-[#101114] tabular-nums">
                  <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                  <span>{formatSats(totalPoolSats)} sats</span>
                </span>
              </div>
            </dl>

            <div className="space-y-2">
              <Link
                href="/profile"
                className="w-full py-3 px-4 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>View My Positions &amp; Payouts</span>
                <LuArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/"
                className="w-full py-2.5 px-4 text-[13px] font-semibold text-[#5741d8] bg-white border border-[#dedee5] hover:border-[#7132f5] rounded-[12px] transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <span>Explore Open Markets</span>
              </Link>
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onSelectSide("YES")}
                className={`py-3 px-3 rounded-[12px] text-[14px] font-bold border transition-all cursor-pointer ${
                  activeSide === "YES"
                    ? "bg-[#149e61] text-white border-[#149e61] shadow-micro"
                    : "bg-[rgba(20,158,97,0.12)] text-[#026b3f] border-transparent hover:bg-[rgba(20,158,97,0.2)]"
                }`}
              >
                YES {yesPct}%
              </button>
              <button
                type="button"
                onClick={() => onSelectSide("NO")}
                className={`py-3 px-3 rounded-[12px] text-[14px] font-bold border transition-all cursor-pointer ${
                  activeSide === "NO"
                    ? "bg-[#dc2626] text-white border-[#dc2626] shadow-micro"
                    : "bg-[rgba(220,38,38,0.10)] text-[#b91c1c] border-transparent hover:bg-[rgba(220,38,38,0.18)]"
                }`}
              >
                NO {noPct}%
              </button>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="tradeAmountInput" className="text-[12px] font-semibold text-[#686b82]">
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
                  className="w-full h-[50px] px-4 pr-24 text-[20px] font-bold text-[#101114] tabular-nums bg-white border border-[#dedee5] rounded-[12px] focus:outline-none focus:border-[#7132f5]"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#686b82]">
                  <SatsIcon className="w-4 h-4 shrink-0" />
                  <span>SATS</span>
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
                <span>Fee ({(market.feeBps / 100).toFixed(0)}% losing pool)</span>
                <span className="font-medium text-[#101114] tabular-nums">
                  {formatSats(ticketQuote.feeSats)} sats
                </span>
              </div>
              <div className="pt-2 border-t border-[#dedee5] flex items-center justify-between">
                <span className="font-semibold text-[#101114]">Est. Payout if {activeSide}</span>
                <div className="text-right">
                  <p className="inline-flex items-center justify-end gap-1.5 text-[15px] font-bold text-[#026b3f] tabular-nums">
                    <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                    <span>{formatSats(ticketQuote.estPayoutSats)} sats</span>
                  </p>
                  <p className="text-[11px] font-semibold text-[#149e61] tabular-nums">
                    +{formatSats(Math.max(0, estReturnSats))} sats (+{Math.max(0, estReturnPct)}%)
                  </p>
                </div>
              </div>
            </div>

            <div className="text-[12px] text-[#686b82] flex items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 min-w-0">
                <LuWallet className="w-3.5 h-3.5 text-[#7132f5] shrink-0" />
                <span className="truncate">
                  {wallet
                    ? `Wallet connected: ${wallet.label}`
                    : user
                      ? "Signed in with Nostr"
                      : "Guest Nostr session ready"}
                </span>
              </span>
              {user && (
                <code className="font-mono text-[11px] text-[#101114] shrink-0">
                  {user.npub.slice(0, 12)}...
                </code>
              )}
            </div>

            <button
              type="button"
              disabled={submittingBet || amount < 10}
              onClick={() => setConfirmOpen(true)}
              className="w-full py-3.5 px-4 text-[15px] font-bold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:bg-[rgba(148,151,169,0.35)] rounded-[12px] transition-colors flex items-center justify-center gap-2 cursor-pointer"
            >
              <LuZap className="w-4 h-4" />
              <span>
                {submittingBet
                  ? "Settling Lightning Invoice..."
                  : `Buy ${activeSide} · ${formatSats(cleanAmount)} sats`}
              </span>
            </button>

            {lastTxHash && (
              <div className="p-3 rounded-[10px] bg-[rgba(20,158,97,0.14)] text-[#026b3f] text-[12px] space-y-0.5">
                <p className="font-semibold">Lightning invoice settled into pool</p>
                <p className="font-mono text-[11px] truncate">Payment hash: {lastTxHash}</p>
              </div>
            )}
          </>
        )}
      </div>

      {myMarketPositions.length > 0 && (
        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-[14px] font-bold text-[#101114]">
              Your Positions ({myMarketPositions.length})
            </h3>
            <Link
              href="/profile"
              className="text-[12px] font-semibold text-[#7132f5] hover:underline cursor-pointer"
            >
              View Portfolio
            </Link>
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

      <ConfirmActionModal
        open={confirmOpen}
        title={`Confirm ${activeSide} Position`}
        description="Review your Lightning prediction order before committing satoshis to the pool."
        details={[
          { label: "Market", value: market.title },
          { label: "Side", value: activeSide },
          { label: "Stake", value: `${formatSats(cleanAmount)} sats` },
          {
            label: "Implied Odds",
            value: `${(activeSide === "YES" ? yesExactPct : noExactPct).toFixed(1)}% ${activeSide}`,
          },
          {
            label: "Protocol Fee",
            value: `${formatSats(ticketQuote.feeSats)} sats`,
          },
          {
            label: `Est. Payout if ${activeSide}`,
            value: `${formatSats(ticketQuote.estPayoutSats)} sats`,
          },
        ]}
        warning="Lightning wagers are final once settled and remain locked until market resolution."
        confirmLabel={`Confirm Buy ${activeSide}`}
        tone={activeSide === "YES" ? "success" : "danger"}
        busy={submittingBet}
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </aside>
  );
}
