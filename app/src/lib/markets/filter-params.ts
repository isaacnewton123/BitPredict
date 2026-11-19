import { RESOLUTION_TRACKS, type MarketStatus, type ResolutionTrack } from "@/lib/domain/constants";
import { LISTED_MARKET_STATUSES, type MarketSort } from "./publish-repo";

export interface ParsedMarketFilters {
  status?: MarketStatus;
  track?: ResolutionTrack;
  sort: MarketSort;
}

export function parseMarketFilters(params: {
  status?: string | string[] | null;
  track?: string | string[] | null;
  sort?: string | string[] | null;
}): ParsedMarketFilters {
  const first = (v?: string | string[] | null) => (Array.isArray(v) ? v[0] : v) ?? undefined;

  const statusRaw = first(params.status)?.toUpperCase();
  const status =
    statusRaw && (LISTED_MARKET_STATUSES as readonly string[]).includes(statusRaw)
      ? (statusRaw as MarketStatus)
      : undefined;

  const trackRaw = first(params.track);
  const track =
    trackRaw && (RESOLUTION_TRACKS as readonly string[]).includes(trackRaw)
      ? (trackRaw as ResolutionTrack)
      : undefined;

  const sortRaw = first(params.sort);
  const sort: MarketSort = sortRaw === "trending" || sortRaw === "closing" ? sortRaw : "new";

  return { status, track, sort };
}
