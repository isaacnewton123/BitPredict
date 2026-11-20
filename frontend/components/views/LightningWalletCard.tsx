"use client";

import { useState } from "react";
import {
  LuCheck,
  LuChevronDown,
  LuChevronUp,
  LuLink2,
  LuRefreshCw,
  LuShieldCheck,
  LuUnlink,
  LuWallet,
  LuZap,
} from "react-icons/lu";
import { type BackendUserProfile } from "@/lib/bitpredict-data";
import {
  type ConnectedLightningWallet,
  connectNwcWallet,
  connectWebLnWallet,
  disconnectLightningWallet,
  fetchNostrProfileLud16,
} from "@/lib/lightning-wallet";

interface LightningWalletCardProps {
  user: BackendUserProfile | null;
  wallet: ConnectedLightningWallet | null;
  onSaveLightningAddress: (addr: string) => Promise<void>;
  onNotify: (title: string, subtitle: string) => void;
}

/** Manages direct WebLN/NWC wallet connection plus optional offline LUD-16 auto-payout settings. */
export function LightningWalletCard({
  user,
  wallet,
  onSaveLightningAddress,
  onNotify,
}: LightningWalletCardProps) {
  const [showNwcForm, setShowNwcForm] = useState(false);
  const [nwcUri, setNwcUri] = useState("");
  const [connectingWebLn, setConnectingWebLn] = useState(false);
  const [connectingNwc, setConnectingNwc] = useState(false);

  const [manualAutoOpen, setManualAutoOpen] = useState<boolean | null>(null);
  const [draftAddr, setDraftAddr] = useState<{
    pubkey: string | null;
    value: string;
  } | null>(null);
  const [savingAddr, setSavingAddr] = useState(false);
  const [syncingProfile, setSyncingProfile] = useState(false);

  const currentPubkey = user?.pubkey ?? null;
  const addrInput =
    draftAddr && draftAddr.pubkey === currentPubkey
      ? draftAddr.value
      : (user?.lightning_address ?? "");
  const autoPayoutOpen = manualAutoOpen ?? Boolean(user?.lightning_address);

  async function handleConnectWebLn() {
    setConnectingWebLn(true);
    try {
      const connected = await connectWebLnWallet();
      onNotify(
        "Lightning Wallet Connected",
        `${connected.label} is ready for direct 1-click claims and payments.`,
      );
    } catch (err) {
      onNotify(
        "WebLN Unavailable",
        err instanceof Error ? err.message : "Could not connect browser wallet",
      );
    } finally {
      setConnectingWebLn(false);
    }
  }

  async function handleConnectNwc() {
    if (!nwcUri.trim()) {
      onNotify("Enter NWC URI", "Paste your nostr+walletconnect:// connection string.");
      return;
    }
    setConnectingNwc(true);
    try {
      const connected = await connectNwcWallet(nwcUri);
      setNwcUri("");
      setShowNwcForm(false);
      if (
        connected.kind === "nwc" &&
        connected.lud16 &&
        user &&
        !user.lightning_address
      ) {
        setDraftAddr({ pubkey: currentPubkey, value: connected.lud16 });
        setManualAutoOpen(true);
      }
      onNotify(
        "NWC Wallet Connected",
        `${connected.label} linked locally in your browser.`,
      );
    } catch (err) {
      onNotify(
        "NWC Connection Failed",
        err instanceof Error ? err.message : "Unable to connect NWC wallet",
      );
    } finally {
      setConnectingNwc(false);
    }
  }

  function handleDisconnect() {
    disconnectLightningWallet();
    onNotify(
      "Wallet Disconnected",
      "Disconnected Lightning wallet from this browser session.",
    );
  }

  async function handleSaveAddress() {
    setSavingAddr(true);
    try {
      await onSaveLightningAddress(addrInput);
      setDraftAddr(null);
    } catch (err) {
      onNotify(
        "Invalid Lightning Address",
        err instanceof Error ? err.message : "Unable to save payout address",
      );
    } finally {
      setSavingAddr(false);
    }
  }

  async function handleSyncFromProfile() {
    if (!user) return;
    setSyncingProfile(true);
    try {
      const lud16 = await fetchNostrProfileLud16(user.pubkey);
      if (!lud16) {
        onNotify(
          "No Lightning Address Found",
          "Your Nostr kind 0 profile metadata does not list a lud16 address.",
        );
        return;
      }
      setDraftAddr({ pubkey: currentPubkey, value: lud16 });
      onNotify(
        "Found Profile Lightning Address",
        `Loaded ${lud16} from your Nostr profile. Click Save to enable offline payouts.`,
      );
    } finally {
      setSyncingProfile(false);
    }
  }

  return (
    <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 space-y-5">
      {/* Direct Wallet Connection (WebLN / NWC) */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <LuWallet className="w-4 h-4 text-[#7132f5]" />
              <h2 className="text-[16px] font-semibold text-[#101114]">
                Connected Lightning Wallet
              </h2>
            </div>
            <p className="text-[13px] text-[#686b82]">
              Connect a Lightning wallet so winning claims settle directly into your wallet in one click.
            </p>
          </div>

          {user && (
            <span
              className={`px-2.5 py-1 text-[11px] font-semibold rounded-[8px] ${
                user.is_guest
                  ? "bg-[rgba(133,91,251,0.14)] text-[#5741d8]"
                  : "bg-[rgba(20,158,97,0.14)] text-[#026b3f]"
              }`}
            >
              {user.is_guest ? "Demo Sandbox Account" : "Live Nostr Account"}
            </span>
          )}
        </div>

        {wallet ? (
          <div className="p-3.5 rounded-[12px] border border-[rgba(20,158,97,0.28)] bg-[rgba(20,158,97,0.08)] flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-bold bg-[#149e61] text-white rounded-[8px]">
                <LuCheck className="w-3.5 h-3.5" />
                <span>{wallet.kind === "webln" ? "WebLN Connected" : "NWC Connected"}</span>
              </span>
              <span className="text-[14px] font-semibold text-[#101114]">
                {wallet.label}
              </span>
            </div>

            <button
              type="button"
              onClick={handleDisconnect}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-[#b91c1c] bg-white border border-[rgba(220,38,38,0.25)] hover:bg-[rgba(220,38,38,0.08)] rounded-[10px] transition-colors cursor-pointer"
            >
              <LuUnlink className="w-3.5 h-3.5" />
              <span>Disconnect</span>
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={connectingWebLn}
                onClick={handleConnectWebLn}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
              >
                <LuZap className="w-4 h-4" />
                <span>
                  {connectingWebLn ? "Connecting..." : "Connect Browser Wallet (WebLN)"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => setShowNwcForm((prev) => !prev)}
                className="inline-flex items-center gap-2 px-4 py-2.5 text-[13px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] rounded-[12px] transition-colors cursor-pointer"
              >
                <LuLink2 className="w-4 h-4" />
                <span>Connect via NWC</span>
              </button>
            </div>

            {showNwcForm && (
              <div className="p-3.5 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)] space-y-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="password"
                    value={nwcUri}
                    onChange={(e) => setNwcUri(e.target.value)}
                    placeholder="nostr+walletconnect://..."
                    className="flex-1 h-[42px] px-3.5 text-[13px] font-mono text-[#101114] bg-white border border-[#dedee5] rounded-[10px] focus:outline-none focus:border-[#7132f5]"
                  />
                  <button
                    type="button"
                    disabled={connectingNwc}
                    onClick={handleConnectNwc}
                    className="px-4 py-2 text-[13px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] disabled:opacity-60 rounded-[10px] transition-colors cursor-pointer"
                  >
                    {connectingNwc ? "Verifying..." : "Connect NWC"}
                  </button>
                </div>
                <p className="text-[11px] text-[#686b82] inline-flex items-center gap-1.5">
                  <LuShieldCheck className="w-3.5 h-3.5 text-[#149e61] shrink-0" />
                  <span>
                    Your connection secret stays in this browser and is never sent to our servers.
                  </span>
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Optional Offline Auto-Payout (LUD-16) */}
      <div className="pt-4 border-t border-[#dedee5]">
        <button
          type="button"
          onClick={() => setManualAutoOpen(!autoPayoutOpen)}
          className="w-full flex items-center justify-between gap-2 text-left cursor-pointer"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-semibold text-[#101114]">
              Auto-Payout While Offline (Optional · LUD-16)
            </span>
            {user?.lightning_address && (
              <span className="px-2 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]">
                {user.lightning_address}
              </span>
            )}
          </div>
          {autoPayoutOpen ? (
            <LuChevronUp className="w-4 h-4 text-[#686b82] shrink-0" />
          ) : (
            <LuChevronDown className="w-4 h-4 text-[#686b82] shrink-0" />
          )}
        </button>

        {autoPayoutOpen && (
          <div className="mt-3 space-y-2.5">
            <p className="text-[12px] text-[#686b82] leading-[1.5]">
              Optional — receive winnings automatically when a market settles while your browser is closed. Without it, payouts stay claimable directly into your connected wallet anytime.
            </p>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="email"
                value={addrInput}
                onChange={(e) =>
                  setDraftAddr({ pubkey: currentPubkey, value: e.target.value })
                }
                placeholder="you@getalby.com"
                className="flex-1 h-[42px] px-3.5 text-[14px] text-[#101114] bg-white border border-[#dedee5] rounded-[12px] focus:outline-none focus:border-[#7132f5]"
              />
              {user && !user.is_guest && (
                <button
                  type="button"
                  disabled={syncingProfile}
                  onClick={handleSyncFromProfile}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold text-[#5741d8] bg-[rgba(133,91,251,0.12)] hover:bg-[rgba(133,91,251,0.2)] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
                >
                  <LuRefreshCw className="w-3.5 h-3.5" />
                  <span>{syncingProfile ? "Checking..." : "Sync Nostr Profile"}</span>
                </button>
              )}
              <button
                type="button"
                disabled={savingAddr || !user}
                onClick={handleSaveAddress}
                className="px-4 py-2 text-[13px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-50 rounded-[12px] transition-colors cursor-pointer"
              >
                {savingAddr ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
