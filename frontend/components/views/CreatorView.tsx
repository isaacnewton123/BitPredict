"use client";

import { useState } from "react";
import {
  LuClock,
  LuCpu,
  LuLock,
  LuRadio,
  LuShieldCheck,
  LuSparkles,
  LuWandSparkles,
  LuX,
} from "react-icons/lu";
import { ConfirmActionModal } from "@/components/shared/ConfirmActionModal";
import { MarketCover } from "@/components/shared/MarketCover";
import { OracleSpecSummary } from "@/components/shared/OracleSpecSummary";
import {
  type BackendUserProfile,
  createBackendMarketDraft,
  type DraftResponse,
  formatUtcDisplay,
  type MarketItem,
  publishBackendMarketDraft,
  resolveMarketImageUrl,
  updateBackendMarketDraftSpec,
} from "@/lib/bitpredict-data";
import { CoverImageUploader } from "./CoverImageUploader";

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
  user: BackendUserProfile | null;
  onOpenConnectModal: () => void;
  onPublished: (market: MarketItem) => void;
  onNotify: (title: string, subtitle: string) => void;
}

export function CreatorView({
  user,
  onOpenConnectModal,
  onPublished,
  onNotify,
}: CreatorViewProps) {
  const [prompt, setPrompt] = useState("");
  const [compiling, setCompiling] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [confirmPublishOpen, setConfirmPublishOpen] = useState(false);
  const [draft, setDraft] = useState<DraftResponse | null>(null);
  const [coverImageUrl, setCoverImageUrl] = useState<string | null>(null);

  async function syncCoverUrl(nextUrl: string | null) {
    setCoverImageUrl(nextUrl);
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

  async function generateFrom(text: string) {
    if (!user) {
      onOpenConnectModal();
      onNotify(
        "Connect an Account First",
        "Choose Live Nostr or Use Demo Account before generating a market.",
      );
      return;
    }
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
        err instanceof Error ? err.message : "Unable to reach the market service. Please try again.",
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
      setConfirmPublishOpen(false);
      setDraft(null);
      setPrompt("");
      setCoverImageUrl(null);
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
    imageUrl: typeof spec.image_url === "string" ? spec.image_url : coverImageUrl,
  });
  const hasCustomImage = Boolean(
    (typeof spec.image_url === "string" && spec.image_url) || coverImageUrl,
  );

  return (
    <section className="max-w-[960px] mx-auto px-4 sm:px-6 lg:px-8 py-10 sm:py-12">
      <div className="mb-8">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] bg-[rgba(133,91,251,0.16)] text-[#7132f5] text-[12px] font-semibold">
            <LuSparkles className="w-3.5 h-3.5" strokeWidth={2} />
            <span>AI Prompt-to-Oracle Studio</span>
          </div>
          {user && (
            <span
              className={`px-2.5 py-1 rounded-[6px] text-[12px] font-semibold ${
                user.is_guest
                  ? "bg-[rgba(133,91,251,0.12)] text-[#5741d8]"
                  : "bg-[rgba(20,158,97,0.14)] text-[#026b3f]"
              }`}
            >
              {user.is_guest ? "Publishing to Demo Sandbox" : "Publishing as Live Market"}
            </span>
          )}
        </div>
        <h1 className="text-[32px] sm:text-[36px] font-bold leading-[1.22] tracking-[-0.5px] text-[#101114] mb-2">
          Create a Prediction Market in One Sentence
        </h1>
        <p className="text-[16px] text-[#686b82] leading-[1.45] max-w-[700px]">
          Type any real-world question. Our AI contract engine locks exact locations, UTC deadlines,
          and a deterministic data-feed rulebook or community oracle specification.
        </p>
      </div>

      {!user && (
        <div className="mb-5 p-4 rounded-[14px] border border-[rgba(113,50,245,0.28)] bg-[rgba(133,91,251,0.06)] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-[14px] font-bold text-[#101114]">
              Connect Live Nostr or Demo Account
            </p>
            <p className="text-[12px] text-[#686b82] mt-0.5">
              Demo accounts publish safely to the isolated Demo Sandbox without real sats; Live Nostr accounts publish live markets.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenConnectModal}
            className="shrink-0 px-4 py-2 text-[13px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] rounded-[12px] transition-colors cursor-pointer"
          >
            Connect Account
          </button>
        </div>
      )}

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

        <CoverImageUploader
          category={category}
          previewSrc={activeImageSrc}
          hasCustomImage={hasCustomImage}
          onImageUrlChanged={syncCoverUrl}
          onNotify={onNotify}
        />

        {draft && (
          <div className="mt-6 pt-6 border-t border-[#dedee5]">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[0.04em] text-[#7132f5]">
                  <LuCpu className="w-4 h-4" strokeWidth={2} />
                  Structured Contract Preview
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
                  <MarketCover
                    imageUrl={activeImageSrc}
                    category={category}
                    alt="Draft market cover"
                    size="md"
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
                    <LuShieldCheck className="w-3.5 h-3.5 text-[#5741d8]" />
                    Verification Contract
                  </span>
                  <span className="text-[11px] font-semibold text-[#5741d8]">
                    {track === "auto_api" ? "Automated Data Feed" : "Community Oracle"}
                  </span>
                </div>
                <OracleSpecSummary
                  oracleConfig={
                    (spec.oracle_config as Record<string, unknown> | undefined) ?? {}
                  }
                  oracleTrack={track}
                />
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
                onClick={() => setConfirmPublishOpen(true)}
                className="inline-flex items-center gap-2 px-5 py-[13px] text-[15px] font-semibold text-white bg-[#7132f5] hover:bg-[#5b1ecf] disabled:opacity-60 rounded-[12px] transition-colors cursor-pointer"
              >
                <LuRadio className="w-4 h-4" strokeWidth={2} />
                <span>{publishing ? "Publishing..." : "Publish Market"}</span>
              </button>
            </div>
          </div>
        )}
      </div>

      <ConfirmActionModal
        open={confirmPublishOpen && draft !== null}
        title="Publish Prediction Market"
        description="Publishing makes this market live for Lightning trading with locked contract rules."
        details={[
          { label: "Question", value: String(spec.question ?? "") },
          { label: "Category", value: category },
          {
            label: "Resolution Track",
            value: track === "auto_api" ? "Automated Data Feed" : "Community Oracle",
          },
          {
            label: "Event Deadline",
            value: formatUtcDisplay(String(spec.deadline_utc ?? "")),
          },
        ]}
        warning="Once published, market rules, oracle parameters, and UTC deadlines cannot be edited."
        confirmLabel="Publish Market Live"
        tone="primary"
        busy={publishing}
        onConfirm={handlePublish}
        onCancel={() => setConfirmPublishOpen(false)}
      />

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
