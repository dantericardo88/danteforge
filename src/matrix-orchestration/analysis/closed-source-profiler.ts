// Matrix Orchestration — Closed-Source Profiler (PRD §5.2)
//
// THIN WRAPPER for v1. For each `category === 'closed_source'` entry in the
// CompetitiveUniverse, builds a `ClosedSourceProfile` populated from documentation
// at `homeUrl` (via the injected `_fetchDocs` seam) plus optional LLM inference.
//
// CONSTITUTION RULE (PRD §5.2):
//   Closed-source claims MUST be marked `claimType: 'inferred'`.
//   Only mark `claimType: 'documented'` when the evidence URL is the official
//   docs URL we actually fetched.
//
// All inputs flow in; nothing reads from disk other than `loadOrch`/`saveOrch`.
// Three-mode pattern (LLM/prompt/local) mirrors `src/cli/commands/harvest.ts`.

import type {
  ClosedSourceClaim,
  ClosedSourceProfile,
  ClosedSourceProfileReport,
  CompetitiveUniverse,
  UniverseEntry,
} from '../types.js';
import { saveOrch, appendAudit } from '../state-io.js';

// ── Options ─────────────────────────────────────────────────────────────────

export interface ClosedSourceProfilerOptions {
  cwd: string;
  mode?: 'llm' | 'prompt' | 'local';
  /** Optional run id for audit log. */
  runId?: string;
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  /** Returns the fetched body for a docs URL, or null on failure. */
  _fetchDocs?: (url: string) => Promise<string | null>;
  /** ISO timestamp seam for deterministic tests. */
  _now?: () => string;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Profile every closed-source entry in the given universe. Persists the
 * resulting report and returns it.
 */
export async function profileClosedSource(
  universe: CompetitiveUniverse,
  options: ClosedSourceProfilerOptions,
): Promise<ClosedSourceProfileReport> {
  const now = options._now ?? (() => new Date().toISOString());
  const closedSource = (universe.entries ?? []).filter(
    (e) => e.category === 'closed_source',
  );

  if (closedSource.length === 0) {
    const empty: ClosedSourceProfileReport = {
      generatedAt: now(),
      profiles: [],
    };
    await saveOrch(options.cwd, 'closedSourceProfiles', empty);
    await safeAudit(options, 'empty-universe', { totalEntries: universe.entries.length });
    return empty;
  }

  const mode = options.mode ?? 'llm';
  const llmAvailable = options._isLLMAvailable
    ? await options._isLLMAvailable()
    : false;

  const profiles: ClosedSourceProfile[] = [];
  for (const entry of closedSource) {
    const profile = await profileEntry(entry, {
      now: now(),
      mode,
      llmAvailable,
      llmCaller: options._llmCaller,
      fetchDocs: options._fetchDocs,
    });
    profiles.push(profile);
  }

  const report: ClosedSourceProfileReport = {
    generatedAt: now(),
    profiles,
  };

  await saveOrch(options.cwd, 'closedSourceProfiles', report);
  await safeAudit(options, 'profiled', {
    count: profiles.length,
    mode,
    llmAvailable,
  });

  return report;
}

// ── Per-entry profiling ─────────────────────────────────────────────────────

interface PerEntryContext {
  now: string;
  mode: 'llm' | 'prompt' | 'local';
  llmAvailable: boolean;
  llmCaller?: (prompt: string) => Promise<string>;
  fetchDocs?: (url: string) => Promise<string | null>;
}

async function profileEntry(
  entry: UniverseEntry,
  ctx: PerEntryContext,
): Promise<ClosedSourceProfile> {
  const docsBody = await tryFetchDocs(entry, ctx);
  const docsUrl = entry.homeUrl;

  // If docs were fetched and LLM is available, ask the LLM for structured
  // feature inventory + architectural inferences. Otherwise return empty arrays
  // with a "no evidence available" architectural note.
  let raw: string | null = null;
  if (ctx.mode !== 'local' && ctx.llmAvailable && ctx.llmCaller && docsBody) {
    raw = await safeLLM(ctx.llmCaller, buildProfilePrompt(entry, docsBody));
  }

  const parsed = raw ? safeParse(raw) : null;
  const inventory = (parsed?.featureInventory ?? []).map((text) =>
    buildClaim(text, docsUrl, entry, /*hasDocs*/ Boolean(docsBody)),
  );
  const inferences = (parsed?.architecturalInferences ?? []).map((text) =>
    buildClaim(text, docsUrl, entry, /*hasDocs*/ Boolean(docsBody)),
  );
  const strengths = (parsed?.reportedStrengths ?? []).map((text) =>
    buildClaim(text, docsUrl, entry, /*hasDocs*/ Boolean(docsBody)),
  );
  const weaknesses = (parsed?.reportedWeaknesses ?? []).map((text) =>
    buildClaim(text, docsUrl, entry, /*hasDocs*/ Boolean(docsBody)),
  );

  // If we ended up with nothing concrete, insert one synthetic note so the
  // report makes the gap obvious to downstream stages.
  if (
    inventory.length === 0 &&
    inferences.length === 0 &&
    strengths.length === 0 &&
    weaknesses.length === 0
  ) {
    inferences.push({
      text: docsBody
        ? `Docs fetched but no structured claims extracted (mode=${ctx.mode}, llm=${ctx.llmAvailable}).`
        : `No documentation available; profile is a placeholder.`,
      confidence: 0.1,
      claimType: 'inferred',
    });
  }

  const profile: ClosedSourceProfile = {
    competitorId: entry.id,
    competitorName: entry.name,
    featureInventory: inventory,
    architecturalInferences: inferences,
    reportedStrengths: strengths,
    reportedWeaknesses: weaknesses,
    ...(parsed?.pricingContext ? { pricingContext: parsed.pricingContext } : {}),
    generatedAt: ctx.now,
  };

  return profile;
}

// ── Claim construction enforces the constitution rule ─────────────────────────

function buildClaim(
  text: string,
  docsUrl: string | undefined,
  entry: UniverseEntry,
  hasDocs: boolean,
): ClosedSourceClaim {
  // Constitution rule: closed-source claims default to 'inferred'.
  // We only mark a claim as 'documented' when we actually fetched docs
  // AND the URL is the official homeUrl (PRD §5.2).
  const claimType: ClosedSourceClaim['claimType'] =
    hasDocs && docsUrl && docsUrl === entry.homeUrl ? 'documented' : 'inferred';

  return {
    text,
    ...(docsUrl ? { evidenceUrl: docsUrl } : {}),
    confidence: hasDocs ? 0.6 : 0.3,
    claimType,
  };
}

// ── Prompt construction ─────────────────────────────────────────────────────

function buildProfilePrompt(entry: UniverseEntry, docsBody: string): string {
  // Truncate docs to keep token cost bounded.
  const truncated =
    docsBody.length > 8000 ? `${docsBody.slice(0, 8000)}\n\n[truncated]` : docsBody;
  return `You are profiling a closed-source competitor for the DanteForge orchestration matrix.

Competitor: ${entry.name}
Category: ${entry.category}
Home URL: ${entry.homeUrl ?? 'unknown'}

Documentation excerpt:
"""
${truncated}
"""

Constitution rule: every claim about a closed-source product is INFERRED
(not verified) — we have not read its source.

Return STRICT JSON with this shape (no markdown fences):
{
  "featureInventory":         [ "short feature description", ... ],
  "architecturalInferences":  [ "short architectural inference", ... ],
  "reportedStrengths":        [ "praise from users or docs", ... ],
  "reportedWeaknesses":       [ "complaint or limitation", ... ],
  "pricingContext":           "optional one-line pricing summary"
}

Rules:
- Keep each item to one sentence under 200 characters.
- Do not invent capabilities not supported by the documentation excerpt.
- If a section has no evidence, return an empty array.
`;
}

// ── Safe wrappers ───────────────────────────────────────────────────────────

async function tryFetchDocs(
  entry: UniverseEntry,
  ctx: PerEntryContext,
): Promise<string | null> {
  if (!entry.homeUrl || !ctx.fetchDocs) return null;
  try {
    return await ctx.fetchDocs(entry.homeUrl);
  } catch {
    return null;
  }
}

async function safeLLM(
  caller: (prompt: string) => Promise<string>,
  prompt: string,
): Promise<string | null> {
  try {
    return await caller(prompt);
  } catch {
    return null;
  }
}

interface ParsedProfile {
  featureInventory?: string[];
  architecturalInferences?: string[];
  reportedStrengths?: string[];
  reportedWeaknesses?: string[];
  pricingContext?: string;
}

function safeParse(raw: string): ParsedProfile | null {
  // Strip code fences if present.
  const body = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    return {
      featureInventory: stringArray(obj.featureInventory),
      architecturalInferences: stringArray(obj.architecturalInferences),
      reportedStrengths: stringArray(obj.reportedStrengths),
      reportedWeaknesses: stringArray(obj.reportedWeaknesses),
      pricingContext:
        typeof obj.pricingContext === 'string' ? obj.pricingContext : undefined,
    };
  } catch {
    return null;
  }
}

function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.trim().length > 0) out.push(item);
  }
  return out;
}

async function safeAudit(
  options: ClosedSourceProfilerOptions,
  outcome: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await appendAudit(options.cwd, {
      ts: options._now ? options._now() : new Date().toISOString(),
      runId: options.runId ?? 'closed-source-profiler',
      kind: 'stage_completed',
      stage: 'analyzing_competitors',
      payload: { component: 'closed-source-profiler', outcome, ...payload },
    });
  } catch {
    /* best-effort */
  }
}
