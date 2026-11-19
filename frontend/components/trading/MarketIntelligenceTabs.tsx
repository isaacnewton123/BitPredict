"use client";

import { useState } from "react";
import {
  LuCheck,
  LuCircleCheck,
  LuCopy,
  LuExternalLink,
  LuScale,
  LuShieldCheck,
  LuSparkles,
} from "react-icons/lu";
import {
  formatProviderName,
  OracleSpecSummary,
} from "@/components/shared/OracleSpecSummary";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  canonicalizeJsonBrowser,
  formatPubkeyShort,
  formatSats,
  formatUtcDisplay,
  type MarketDetailBundle,
  type MarketItem,
  sha256HexBrowser,
} from "@/lib/bitpredict-data";

type InspectorTab = "rules" | "insight" | "trades" | "oracle";

interface MarketIntelligenceTabsProps {
  marketIdOrSlug: string;
  liveMarket: MarketItem;
  bundle: MarketDetailBundle;
}

export function MarketIntelligenceTabs({
  marketIdOrSlug,
  liveMarket,
  bundle,
}: MarketIntelligenceTabsProps) {
  const [activeTab, setActiveTab] = useState<InspectorTab>("rules");
  const [digestState, setDigestState] = useState<{
    key: string;
    digest: string;
  } | null>(null);
  const [copiedNote, setCopiedNote] = useState(false);

  const browserDigest =
    digestState?.key === marketIdOrSlug ? digestState.digest : null;

  async function handleCopyNote() {
    await navigator.clipboard?.writeText(liveMarket.nostrNoteId).catch(() => undefined);
    setCopiedNote(true);
    setTimeout(() => setCopiedNote(false), 1800);
  }

  async function handleVerifySha() {
    const digest = await sha256HexBrowser(canonicalizeJsonBrowser(liveMarket.spec));
    setDigestState({ key: marketIdOrSlug, digest });
  }

  return (
    <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
      <div className="px-4 sm:px-5 pt-3 border-b border-[#dedee5] flex items-center gap-1 overflow-x-auto no-scrollbar">
        {(
          [
            ["rules", "Rules & Resolution"],
            ["insight", "AI Market Insight"],
            ["trades", `Trade Tape (${bundle.recentTrades.length})`],
            ["oracle", "Oracle & Spec Proof"],
          ] as const
        ).map(([tabId, label]) => {
          const active = activeTab === tabId;
          return (
            <button
              key={tabId}
              type="button"
              onClick={() => setActiveTab(tabId)}
              className={`shrink-0 px-3.5 py-2.5 text-[13px] font-semibold border-b-2 transition-colors cursor-pointer ${
                active
                  ? "border-[#7132f5] text-[#7132f5]"
                  : "border-transparent text-[#686b82] hover:text-[#101114]"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="p-5 sm:p-6">
        {activeTab === "rules" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-[14px] font-semibold text-[#101114] mb-1.5">
                Settlement Rules
              </h3>
              <p className="text-[14px] text-[#686b82] leading-[1.6]">
                {liveMarket.rules}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
                  1 · Betting Cutoff
                </p>
                <p className="text-[13px] font-semibold text-[#101114] mt-1">
                  {formatUtcDisplay(liveMarket.bettingCutoffIso)}
                </p>
              </div>
              <div className="p-3 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
                  2 · Event Deadline
                </p>
                <p className="text-[13px] font-semibold text-[#101114] mt-1">
                  {liveMarket.deadline}
                </p>
              </div>
              <div className="p-3 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)]">
                <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#9497a9]">
                  3 · Resolve After
                </p>
                <p className="text-[13px] font-semibold text-[#101114] mt-1">
                  {formatUtcDisplay(String(liveMarket.spec.resolve_after_utc ?? ""))}
                </p>
              </div>
            </div>

            {Array.isArray(liveMarket.spec.assumptions) && liveMarket.spec.assumptions.length > 0 && (
              <div>
                <p className="text-[12px] font-semibold text-[#101114] mb-2">
                  Locked Ambiguity Assumptions
                </p>
                <ul className="space-y-1.5 text-[13px] text-[#686b82]">
                  {(liveMarket.spec.assumptions as string[]).map((a) => (
                    <li key={a} className="flex items-start gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#7132f5] mt-2 shrink-0" />
                      <span>{a}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {activeTab === "insight" && (
          <div className="space-y-4">
            {bundle.insight ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] text-[12px] font-semibold">
                    <LuSparkles className="w-3.5 h-3.5" />
                    <span>{bundle.insight.model}</span>
                  </span>
                  <span className="text-[12px] text-[#686b82]">
                    {bundle.insight.disclaimer}
                  </span>
                </div>
                <p className="text-[14px] text-[#101114] leading-[1.6]">
                  {bundle.insight.summary}
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {bundle.insight.data_points.map((dp) => (
                    <div
                      key={dp.label}
                      className="p-3 rounded-[10px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)]"
                    >
                      <p className="text-[11px] font-semibold text-[#9497a9]">{dp.label}</p>
                      <p className="text-[13px] font-semibold text-[#101114] mt-0.5 break-words">
                        {dp.value}
                      </p>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-3 text-[12px]">
                  {bundle.insight.sources.map((src) =>
                    src.startsWith("http") ? (
                      <a
                        key={src}
                        href={src}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[#7132f5] hover:underline font-medium"
                      >
                        <span>{src}</span>
                        <LuExternalLink className="w-3 h-3" />
                      </a>
                    ) : (
                      <span key={src} className="text-[#686b82]">
                        {src}
                      </span>
                    ),
                  )}
                </div>
              </>
            ) : (
              <p className="text-[14px] text-[#686b82]">
                AI Market Insight is not available for this market yet.
              </p>
            )}
          </div>
        )}

        {activeTab === "trades" && (
          <div>
            {bundle.recentTrades.length === 0 ? (
              <p className="text-[14px] text-[#686b82] py-4">
                No confirmed Lightning bets recorded yet — place the first wager on the ticket!
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-[13px]">
                  <thead>
                    <tr className="border-b border-[#dedee5] text-[11px] uppercase tracking-[0.04em] text-[#9497a9]">
                      <th className="py-2 pr-4 font-semibold">Side</th>
                      <th className="py-2 pr-4 font-semibold">Amount</th>
                      <th className="py-2 pr-4 font-semibold">Trader</th>
                      <th className="py-2 pr-4 font-semibold">YES Odds After</th>
                      <th className="py-2 font-semibold">Time</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#dedee5]">
                    {bundle.recentTrades.map((t) => (
                      <tr key={t.id}>
                        <td className="py-2.5 pr-4">
                          <span
                            className={`px-2 py-0.5 text-[11px] font-bold rounded-[6px] ${
                              t.side === "YES"
                                ? "bg-[rgba(20,158,97,0.16)] text-[#026b3f]"
                                : "bg-[rgba(220,38,38,0.12)] text-[#b91c1c]"
                            }`}
                          >
                            {t.side}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-semibold text-[#101114] tabular-nums">
                          <span className="inline-flex items-center gap-1.5">
                            <SatsIcon className="w-3.5 h-3.5 shrink-0" />
                            <span>{formatSats(t.amount_sats)} sats</span>
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 font-mono text-[12px] text-[#686b82]">
                          {t.trader_label}
                        </td>
                        <td className="py-2.5 pr-4 font-semibold text-[#101114] tabular-nums">
                          {t.yes_pct_after.toFixed(1)}% YES
                        </td>
                        <td className="py-2.5 text-[#9497a9]">
                          {formatUtcDisplay(t.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === "oracle" && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#5741d8]">
                <LuShieldCheck className="w-4 h-4" />
                <span>Verification Contract &amp; Fingerprint</span>
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

            <OracleSpecSummary
              oracleConfig={liveMarket.oracleConfig}
              oracleTrack={liveMarket.oracleTrack}
            />

            <div className="space-y-1.5 text-[12px]">
              <div className="flex items-center justify-between gap-2 text-[#686b82]">
                <span>Committed Contract SHA-256 ({bundle.specVerified ? "Verified" : "Hash"}):</span>
                <code className="font-mono text-[11px] text-[#101114] truncate max-w-[360px]">
                  {liveMarket.specSha256}
                </code>
              </div>
              {browserDigest && (
                <div className="flex items-center justify-between gap-2 text-[#026b3f]">
                  <span>
                    Browser WebCrypto Match:{" "}
                    {browserDigest === liveMarket.specSha256 ? "VERIFIED" : "COMPUTED"}
                  </span>
                  <code className="font-mono text-[11px] truncate max-w-[340px]">
                    {browserDigest}
                  </code>
                </div>
              )}
              <div className="flex items-center justify-between gap-2 text-[#686b82]">
                <span>Nostr Announcement Note:</span>
                <button
                  type="button"
                  onClick={handleCopyNote}
                  className="inline-flex items-center gap-1 font-mono text-[11px] text-[#5741d8] hover:underline cursor-pointer"
                >
                  <span className="truncate max-w-[260px]">{liveMarket.nostrNoteId}</span>
                  {copiedNote ? <LuCheck className="w-3.5 h-3.5" /> : <LuCopy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {bundle.proofs.length > 0 && (
              <div className="pt-3 border-t border-[#dedee5] space-y-2">
                <p className="text-[12px] font-semibold text-[#101114]">
                  Verified Data Feed Proofs ({bundle.proofs.length})
                </p>
                {bundle.proofs.map((proof) => (
                  <div
                    key={proof.id}
                    className="p-3 rounded-[10px] bg-[rgba(20,158,97,0.12)] text-[12px] text-[#026b3f] space-y-1"
                  >
                    <div className="font-semibold">
                      Provider: {formatProviderName(proof.provider)} · Observed Value:{" "}
                      {proof.value ?? "N/A"}
                    </div>
                    <div className="font-mono text-[11px] break-all">{proof.url}</div>
                    {proof.bodySha256 && (
                      <div className="font-mono text-[11px] break-all">
                        Response SHA-256: {proof.bodySha256}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {bundle.proposals.length > 0 && (
              <div className="pt-3 border-t border-[#dedee5] space-y-2">
                <p className="text-[12px] font-semibold text-[#101114] inline-flex items-center gap-1.5">
                  <LuScale className="w-3.5 h-3.5 text-[#7132f5]" />
                  <span>Community Oracle Proposals ({bundle.proposals.length})</span>
                </p>
                {bundle.proposals.map((p) => (
                  <div
                    key={p.id}
                    className="p-3 rounded-[10px] border border-[#dedee5] bg-[rgba(148,151,169,0.06)] text-[12px] space-y-1"
                  >
                    <div className="font-semibold text-[#101114]">
                      Outcome: {p.outcome} ({p.status})
                    </div>
                    <div className="font-mono text-[11px] text-[#686b82] truncate">
                      Verifier: {formatPubkeyShort(p.signerPubkey)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
