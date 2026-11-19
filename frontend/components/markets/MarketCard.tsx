"use client";

import Link from "next/link";
import {
  LuArrowRight,
  LuClock,
  LuRadio,
  LuShieldCheck,
} from "react-icons/lu";
import { MarketCover } from "@/components/shared/MarketCover";
import { SatsIcon } from "@/components/shared/SatsIcon";
import {
  formatSats,
  getYesProbability,
  type MarketItem,
  resolveMarketImageUrl,
  setPendingTradeSide,
} from "@/lib/bitpredict-data";

export function MarketCard({ market: m }: { market: MarketItem }) {
  const yesPct = getYesProbability(m);
  const noPct = 100 - yesPct;
  const totalPool = m.yesPool + m.noPool;
  const isOpen = m.status === "OPEN";
  const coverSrc = resolveMarketImageUrl(m);
  const gaugeCircumference = Math.PI * 18;
  const gaugeFill = (yesPct / 100) * gaugeCircumference;
  const marketHref = `/m/${encodeURIComponent(m.slug)}`;

  return (
    <article className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col justify-between hover:border-[#7132f5]/60 transition-all">
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <Link
            href={marketHref}
            onClick={() => setPendingTradeSide(m.slug, "YES")}
            className="flex items-start gap-3 text-left group flex-1 min-w-0 cursor-pointer"
          >
            <MarketCover
              imageUrl={coverSrc}
              category={m.category}
              alt={m.title}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                <span className="px-2 py-0.5 text-[11px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[6px]">
                  {m.category}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold rounded-[6px] ${
                    m.oracleTrack === "auto_api"
                      ? "bg-[rgba(20,158,97,0.16)] text-[#026b3f]"
                      : "bg-[rgba(104,107,130,0.12)] text-[#484b5e]"
                  }`}
                >
                  {m.oracleTrack === "auto_api" ? (
                    <LuShieldCheck className="w-3 h-3" strokeWidth={2} />
                  ) : (
                    <LuRadio className="w-3 h-3" strokeWidth={2} />
                  )}
                  <span>{m.oracleLabel}</span>
                </span>
              </div>
              <h3 className="text-[16px] font-semibold text-[#101114] group-hover:text-[#7132f5] leading-[1.35] transition-colors line-clamp-2">
                {m.question}
              </h3>
            </div>
          </Link>

          <div className="shrink-0 flex flex-col items-center w-[52px]">
            <svg viewBox="0 0 44 26" className="w-[46px] h-[27px]">
              <path
                d="M 4 22 A 18 18 0 0 1 40 22"
                fill="none"
                stroke="#dedee5"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M 4 22 A 18 18 0 0 1 40 22"
                fill="none"
                stroke="#149e61"
                strokeWidth="4"
                strokeLinecap="round"
                strokeDasharray={`${gaugeFill} ${gaugeCircumference}`}
              />
              <text
                x="22"
                y="21"
                textAnchor="middle"
                fontSize="10"
                fontWeight="700"
                fill="#101114"
              >
                {yesPct}%
              </text>
            </svg>
            <span className="text-[10px] font-semibold text-[#686b82] -mt-0.5">
              chance
            </span>
          </div>
        </div>

        <p className="inline-flex items-center gap-1.5 text-[12px] text-[#9497a9] mb-3.5">
          <LuClock className="w-3.5 h-3.5" strokeWidth={2} />
          <span>{m.deadline}</span>
        </p>

        <div className="mb-4">
          <div className="flex items-center justify-between text-[12px] font-semibold mb-1.5 tabular-nums">
            <span className="text-[#026b3f]">YES {yesPct}%</span>
            <span className="text-[#b91c1c]">NO {noPct}%</span>
          </div>
          <div className="w-full h-1.5 bg-[#dc2626]/20 rounded-[6px] overflow-hidden">
            <div
              className="h-full bg-[#149e61] rounded-[6px] transition-all duration-300"
              style={{ width: `${yesPct}%` }}
            />
          </div>
        </div>
      </div>

      <div>
        <div className="grid grid-cols-2 gap-2.5 mb-3.5">
          {isOpen ? (
            <Link
              href={marketHref}
              onClick={() => setPendingTradeSide(m.slug, "YES")}
              className="py-2.5 px-3 text-center text-[13px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white rounded-[12px] transition-colors cursor-pointer"
            >
              Buy YES {yesPct}%
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="py-2.5 px-3 text-[13px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] opacity-45 rounded-[12px]"
            >
              Buy YES {yesPct}%
            </button>
          )}
          {isOpen ? (
            <Link
              href={marketHref}
              onClick={() => setPendingTradeSide(m.slug, "NO")}
              className="py-2.5 px-3 text-center text-[13px] font-semibold text-[#b91c1c] bg-[rgba(220,38,38,0.10)] hover:bg-[#dc2626] hover:text-white rounded-[12px] transition-colors cursor-pointer"
            >
              Buy NO {noPct}%
            </Link>
          ) : (
            <button
              type="button"
              disabled
              className="py-2.5 px-3 text-[13px] font-semibold text-[#b91c1c] bg-[rgba(220,38,38,0.10)] opacity-45 rounded-[12px]"
            >
              Buy NO {noPct}%
            </button>
          )}
        </div>

        <div className="pt-3 border-t border-[#dedee5] flex items-center justify-between text-[12px] text-[#686b82]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#101114] tabular-nums">
            <SatsIcon className="w-3.5 h-3.5 shrink-0" />
            {formatSats(totalPool)} sats Vol.
          </span>

          <Link
            href={marketHref}
            onClick={() => setPendingTradeSide(m.slug, "YES")}
            className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#7132f5] hover:underline cursor-pointer"
          >
            <span>Trade Terminal</span>
            <LuArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </article>
  );
}
