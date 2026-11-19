"use client";

import Link from "next/link";
import { LuChartColumn, LuSend, LuShieldCheck, LuSparkles, LuZap } from "react-icons/lu";

const ROUTING_MATRIX: readonly [string, "Auto-API" | "Nostr Oracle", string][] = [
  ["Crypto", "Auto-API", "Mempool.space API, Binance Public API, CoinGecko"],
  ["Weather", "Auto-API", "Open-Meteo API (Free, keyless deterministic weather data)"],
  ["Finance", "Auto-API", "Frankfurter API (ECB FX Reference Rates)"],
  ["Technology", "Auto-API", "GitHub Public REST API (repository stars, releases) / Nostr Oracle"],
  ["Sports", "Nostr Oracle", "TheSportsDB / Official league match sheets + Nostr Sports Oracle Signers"],
  ["Esports", "Nostr Oracle", "OpenDota / Official tournament brackets + Signer verification"],
  ["Politics", "Nostr Oracle", "Official legislative & election records + Multi-Signer Oracles"],
  ["Economy", "Nostr Oracle", "Central bank & official agency statistical releases + Signer attestation"],
  ["Culture", "Nostr Oracle", "Verified public event announcements & metrics + Signer"],
];

export function HowItWorksView() {
  return (
    <section>
      <div className="bg-white border-b border-[#dedee5] py-14 sm:py-20">
        <div className="max-w-[920px] mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-[6px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] text-[13px] font-semibold mb-6">
            <span className="w-2 h-2 rounded-full bg-[#149e61]" />
            <span>Live on Bitcoin Lightning &amp; Nostr Oracles</span>
          </div>

          <h1 className="text-[38px] sm:text-[48px] font-bold leading-[1.17] tracking-[-1px] text-[#101114] mb-5">
            Predict anything. Settle in Sats.
          </h1>

          <p className="text-[16px] sm:text-[18px] leading-[1.45] text-[#686b82] max-w-[680px] mx-auto mb-8">
            Turn any real-world question into an unambiguous prediction contract with AI.
            Deterministic public APIs and Nostr Oracles settle winners automatically via Lightning.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-5 py-[13px] text-[16px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
            >
              <LuChartColumn className="w-4 h-4" strokeWidth={2} />
              <span>Explore Live Markets</span>
            </Link>

            <Link
              href="/create"
              className="inline-flex items-center gap-2 px-5 py-[13px] text-[16px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] rounded-[12px] transition-colors cursor-pointer"
            >
              <LuSparkles className="w-4 h-4" strokeWidth={2} />
              <span>Create with AI</span>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16">
        <div className="mb-8">
          <h2 className="text-[28px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114] mb-2">
            End-to-End Protocol Workflow
          </h2>
          <p className="text-[16px] text-[#686b82]">
            From natural-language prompt to automated Lightning Network settlement in four transparent stages.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-14">
          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-[12px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] flex items-center justify-center">
                <LuSparkles className="w-5 h-5" strokeWidth={2} />
              </div>
              <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                Step 01
              </span>
            </div>
            <h3 className="text-[18px] font-semibold text-[#101114] mb-2">
              AI Prompt-to-Oracle
            </h3>
            <p className="text-[14px] text-[#686b82] leading-[1.5]">
              Users submit a 1-sentence question. AI locks exact locations, UTC deadlines, and maps
              deterministic data-feed parameters or Nostr rules.
            </p>
          </div>

          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-[12px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] flex items-center justify-center">
                <LuZap className="w-5 h-5" strokeWidth={2} />
              </div>
              <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                Step 02
              </span>
            </div>
            <h3 className="text-[18px] font-semibold text-[#101114] mb-2">
              Lightning Parimutuel Betting
            </h3>
            <p className="text-[14px] text-[#686b82] leading-[1.5]">
              Sign in with Nostr, connect a Lightning wallet (WebLN / NWC), and wager Sats directly
              on YES or NO pools without custodial balances.
            </p>
          </div>

          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-[12px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] flex items-center justify-center">
                <LuShieldCheck className="w-5 h-5" strokeWidth={2} />
              </div>
              <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                Step 03
              </span>
            </div>
            <h3 className="text-[18px] font-semibold text-[#101114] mb-2">
              Dual-Track Oracle Resolution
            </h3>
            <p className="text-[14px] text-[#686b82] leading-[1.5]">
              Track A resolves automatically via public APIs (Open-Meteo, Mempool, GitHub). Track B
              resolves via cryptographic Nostr Oracle signers.
            </p>
          </div>

          <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="w-10 h-10 rounded-[12px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] flex items-center justify-center">
                <LuSend className="w-5 h-5" strokeWidth={2} />
              </div>
              <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                Step 04
              </span>
            </div>
            <h3 className="text-[18px] font-semibold text-[#101114] mb-2">
              Automated Sats Payout
            </h3>
            <p className="text-[14px] text-[#686b82] leading-[1.5]">
              Winning pool shares settle automatically to your optional Lightning Address while
              offline, or claim directly into your connected wallet in one click.
            </p>
          </div>
        </div>

        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
          <div className="px-6 py-5 border-b border-[#dedee5]">
            <h3 className="text-[22px] font-semibold text-[#101114]">
              9-Category Oracle Routing Matrix
            </h3>
            <p className="text-[14px] text-[#686b82] mt-1">
              Every market is automatically assigned to the safest verification mechanism for its data type.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#dedee5] bg-[rgba(148,151,169,0.08)] text-[12px] font-semibold uppercase tracking-[0.04em] text-[#686b82]">
                  <th className="py-3.5 px-6">Category</th>
                  <th className="py-3.5 px-6">Oracle Track</th>
                  <th className="py-3.5 px-6">Primary Data Source / Verification</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#dedee5] text-[14px]">
                {ROUTING_MATRIX.map(([cat, track, source]) => (
                  <tr key={cat} className="hover:bg-[rgba(148,151,169,0.04)]">
                    <td className="py-3.5 px-6 font-semibold text-[#101114]">{cat}</td>
                    <td className="py-3.5 px-6">
                      <span
                        className={
                          track === "Auto-API"
                            ? "px-2.5 py-1 text-[12px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                            : "px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]"
                        }
                      >
                        {track}
                      </span>
                    </td>
                    <td className="py-3.5 px-6 text-[#686b82]">{source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
