/* eslint-disable @next/next/no-img-element */
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  LuChartColumn,
  LuClock,
  LuCodeXml,
  LuCpu,
  LuImage,
  LuLink2,
  LuLock,
  LuRadio,
  LuScale,
  LuSend,
  LuShieldCheck,
  LuSparkles,
  LuTrash2,
  LuUpload,
  LuWandSparkles,
  LuX,
  LuZap,
} from "react-icons/lu";
import {
  type AppView,
  type BackendUserProfile,
  type CategoryId,
  createBackendMarketDraft,
  type DraftResponse,
  fetchOracleQueueFromBackend,
  finalizeBackendTrackBProposal,
  formatSats,
  formatUtcDisplay,
  type MarketItem,
  type OracleQueueEntry,
  publishBackendMarketDraft,
  resolveMarketImageUrl,
  runBackendTrackAResolve,
  submitBackendTrackBDispute,
  submitBackendTrackBProposal,
  updateBackendMarketDraftSpec,
  uploadMarketImage,
  type UserPayoutItem,
  type UserPositionItem,
} from "@/lib/bitpredict-data";

const QUICK_EXAMPLES: readonly { label: string; prompt: string }[] = [
  {
    label: "Weather: Washington D.C. 19°C",
    prompt: "Will Washington, D.C. max temperature reach 19°C tomorrow?",
  },
  {
    label: "Crypto: Bitcoin Mempool > 18 sat/vB",
    prompt: "Will Bitcoin mempool fee rate exceed 18 sat/vB tomorrow?",
  },
  {
    label: "Technology: GitHub Stars",
    prompt: "Will the bitcoin/bitcoin GitHub repo reach 85,000 stars tomorrow?",
  },
  {
    label: "Politics: EU Plenary Vote",
    prompt: "Will the EU Digital Identity open-source amendment pass the plenary vote?",
  },
];

interface CreatorViewProps {
  onPublished: (market: MarketItem) => void;
  onNotify: (title: string, subtitle: string) => void;
}

