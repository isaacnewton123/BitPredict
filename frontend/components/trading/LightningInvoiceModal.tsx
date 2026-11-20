"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import {
  LuCheck,
  LuClock,
  LuCopy,
  LuExternalLink,
  LuRefreshCw,
  LuX,
  LuZap,
} from "react-icons/lu";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  confirmBackendBet,
  formatSats,
  formatUtcDisplay,
  type MarketSide,
  type PlaceBetOutcome,
} from "@/lib/bitpredict-data";

type AwaitingBetOrder = Extract<PlaceBetOutcome, { status: "awaiting_payment" }>;

interface LightningInvoiceModalProps {
  invoice: AwaitingBetOrder | null;
  marketTitle: string;
  side: MarketSide;
  amountSats: number;
  onSettled: (res: {
    bet_id: string;
    payment_hash: string;
    pool_yes_msat: number;
    pool_no_msat: number;
  }) => void;
  onClose: () => void;
  onNotify: (title: string, subtitle: string) => void;
}

/** Displays a live BOLT11 QR invoice for manual wallet payment and polls settlement confirmation. */
export function LightningInvoiceModal({
  invoice,
  marketTitle,
  side,
  amountSats,
  onSettled,
  onClose,
  onNotify,
}: LightningInvoiceModalProps) {
  const [copiedBolt11, setCopiedBolt11] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    let active = true;
    const betId = invoice.bet_id;
    const paymentHash = invoice.payment_hash;

    const timer = window.setInterval(async () => {
      try {
        const res = await confirmBackendBet(betId);
        if (!active) return;
        window.clearInterval(timer);
        onSettled({
          bet_id: betId,
          payment_hash: paymentHash,
          pool_yes_msat: res.pool_yes_msat,
          pool_no_msat: res.pool_no_msat,
        });
      } catch {
        // Invoice still awaiting payment; keep polling quietly.
      }
    }, 2500);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [invoice, onSettled]);

  useEffect(() => {
    if (!invoice) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !verifying) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [invoice, verifying, onClose]);

  if (!invoice) return null;
  const activeInvoice = invoice;

  async function handleCopy() {
    await navigator.clipboard?.writeText(activeInvoice.bolt11).catch(() => undefined);
    setCopiedBolt11(true);
    setTimeout(() => setCopiedBolt11(false), 1800);
  }

  async function handleVerifyNow() {
    setVerifying(true);
    try {
      const res = await confirmBackendBet(activeInvoice.bet_id);
      onSettled({
        bet_id: activeInvoice.bet_id,
        payment_hash: activeInvoice.payment_hash,
        pool_yes_msat: res.pool_yes_msat,
        pool_no_msat: res.pool_no_msat,
      });
    } catch (err) {
      onNotify(
        "Awaiting Payment",
        err instanceof Error
          ? err.message
          : "Lightning payment has not been confirmed yet. Pay the invoice and try again.",
      );
    } finally {
      setVerifying(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101114]/50 backdrop-blur-[2px]"
      onClick={() => {
        if (!verifying) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="lightning-invoice-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[460px] bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 shrink-0 rounded-[12px] bg-[rgba(20,158,97,0.14)] text-[#026b3f] flex items-center justify-center">
              <LuZap className="w-5 h-5" />
            </div>
            <div>
              <h2
                id="lightning-invoice-modal-title"
                className="text-[18px] font-bold text-[#101114] leading-[1.3]"
              >
                Pay Lightning Invoice
              </h2>
              <p className="text-[13px] text-[#686b82] mt-1">
                Scan with any Lightning wallet to settle your{" "}
                <strong className="text-[#101114]">
                  {side} · {formatSats(amountSats)} sats
                </strong>{" "}
                wager.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={verifying}
            onClick={onClose}
            aria-label="Close invoice dialog"
            className="p-1.5 text-[#9497a9] hover:text-[#101114] disabled:opacity-40 rounded-[8px] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
          >
            <LuX className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3 rounded-[12px] bg-[rgba(148,151,169,0.06)] border border-[#dedee5] flex items-center justify-between gap-3 text-[12px]">
          <span className="text-[#686b82] truncate">{marketTitle}</span>
          <span className="inline-flex items-center gap-1.5 font-bold text-[#101114] shrink-0 tabular-nums">
            <SatsIcon className="w-3.5 h-3.5" />
            <span>{formatSats(amountSats)} sats</span>
          </span>
        </div>

        {activeInvoice.qr_data_url ? (
          <div className="flex justify-center">
            <div className="p-3 bg-white border border-[#dedee5] rounded-[14px] shadow-micro">
              <Image
                src={activeInvoice.qr_data_url}
                alt="BOLT11 Lightning QR code"
                width={216}
                height={216}
                unoptimized
                className="w-[216px] h-[216px]"
              />
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-[12px] bg-[rgba(148,151,169,0.08)] text-center text-[13px] text-[#686b82]">
            Copy or open the BOLT11 invoice below in your Lightning wallet.
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 bg-[rgba(148,151,169,0.06)] border border-[#dedee5] rounded-[10px] px-3 py-2">
            <code className="text-[11px] font-mono text-[#101114] truncate">
              {activeInvoice.bolt11}
            </code>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleCopy}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[#101114] bg-white border border-[#dedee5] hover:border-[#7132f5] rounded-[6px] cursor-pointer"
              >
                {copiedBolt11 ? (
                  <LuCheck className="w-3 h-3 text-[#149e61]" />
                ) : (
                  <LuCopy className="w-3 h-3" />
                )}
                <span>{copiedBolt11 ? "Copied" : "Copy"}</span>
              </button>
              <a
                href={`lightning:${activeInvoice.bolt11}`}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold text-[#7132f5] bg-[rgba(133,91,251,0.12)] hover:bg-[rgba(133,91,251,0.2)] rounded-[6px]"
              >
                <span>Open Wallet</span>
                <LuExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-[#686b82]">
            <span className="inline-flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-[#149e61] animate-pulse" />
              <span>Listening for Lightning settlement...</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <LuClock className="w-3 h-3" />
              <span>Expires {formatUtcDisplay(activeInvoice.expires_at)}</span>
            </span>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            disabled={verifying}
            onClick={onClose}
            className="px-4 py-2.5 text-[13px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(148,151,169,0.16)] rounded-[12px] cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={verifying}
            onClick={handleVerifyNow}
            className="inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] disabled:opacity-60 rounded-[12px] cursor-pointer"
          >
            <LuRefreshCw className={`w-3.5 h-3.5 ${verifying ? "animate-spin" : ""}`} />
            <span>{verifying ? "Checking..." : "I've Paid — Verify Now"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
