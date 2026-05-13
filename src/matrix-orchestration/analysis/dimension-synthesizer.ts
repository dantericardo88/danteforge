// Matrix Orchestration — Dimension Synthesizer (PRD §5.4)
//
// Synthesizes ~50 dimensions of excellence for the project, spanning ~8
// categories. Two-stage to keep token cost bounded (plan risk #2):
//   Stage 1 (per_category):   ~6-8 dimension proposals per category
//   Stage 2 (consolidation):  dedupe, normalize, pick top-N by importance
//
// Local-mode fallback loads `src/core/compete-matrix.ts::loadMatrix(cwd)` and
// augments to the target count with placeholders.

import type {
  ClosedSourceProfileReport,
  CompetitiveUniverse,
  OrchestrationDimension,
  OrchestrationDimensionMatrix,
  ProjectIntent,
  SocialSignalReport,
} from '../types.js';
import { saveOrch, appendAudit } from '../state-io.js';
import { loadMatrix } from '../../core/compete-matrix.js';
import type { MatrixDimension } from '../../core/compete-matrix.js';
import { synthesizeDimensions as kernelSynthesize } from '../../matrix/engines/dimension-synthesizer.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface DimensionSynthesisArgs {
  intent: ProjectIntent;
  universe: CompetitiveUniverse;
  signal?: SocialSignalReport;
  profiles?: ClosedSourceProfileReport;
}

export interface DimensionSynthesisOptions {
  cwd: string;
  mode?: 'llm' | 'prompt' | 'local';
  runId?: string;
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _now?: () => string;
  /** Two-stage synthesis (default 'both'). */
  stage?: 'per_category' | 'consolidation' | 'both';
  /** Target ~50 dimensions across ~8 categories. */
  targetDimensionCount?: number;
  targetCategoryCount?: number;
}

export interface DimensionValidationResult {
  ok: boolean;
  matrix?: OrchestrationDimensionMatrix;
  errors: string[];
}

// ── Public API ──────────────────────────────────────────────────────────────

export async function synthesizeOrchestrationDimensions(
  args: DimensionSynthesisArgs,
  options: DimensionSynthesisOptions,
): Promise<OrchestrationDimensionMatrix> {
  const now = options._now ?? (() => new Date().toISOString());
  const mode = options.mode ?? 'llm';
  const stage = options.stage ?? 'both';
  const targetDimensionCount = options.targetDimensionCount ?? 50;
  const targetCategoryCount = options.targetCategoryCount ?? 8;

  const categories = buildCategoryList(args, targetCategoryCount);

  const llmAvailable = options._isLLMAvailable
    ? await options._isLLMAvailable()
    : false;

  let proposals: ProposedDimension[] = [];

  if (mode !== 'local' && llmAvailable && options._llmCaller) {
    if (stage === 'per_category' || stage === 'both') {
      for (const cat of categories) {
        const raw = await safeLLM(
          options._llmCaller,
          buildPerCategoryPrompt(args, cat, targetDimensionCount, targetCategoryCount),
        );
        proposals.push(...parseProposals(raw, cat));
      }
    }
    if (stage === 'consolidation' || stage === 'both') {
      // Consolidation: prompt the LLM once with all proposals (capped) for
      // dedupe / normalize. If consolidation fails, fall back to local.
      const consolidatedRaw = await safeLLM(
        options._llmCaller,
        buildConsolidationPrompt(proposals, targetDimensionCount),
      );
      const consolidated = parseProposals(consolidatedRaw, null);
      if (consolidated.length > 0) proposals = consolidated;
    }
  }

  // Fallback path: load any existing compete-matrix or kernel synthesizer.
  if (proposals.length === 0) {
    proposals = await localFallback(options.cwd, categories);
  }

  // Final shaping: cap to targetDimensionCount, ensure category coverage,
  // back-fill with placeholders so the floor count is met.
  const dimensions = shapeDimensions(
    proposals,
    args,
    categories,
    targetDimensionCount,
  );

  const matrix: OrchestrationDimensionMatrix = {
    generatedAt: now(),
    projectName: args.intent.projectName,
    dimensions,
    overallCurrentScore: 0, // current-state-scorer fills in
    overallOssFrontierScore: weightedAverage(dimensions, 'ossFrontierScore'),
    overallClosedFrontierScore: weightedAverage(dimensions, 'closedFrontierScore'),
    approvedByUser: false,
  };

  await saveOrch(options.cwd, 'dimensionMatrix', matrix);
  await safeAudit(options, {
    component: 'dimension-synthesizer',
    dimensionCount: dimensions.length,
    categories: categories.length,
    mode,
    llmAvailable,
  });

  return matrix;
}

