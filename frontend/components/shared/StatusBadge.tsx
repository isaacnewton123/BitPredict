"use client";

export type StatusKind = "market" | "bet" | "payout";

interface StatusPresentation {
  label: string;
  badgeClass: string;
  dotClass: string;
  pulse?: boolean;
}

const MARKET_LABELS: Record<string, string> = {
  OPEN: "Open",
  CLOSED: "Betting Closed",
  PENDING_RESOLUTION: "Resolving",
  RESOLVING: "Resolving",
  PROPOSED: "Outcome Proposed",
  DISPUTED: "Under Dispute",
  VOID: "Void · Refunded",
  SETTLED: "Settled",
  RESOLVED: "Settled",
};

const BET_LABELS: Record<string, string> = {
  CONFIRMED: "Active",
  PENDING_INVOICE: "Pending",
  PENDING: "Pending",
  REFUNDED: "Refunded",
  LATE: "Refunded",
};

const PAYOUT_LABELS: Record<string, string> = {
  CLAIMABLE: "Ready to Claim",
  SENT: "Paid",
  QUEUED: "Processing",
  SENDING: "Processing",
  FAILED: "Retry Needed",
};

/** Maps raw backend market status and outcome enums into clean human labels. */
export function formatMarketStatusLabel(status: string, outcome?: string | null): string {
  const key = status.trim().toUpperCase();
  if (key === "SETTLED" || key === "RESOLVED") {
    if (outcome === "YES") return "Settled · YES";
    if (outcome === "NO") return "Settled · NO";
    if (outcome === "INVALID") return "Void · Refunded";
    return "Settled";
  }
  return MARKET_LABELS[key] ?? status;
}

function resolveStatusPresentation(
  status: string,
  outcome: string | null | undefined,
  kind: StatusKind,
): StatusPresentation {
  const key = status.trim().toUpperCase();

  if (kind === "bet") {
    const label = BET_LABELS[key] ?? status;
    if (key === "CONFIRMED") {
      return {
        label,
        badgeClass: "bg-[rgba(20,158,97,0.14)] text-[#026b3f]",
        dotClass: "bg-[#149e61]",
      };
    }
    if (key === "PENDING_INVOICE" || key === "PENDING") {
      return {
        label,
        badgeClass: "bg-[rgba(133,91,251,0.14)] text-[#7132f5]",
        dotClass: "bg-[#7132f5]",
      };
    }
    return {
      label,
      badgeClass: "bg-[rgba(104,107,130,0.12)] text-[#484b5e]",
      dotClass: "bg-[#9497a9]",
    };
  }

  if (kind === "payout") {
    const label = PAYOUT_LABELS[key] ?? status;
    if (key === "CLAIMABLE" || key === "SENT") {
      return {
        label,
        badgeClass: "bg-[rgba(20,158,97,0.14)] text-[#026b3f]",
        dotClass: "bg-[#149e61]",
      };
    }
    if (key === "QUEUED" || key === "SENDING") {
      return {
        label,
        badgeClass: "bg-[rgba(133,91,251,0.14)] text-[#7132f5]",
        dotClass: "bg-[#7132f5]",
      };
    }
    if (key === "FAILED") {
      return {
        label,
        badgeClass: "bg-[rgba(220,38,38,0.10)] text-[#b91c1c]",
        dotClass: "bg-[#dc2626]",
      };
    }
    return {
      label,
      badgeClass: "bg-[rgba(104,107,130,0.12)] text-[#484b5e]",
      dotClass: "bg-[#9497a9]",
    };
  }

  // kind === "market" (also covers ACTIVE/ACCEPTED/REJECTED proposal badges cleanly)
  const label = formatMarketStatusLabel(key, outcome);
  if (key === "OPEN") {
    return {
      label,
      badgeClass: "bg-[rgba(20,158,97,0.14)] text-[#026b3f]",
      dotClass: "bg-[#149e61]",
      pulse: true,
    };
  }
  if (key === "SETTLED" || key === "RESOLVED") {
    if (outcome === "NO") {
      return {
        label,
        badgeClass: "bg-[rgba(220,38,38,0.10)] text-[#b91c1c]",
        dotClass: "bg-[#dc2626]",
      };
    }
    if (outcome === "INVALID") {
      return {
        label,
        badgeClass: "bg-[rgba(104,107,130,0.12)] text-[#484b5e]",
        dotClass: "bg-[#9497a9]",
      };
    }
    return {
      label,
      badgeClass: "bg-[rgba(20,158,97,0.14)] text-[#026b3f]",
      dotClass: "bg-[#149e61]",
    };
  }
  if (key === "PENDING_RESOLUTION" || key === "RESOLVING" || key === "PROPOSED" || key === "ACTIVE") {
    return {
      label: key === "ACTIVE" ? "Active Proposal" : label,
      badgeClass: "bg-[rgba(133,91,251,0.14)] text-[#7132f5]",
      dotClass: "bg-[#7132f5]",
    };
  }
  if (key === "DISPUTED" || key === "REJECTED") {
    return {
      label: key === "REJECTED" ? "Rejected" : label,
      badgeClass: "bg-[rgba(220,38,38,0.10)] text-[#b91c1c]",
      dotClass: "bg-[#dc2626]",
    };
  }
  if (key === "ACCEPTED") {
    return {
      label: "Accepted",
      badgeClass: "bg-[rgba(20,158,97,0.14)] text-[#026b3f]",
      dotClass: "bg-[#149e61]",
    };
  }
  return {
    label,
    badgeClass: "bg-[rgba(104,107,130,0.12)] text-[#484b5e]",
    dotClass: "bg-[#9497a9]",
  };
}

interface StatusBadgeProps {
  status: string;
  outcome?: string | null;
  kind?: StatusKind;
  size?: "sm" | "md";
}

/** Unified, clean tinted status pill adhering to BitPredict's DESIGN.md badge scale. */
export function StatusBadge({
  status,
  outcome,
  kind = "market",
  size = "sm",
}: StatusBadgeProps) {
  const { label, badgeClass, dotClass, pulse } = resolveStatusPresentation(
    status,
    outcome,
    kind,
  );
  const sizeClass =
    size === "md" ? "px-3 py-1 text-[12px] gap-2" : "px-2 py-0.5 text-[11px] gap-1.5";

  return (
    <span
      className={`inline-flex items-center font-semibold rounded-[6px] leading-[1.3] whitespace-nowrap ${sizeClass} ${badgeClass}`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotClass} ${
          pulse ? "animate-pulse" : ""
        }`}
      />
      <span>{label}</span>
    </span>
  );
}
