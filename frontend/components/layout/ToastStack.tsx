"use client";

import { LuCircleCheck } from "react-icons/lu";
import type { ToastItem } from "@/lib/bitpredict-data";

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  return (
    <div
      id="toastContainer"
      className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 pointer-events-none max-w-[360px] w-[calc(100%-2.5rem)]"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-start gap-3 p-3.5 bg-white border border-[#dedee5] rounded-[12px] shadow-whisper transition-all duration-200"
        >
          <div className="w-8 h-8 shrink-0 rounded-[8px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] flex items-center justify-center">
            <LuCircleCheck className="w-4 h-4" strokeWidth={2} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[14px] font-semibold text-[#101114] leading-[1.3]">
              {t.title}
            </p>
            <p className="text-[12px] text-[#686b82] mt-0.5">{t.subtitle}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
