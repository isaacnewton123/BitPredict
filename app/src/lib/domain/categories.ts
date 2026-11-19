import type { Category, ResolutionTrack } from "./constants";

export interface CategoryMeta {
  id: Category;
  slug: string;
  label: string;
  /** Default oracle routing (docs/05-oracle-design.md#routing-matrix). */
  defaultTrack: ResolutionTrack;
  /** Tracks the AI may choose for this category. */
  allowedTracks: readonly ResolutionTrack[];
  icon: string;
  dataSources: string;
}

export const CATEGORY_META: readonly CategoryMeta[] = [
  { id: "Crypto", slug: "crypto", label: "Crypto", icon: "₿", defaultTrack: "auto_api", allowedTracks: ["auto_api"], dataSources: "Binance, Mempool.space, CoinGecko" },
  { id: "Weather", slug: "weather", label: "Weather", icon: "☀", defaultTrack: "auto_api", allowedTracks: ["auto_api"], dataSources: "Open-Meteo" },
  { id: "Finance", slug: "finance", label: "Finance", icon: "€", defaultTrack: "auto_api", allowedTracks: ["auto_api"], dataSources: "Frankfurter (ECB FX)" },
  { id: "Technology", slug: "technology", label: "Technology", icon: "⌘", defaultTrack: "auto_api", allowedTracks: ["auto_api", "nostr_oracle"], dataSources: "GitHub REST API / Community" },
  { id: "Sports", slug: "sports", label: "Sports", icon: "⚽", defaultTrack: "nostr_oracle", allowedTracks: ["nostr_oracle", "auto_api"], dataSources: "TheSportsDB / Oracle Signer" },
  { id: "Esports", slug: "esports", label: "Esports", icon: "🎮", defaultTrack: "nostr_oracle", allowedTracks: ["nostr_oracle", "auto_api"], dataSources: "OpenDota / Oracle Signer" },
  { id: "Economy", slug: "economy", label: "Economy", icon: "📈", defaultTrack: "nostr_oracle", allowedTracks: ["nostr_oracle"], dataSources: "Central bank / agency releases + Signer" },
  { id: "Politics", slug: "politics", label: "Politics", icon: "🏛", defaultTrack: "nostr_oracle", allowedTracks: ["nostr_oracle"], dataSources: "Official sources + Multi-Signer" },
  { id: "Culture", slug: "culture", label: "Culture", icon: "🎬", defaultTrack: "nostr_oracle", allowedTracks: ["nostr_oracle"], dataSources: "Official announcements + Signer" },
];

export function getCategoryBySlug(slug: string): CategoryMeta | undefined {
  return CATEGORY_META.find((c) => c.slug === slug.toLowerCase());
}

export function getCategory(id: Category): CategoryMeta {
  const meta = CATEGORY_META.find((c) => c.id === id);
  if (!meta) throw new Error(`Unknown category: ${id}`);
  return meta;
}
