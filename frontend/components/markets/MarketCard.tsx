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
import { StatusBadge } from "@/components/shared/StatusBadge";
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
    <article className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col justify-between card-interactive">
      <div>
        <div className="flex items-start justify-between gap-3 mb-4">
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
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 mb-1.5 text-[11px]">
                <span className="font-semibold text-[#686b82]">{m.category}</span>
                <span className="text-[#dedee5]" aria-hidden="true">
                  ·
                </span>
                <span
                  className={`inline-flex items-center gap-1 font-semibold ${
                    m.oracleTrack === "auto_api" ? "text-[#026b3f]" : "text-[#686b82]"
                  }`}
                >
                  {m.oracleTrack === "auto_api" ? (
                    <LuShieldCheck className="w-3 h-3 shrink-0" strokeWidth={2} />
                  ) : (
                    <LuRadio className="w-3 h-3 shrink-0" strokeWidth={2} />
                  )}
                  <span>{m.oracleLabel}</span>
                </span>
                {m.isDemo && (
                  <span className="px-1.5 py-0.5 text-[10px] font-bold bg-[rgba(133,91,251,0.14)] text-[#7132f5] rounded-[6px]">
                    Demo
                  </span>
                )}
                {!isOpen && <StatusBadge status={m.status} outcome={m.outcome} size="sm" />}
              </div>
              <h3 className="text-[16px] font-semibold text-[#101114] group-hover:text-[#7132f5] leading-[1.35] transition-colors line-clamp-2">
                {m.question}
              </h3>
            </div>
          </Link>

          <div className="shrink-0 flex flex-col items-center w-[50px]">
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

        <div className="mb-4">
          <div className="flex items-center justify-between text-[12px] font-semibold mb-1.5 tabular-nums">
            <span className="text-[#026b3f]">YES {yesPct}%</span>
            <span className="text-[#b91c1c]">NO {noPct}%</span>
          </div>
          <div className="w-full h-1.5 bg-[rgba(220,38,38,0.16)] rounded-[6px] overflow-hidden">
            <div
              className="h-full bg-[#149e61] rounded-[6px] transition-all duration-300"
              style={{ width: `${yesPct}%` }}
            />
          </div>
        </div>
      </div>

      <div>
        {isOpen ? (
          <div className="grid grid-cols-2 gap-2.5 mb-3.5">
            <Link
              href={marketHref}
              onClick={() => setPendingTradeSide(m.slug, "YES")}
              className="py-2.5 px-3 text-center text-[13px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.14)] hover:bg-[#149e61] hover:text-white rounded-[12px] transition-colors cursor-pointer"
            >
              Buy YES {yesPct}%
            </Link>
            <Link
              href={marketHref}
              onClick={() => setPendingTradeSide(m.slug, "NO")}
              className="py-2.5 px-3 text-center text-[13px] font-semibold text-[#b91c1c] bg-[rgba(220,38,38,0.10)] hover:bg-[#dc2626] hover:text-white rounded-[12px] transition-colors cursor-pointer"
            >
              Buy NO {noPct}%
            </Link>
          </div>
        ) : (
          <Link
            href={marketHref}
            onClick={() => setPendingTradeSide(m.slug, "YES")}
            className="mb-3.5 px-3.5 py-2.5 rounded-[12px] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(133,91,251,0.08)] flex items-center justify-between gap-2 transition-colors group cursor-pointer"
          >
            <StatusBadge status={m.status} outcome={m.outcome} size="sm" />
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-[#5741d8] group-hover:text-[#7132f5]">
              <span>View Result</span>
              <LuArrowRight className="w-3.5 h-3.5" />
            </span>
          </Link>
        )}

        <div className="pt-3 border-t border-[#dedee5] flex items-center justify-between gap-2 text-[12px] text-[#686b82]">
          <span className="inline-flex items-center gap-1.5 font-semibold text-[#101114] tabular-nums">
            <SatsIcon className="w-3.5 h-3.5 shrink-0" />
            <span>{formatSats(totalPool)} sats</span>
          </span>

          <span className="inline-flex items-center gap-1 text-[#9497a9] truncate">
            <LuClock className="w-3.5 h-3.5 shrink-0" strokeWidth={2} />
            <span className="truncate">{m.deadline}</span>
          </span>
        </div>
      </div>
    </article>
  );
}