// ── Validation ──────────────────────────────────────────────────────────────

export function validateDimensionMatrix(
  candidate: unknown,
): DimensionValidationResult {
  const errors: string[] = [];
  if (typeof candidate !== 'object' || candidate === null) {
    return { ok: false, errors: ['matrix is not an object'] };
  }
  const obj = candidate as Record<string, unknown>;
  if (!Array.isArray(obj.dimensions)) {
    return { ok: false, errors: ['dimensions field is missing or not an array'] };
  }
  const dims = obj.dimensions as unknown[];
  if (dims.length < 5) {
    errors.push(`dimensions.length=${dims.length} below sanity floor (5)`);
  }
  let weightSum = 0;
  dims.forEach((d, idx) => {
    if (typeof d !== 'object' || d === null) {
      errors.push(`dimension[${idx}] is not an object`);
      return;
    }
    const dd = d as Record<string, unknown>;
    if (typeof dd.name !== 'string' || dd.name.length === 0) {
      errors.push(`dimension[${idx}].name missing`);
    }
    if (typeof dd.weight !== 'number') {
      errors.push(`dimension[${idx}].weight not a number`);
    } else {
      weightSum += dd.weight;
    }
    const r = dd.rubric as Record<string, unknown> | undefined;
    if (
      !r ||
      typeof r.score5 !== 'string' ||
      typeof r.score7 !== 'string' ||
      typeof r.score9 !== 'string'
    ) {
      errors.push(`dimension[${idx}] missing rubric 5/7/9`);
    }
  });
  if (weightSum <= 0) errors.push('weights sum to zero');
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, matrix: candidate as OrchestrationDimensionMatrix, errors: [] };
}

// ── Internals ───────────────────────────────────────────────────────────────

interface ProposedDimension {
  name: string;
  category: string;
  weight: number;
  rubric?: { score5?: string; score7?: string; score9?: string };
  evidenceRequired?: string[];
  ossFrontierLeader?: string;
  closedFrontierLeader?: string;
  sourcedFromComplaints?: string[];
  ossFrontierScore?: number;
  closedFrontierScore?: number;
}

function buildCategoryList(
  args: DimensionSynthesisArgs,
  targetCount: number,
): string[] {
  const seeds = new Set<string>();

  // Project type drives a baseline category.
  if (args.intent.projectType) seeds.add(args.intent.projectType);

  // Direct competitor categories.
  for (const c of args.intent.competitiveCategoryBoundary?.direct ?? []) {
    seeds.add(c);
  }

  // Always include the universal categories.
  const universal = [
    'core_functionality',
    'developer_experience',
    'reliability',
    'performance',
    'security',
    'ecosystem',
    'observability',
    'extensibility',
  ];
  for (const u of universal) {
    if (seeds.size >= targetCount) break;
    seeds.add(u);
  }

  const list = Array.from(seeds).slice(0, targetCount);
  // Ensure non-empty result even when intent is bare.
  if (list.length === 0) return universal.slice(0, targetCount);
  return list;
}

function buildPerCategoryPrompt(
  args: DimensionSynthesisArgs,
  category: string,
  targetDimensions: number,
  targetCategories: number,
): string {
  const perCat = Math.max(
    3,
    Math.ceil(targetDimensions / Math.max(1, targetCategories)),
  );
  return `You are synthesizing orchestration dimensions for the DanteForge matrix.

Project: ${args.intent.projectName}
Goal: ${args.intent.goal}
ProjectType: ${args.intent.projectType}
Category under proposal: ${category}

Propose ${perCat} dimensions that define excellence in "${category}" for this project.
Each dimension MUST include:
  - name: short noun phrase
  - weight: 0.5..1.5 (1.0 is normal importance)
  - rubric.score5: what a 5/10 looks like
  - rubric.score7: what a 7/10 looks like
  - rubric.score9: what a 9/10 looks like
  - evidenceRequired: short bullet list of artifacts that prove a 9

Return STRICT JSON with this shape (no markdown fences):
{
  "dimensions": [
    { "name": "...", "category": "${category}", "weight": 1.0,
      "rubric": { "score5": "...", "score7": "...", "score9": "..." },
      "evidenceRequired": [ "..." ] }
  ]
}`;
}

