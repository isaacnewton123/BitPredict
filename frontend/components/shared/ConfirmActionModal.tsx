"use client";

import { useEffect } from "react";
import { LuCircleAlert, LuShieldCheck, LuTriangleAlert, LuX } from "react-icons/lu";

export interface ConfirmDetailItem {
  label: string;
  value: string;
}

export interface ConfirmActionModalProps {
  open: boolean;
  title: string;
  description: string;
  details?: ConfirmDetailItem[];
  warning?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "success" | "danger";
  busy?: boolean;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const TONE_STYLES = {
  primary: {
    iconWrap: "bg-[rgba(133,91,251,0.16)] text-[#7132f5]",
    button: "bg-[#7132f5] hover:bg-[#5b1ecf] text-white",
    warningBox: "bg-[rgba(133,91,251,0.08)] border-[rgba(113,50,245,0.22)] text-[#5741d8]",
    Icon: LuCircleAlert,
  },
  success: {
    iconWrap: "bg-[rgba(20,158,97,0.16)] text-[#026b3f]",
    button: "bg-[#149e61] hover:bg-[#026b3f] text-white",
    warningBox: "bg-[rgba(20,158,97,0.10)] border-[rgba(20,158,97,0.25)] text-[#026b3f]",
    Icon: LuShieldCheck,
  },
  danger: {
    iconWrap: "bg-[rgba(220,38,38,0.12)] text-[#b91c1c]",
    button: "bg-[#dc2626] hover:bg-[#b91c1c] text-white",
    warningBox: "bg-[rgba(220,38,38,0.08)] border-[rgba(220,38,38,0.25)] text-[#b91c1c]",
    Icon: LuTriangleAlert,
  },
} as const;

/** Reusable accessible confirmation dialog for irreversible or financial actions. */
export function ConfirmActionModal({
  open,
  title,
  description,
  details,
  warning,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "primary",
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmActionModalProps) {
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) {
        onCancel();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  const style = TONE_STYLES[tone];
  const ToneIcon = style.Icon;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101114]/50 backdrop-blur-[2px]"
      onClick={() => {
        if (!busy) onCancel();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-action-modal-title"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[480px] bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-6 space-y-5"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 shrink-0 rounded-[12px] flex items-center justify-center ${style.iconWrap}`}
            >
              <ToneIcon className="w-5 h-5" strokeWidth={2} />
            </div>
            <div>
              <h2
                id="confirm-action-modal-title"
                className="text-[18px] font-bold text-[#101114] leading-[1.3]"
              >
                {title}
              </h2>
              <p className="text-[14px] text-[#686b82] leading-[1.5] mt-1">{description}</p>
            </div>
          </div>

          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            aria-label="Close confirmation dialog"
            className="p-1.5 text-[#9497a9] hover:text-[#101114] disabled:opacity-40 rounded-[8px] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
          >
            <LuX className="w-4 h-4" />
          </button>
        </div>

        {details && details.length > 0 && (
          <dl className="p-3.5 rounded-[12px] bg-[rgba(148,151,169,0.06)] border border-[#dedee5] space-y-2 text-[13px]">
            {details.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-4">
                <dt className="text-[#686b82] shrink-0">{row.label}</dt>
                <dd className="font-semibold text-[#101114] text-right break-words">
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {warning && (
          <div className={`p-3 rounded-[12px] border text-[12px] leading-[1.5] ${style.warningBox}`}>
            {warning}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-4 py-2.5 text-[14px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(148,151,169,0.16)] disabled:opacity-50 rounded-[12px] transition-colors cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={`px-4 py-2.5 text-[14px] font-semibold rounded-[12px] transition-colors disabled:opacity-60 cursor-pointer ${style.button}`}
          >
            {busy ? "Processing..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
