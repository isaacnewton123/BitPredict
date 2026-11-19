"use client";

import { useEffect, useState } from "react";
import { LuCheck, LuCopy, LuExternalLink, LuWallet, LuX, LuZap } from "react-icons/lu";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  formatSats,
  getPayoutLnurlWithdrawUrl,
  type UserPayoutItem,
} from "@/lib/bitpredict-data";
import {
  type ConnectedLightningWallet,
  encodeLnurlBech32,
  requestInvoiceFromWallet,
} from "@/lib/lightning-wallet";

interface ClaimPayoutModalProps {
  payout: UserPayoutItem | null;
  wallet: ConnectedLightningWallet | null;
  onClaim: (payoutId: string, bolt11?: string) => Promise<void>;
  onClose: () => void;
  onNotify: (title: string, subtitle: string) => void;
}

/** Confirmation & direct-to-wallet claim dialog supporting WebLN/NWC invoices, BOLT11, and LNURL-withdraw. */
export function ClaimPayoutModal({
  payout,
  wallet,
  onClaim,
  onClose,
  onNotify,
}: ClaimPayoutModalProps) {
  const [selectedMode, setSelectedMode] = useState<{
    payoutId: string;
    mode: "wallet" | "manual";
  } | null>(null);
  const [bolt11Draft, setBolt11Draft] = useState<{
    payoutId: string;
    value: string;
  } | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [copiedLnurl, setCopiedLnurl] = useState(false);

  useEffect(() => {
    if (!payout) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !claiming) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [payout, claiming, onClose]);

  if (!payout) return null;

  const activePayout = payout;
  const activeMode =
    selectedMode?.payoutId === activePayout.id
      ? selectedMode.mode
      : wallet
        ? "wallet"
        : "manual";
  const bolt11Input =
    bolt11Draft?.payoutId === activePayout.id ? bolt11Draft.value : "";

  const lnurlString = encodeLnurlBech32(getPayoutLnurlWithdrawUrl(activePayout.id));

  async function handleCopyLnurl() {
    await navigator.clipboard?.writeText(lnurlString).catch(() => undefined);
    setCopiedLnurl(true);
    setTimeout(() => setCopiedLnurl(false), 1800);
  }

  async function handleClaimDirectToWallet() {
    if (!wallet) return;
    setClaiming(true);
    try {
      const memo = `BitPredict ${activePayout.kind} payout: ${activePayout.market.title.slice(0, 60)}`;
      const { bolt11 } = await requestInvoiceFromWallet(
        wallet,
        activePayout.amount_sats,
        memo,
      );
      await onClaim(activePayout.id, bolt11);
      onClose();
    } catch (err) {
      onNotify(
        "Wallet Claim Failed",
        err instanceof Error
          ? err.message
          : "Could not request invoice from connected wallet. Try Manual Invoice / LNURL.",
      );
    } finally {
      setClaiming(false);
    }
  }

  async function handleClaimManual() {
    setClaiming(true);
    try {
      const clean = bolt11Input.trim();
      await onClaim(activePayout.id, clean || undefined);
      onClose();
    } catch (err) {
      onNotify(
        "Payout Claim Failed",
        err instanceof Error ? err.message : "Unable to settle payout claim",
      );
    } finally {
      setClaiming(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101114]/50 backdrop-blur-[2px]"
      onClick={() => {
        if (!claiming) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claim-payout-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[500px] bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 shrink-0 rounded-[12px] bg-[rgba(255,139,0,0.12)] flex items-center justify-center">
              <SatsIcon className="w-6 h-6 shrink-0" />
            </div>
            <div>
              <h2
                id="claim-payout-modal-title"
                className="text-[18px] font-bold text-[#101114] leading-[1.3]"
              >
                Claim {formatSats(activePayout.amount_sats)} sats Payout
              </h2>
              <p className="text-[13px] text-[#686b82] mt-1">
                Receive your settled Lightning payout directly into your wallet.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={claiming}
            onClick={onClose}
            aria-label="Close claim dialog"
            className="p-1.5 text-[#9497a9] hover:text-[#101114] disabled:opacity-40 rounded-[8px] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
          >
            <LuX className="w-4 h-4" />
          </button>
        </div>

        <dl className="p-3.5 rounded-[12px] bg-[rgba(148,151,169,0.06)] border border-[#dedee5] space-y-2 text-[13px]">
          <div className="flex items-start justify-between gap-4">
            <dt className="text-[#686b82] shrink-0">Market</dt>
            <dd className="font-semibold text-[#101114] text-right">
              {activePayout.market.title}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686b82]">Payout Type</dt>
            <dd className="font-semibold text-[#101114]">{activePayout.kind}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-[#686b82]">Amount</dt>
            <dd className="inline-flex items-center gap-1.5 font-bold text-[#026b3f] tabular-nums">
              <SatsIcon className="w-4 h-4 shrink-0" />
              <span>{formatSats(activePayout.amount_sats)} sats</span>
            </dd>
          </div>
        </dl>

        {wallet && (
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-[rgba(148,151,169,0.08)] rounded-[12px]">
            <button
              type="button"
              disabled={claiming}
              onClick={() =>
                setSelectedMode({ payoutId: activePayout.id, mode: "wallet" })
              }
              className={`py-2 px-3 text-[12px] font-semibold rounded-[10px] transition-colors cursor-pointer ${
                activeMode === "wallet"
                  ? "bg-white text-[#101114] shadow-micro"
                  : "text-[#686b82] hover:text-[#101114]"
              }`}
            >
              Connected Wallet
            </button>
            <button
              type="button"
              disabled={claiming}
              onClick={() =>
                setSelectedMode({ payoutId: activePayout.id, mode: "manual" })
              }
              className={`py-2 px-3 text-[12px] font-semibold rounded-[10px] transition-colors cursor-pointer ${
                activeMode === "manual"
                  ? "bg-white text-[#101114] shadow-micro"
                  : "text-[#686b82] hover:text-[#101114]"
              }`}
            >
              Invoice / LNURL
            </button>
          </div>
        )}

        {activeMode === "wallet" && wallet ? (
          <div className="space-y-4">
            <div className="p-3.5 rounded-[12px] border border-[rgba(20,158,97,0.28)] bg-[rgba(20,158,97,0.08)] space-y-1.5">
              <div className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[#026b3f]">
                <LuWallet className="w-3.5 h-3.5" />
                <span>{wallet.label}</span>
              </div>
              <p className="text-[12px] text-[#026b3f] leading-[1.5]">
                BitPredict will request a fresh BOLT11 invoice from your connected wallet and pay{" "}
                <strong>{formatSats(activePayout.amount_sats)} sats</strong> straight into it.
              </p>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={claiming}
                onClick={onClose}
                className="px-4 py-2.5 text-[14px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(148,151,169,0.16)] rounded-[12px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={claiming}
                onClick={handleClaimDirectToWallet}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] disabled:opacity-60 rounded-[12px] cursor-pointer"
              >
                <LuZap className="w-4 h-4" />
                <span>
                  {claiming
                    ? "Requesting Invoice..."
                    : `Claim ${formatSats(activePayout.amount_sats)} sats to Wallet`}
                </span>
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label
                htmlFor="manualBolt11Input"
                className="block text-[12px] font-semibold text-[#101114]"
              >
                BOLT11 Invoice (Optional in Demo)
              </label>
              <input
                id="manualBolt11Input"
                type="text"
                value={bolt11Input}
                onChange={(e) =>
                  setBolt11Draft({ payoutId: activePayout.id, value: e.target.value })
                }
                placeholder="lnbc..."
                className="w-full h-[42px] px-3.5 text-[13px] font-mono text-[#101114] bg-white border border-[#dedee5] rounded-[10px] focus:outline-none focus:border-[#7132f5]"
              />
              <p className="text-[11px] text-[#686b82]">
                Paste an invoice for {formatSats(activePayout.amount_sats)} sats from any Lightning wallet, or leave blank for instant demo settlement.
              </p>
            </div>

            <div className="p-3 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)] flex flex-wrap items-center justify-between gap-2 text-[12px]">
              <div className="min-w-0">
                <p className="font-semibold text-[#101114]">LNURL-Withdraw</p>
                <p className="font-mono text-[11px] text-[#686b82] truncate max-w-[260px]">
                  {lnurlString}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleCopyLnurl}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-[#101114] bg-white border border-[#dedee5] hover:border-[#7132f5] rounded-[8px] cursor-pointer"
                >
                  {copiedLnurl ? (
                    <LuCheck className="w-3.5 h-3.5 text-[#149e61]" />
                  ) : (
                    <LuCopy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedLnurl ? "Copied" : "Copy LNURL"}</span>
                </button>
                <a
                  href={`lightning:${lnurlString}`}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 font-semibold text-[#7132f5] bg-[rgba(133,91,251,0.12)] hover:bg-[rgba(133,91,251,0.2)] rounded-[8px]"
                >
                  <span>Open</span>
                  <LuExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                disabled={claiming}
                onClick={onClose}
                className="px-4 py-2.5 text-[14px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(148,151,169,0.16)] rounded-[12px] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={claiming}
                onClick={handleClaimManual}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] disabled:opacity-60 rounded-[12px] cursor-pointer"
              >
                <LuZap className="w-4 h-4" />
                <span>
                  {claiming
                    ? "Settling..."
                    : `Claim ${formatSats(activePayout.amount_sats)} sats`}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