export function CreatorView({ onPublished, onNotify }: CreatorViewProps) {
  const [prompt, setPrompt] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [draggingImage, setDraggingImage] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [imageUrlInput, setImageUrlInput] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function applyCoverUrlToDraft(nextUrl: string | null) {
    if (!draft) return;
    const nextSpec: Record<string, unknown> = { ...draft.spec };
    if (nextUrl) {
      nextSpec.image_url = nextUrl;
    } else {
      delete nextSpec.image_url;
    }
    const updated = await updateBackendMarketDraftSpec(draft.draft_id, nextSpec);
    setDraft(updated);
  }

  async function handleFileSelected(file: File | null | undefined) {
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      onNotify("Image Too Large", "Please choose an image smaller than 5 MB.");
      return;
    }
    setUploadingImage(true);
    try {
      const uploaded = await uploadMarketImage(file);
      setCoverImageUrl(uploaded.url);
      if (draft) {
        await applyCoverUrlToDraft(uploaded.url);
      }
      onNotify("Cover Image Ready", `${file.name} uploaded and attached to market spec.`);
    } catch (err) {
      onNotify(
        "Image Upload Failed",
        err instanceof Error ? err.message : "Could not upload image",
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleApplyManualUrl() {
    const cleaned = imageUrlInput.trim();
    if (!cleaned) return;
    if (!/^https:\/\/[^\s]+$/i.test(cleaned) && !/^\/(api\/v1\/uploads|markets)\//.test(cleaned)) {
      onNotify("Invalid Image URL", "Enter a valid https:// image URL.");
      return;
    }
    setUploadingImage(true);
    try {
      setCoverImageUrl(cleaned);
      if (draft) {
        await applyCoverUrlToDraft(cleaned);
      }
      setShowUrlInput(false);
      onNotify("Cover Image Linked", "External HTTPS image attached to market spec.");
    } catch (err) {
      onNotify(
        "Invalid Cover URL",
        err instanceof Error ? err.message : "Failed to attach image URL",
      );
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleRemoveCover() {
    setCoverImageUrl(null);
    setImageUrlInput("");
    if (draft) {
      try {
        await applyCoverUrlToDraft(null);
      } catch (err) {
        onNotify(
          "Update Failed",
          err instanceof Error ? err.message : "Could not update draft spec",
        );
      }
    }
  }

  async function generateFrom(text: string) {
    const trimmed = text.trim();
    if (!trimmed) {
      onNotify("Enter a Prediction Prompt", "Type a 1-sentence question or click a quick example.");
      return;
    }
    setCompiling(true);
    try {
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
      const created = await createBackendMarketDraft(
        trimmed,
        tz,
        coverImageUrl ?? undefined,
      );
      setDraft(created);
    } catch (err) {
      onNotify(
        "Failed to Draft Contract",
        err instanceof Error ? err.message : "Check Elysia backend connection",
      );
    } finally {
      setCompiling(false);
    }
  }

  async function handlePublish() {
    if (!draft) return;
    setPublishing(true);
    try {
      const res = await publishBackendMarketDraft(draft.draft_id);
      setDraft(null);
      setPrompt("");
      setCoverImageUrl(null);
      setImageUrlInput("");
      onPublished(res.market);
    } catch (err) {
      onNotify(
        "Publish Failed",
        err instanceof Error ? err.message : "Unable to publish market",
      );
    } finally {
      setPublishing(false);
    }
  }

  const spec = draft?.spec ?? {};
  const category = String(spec.category ?? "Crypto");
  const track = String(spec.resolution_track ?? "auto_api");
  const activeImageSrc = resolveMarketImageUrl({
    imageUrl:
      typeof spec.image_url === "string"
        ? spec.image_url
        : coverImageUrl,
    category: category as Exclude<CategoryId, "All">,
  });
  const hasCustomImage = Boolean(
    (typeof spec.image_url === "string" && spec.image_url) || coverImageUrl,
  );

  return (
    <section className="max-w-[960px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
      <div className="mb-8">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] text-[12px] font-semibold mb-3">
          <LuSparkles className="w-3.5 h-3.5" strokeWidth={2} />
          <span>AI Prompt-to-Oracle Studio</span>
        </div>
        <h1 className="text-[32px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114] mb-2">
          Create a Prediction Market in One Sentence
        </h1>
        <p className="text-[16px] text-[#686b82] leading-[1.45] max-w-[700px]">
          Type any real-world question. The backend AI/compiler locks locations, UTC deadlines,
          and a deterministic API JSON contract or Nostr Oracle rulebook saved in SQLite.
        </p>
      </div>

      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 sm:p-6">
        <label
          htmlFor="aiPromptInput"
          className="block text-[14px] font-semibold text-[#101114] mb-2"
        >
          Your Prediction Question
        </label>

        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <LuWandSparkles
              className="w-5 h-5 text-[#7132f5] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              strokeWidth={1.85}
            />
            <input
              id="aiPromptInput"
              type="text"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !compiling) generateFrom(prompt);
              }}
              placeholder="e.g. Will Washington, D.C. max temperature reach 19°C tomorrow?"
              className="w-full h-[50px] pl-11 pr-4 text-[15px] text-[#101114] placeholder-[#9497a9] bg-white border border-[#dedee5] rounded-[12px] focus:outline-none focus:border-[#7132f5] transition-colors"
            />
          </div>

          <button
            type="button"
            disabled={compiling}
            onClick={() => generateFrom(prompt)}
            className="shrink-0 inline-flex items-center justify-center gap-2 px-5 py-[13px] text-[15px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
          >
            <LuSparkles className="w-4 h-4" strokeWidth={2} />
            <span>{compiling ? "Compiling..." : "Generate Contract"}</span>
          </button>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] font-medium text-[#9497a9] mr-1">
            Quick examples:
          </span>
          {QUICK_EXAMPLES.map((ex) => (
            <button
              key={ex.label}
              type="button"
              onClick={() => {
                setPrompt(ex.prompt);
                generateFrom(ex.prompt);
              }}
              className="px-3 py-1.5 text-[12px] font-medium text-[#686b82] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(133,91,251,0.16)] hover:text-[#7132f5] rounded-[10px] transition-colors cursor-pointer"
            >
              {ex.label}
            </button>
          ))}
        </div>

        {/* COVER IMAGE UPLOADER */}
        <div className="mt-5 pt-5 border-t border-[#dedee5]">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2.5">
            <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-[#101114]">
              <LuImage className="w-4 h-4 text-[#7132f5]" />
              <span>Market Cover Image (Optional)</span>
            </span>
            <button
              type="button"
              onClick={() => setShowUrlInput((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-[#7132f5] hover:underline cursor-pointer"
            >
              <LuLink2 className="w-3.5 h-3.5" />
              <span>{showUrlInput ? "Hide URL input" : "or paste https:// URL"}</span>
            </button>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDraggingImage(true);
            }}
            onDragLeave={() => setDraggingImage(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDraggingImage(false);
              handleFileSelected(e.dataTransfer.files?.[0]);
            }}
            className={`p-3.5 rounded-[12px] border border-dashed transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              draggingImage
                ? "border-[#7132f5] bg-[rgba(133,91,251,0.08)]"
                : "border-[#dedee5] bg-[rgba(148,151,169,0.05)]"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              onChange={(e) => {
                handleFileSelected(e.target.files?.[0]);
                e.currentTarget.value = "";
              }}
              className="hidden"
            />

            <div className="flex items-center gap-3.5 min-w-0">
              <img
                src={activeImageSrc}
                alt="Market cover preview"
                className="w-14 h-14 rounded-[12px] object-cover border border-[#dedee5] bg-white shrink-0"
              />
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-[#101114] truncate">
                  {hasCustomImage
                    ? "Custom cover image attached"
                    : `Auto category artwork (${category})`}
                </p>
                <p className="text-[12px] text-[#686b82]">
                  Drag &amp; drop PNG, JPG, WEBP, or GIF (max 5 MB) — committed inside SHA-256 spec.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={uploadingImage}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-[13px] font-semibold text-[#101114] bg-white border border-[#dedee5] hover:border-[#7132f5] hover:text-[#7132f5] disabled:opacity-60 rounded-[10px] transition-colors cursor-pointer"
              >
                <LuUpload className="w-3.5 h-3.5" />
                <span>
                  {uploadingImage
                    ? "Uploading..."
                    : hasCustomImage
                      ? "Change Image"
                      : "Upload Image"}
                </span>
              </button>

              {hasCustomImage && (
                <button
                  type="button"
                  onClick={handleRemoveCover}
                  aria-label="Remove cover image"
                  className="inline-flex items-center gap-1 px-2.5 py-2 text-[12px] font-semibold text-[#686b82] hover:text-[#dc2626] bg-white border border-[#dedee5] rounded-[10px] transition-colors cursor-pointer"
                >
                  <LuTrash2 className="w-3.5 h-3.5" />
                  <span>Remove</span>
                </button>
              )}
            </div>
          </div>

          {showUrlInput && (
            <div className="mt-2.5 flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                value={imageUrlInput}
                onChange={(e) => setImageUrlInput(e.target.value)}
                placeholder="https://example.com/market-cover.jpg"
                className="flex-1 h-[40px] px-3 text-[13px] text-[#101114] bg-white border border-[#dedee5] rounded-[10px] focus:outline-none focus:border-[#7132f5]"
              />
              <button
                type="button"
                disabled={uploadingImage}
                onClick={handleApplyManualUrl}
                className="px-3.5 py-2 text-[13px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[10px] cursor-pointer"
              >
                Apply URL
              </button>
            </div>
          )}
        </div>

        {draft && (
          <div className="mt-6 pt-6 border-t border-[#dedee5]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#7132f5]">
                  <LuCpu className="w-4 h-4" strokeWidth={2} />
                  Backend Contract Preview ({draft.model ?? "compiler"})
                </span>
                <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                  {category}
                </span>
                <span
                  className={
                    track === "auto_api"
                      ? "px-2.5 py-1 text-[12px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                      : "px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]"
                  }
                >
                  {track === "auto_api" ? "Track A · Auto-API" : "Track B · Nostr Oracle"}
                </span>
              </div>

              <button
                type="button"
                onClick={() => setDraft(null)}
                aria-label="Close preview"
                className="p-1.5 text-[#9497a9] hover:text-[#101114] rounded-[8px] hover:bg-[rgba(148,151,169,0.08)] transition-colors cursor-pointer"
              >
                <LuX className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              <div className="p-4 rounded-[12px] border border-[#dedee5] bg-white space-y-3">
                <div className="flex items-start gap-3">
                  <img
                    src={activeImageSrc}
                    alt="Draft market cover"
                    className="w-12 h-12 rounded-[10px] object-cover border border-[#dedee5] shrink-0"
                  />
                  <div>
                    <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9497a9] mb-1">
                      Standardized Question
                    </p>
                    <h3 className="text-[18px] font-semibold text-[#101114] leading-[1.3]">
                      {String(spec.question ?? "")}
                    </h3>
                  </div>
                </div>

                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9497a9] mb-1">
                    Unambiguous Resolution Rules
                  </p>
                  <p className="text-[14px] text-[#686b82] leading-[1.5]">
                    {String(spec.rules ?? "")}
                  </p>
                </div>

                <div className="pt-2 border-t border-[#dedee5] space-y-1.5 text-[13px] text-[#686b82]">
                  <div className="flex items-center gap-2">
                    <LuClock className="w-4 h-4 text-[#9497a9]" />
                    <span>
                      Deadline:{" "}
                      <strong className="text-[#101114] font-semibold">
                        {formatUtcDisplay(String(spec.deadline_utc ?? ""))}
                      </strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <LuShieldCheck className="w-4 h-4 text-[#149e61]" />
                    <span>
                      SHA-256:{" "}
                      <code className="text-[11px] font-mono text-[#101114]">
                        {draft.spec_sha256.slice(0, 18)}...
                      </code>
                    </span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[#9497a9] flex items-center gap-1.5">
                    <LuCodeXml className="w-3.5 h-3.5 text-[#5741d8]" />
                    Structured Oracle JSON
                  </span>
                  <span className="text-[11px] font-semibold text-[#5741d8]">
                    {track}
                  </span>
                </div>
                <pre className="flex-1 p-4 text-[12px] leading-[1.55] text-[#101114] bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px] overflow-x-auto font-mono">
                  {JSON.stringify(spec.oracle_config ?? {}, null, 2)}
                </pre>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-end gap-2.5">
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="px-4 py-2.5 text-[14px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(148,151,169,0.16)] rounded-[12px] transition-colors cursor-pointer"
              >
                Discard
              </button>
              <button
                type="button"
                disabled={publishing}
                onClick={handlePublish}
                className="inline-flex items-center gap-2 px-5 py-[13px] text-[15px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
              >
                <LuRadio className="w-4 h-4" strokeWidth={2} />
                <span>{publishing ? "Publishing..." : "Publish Market"}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 p-4 rounded-[12px] border border-[#dedee5] bg-[rgba(148,151,169,0.08)] flex items-start gap-3">
        <div className="w-8 h-8 shrink-0 rounded-[8px] bg-white border border-[#dedee5] flex items-center justify-center text-[#7132f5]">
          <LuLock className="w-4 h-4" strokeWidth={2} />
        </div>
        <div className="text-[13px] text-[#686b82] leading-[1.5]">
          <strong className="text-[#101114]">Why AI never touches your Sats:</strong> AI is strictly
          limited to drafting unambiguous contract parameters before a market opens. Final settlement
          is executed deterministically via public API responses (Track A) or cryptographic Nostr
          Oracle signatures (Track B).
        </div>
      </div>
    </section>
  );
}

interface OracleConsoleViewProps {
  markets: MarketItem[];
  onRefreshMarkets: () => void;
  onNotify: (title: string, subtitle: string) => void;
  onOpenMarket?: (marketSlugOrId: string) => void;
}

export function OracleConsoleView({
  markets,
  onRefreshMarkets,
  onNotify,
  onOpenMarket,
}: OracleConsoleViewProps) {
  const [queue, setQueue] = useState<OracleQueueEntry[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const items = await fetchOracleQueueFromBackend();
      setQueue(items);
    } catch {
      setQueue([]);
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchOracleQueueFromBackend()
      .then((items) => {
        if (active) setQueue(items);
      })
      .catch(() => {
        if (active) setQueue([]);
      })
      .finally(() => {
        if (active) setLoadingQueue(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const trackAMarkets = markets.filter((m) => m.oracleTrack === "auto_api");

  async function handleTrackACheck(marketId: string) {
    setBusyId(marketId);
    try {
      const res = await runBackendTrackAResolve(marketId);
      onRefreshMarkets();
      await loadQueue();
      onNotify(
        `Track A Attested: ${res.market.outcome ?? "SETTLED"}`,
        `Saved raw proof SHA-256 ${res.proof.bodySha256?.slice(0, 12) ?? ""}...`,
      );
    } catch (err) {
      onNotify(
        "Track A Check Failed",
        err instanceof Error ? err.message : "Resolution failed",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handlePropose(market: MarketItem, outcome: "YES" | "NO") {
    setBusyId(market.id);
    try {
      await submitBackendTrackBProposal(market, outcome);
      onRefreshMarkets();
      await loadQueue();
      onNotify(
        `Signed Kind 30079 Proposal (${outcome})`,
        "Proposal recorded in backend with active challenge window.",
      );
    } catch (err) {
      onNotify(
        "Proposal Rejected",
        err instanceof Error ? err.message : "Unable to submit proposal",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleFinalize(marketId: string) {
    setBusyId(marketId);
    try {
      await finalizeBackendTrackBProposal(marketId);
      onRefreshMarkets();
      await loadQueue();
      onNotify("Track B Finalized & Settled", "Winners paid out automatically.");
    } catch (err) {
      onNotify(
        "Finalization Failed",
        err instanceof Error ? err.message : "Unable to finalize",
      );
    } finally {
      setBusyId(null);
    }
  }

  async function handleDispute(entry: OracleQueueEntry) {
    const activeProposal = entry.proposals[0];
    const proposalEventId =
      (activeProposal?.nostrEvent as { id?: string } | undefined)?.id ??
      "0".repeat(64);
    setBusyId(entry.market.id);
    try {
      await submitBackendTrackBDispute(entry.market, proposalEventId);
      onRefreshMarkets();
      await loadQueue();
      onNotify(
        "Dispute Filed (Kind 30080)",
        "Proposal challenged and bonded dispute opened on backend.",
      );
    } catch (err) {
      onNotify(
        "Dispute Rejected",
        err instanceof Error ? err.message : "Unable to file dispute",
      );
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="max-w-[1280px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-8">
      <div className="border-b border-[#dedee5] pb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] text-[12px] font-semibold mb-2">
            <LuShieldCheck className="w-3.5 h-3.5" />
            <span>Dual-Track Oracle Worker &amp; Nostr Signer Console</span>
          </div>
          <h1 className="text-[30px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114]">
            Oracle Resolution Queue
          </h1>
          <p className="text-[15px] text-[#686b82] mt-1">
            Live queue from Elysia `/api/v1/oracle/queue` and `/api/v1/oracle/tick`.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="px-3.5 py-2 bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px] text-[13px] text-[#686b82]">
            Track A Markets: <strong className="text-[#101114]">{trackAMarkets.length}</strong>
          </div>
          <div className="px-3.5 py-2 bg-[rgba(148,151,169,0.08)] border border-[#dedee5] rounded-[12px] text-[13px] text-[#686b82]">
            Track B Queue: <strong className="text-[#101114]">{queue.length}</strong>
          </div>
        </div>
      </div>

      {/* Track B Optimistic Queue */}
      <div className="space-y-4">
        <h2 className="text-[20px] font-bold text-[#101114] flex items-center gap-2">
          <LuScale className="w-5 h-5 text-[#7132f5]" />
          <span>Track B · Nostr Optimistic Signer Queue</span>
        </h2>

        {loadingQueue ? (
          <p className="text-[14px] text-[#686b82]">Loading Track B queue from backend...</p>
        ) : queue.length === 0 ? (
          <p className="text-[14px] text-[#686b82]">No Track B markets currently in queue.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {queue.map((entry) => {
              const m = entry.market;
              const activeProp = entry.proposals.find((p) => p.status === "ACTIVE") ?? entry.proposals[0];
              const busy = busyId === m.id;
              return (
                <article
                  key={m.id}
                  className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col justify-between gap-4"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                        {m.category}
                      </span>
                      <span className="px-2.5 py-1 text-[11px] font-semibold bg-[rgba(133,91,251,0.16)] text-[#7132f5] rounded-[6px]">
                        {m.status}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => onOpenMarket?.(m.slug)}
                      className="text-left text-[17px] font-semibold text-[#101114] hover:text-[#7132f5] leading-[1.35] transition-colors cursor-pointer"
                    >
                      {m.question}
                    </button>

                    {entry.evidence && (
                      <div className="p-3 rounded-[10px] bg-[rgba(148,151,169,0.08)] border border-[#dedee5] text-[12px] text-[#686b82] space-y-1">
                        <p className="font-semibold text-[#101114]">
                          AI Evidence Brief ({entry.evidence.model} · non-binding):
                        </p>
                        <p>{entry.evidence.summary}</p>
                      </div>
                    )}

                    {activeProp && (
                      <div className="p-3 rounded-[10px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] text-[12px] space-y-1">
                        <p className="font-semibold">
                          Proposal: {activeProp.outcome} ({activeProp.status})
                        </p>
                        <p className="font-mono text-[11px] truncate">
                          Signer: {activeProp.signerPubkey}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[#dedee5]">
                    {m.status === "PROPOSED" ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleFinalize(m.id)}
                          className="px-3.5 py-2 text-[13px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] rounded-[12px] transition-colors cursor-pointer"
                        >
                          Finalize &amp; Settle (Demo)
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handleDispute(entry)}
                          className="px-3.5 py-2 text-[13px] font-semibold text-[#7132f5] bg-[rgba(133,91,251,0.16)] hover:bg-[#7132f5] hover:text-white rounded-[12px] transition-colors cursor-pointer"
                        >
                          Dispute (Kind 30080)
                        </button>
                      </>
                    ) : m.status === "DISPUTED" ? (
                      <span className="text-[13px] font-semibold text-[#5741d8]">
                        Disputed — awaiting admin ruling
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handlePropose(m, "YES")}
                          className="px-3.5 py-2 text-[13px] font-semibold text-[#026b3f] bg-[rgba(20,158,97,0.16)] hover:bg-[#149e61] hover:text-white rounded-[12px] transition-colors cursor-pointer"
                        >
                          Propose YES (Kind 30079)
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => handlePropose(m, "NO")}
                          className="px-3.5 py-2 text-[13px] font-semibold text-[#101114] bg-[rgba(148,151,169,0.08)] hover:bg-[rgba(133,91,251,0.16)] hover:text-[#7132f5] rounded-[12px] transition-colors cursor-pointer"
                        >
                          Propose NO (Kind 30079)
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* Track A Auto-API Markets */}
      <div className="space-y-4">
        <h2 className="text-[20px] font-bold text-[#101114] flex items-center gap-2">
          <LuShieldCheck className="w-5 h-5 text-[#149e61]" />
          <span>Track A · Deterministic Auto-API Proof Worker</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {trackAMarkets.map((m) => (
            <article
              key={m.id}
              className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 flex flex-col justify-between gap-4"
            >
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="px-2.5 py-1 text-[12px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]">
                    {String((m.oracleConfig as { provider?: string }).provider ?? "auto_api")}
                  </span>
                  <span className="text-[12px] font-semibold text-[#686b82]">
                    {m.status} {m.outcome ? `· ${m.outcome}` : ""}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => onOpenMarket?.(m.slug)}
                  className="text-left text-[16px] font-semibold text-[#101114] hover:text-[#7132f5] transition-colors cursor-pointer"
                >
                  {m.question}
                </button>
                <p className="text-[12px] text-[#686b82]">{m.rules}</p>
              </div>

              <div className="pt-3 border-t border-[#dedee5] flex items-center justify-between">
                <span className="text-[12px] text-[#9497a9]">{m.deadline}</span>
                <button
                  type="button"
                  disabled={m.status === "SETTLED" || m.status === "RESOLVED" || busyId === m.id}
                  onClick={() => handleTrackACheck(m.id)}
                  className="px-3.5 py-2 text-[13px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:bg-[rgba(148,151,169,0.3)] rounded-[12px] transition-colors cursor-pointer"
                >
                  {m.status === "SETTLED" || m.status === "RESOLVED"
                    ? `Resolved (${m.outcome})`
                    : busyId === m.id
                      ? "Resolving..."
                      : "Run Auto-API Check"}
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

interface PositionsViewProps {
  user: BackendUserProfile | null;
  positions: UserPositionItem[];
  payouts: UserPayoutItem[];
  onConnectNwc: () => void;
  onSaveLightningAddress: (addr: string) => Promise<void>;
  onClaimPayout: (payoutId: string) => Promise<void>;
  onInspectMarket: (marketId: string) => void;
}

export function PositionsView({
  user,
  positions,
  payouts,
  onConnectNwc,
  onSaveLightningAddress,
  onClaimPayout,
  onInspectMarket,
}: PositionsViewProps) {
  const [draftAddr, setDraftAddr] = useState<{
    pubkey: string | null;
    value: string;
  } | null>(null);
  const [savingAddr, setSavingAddr] = useState(false);

  const currentPubkey = user?.pubkey ?? null;
  const addrInput =
    draftAddr && draftAddr.pubkey === currentPubkey
      ? draftAddr.value
      : (user?.lightning_address ?? "");

  async function handleSave() {
    setSavingAddr(true);
    try {
      await onSaveLightningAddress(addrInput);
      setDraftAddr(null);
    } finally {
      setSavingAddr(false);
    }
  }

  return (
    <section className="max-w-[960px] mx-auto px-4 sm:px-6 lg:px-8 py-8 sm:py-10 space-y-6">
      <div className="border-b border-[#dedee5] pb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-[30px] font-bold tracking-[-0.5px] text-[#101114]">
            My Positions &amp; Payouts
          </h1>
          <p className="text-[14px] text-[#686b82] mt-1">
            Live bets, LUD-16 Lightning payout destination, and winnings stored in backend DB.
          </p>
        </div>

        {!user ? (
          <button
            type="button"
            onClick={onConnectNwc}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] cursor-pointer"
          >
            <LuZap className="w-4 h-4" />
            <span>Sign In with Nostr</span>
          </button>
        ) : (
          <div className="px-4 py-2 rounded-[12px] bg-[rgba(20,158,97,0.16)] text-[#026b3f] text-[13px] font-semibold font-mono">
            {user.npub.slice(0, 14)}...{user.npub.slice(-6)}
          </div>
        )}
      </div>

      {/* LUD-16 Payout Address Settings */}
      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[16px] font-semibold text-[#101114]">
            Payout Destination (LUD-16 Lightning Address)
          </h2>
          {user && (
            <span className="text-[12px] text-[#686b82]">
              {user.is_guest ? "Guest Nostr Keypair" : "NIP-07 Authenticated"}
            </span>
          )}
        </div>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            type="email"
            value={addrInput}
            onChange={(e) =>
              setDraftAddr({ pubkey: currentPubkey, value: e.target.value })
            }
            placeholder="you@getalby.com"
            className="flex-1 h-[44px] px-3.5 text-[14px] text-[#101114] bg-white border border-[#dedee5] rounded-[12px] focus:outline-none focus:border-[#7132f5]"
          />
          <button
            type="button"
            disabled={savingAddr}
            onClick={handleSave}
            className="px-4 py-2.5 text-[14px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
          >
            {savingAddr ? "Saving..." : "Save Payout Address"}
          </button>
        </div>
      </div>

      {/* Payouts */}
      {payouts.length > 0 && (
        <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
          <div className="px-5 py-4 border-b border-[#dedee5]">
            <h2 className="text-[16px] font-semibold text-[#101114]">
              Payouts &amp; Claims ({payouts.length})
            </h2>
          </div>
          <div className="divide-y divide-[#dedee5]">
            {payouts.map((pay) => (
              <div
                key={pay.id}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]">
                      {pay.kind}
                    </span>
                    <span className="text-[14px] font-bold text-[#101114]">
                      {formatSats(pay.amount_sats)} sats
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onInspectMarket(pay.market.slug || pay.marketId)}
                    className="text-left text-[15px] font-semibold text-[#101114] hover:text-[#7132f5] cursor-pointer"
                  >
                    {pay.market.title}
                  </button>
                  {pay.preimage && (
                    <p className="text-[11px] text-[#686b82] font-mono break-all">
                      Preimage: {pay.preimage}
                    </p>
                  )}
                </div>

                <div>
                  {pay.status === "CLAIMABLE" || pay.status === "FAILED" ? (
                    <button
                      type="button"
                      onClick={() => onClaimPayout(pay.id)}
                      className="px-4 py-2 text-[13px] font-semibold text-white bg-[#149e61] hover:bg-[#026b3f] rounded-[12px] cursor-pointer"
                    >
                      Claim {formatSats(pay.amount_sats)} sats
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                      {pay.status}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Positions List */}
      <div className="bg-white border border-[#dedee5] rounded-[16px] shadow-whisper overflow-hidden">
        <div className="px-5 py-4 border-b border-[#dedee5]">
          <h2 className="text-[16px] font-semibold text-[#101114]">
            Bets Placed ({positions.length})
          </h2>
        </div>

        {positions.length === 0 ? (
          <div className="p-8 text-center text-[14px] text-[#686b82]">
            {user
              ? "No bets placed yet with this Nostr keypair. Place YES/NO wagers on any OPEN market."
              : "Connect NWC / Sign In with Nostr to view and manage your backend positions."}
          </div>
        ) : (
          <div className="divide-y divide-[#dedee5]">
            {positions.map((pos) => (
              <div
                key={pos.bet_id}
                className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-[rgba(148,151,169,0.04)]"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={
                        pos.side === "YES"
                          ? "px-2 py-0.5 text-[11px] font-semibold bg-[rgba(20,158,97,0.16)] text-[#026b3f] rounded-[6px]"
                          : "px-2 py-0.5 text-[11px] font-semibold bg-[rgba(133,91,251,0.16)] text-[#7132f5] rounded-[6px]"
                      }
                    >
                      {pos.side}
                    </span>
                    <span className="text-[12px] font-semibold text-[#101114]">
                      {formatSats(pos.amount_sats)} sats
                    </span>
                    <span className="text-[12px] text-[#9497a9]">· {pos.created_at}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onInspectMarket(pos.market.slug || pos.market.id)}
                    className="text-left text-[15px] font-semibold text-[#101114] hover:text-[#7132f5] transition-colors cursor-pointer"
                  >
                    {pos.market.title}
                  </button>
                </div>

                <div className="flex items-center gap-2.5 shrink-0">
                  {pos.estimated_payout_sats != null && (
                    <span className="text-[12px] font-semibold text-[#026b3f]">
                      Est. {formatSats(pos.estimated_payout_sats)} sats
                    </span>
                  )}
                  <span className="px-3 py-1.5 text-[12px] font-semibold bg-[rgba(104,107,130,0.12)] text-[#484b5e] rounded-[8px]">
                    {pos.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

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

export function HowItWorksView({ onSwitchView }: { onSwitchView: (v: AppView) => void }) {
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
            <button
              type="button"
              onClick={() => onSwitchView("markets")}
              className="inline-flex items-center gap-2 px-5 py-[13px] text-[16px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
            >
              <LuChartColumn className="w-4 h-4" strokeWidth={2} />
              <span>Explore Live Markets</span>
            </button>

            <button
              type="button"
              onClick={() => onSwitchView("creator")}
              className="inline-flex items-center gap-2 px-5 py-[13px] text-[16px] font-semibold text-[#5741d8] bg-white border border-[#5741d8] hover:bg-[rgba(133,91,251,0.08)] rounded-[12px] transition-colors cursor-pointer"
            >
              <LuSparkles className="w-4 h-4" strokeWidth={2} />
              <span>Create with AI</span>
            </button>
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
              deterministic API JSON parameters or Nostr rules.
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
              Connect NWC and wager Sats directly on YES or NO pools without custodial balances.
              Live odds update transparently with every bet.
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
              Winning pool shares are calculated automatically and streamed back to winners&apos;
              Lightning Addresses or NWC wallets in seconds.
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
