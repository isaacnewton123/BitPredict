/* eslint-disable @next/next/no-img-element */
"use client";

import { useState } from "react";
import { LuLayoutGrid } from "react-icons/lu";
import { CATEGORY_ICONS } from "@/components/layout/route-utils";
import type { CategoryId } from "@/lib/bitpredict-data";

const SIZE_CLASSES = {
  sm: { box: "w-10 h-10 rounded-[10px]", icon: "w-5 h-5" },
  md: { box: "w-12 h-12 rounded-[12px]", icon: "w-6 h-6" },
  preview: { box: "w-14 h-14 rounded-[12px]", icon: "w-7 h-7" },
  lg: { box: "w-16 h-16 rounded-[14px]", icon: "w-8 h-8" },
} as const;

const CATEGORY_STYLES: Record<string, string> = {
  Crypto: "bg-[rgba(133,91,251,0.12)] text-[#7132f5]",
  Weather: "bg-[rgba(14,165,233,0.12)] text-[#0284c7]",
  Finance: "bg-[rgba(20,158,97,0.12)] text-[#026b3f]",
  Technology: "bg-[rgba(99,102,241,0.12)] text-[#4f46e5]",
  Sports: "bg-[rgba(234,88,12,0.12)] text-[#c2410c]",
  Esports: "bg-[rgba(168,85,247,0.12)] text-[#7e22ce]",
  Politics: "bg-[rgba(220,38,38,0.10)] text-[#b91c1c]",
  Economy: "bg-[rgba(20,158,97,0.12)] text-[#026b3f]",
  Culture: "bg-[rgba(236,72,153,0.12)] text-[#be185d]",
};

interface MarketCoverProps {
  imageUrl: string | null;
  category: string;
  alt?: string;
  size?: "sm" | "md" | "preview" | "lg";
}

/** Renders an uploaded/HTTPS cover image, or falls back to a crisp react-icons category badge. */
export function MarketCover({
  imageUrl,
  category,
  alt = "",
  size = "md",
}: MarketCoverProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const dims = SIZE_CLASSES[size];

  if (imageUrl && failedUrl !== imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={alt}
        onError={() => setFailedUrl(imageUrl)}
        className={`${dims.box} object-cover border border-[#dedee5] bg-[rgba(148,151,169,0.08)] shrink-0`}
      />
    );
  }

  const Icon = CATEGORY_ICONS[category as CategoryId] ?? LuLayoutGrid;
  const tintClass =
    CATEGORY_STYLES[category] ?? "bg-[rgba(133,91,251,0.12)] text-[#7132f5]";

  return (
    <div
      aria-hidden={!alt}
      role={alt ? "img" : undefined}
      aria-label={alt || undefined}
      className={`${dims.box} border border-[#dedee5] flex items-center justify-center shrink-0 ${tintClass}`}
    >
      <Icon className={dims.icon} strokeWidth={1.85} />
    </div>
  );
}
