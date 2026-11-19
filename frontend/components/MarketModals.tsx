"use client";

import { useEffect, useState } from "react";
import {
  LuCheck,
  LuCircleCheck,
  LuCodeXml,
  LuCopy,
  LuExternalLink,
  LuRadio,
  LuShieldCheck,
  LuSparkles,
  LuX,
  LuZap,
} from "react-icons/lu";
import {
  calculateBetQuote,
  canonicalizeJsonBrowser,
  fetchMarketDetailBundle,
  formatSats,
  getYesProbability,
  type MarketDetailBundle,
  type MarketItem,
  type MarketSide,
  runBackendTrackAResolve,
  sha256HexBrowser,
} from "@/lib/bitpredict-data";

interface BetModalProps {
  market: MarketItem | null;
  side: MarketSide;
  amount: number;
  submitting: boolean;
  walletConnected: boolean;
  userNpub: string | null;
  onChangeSide: (side: MarketSide) => void;
  onChangeAmount: (amount: number) => void;
  onConfirm: () => void;
  onClose: () => void;
}

export function BetModal({
  market,
  side,
  amount,
  submitting,
  walletConnected,
  userNpub,
  onChangeSide,
  onChangeAmount,
  onConfirm,
  onClose,
}: BetModalProps) {
  if (!market) return null;

  const yesPct = getYesProbability(market);
  const noPct = 100 - yesPct;
  const quote = calculateBetQuote(market, side, amount);
  const feePercent = (market.feeBps / 100).toFixed(0);

  return (
    <div
      id="betModal"
      onClick={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101114]/40 backdrop-blur-[2px]"
    >
      <div className="w-full max-w-[460px] bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
        <div className="px-5 py-4 border-b border-[#dedee5] flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-[10px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] flex items-center justify-center">
              <LuZap className="w-4 h-4" strokeWidth={2} />
            </div>
            <div>
              <h3 className="text-[16px] font-semibold text-[#101114]">
                Place Lightning Prediction
              </h3>
              <p className="text-[12px] text-[#9497a9]">
                Parimutuel pool settled via Elysia &amp; LNbits
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            aria-label="Close modal"
            className="p-1.5 text-[#9497a9] hover:text-[#101114] rounded-[8px] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
          >
            <LuX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="p-3.5 rounded-[12px] bg-[rgba(148,151,169,0.08)] border border-[#dedee5]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2 py-0.5 text-[11px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                {market.category}
              </span>
              <span
                className={
                  market.oracleTrack === "auto_api"
                    ? "px-2 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                    : "px-2 py-0.5 text-[11px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]"
                }
              >
                {market.oracleLabel}
              </span>
            </div>
            <p className="text-[15px] font-semibold text-[#101114] leading-[1.35]">
              {market.title}
            </p>
            <p className="text-[12px] text-[#686b82] mt-1.5 leading-[1.45]">
              {market.rules}
            </p>
          </div>

          <div>
            <label className="block text-[13px] font-medium text-[#686b82] mb-2">
              Choose Outcome
            </label>
            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => onChangeSide("YES")}
                className={
                  side === "YES"
                    ? "py-2.5 px-3 text-[14px] font-semibold rounded-[12px] border border-[#149e61] bg-[rgba(20,158,97,0.16)] text-[#026b3f] transition-colors cursor-pointer"
                    : "py-2.5 px-3 text-[14px] font-semibold rounded-[12px] border border-[#dedee5] bg-white text-[#686b82] hover:text-[#101114] transition-colors cursor-pointer"
                }
              >
                Bet YES
              </button>
              <button
                type="button"
                onClick={() => onChangeSide("NO")}
                className={
                  side === "NO"
                    ? "py-2.5 px-3 text-[14px] font-semibold rounded-[12px] border border-[#5741d8] bg-[rgba(133,91,251,0.16)] text-[#7132f5] transition-colors cursor-pointer"
                    : "py-2.5 px-3 text-[14px] font-semibold rounded-[12px] border border-[#dedee5] bg-white text-[#686b82] hover:text-[#101114] transition-colors cursor-pointer"
                }
              >
                Bet NO
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label
                htmlFor="betAmountInput"
                className="text-[13px] font-medium text-[#686b82]"
              >
                Wager Amount (Sats)
              </label>
              <span className="text-[12px] text-[#9497a9]">
                {walletConnected && userNpub
                  ? `Session: ${userNpub.slice(0, 12)}...`
                  : "Auto-signs Nostr session on submit"}
              </span>
            </div>
            <div className="relative">
              <input
                id="betAmountInput"
                type="number"
                min={10}
                step={100}
                value={amount}
                onChange={(e) => onChangeAmount(parseInt(e.target.value, 10) || 0)}
                className="w-full h-[46px] pl-4 pr-14 text-[16px] font-semibold text-[#101114] bg-white border border-[#dedee5] rounded-[12px] focus:outline-none focus:border-[#7132f5] transition-colors"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[#9497a9]">
                SATS
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2 mt-2.5">
              {[1000, 5000, 10000, 25000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => onChangeAmount(preset)}
                  className="py-1.5 text-[12px] font-semibold text-[#686b82] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(133,91,251,0.16)] hover:text-[#7132f5] rounded-[12px] transition-colors cursor-pointer"
                >
                  {preset / 1000}k sats
                </button>
              ))}
            </div>
          </div>

          <div className="p-3.5 rounded-[12px] border border-[#dedee5] space-y-2 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="text-[#686b82]">Current Pool Odds</span>
              <span className="font-semibold text-[#101114]">
                YES {yesPct}% · NO {noPct}%
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[#686b82]">
                Est. Losing Pool Fee ({feePercent}%)
              </span>
              <span className="font-medium text-[#686b82]">
                {formatSats(quote.feeSats)} sats
              </span>
            </div>
            <div className="pt-2 border-t border-[#dedee5] flex items-center justify-between">
              <span className="font-semibold text-[#101114]">
                Est. Parimutuel Payout
              </span>
              <span className="text-[15px] font-bold text-[#149e61]">
                {formatSats(quote.estPayoutSats)} sats ({quote.multiplier}x)
              </span>
            </div>
          </div>

          <button
            type="button"
            disabled={submitting}
            onClick={onConfirm}
            className="w-full inline-flex items-center justify-center gap-2 py-[13px] px-4 text-[15px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
          >
            <LuZap className="w-4 h-4" strokeWidth={2} />
            <span>
              {submitting ? "Creating & Settling Invoice..." : "Pay via Lightning (NWC)"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}

interface MarketInspectorModalProps {
  marketIdOrSlug: string | null;
  onClose: () => void;
  onOpenBet: (market: MarketItem, side: MarketSide) => void;
  onRefreshMarkets: () => void;
  onNotify: (title: string, subtitle: string) => void;
}

export function MarketInspectorModal({
  marketIdOrSlug,
  onClose,
  onOpenBet,
  onRefreshMarkets,
  onNotify,
}: MarketInspectorModalProps) {
  const [loadedState, setLoadedState] = useState<{
    key: string;
    bundle: MarketDetailBundle | null;
    error: string | null;
  } | null>(null);
  const [digestState, setDigestState] = useState<{
    key: string;
    digest: string;
  } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!marketIdOrSlug) return;
    let cancelled = false;

    fetchMarketDetailBundle(marketIdOrSlug)
      .then((res) => {
        if (!cancelled) {
          setLoadedState({ key: marketIdOrSlug, bundle: res, error: null });
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoadedState({
            key: marketIdOrSlug,
            bundle: null,
            error: err instanceof Error ? err.message : "Failed to load market detail",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [marketIdOrSlug]);

  if (!marketIdOrSlug) return null;

  const activeKey = marketIdOrSlug;
  const activeEntry = loadedState?.key === activeKey ? loadedState : null;
  const bundle = activeEntry?.bundle ?? null;
  const error = activeEntry?.error ?? null;
  const loading = !activeEntry;
  const browserDigest =
    digestState?.key === activeKey ? digestState.digest : null;

  async function handleVerifySha() {
    if (!bundle) return;
    const digest = await sha256HexBrowser(canonicalizeJsonBrowser(bundle.market.spec));
    setDigestState({ key: activeKey, digest });
  }

  async function handleCopyNote() {
    if (!bundle) return;
    await navigator.clipboard?.writeText(bundle.market.nostrNoteId).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  async function handleRunTrackA() {
    if (!bundle) return;
    setResolving(true);
    try {
      const res = await runBackendTrackAResolve(bundle.market.id);
      const refreshed = await fetchMarketDetailBundle(bundle.market.id);
      setLoadedState({ key: activeKey, bundle: refreshed, error: null });
      onRefreshMarkets();
      onNotify(
        `Resolved: ${res.market.outcome ?? "SETTLED"}`,
        `Proof SHA-256 ${res.proof.bodySha256?.slice(0, 12) ?? ""}... saved in backend DB.`,
      );
    } catch (err) {
      onNotify(
        "Track A Check Failed",
        err instanceof Error ? err.message : "Unable to resolve market",
      );
    } finally {
      setResolving(false);
    }
  }

  const m = bundle?.market;
  const yesPct = m ? getYesProbability(m) : 50;
  const noPct = 100 - yesPct;

  return (
    <div
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101114]/40 backdrop-blur-[2px] overflow-y-auto"
    >
      <div className="w-full max-w-[740px] my-auto bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-6 py-4 border-b border-[#dedee5] flex items-center justify-between gap-4 shrink-0">
          {m ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                {m.category}
              </span>
              <span
                className={
                  m.oracleTrack === "auto_api"
                    ? "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                    : "inline-flex items-center gap-1 px-2.5 py-1 text-[11px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]"
                }
              >
                {m.oracleTrack === "auto_api" ? (
                  <LuShieldCheck className="w-3.5 h-3.5" />
                ) : (
                  <LuRadio className="w-3.5 h-3.5" />
                )}
                <span>{m.oracleLabel}</span>
              </span>
              <span className="px-2.5 py-1 text-[11px] font-semibold bg-[rgba(133,91,251,0.16)] text-[#7132f5] rounded-[6px]">
                {m.status}
              </span>
            </div>
          ) : (
            <span className="text-[14px] font-semibold text-[#101114]">
              Loading Market Contract...
            </span>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close inspector"
            className="p-1.5 text-[#9497a9] hover:text-[#101114] rounded-[8px] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
          >
            <LuX className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 overflow-y-auto">
          {loading && (
            <p className="text-[14px] text-[#686b82]">
              Fetching live market spec, AI insight, and Nostr proofs from Elysia backend...
            </p>
          )}

          {error && (
            <div className="p-4 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.08)] text-[14px] text-[#101114]">
              {error}
            </div>
          )}

          {bundle && m && (
            <>
              <div>
                <h2 className="text-[22px] font-bold text-[#101114] leading-[1.3] mb-2">
                  {m.question}
                </h2>
                <p className="text-[14px] text-[#686b82] leading-[1.5]">{m.rules}</p>
                <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[13px]">
                  <span className="text-[#686b82]">
                    Deadline: <strong className="text-[#101114]">{m.deadline}</strong>
                  </span>
                  <span className="font-semibold text-[#101114]">
                    Pool: {formatSats(m.yesPool + m.noPool)} sats ({yesPct}% YES / {noPct}% NO)
                  </span>
                </div>
              </div>

              {bundle.insight && (
                <section className="p-4 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.08)] space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] text-[12px] font-semibold">
                      <LuSparkles className="w-3.5 h-3.5" />
                      <span>AI Market Insight ({bundle.insight.model})</span>
                    </span>
                    <span className="text-[11px] font-medium text-[#686b82]">
                      Informational only · Does not affect resolution
                    </span>
                  </div>

                  <p className="text-[13px] text-[#101114] leading-[1.55]">
                    {bundle.insight.summary}
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {bundle.insight.data_points.map((dp) => (
                      <div
                        key={dp.label}
                        className="p-2.5 rounded-[10px] bg-white border border-[#dedee5]"
                      >
                        <p className="text-[11px] font-medium text-[#9497a9]">{dp.label}</p>
                        <p className="text-[13px] font-semibold text-[#101114] mt-0.5 break-words">
                          {dp.value}
                        </p>
                      </div>
                    ))}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-[#686b82]">
                    <span>{bundle.insight.disclaimer}</span>
                    <div className="flex flex-wrap items-center gap-2">
                      {bundle.insight.sources.slice(0, 2).map((src) =>
                        src.startsWith("http") ? (
                          <a
                            key={src}
                            href={src}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[#7132f5] hover:underline font-medium"
                          >
                            <span>Source</span>
                            <LuExternalLink className="w-3 h-3" />
                          </a>
                        ) : (
                          <span key={src} className="text-[#9497a9]">
                            {src}
                          </span>
                        ),
                      )}
                    </div>
                  </div>
                </section>
              )}

              <section className="p-4 rounded-[12px] border border-[#dedee5] bg-white space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#5741d8]">
                    <LuCodeXml className="w-4 h-4" />
                    <span>Oracle Contract &amp; SHA-256 Commitment</span>
                  </span>
                  <button
                    type="button"
                    onClick={handleVerifySha}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white rounded-[8px] transition-colors cursor-pointer"
                  >
                    <LuCircleCheck className="w-3.5 h-3.5" />
                    <span>Verify Spec SHA-256</span>
                  </button>
                </div>

                <pre className="p-3.5 text-[12px] leading-[1.5] text-[#101114] bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px] overflow-x-auto font-mono">
                  {JSON.stringify(m.oracleConfig, null, 2)}
                </pre>

                <div className="space-y-1.5 text-[12px]">
                  <div className="flex items-center justify-between gap-2 text-[#686b82]">
                    <span>Committed Spec SHA-256:</span>
                    <code className="text-[11px] font-mono text-[#101114] truncate max-w-[360px]">
                      {m.specSha256}
                    </code>
                  </div>
                  {browserDigest && (
                    <div
                      className={`flex items-center justify-between gap-2 ${
                        browserDigest === m.specSha256 ? "text-[#026b3f]" : "text-[#686b82]"
                      }`}
                    >
                      <span>
                        Browser WebCrypto Match:{" "}
                        {browserDigest === m.specSha256 ? "VERIFIED" : "COMPUTED"}
                      </span>
                      <code className="text-[11px] font-mono truncate max-w-[320px]">
                        {browserDigest}
                      </code>
                    </div>
                  )}
                  <div className="flex items-center justify-between gap-2 text-[#686b82]">
                    <span>Nostr Announcement Note:</span>
                    <button
                      type="button"
                      onClick={handleCopyNote}
                      className="inline-flex items-center gap-1 text-[11px] font-mono text-[#5741d8] hover:underline cursor-pointer"
                    >
                      <span className="truncate max-w-[260px]">{m.nostrNoteId}</span>
                      {copied ? (
                        <LuCheck className="w-3.5 h-3.5" />
                      ) : (
                        <LuCopy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                {bundle.proofs.length > 0 && (
                  <div className="p-3 rounded-[10px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] text-[12px] space-y-1">
                    <p className="font-semibold">
                      Outcome: {m.outcome ?? m.status} · Provider: {bundle.proofs[0].provider}
                    </p>
                    <p>
                      Extracted value: <strong>{bundle.proofs[0].value ?? "N/A"}</strong> · Proof
                      SHA-256:{" "}
                      <code className="font-mono">
                        {bundle.proofs[0].bodySha256?.slice(0, 24) ?? "pending"}...
                      </code>
                    </p>
                  </div>
                )}

                {bundle.proposals.length > 0 && (
                  <div className="p-3 rounded-[10px] bg-[rgba(133,91,251,0.16)] text-[#5741d8] text-[12px] space-y-1">
                    <p className="font-semibold">
                      Track B Proposal: {bundle.proposals[0].outcome} ({bundle.proposals[0].status})
                    </p>
                    <p className="font-mono text-[11px] truncate">
                      Signer: {bundle.proposals[0].signerPubkey}
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
        </div>

        {m && (
          <div className="px-6 py-4 border-t border-[#dedee5] bg-[rgba(148,151,169,0.04)] flex flex-wrap items-center justify-between gap-3 shrink-0">
            {m.oracleTrack === "auto_api" && m.status === "OPEN" ? (
              <button
                type="button"
                disabled={resolving}
                onClick={handleRunTrackA}
                className="px-3.5 py-2 text-[13px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] rounded-[12px] transition-colors cursor-pointer"
              >
                {resolving ? "Resolving..." : "Resolve Track A Now (Demo)"}
              </button>
            ) : (
              <span className="text-[12px] text-[#686b82]">
                {m.outcome ? `Outcome: ${m.outcome}` : `Status: ${m.status}`}
              </span>
            )}

            {m.status === "OPEN" && (
              <div className="flex items-center gap-2.5 ml-auto">
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenBet(m, "YES");
                  }}
                  className="px-4 py-2 text-[14px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white rounded-[12px] transition-colors cursor-pointer"
                >
                  Bet YES ({yesPct}%)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenBet(m, "NO");
                  }}
                  className="px-4 py-2 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
                >
                  Bet NO ({noPct}%)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