function buildConsolidationPrompt(
  proposals: ProposedDimension[],
  targetDimensionCount: number,
): string {
  // Cap input size for safety.
  const capped = proposals.slice(0, 80);
  const list = capped
    .map(
      (p, i) =>
        `${i + 1}. [${p.category}] ${p.name} (weight=${p.weight})`,
    )
    .join('\n');
  return `Consolidate orchestration dimensions for the DanteForge matrix.

Goal: pick the top ${targetDimensionCount} dimensions that together cover the
project's excellence space without redundancy. Deduplicate near-synonyms,
normalize weights to 0.5..1.5, ensure every category is represented.

Candidate dimensions:
${list}

Return STRICT JSON (no markdown fences):
{
  "dimensions": [
    { "name": "...", "category": "...", "weight": 1.0,
      "rubric": { "score5": "...", "score7": "...", "score9": "..." },
      "evidenceRequired": [ "..." ] }
  ]
}`;
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

function parseProposals(
  raw: string | null,
  defaultCategory: string | null,
): ProposedDimension[] {
  if (!raw) return [];
  const body = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(body) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return [];
    const obj = parsed as Record<string, unknown>;
    const dims = obj.dimensions;
    if (!Array.isArray(dims)) return [];
    const out: ProposedDimension[] = [];
    for (const d of dims) {
      if (typeof d !== 'object' || d === null) continue;
      const dd = d as Record<string, unknown>;
      const name = typeof dd.name === 'string' ? dd.name : '';
      if (!name) continue;
      const category =
        typeof dd.category === 'string' && dd.category.length > 0
          ? dd.category
          : (defaultCategory ?? 'general');
      const weight =
        typeof dd.weight === 'number'
          ? Math.min(1.5, Math.max(0.5, dd.weight))
          : 1.0;
      const rubric =
        typeof dd.rubric === 'object' && dd.rubric !== null
          ? (dd.rubric as Record<string, unknown>)
          : {};
      out.push({
        name,
        category,
        weight,
        rubric: {
          score5: stringOr(rubric.score5),
          score7: stringOr(rubric.score7),
          score9: stringOr(rubric.score9),
        },
        evidenceRequired: stringArray(dd.evidenceRequired),
      });
    }
    return out;
  } catch {
    return [];
  }
}

