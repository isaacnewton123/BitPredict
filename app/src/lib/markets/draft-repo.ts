import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import type { CompileMarketResult } from "@/lib/ai/compiler";
import { validateFullMarketSpec } from "@/lib/ai/validate-spec";
import * as schema from "@/lib/db/schema";

type ValidCompileResult = Extract<CompileMarketResult, { ok: true }>;

function makeSlug(title: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = randomBytes(3).toString("hex");
  return `${base || "market"}-${suffix}`;
}

export interface DraftDto {
  draft_id: string;
  slug: string;
  spec: ValidCompileResult["spec"];
  spec_sha256: string;
  audit_url: string | null;
  assumptions: string[];
  warnings: string[];
  model?: string;
}

export async function recordRejectedAiRun(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    prompt: string;
    timezone?: string;
    compiled: Extract<CompileMarketResult, { ok: false }>;
  },
): Promise<void> {
  await db.insert(schema.aiRuns).values({
    purpose: "market_spec",
    marketId: null,
    model: opts.compiled.model,
    promptSha256: opts.compiled.promptSha256,
    input: { prompt: opts.prompt, timezone: opts.timezone ?? "UTC" },
    output: { errors: opts.compiled.errors },
    valid: false,
    latencyMs: opts.compiled.latencyMs,
  });
}

export async function createMarketDraft(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    creatorPubkey: string;
    prompt: string;
    timezone?: string;
    isDemo?: boolean;
    compiled: ValidCompileResult;
  },
): Promise<DraftDto> {
  const { compiled } = opts;
  const spec = compiled.spec;
  const draftId = crypto.randomUUID();
  const slug = makeSlug(spec.title);

  await db.transaction(async (tx) => {
    await tx.insert(schema.markets).values({
      id: draftId,
      slug,
      creatorPubkey: opts.creatorPubkey.toLowerCase(),
      status: "DRAFT",
      category: spec.category,
      track: spec.resolution_track,
      title: spec.title,
      spec,
      specSha256: compiled.specSha256,
      bettingCutoff: new Date(spec.betting_cutoff_utc),
      deadlineUtc: new Date(spec.deadline_utc),
      resolveAfter: new Date(spec.resolve_after_utc),
      isDemo: Boolean(opts.isDemo),
    });

    await tx.insert(schema.aiRuns).values({
      purpose: "market_spec",
      marketId: draftId,
      model: compiled.model,
      promptSha256: compiled.promptSha256,
      input: { prompt: opts.prompt, timezone: opts.timezone ?? "UTC" },
      output: spec,
      valid: true,
      latencyMs: compiled.latencyMs,
    });
  });

  return {
    draft_id: draftId,
    slug,
    spec,
    spec_sha256: compiled.specSha256,
    audit_url: compiled.auditUrl,
    assumptions: spec.assumptions,
    warnings: compiled.warnings,
    model: compiled.model,
  };
}

export type UpdateDraftResult =
  | ({ ok: true } & DraftDto)
  | { ok: false; status: 404 | 403 | 409 | 422; code: string; message: string; errors?: string[] };

export async function updateMarketDraft(
  db: LibSQLDatabase<typeof schema>,
  opts: {
    draftId: string;
    creatorPubkey: string;
    rawSpec: unknown;
    now?: Date;
  },
): Promise<UpdateDraftResult> {
  const rows = await db
    .select()
    .from(schema.markets)
    .where(eq(schema.markets.id, opts.draftId))
    .limit(1);

  const existing = rows[0];
  if (!existing) {
    return { ok: false, status: 404, code: "NOT_FOUND", message: "Draft not found" };
  }
  if (existing.creatorPubkey !== opts.creatorPubkey.toLowerCase()) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "Only the creator can edit this draft" };
  }
  if (existing.status !== "DRAFT") {
    return { ok: false, status: 409, code: "MARKET_NOT_DRAFT", message: "Published markets cannot be edited" };
  }

  const validated = validateFullMarketSpec(opts.rawSpec, { now: opts.now });
  if (!validated.ok) {
    return {
      ok: false,
      status: 422,
      code: "VALIDATION_FAILED",
      message: validated.errors[0] ?? "Validation failed",
      errors: validated.errors,
    };
  }

  const spec = validated.spec;
  await db
    .update(schema.markets)
    .set({
      category: spec.category,
      track: spec.resolution_track,
      title: spec.title,
      spec,
      specSha256: validated.specSha256,
      bettingCutoff: new Date(spec.betting_cutoff_utc),
      deadlineUtc: new Date(spec.deadline_utc),
      resolveAfter: new Date(spec.resolve_after_utc),
    })
    .where(eq(schema.markets.id, existing.id));

  return {
    ok: true,
    draft_id: existing.id,
    slug: existing.slug,
    spec,
    spec_sha256: validated.specSha256,
    audit_url: validated.auditUrl,
    assumptions: spec.assumptions,
    warnings: validated.warnings,
  };
}
