import type { Metadata } from "next";

function resolveSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  if (raw && /^https?:\/\//i.test(raw) && !/localhost|127\.0\.0\.1/i.test(raw)) {
    return raw;
  }
  return "https://bitpredict.web.id";
}

export const SITE_URL = resolveSiteUrl();
export const SITE_NAME = "BitPredict";
export const DEFAULT_TITLE = "BitPredict — Live Bitcoin Lightning & Nostr Prediction Markets";
export const DEFAULT_DESCRIPTION =
  "Turn any prediction into an unambiguous Bitcoin Lightning prediction market backed by deterministic Auto-API feeds, AI market drafting, and Nostr oracles.";

export const OG_IMAGE_URL = "https://cdn.bitpredict.web.id/bitpredict-logo.jpg";

export const OG_IMAGE = {
  url: OG_IMAGE_URL,
  width: 1024,
  height: 1024,
  alt: "BitPredict — Bitcoin Lightning & Nostr Prediction Markets",
  type: "image/jpeg",
} as const;

export const SITE_KEYWORDS: string[] = [
  "BitPredict",
  "Bitcoin prediction markets",
  "Lightning Network",
  "Bitcoin Lightning betting",
  "Nostr prediction market",
  "Nostr oracle",
  "NIP-07",
  "NIP-98",
  "Nostr Wallet Connect",
  "parimutuel prediction market",
  "AI prediction market creator",
  "BTC markets",
];

const UPPERCASE_WORDS = new Set([
  "btc",
  "usd",
  "eth",
  "ai",
  "api",
  "eu",
  "us",
  "uk",
  "gdp",
  "cpi",
  "etf",
  "sec",
  "ln",
  "nwc",
  "fed",
]);

/** Converts a market slug into a clean human-readable page title without runtime fetches. */
export function formatMarketSlugTitle(rawSlug: string): string {
  let decoded = rawSlug;
  try {
    decoded = decodeURIComponent(rawSlug);
  } catch {
    // keep raw slug if malformed percent-encoding
  }
  const stripped = decoded.trim().replace(/-[0-9a-f]{6}$/i, "");
  const words = stripped
    .split(/[-_]+/)
    .map((w) => w.trim())
    .filter(Boolean);

  if (words.length === 0) return "Prediction Market";

  return words
    .map((w) => {
      const lower = w.toLowerCase();
      if (UPPERCASE_WORDS.has(lower)) return lower.toUpperCase();
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(" ");
}

/** Builds consistent page-level metadata, canonical URLs, Open Graph tags, and Twitter cards. */
export function buildPageMetadata(opts: {
  title: string;
  description: string;
  path: string;
  noIndex?: boolean;
}): Metadata {
  const fullTitle = `${opts.title} | ${SITE_NAME}`;
  return {
    title: opts.title,
    description: opts.description,
    alternates: {
      canonical: opts.path,
    },
    openGraph: {
      type: "website",
      locale: "en_US",
      url: opts.path,
      siteName: SITE_NAME,
      title: fullTitle,
      description: opts.description,
      images: [OG_IMAGE],
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: opts.description,
      images: [
        {
          url: OG_IMAGE_URL,
          alt: OG_IMAGE.alt,
        },
      ],
    },
    ...(opts.noIndex
      ? {
          robots: {
            index: false,
            follow: false,
            googleBot: {
              index: false,
              follow: false,
            },
          },
        }
      : {}),
  };
}