function stringOr(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function stringArray(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out: string[] = [];
  for (const item of v) {
    if (typeof item === 'string' && item.trim().length > 0) out.push(item);
  }
  return out;
}

async function localFallback(
  cwd: string,
  categories: string[],
): Promise<ProposedDimension[]> {
  // Try compete-matrix first.
  const matrix = await loadMatrix(cwd).catch(() => null);
  if (matrix && matrix.dimensions.length > 0) {
    return matrix.dimensions.map((d) => proposalFromMatrixDimension(d));
  }
  // Try kernel synthesizer (it also reads compete-matrix, but tolerates absent state).
  try {
    const graph = await kernelSynthesize({ cwd });
    if (graph.nodes.length > 0) {
      return graph.nodes.map((n) => ({
        name: n.name,
        category: n.category ?? 'general',
        weight: 1.0,
        rubric: undefined,
        evidenceRequired: n.evidenceRequired,
        ...(typeof n.ossFrontierScore === 'number'
          ? { ossFrontierScore: n.ossFrontierScore }
          : {}),
        ...(typeof n.closedFrontierScore === 'number'
          ? { closedFrontierScore: n.closedFrontierScore }
          : {}),
      }));
    }
  } catch {
    /* best-effort */
  }
  // Final placeholder: one dimension per category.
  return categories.map((c) => ({
    name: `${c} excellence`,
    category: c,
    weight: 1.0,
  }));
}

function proposalFromMatrixDimension(d: MatrixDimension): ProposedDimension {
  return {
    name: d.label,
    category: d.category,
    weight: d.weight,
    rubric: undefined,
    ossFrontierScore: (d.scores.self ?? 0) + d.gap_to_oss_leader,
    closedFrontierScore: (d.scores.self ?? 0) + d.gap_to_closed_source_leader,
    ossFrontierLeader: d.oss_leader,
    closedFrontierLeader: d.closed_source_leader,
  };
}

function shapeDimensions(
  proposals: ProposedDimension[],
  args: DimensionSynthesisArgs,
  categories: string[],
  targetCount: number,
): OrchestrationDimension[] {
  // Dedupe by name lowercased.
  const seen = new Set<string>();
  const unique: ProposedDimension[] = [];
  for (const p of proposals) {
    const key = p.name.toLowerCase().trim();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  // Ensure every category has at least one entry; add placeholders otherwise.
  const byCategory = new Map<string, ProposedDimension[]>();
  for (const p of unique) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }
  for (const c of categories) {
    if (!byCategory.has(c)) {
      const placeholder: ProposedDimension = { name: `${c} excellence`, category: c, weight: 1.0 };
      unique.push(placeholder);
      byCategory.set(c, [placeholder]);
    }
  }

  // Sort by weight desc and cap at targetCount.
  unique.sort((a, b) => b.weight - a.weight);
  const capped = unique.slice(0, targetCount);

  // Backfill if under target (placeholder dims).
  while (capped.length < targetCount) {
    const cat = categories[capped.length % categories.length] ?? 'general';
    capped.push({ name: `${cat} additional ${capped.length}`, category: cat, weight: 0.5 });
  }

  return capped.map((p, idx) => toOrchestrationDimension(p, args, idx));
}

function toOrchestrationDimension(
  p: ProposedDimension,
  args: DimensionSynthesisArgs,
  idx: number,
): OrchestrationDimension {
  // Heuristic leader lookup from the universe — highest-scored competitor by
  // category match falls back to first competitor in matching category.
  const ossLeader =
    p.ossFrontierLeader ??
    pickLeader(args.universe.entries, 'oss', p.category);
  const closedLeader =
    p.closedFrontierLeader ??
    pickLeader(args.universe.entries, 'closed_source', p.category);

  const rubric = {
    score5: p.rubric?.score5 ?? `${p.name}: baseline implementation present.`,
    score7: p.rubric?.score7 ?? `${p.name}: above-average; matches most OSS leaders.`,
    score9: p.rubric?.score9 ?? `${p.name}: best-in-class; matches the frontier.`,
  };

  const ossFrontierScore =
    typeof p.ossFrontierScore === 'number' ? p.ossFrontierScore : 7.0;
  const closedFrontierScore =
    typeof p.closedFrontierScore === 'number' ? p.closedFrontierScore : 9.0;

  return {
    dimensionId: slugId(p.name, idx),
    name: p.name,
    category: p.category,
    weight: p.weight,
    rubric,
    evidenceRequired: p.evidenceRequired ?? [`evidence for ${p.name}`],
    currentScore: 0,
    ossFrontierScore,
    closedFrontierScore,
    gapToOssFrontier: ossFrontierScore,
    gapToClosedFrontier: closedFrontierScore,
    ...(ossLeader ? { ossFrontierLeader: ossLeader } : {}),
    ...(closedLeader ? { closedFrontierLeader: closedLeader } : {}),
    ...(p.sourcedFromComplaints
      ? { sourcedFromComplaints: p.sourcedFromComplaints }
      : {}),
  };
}

function slugId(name: string, idx: number): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return base.length > 0 ? `${base}_${idx}` : `dim_${idx}`;
}

function pickLeader(
  entries: CompetitiveUniverse['entries'],
  category: 'oss' | 'closed_source',
  domainHint: string,
): string | undefined {
  const matches = entries.filter((e) => e.category === category);
  if (matches.length === 0) return undefined;
  const hinted = matches.find((e) =>
    e.name.toLowerCase().includes(domainHint.toLowerCase()),
  );
  return (hinted ?? matches[0]).name;
}

function weightedAverage(
  dims: OrchestrationDimension[],
  field: 'ossFrontierScore' | 'closedFrontierScore',
): number {
  const totalW = dims.reduce((s, d) => s + d.weight, 0);
  if (totalW <= 0) return 0;
  const sum = dims.reduce((s, d) => s + d.weight * d[field], 0);
  return Math.round((sum / totalW) * 10) / 10;
}

async function safeAudit(
  options: DimensionSynthesisOptions,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await appendAudit(options.cwd, {
      ts: options._now ? options._now() : new Date().toISOString(),
      runId: options.runId ?? 'dimension-synthesizer',
      kind: 'stage_completed',
      stage: 'synthesizing_dimensions',
      payload,
    });
  } catch {
    /* best-effort */
  }
}
