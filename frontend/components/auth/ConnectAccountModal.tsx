"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  LuArrowRight,
  LuCheck,
  LuCopy,
  LuKeyRound,
  LuLogOut,
  LuShieldCheck,
  LuSparkles,
  LuWallet,
  LuX,
  LuZap,
} from "react-icons/lu";
import type { BackendUserProfile } from "@/lib/bitpredict-data";
import type { ConnectedLightningWallet } from "@/lib/lightning-wallet";

interface ConnectAccountModalProps {
  open: boolean;
  user: BackendUserProfile | null;
  wallet: ConnectedLightningWallet | null;
  busy: boolean;
  onSelectMode: (mode: "live" | "demo") => Promise<void>;
  onLogout: () => Promise<void>;
  onClose: () => void;
}

function subscribeNostrExtension(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const timer = window.setTimeout(callback, 300);
  window.addEventListener("load", callback);
  return () => {
    window.clearTimeout(timer);
    window.removeEventListener("load", callback);
  };
}

function getClientHasNostrExtension(): boolean {
  return typeof window !== "undefined" && Boolean(window.nostr);
}

function getServerHasNostrExtension(): boolean {
  return false;
}

/** Dual-mode account chooser modal: Live Nostr (NIP-07) vs Play-Money Demo Sandbox. */
export function ConnectAccountModal({
  open,
  user,
  wallet,
  busy,
  onSelectMode,
  onLogout,
  onClose,
}: ConnectAccountModalProps) {
  const hasNostrExtension = useSyncExternalStore(
    subscribeNostrExtension,
    getClientHasNostrExtension,
    getServerHasNostrExtension,
  );
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedNpub, setCopiedNpub] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onClose]);

  if (!open) return null;

  async function handleChooseMode(mode: "live" | "demo") {
    setErrorMsg(null);
    try {
      await onSelectMode(mode);
      onClose();
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : "Unable to complete authentication. Please try again.",
      );
    }
  }

  async function handleSignOut() {
    setErrorMsg(null);
    await onLogout();
    onClose();
  }

  async function handleCopyNpub() {
    if (!user) return;
    await navigator.clipboard?.writeText(user.npub).catch(() => undefined);
    setCopiedNpub(true);
    setTimeout(() => setCopiedNpub(false), 1800);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101114]/50 backdrop-blur-[2px]"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-account-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[540px] bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 shrink-0 rounded-[12px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] flex items-center justify-center">
              <LuKeyRound className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <h2
                id="connect-account-modal-title"
                className="text-[19px] font-bold text-[#101114] leading-[1.3]"
              >
                {user ? "Active BitPredict Account" : "Connect to BitPredict"}
              </h2>
              <p className="text-[13px] text-[#686b82] mt-1">
                {user
                  ? "Switch between your Live Nostr identity and the Demo Sandbox anytime."
                  : "Trade with your own Nostr + Lightning identity, or jump straight into the Demo Sandbox."}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            aria-label="Close account modal"
            className="p-1.5 text-[#9497a9] hover:text-[#101114] disabled:opacity-40 rounded-[8px] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
          >
            <LuX className="w-4 h-4" />
          </button>
        </div>

        {errorMsg && (
          <div className="p-3.5 rounded-[12px] border border-[rgba(220,38,38,0.28)] bg-[rgba(220,38,38,0.06)] text-[13px] text-[#b91c1c] leading-[1.5]">
            {errorMsg}
          </div>
        )}

        {user ? (
          <div className="space-y-4">
            <div
              className={`p-4 rounded-[14px] border space-y-3 ${
                user.is_guest
                  ? "border-[rgba(113,50,245,0.28)] bg-[rgba(133,91,251,0.06)]"
                  : "border-[rgba(20,158,97,0.28)] bg-[rgba(20,158,97,0.06)]"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold rounded-[6px] ${
                    user.is_guest
                      ? "bg-[#7132f5] text-white"
                      : "bg-[#149e61] text-white"
                  }`}
                >
                  {user.is_guest ? (
                    <LuSparkles className="w-3.5 h-3.5" />
                  ) : (
                    <LuShieldCheck className="w-3.5 h-3.5" />
                  )}
                  <span>
                    {user.is_guest ? "Demo Sandbox Account" : "Live Nostr Account"}
                  </span>
                </span>

                {user.is_admin && (
                  <span className="px-2 py-0.5 text-[11px] font-semibold bg-white border border-[#dedee5] text-[#5741d8] rounded-[6px]">
                    Operator
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between gap-2 bg-white border border-[#dedee5] rounded-[10px] px-3 py-2">
                <code className="text-[12px] font-mono text-[#101114] truncate">
                  {user.npub}
                </code>
                <button
                  type="button"
                  onClick={handleCopyNpub}
                  className="shrink-0 inline-flex items-center gap-1 text-[12px] font-semibold text-[#7132f5] hover:underline cursor-pointer"
                >
                  {copiedNpub ? (
                    <LuCheck className="w-3.5 h-3.5 text-[#149e61]" />
                  ) : (
                    <LuCopy className="w-3.5 h-3.5" />
                  )}
                  <span>{copiedNpub ? "Copied" : "Copy"}</span>
                </button>
              </div>

              <p className="text-[12px] text-[#686b82] leading-[1.5]">
                {user.is_guest
                  ? "Demo Sandbox sessions use play money and simulated Lightning settlements on isolated Demo markets. Live real-sat pools are untouched."
                  : "Authenticated via your Nostr extension. You can trade live markets, settle real Lightning invoices, and manage direct wallet payouts."}
              </p>

              {wallet && !user.is_guest && (
                <div className="flex items-center gap-2 text-[12px] font-semibold text-[#026b3f]">
                  <LuWallet className="w-3.5 h-3.5 shrink-0" />
                  <span>Connected Wallet: {wallet.label}</span>
                </div>
              )}
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 pt-1">
              <Link
                href="/profile"
                onClick={onClose}
                className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(148,151,169,0.16)] rounded-[12px] transition-colors cursor-pointer"
              >
                <span>Open Portfolio &amp; Wallet</span>
                <LuArrowRight className="w-4 h-4" />
              </Link>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleChooseMode(user.is_guest ? "live" : "demo")}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] disabled:opacity-50 rounded-[12px] transition-colors cursor-pointer"
                >
                  <LuZap className="w-4 h-4" />
                  <span>
                    {busy
                      ? "Switching..."
                      : user.is_guest
                        ? "Switch to Live Account"
                        : "Switch to Demo Account"}
                  </span>
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={handleSignOut}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold text-[#b91c1c] bg-[rgba(220,38,38,0.08)] hover:bg-[rgba(220,38,38,0.14)] disabled:opacity-50 rounded-[12px] transition-colors cursor-pointer"
                >
                  <LuLogOut className="w-4 h-4" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3.5">
            {/* Option 1: Live Nostr Account */}
            <div className="p-4 rounded-[14px] border border-[#dedee5] bg-white space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <LuKeyRound className="w-4 h-4 text-[#149e61]" />
                  <h3 className="text-[15px] font-bold text-[#101114]">
                    Connect Nostr Account
                  </h3>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="px-2 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.14)] text-[#026b3f] rounded-[6px]">
                    Live Sats
                  </span>
                  <span
                    className={`px-2 py-0.5 text-[11px] font-semibold rounded-[6px] ${
                      hasNostrExtension
                        ? "bg-[rgba(20,158,97,0.14)] text-[#026b3f]"
                        : "bg-[rgba(104,107,130,0.12)] text-[#484b5e]"
                    }`}
                  >
                    {hasNostrExtension ? "NIP-07 Ready" : "Extension Needed"}
                  </span>
                </div>
              </div>

              <p className="text-[13px] text-[#686b82] leading-[1.5]">
                Sign in with your browser Nostr signer (Alby, nos2x, Flamingo) to trade real markets and settle sats directly with WebLN, NWC, or BOLT11 QR.
              </p>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => handleChooseMode("live")}
                  className="inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
                >
                  <LuKeyRound className="w-4 h-4" />
                  <span>
                    {busy ? "Signing Challenge..." : "Connect with Nostr Extension"}
                  </span>
                </button>

                {!hasNostrExtension && (
                  <a
                    href="https://getalby.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[12px] font-semibold text-[#7132f5] hover:underline"
                  >
                    Get Alby / NIP-07 Extension
                  </a>
                )}
              </div>
            </div>

            {/* Option 2: Use Demo Account */}
            <div className="p-4 rounded-[14px] border border-[rgba(113,50,245,0.28)] bg-[rgba(133,91,251,0.06)] space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <LuSparkles className="w-4 h-4 text-[#7132f5]" />
                  <h3 className="text-[15px] font-bold text-[#101114]">
                    Use Demo Account
                  </h3>
                </div>
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-[rgba(133,91,251,0.16)] text-[#7132f5] rounded-[6px]">
                  No Wallet Needed
                </span>
              </div>

              <p className="text-[13px] text-[#686b82] leading-[1.5]">
                Instant hackathon &amp; judge sandbox: create AI markets, simulate Lightning bets, trigger oracle resolution, and claim payouts with play money — completely isolated from live funds.
              </p>

              <button
                type="button"
                disabled={busy}
                onClick={() => handleChooseMode("demo")}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.10)] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
              >
                <LuZap className="w-4 h-4" />
                <span>
                  {busy ? "Preparing Demo Sandbox..." : "Use Demo Account"}
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
