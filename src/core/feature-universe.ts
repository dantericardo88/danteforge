// Feature Universe Engine
// Extracts the union of all unique function-level features from competitors,
// then scores the current project against each one.
//
// The "universe" grows as more competitors are analyzed:
//   8 competitors × 12-15 features each → ~40-100 unique features after deduplication
// This becomes the grading universe — the definition of what "complete" means.

import fs from 'fs/promises';
import path from 'path';
import { callLLM } from './llm.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type FeatureCategory =
  | 'planning'
  | 'execution'
  | 'quality'
  | 'dx'
  | 'autonomy'
  | 'integration'
  | 'other';

export interface FeatureItem {
  id: string;                        // "feat-001"
  name: string;                      // "Circuit breaker with exponential backoff"
  description: string;               // What this feature does
  category: FeatureCategory;
  competitorsThatHaveIt: string[];   // which competitors implement this
  bestImplementationHint?: string;   // "Devin achieves this by X"
}

export interface FeatureUniverse {
  features: FeatureItem[];
  competitors: string[];             // names of analyzed competitors
  generatedAt: string;
  version: number;                   // increment on refresh to invalidate cache
  sourceDescription: string;         // "Derived from 8 competitor analysis"
}

export interface FeatureScore {
  featureId: string;
  featureName: string;
  score: number;                     // 0-10
  evidence: string;                  // "Found in src/core/autoforge-loop.ts"
  verdict: 'implemented' | 'partial' | 'missing';
}

export interface FeatureUniverseAssessment {
  universe: FeatureUniverse;
  scores: FeatureScore[];
  overallScore: number;              // avg of all feature scores (0-10)
  implementedCount: number;          // score >= 7
  partialCount: number;              // score >= 4 and < 7
  missingCount: number;              // score < 4
  coveragePercent: number;           // (implemented + partial) / total * 100
  timestamp: string;
}

export interface FeatureUniverseOptions {
  cwd?: string;
  projectName?: string;
  projectDescription?: string;
  _callLLM?: (prompt: string) => Promise<string>;
  _readFile?: (filePath: string) => Promise<string>;
  _writeFile?: (filePath: string, content: string) => Promise<void>;
  _now?: () => string;
}

const VALID_CATEGORIES = new Set<FeatureCategory>([
  'planning', 'execution', 'quality', 'dx', 'autonomy', 'integration', 'other',
]);

const FEATURE_UNIVERSE_FILE = 'feature-universe.json';
const FEATURE_SCORES_FILE = 'feature-scores.json';

// ── Feature extraction per competitor ────────────────────────────────────────

export async function extractCompetitorFeatures(
  competitorName: string,
  projectContext: { projectName: string; projectDescription?: string },
  opts: Pick<FeatureUniverseOptions, '_callLLM'> = {},
): Promise<FeatureItem[]> {
  const callLLMFn = opts._callLLM ?? ((p: string) => callLLM(p));

  const prompt = [
    `You are a product analyst. List 12-15 SPECIFIC function-level capabilities of: "${competitorName}"`,
    projectContext.projectDescription
      ? `in the context of a project like: ${projectContext.projectDescription}`
      : '',
    '',
    'Be granular — name specific mechanisms, not broad categories.',
    'BAD: "good error handling"          GOOD: "Circuit breaker with exponential backoff"',
    'BAD: "test coverage"                GOOD: "Injected test seams for all async I/O operations"',
    '',
    'Respond with ONLY pipe-delimited lines (no headers, no blank lines between):',
    'FEATURE|<category>|<feature name>|<one-sentence description>|<how competitor implements it>',
    '',
    'Valid categories: planning, execution, quality, dx, autonomy, integration, other',
    '',
    'Example output:',
    'FEATURE|autonomy|Circuit breaker with exponential backoff|Detects repeated failures and pauses with increasing delay|Uses CLOSED/OPEN/HALF_OPEN states per provider',
    'FEATURE|planning|LLM-injected clarification Q&A|Runs clarification on the spec before planning|Generates 5-8 targeted questions from spec gaps',
    'FEATURE|execution|Git worktree isolation for parallel agents|Each agent runs in its own worktree|Uses git worktree create/delete lifecycle',
  ].filter(Boolean).join('\n');

  let response = '';
  try {
    response = await callLLMFn(prompt);
  } catch {
    return [];
  }

  return parseFeatureLines(response, [competitorName]);
}

// ── Universe builder ──────────────────────────────────────────────────────────

export async function buildFeatureUniverse(
  competitorNames: string[],
  projectContext: { projectName: string; projectDescription?: string },
  opts: FeatureUniverseOptions = {},
): Promise<FeatureUniverse> {
  const callLLMFn = opts._callLLM ?? ((p: string) => callLLM(p));
  const now = opts._now ?? (() => new Date().toISOString());

  if (competitorNames.length === 0) {
    return {
      features: [],
      competitors: [],
      generatedAt: now(),
      version: 1,
      sourceDescription: 'No competitors provided',
    };
  }

  // Step 1: Extract features per competitor
  const allRaw: Array<FeatureItem & { fromCompetitor: string }> = [];
  for (const competitor of competitorNames) {
    const features = await extractCompetitorFeatures(competitor, projectContext, { _callLLM: callLLMFn });
    for (const f of features) {
      allRaw.push({ ...f, fromCompetitor: competitor });
    }
  }

  if (allRaw.length === 0) {
    return {
      features: [],
      competitors: competitorNames,
      generatedAt: now(),
      version: 1,
      sourceDescription: `Derived from ${competitorNames.length} competitors (no features extracted)`,
    };
  }

  // Step 2: Deduplicate via LLM
  const deduped = await deduplicateFeatures(allRaw, competitorNames, callLLMFn);

  return {
    features: deduped,
    competitors: competitorNames,
    generatedAt: now(),
    version: 1,
    sourceDescription: `Derived from ${competitorNames.length} competitor analysis (${deduped.length} unique features)`,
  };
}

// ── Project scoring against universe ─────────────────────────────────────────

export async function scoreProjectAgainstUniverse(
  universe: FeatureUniverse,
  projectContext: { projectName: string; projectDescription?: string; constitutionContent?: string; fileList?: string[] },
  opts: FeatureUniverseOptions = {},
): Promise<FeatureUniverseAssessment> {
  const callLLMFn = opts._callLLM ?? ((p: string) => callLLM(p));
  const now = opts._now ?? (() => new Date().toISOString());

  if (universe.features.length === 0) {
    return makeEmptyAssessment(universe, now());
  }

  // Score in batches of 10
  const BATCH_SIZE = 10;
  const allScores: FeatureScore[] = [];
  const features = universe.features;

  for (let i = 0; i < features.length; i += BATCH_SIZE) {
    const batch = features.slice(i, i + BATCH_SIZE);
    const batchScores = await scoreBatch(batch, projectContext, callLLMFn);
    allScores.push(...batchScores);
  }

  // Ensure every feature has a score (fill in any the LLM missed)
  for (const feature of features) {
    if (!allScores.find((s) => s.featureId === feature.id)) {
      allScores.push({
        featureId: feature.id,
        featureName: feature.name,
        score: 0,
        evidence: 'Not evaluated (LLM did not return a score for this feature)',
        verdict: 'missing',
      });
    }
  }

  return computeAssessment(universe, allScores, now());
}

// ── Scoring helpers ───────────────────────────────────────────────────────────

async function scoreBatch(
  batch: FeatureItem[],
  ctx: { projectName: string; projectDescription?: string; constitutionContent?: string; fileList?: string[] },
  callLLMFn: (prompt: string) => Promise<string>,
): Promise<FeatureScore[]> {
  const fileContext = ctx.fileList
    ? `Key source files:\n${ctx.fileList.slice(0, 30).join('\n')}`
    : '';

  const constitutionExcerpt = ctx.constitutionContent
    ? `Project constitution (first 600 chars):\n${ctx.constitutionContent.slice(0, 600)}`
    : '';

  const featureList = batch
    .map((f, i) => `${i + 1}. [${f.id}] ${f.name} — ${f.description}`)
    .join('\n');

  const prompt = [
    `You are evaluating whether "${ctx.projectName}" implements each feature below.`,
    ctx.projectDescription ? `Project: ${ctx.projectDescription}` : '',
    constitutionExcerpt,
    fileContext,
    '',
    'For each feature, score 0-10:',
    '  10 = fully implemented, production-quality',
    '   7 = mostly implemented, minor gaps',
    '   4 = partial implementation or incomplete',
    '   0 = not present at all',
    '',
    'Features to score:',
    featureList,
    '',
    'Respond with ONLY pipe-delimited lines:',
    'SCORE|<feat-id>|<score 0-10>|<implemented|partial|missing>|<one-sentence evidence>',
    '',
    'Example:',
    'SCORE|feat-001|9|implemented|autoforge-loop.ts runs up to 20 cycles with circuit breaker and plateau detection',
    'SCORE|feat-002|4|partial|self-improve.ts exists but only targets 12 fixed dimensions',
  ].filter(Boolean).join('\n');

  let response = '';
  try {
    response = await callLLMFn(prompt);
  } catch {
    // Return zero scores for this batch
    return batch.map((f) => ({
      featureId: f.id,
      featureName: f.name,
      score: 0,
      evidence: 'Scoring failed (LLM unavailable)',
      verdict: 'missing' as const,
    }));
  }

  return parseScoreLines(response, batch);
}

function parseScoreLines(response: string, batch: FeatureItem[]): FeatureScore[] {
  const scores: FeatureScore[] = [];
  const validIds = new Set(batch.map((f) => f.id));

  for (const line of response.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('SCORE|')) continue;

    const parts = trimmed.split('|');
    if (parts.length < 5) continue;

    const [, featureId, rawScore, rawVerdict, ...evidenceParts] = parts;
    if (!featureId || !validIds.has(featureId)) continue;

    const score = Math.max(0, Math.min(10, Number(rawScore) || 0));
    const verdict = (['implemented', 'partial', 'missing'].includes(rawVerdict?.trim() ?? '')
      ? rawVerdict!.trim()
      : score >= 7 ? 'implemented' : score >= 4 ? 'partial' : 'missing') as FeatureScore['verdict'];

    const evidence = evidenceParts.join('|').trim() || 'No evidence provided';
    const feature = batch.find((f) => f.id === featureId);

    scores.push({
      featureId,
      featureName: feature?.name ?? featureId,
      score,
      evidence,
      verdict,
    });
  }

  return scores;
}

function computeAssessment(
  universe: FeatureUniverse,
  scores: FeatureScore[],
  timestamp: string,
): FeatureUniverseAssessment {
  const total = scores.length;
  const implementedCount = scores.filter((s) => s.score >= 7).length;
  const partialCount = scores.filter((s) => s.score >= 4 && s.score < 7).length;
  const missingCount = scores.filter((s) => s.score < 4).length;
  const overallScore = total > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / total * 10) / 10
    : 0;
  const coveragePercent = total > 0
    ? Math.round((implementedCount + partialCount) / total * 100)
    : 0;

  return {
    universe,
    scores,
    overallScore,
    implementedCount,
    partialCount,
    missingCount,
    coveragePercent,
    timestamp,
  };
}

function makeEmptyAssessment(universe: FeatureUniverse, timestamp: string): FeatureUniverseAssessment {
  return {
    universe,
    scores: [],
    overallScore: 0,
    implementedCount: 0,
    partialCount: 0,
    missingCount: 0,
    coveragePercent: 0,
    timestamp,
  };
}

// ── Deduplication ─────────────────────────────────────────────────────────────

async function deduplicateFeatures(
  rawFeatures: Array<FeatureItem & { fromCompetitor: string }>,
  competitors: string[],
  callLLMFn: (prompt: string) => Promise<string>,
): Promise<FeatureItem[]> {
  // Group by competitor for the prompt
  const byCompetitor: Record<string, FeatureItem[]> = {};
  for (const f of rawFeatures) {
    const comp = f.fromCompetitor;
    if (!byCompetitor[comp]) byCompetitor[comp] = [];
    byCompetitor[comp]!.push(f);
  }

  const inputJson = JSON.stringify(byCompetitor, null, 2);

  const prompt = [
    `Given feature lists from ${competitors.length} competitors, build a canonical union.`,
    'Merge near-duplicates (same capability with different names) into one item.',
    'For merged items, list ALL competitors that have them.',
    'Keep the most descriptive name and description.',
    '',
    'Input (features by competitor):',
    inputJson.slice(0, 6000), // cap to avoid token overflow
    '',
    'Respond ONLY with a JSON array:',
    '[{"id":"feat-001","name":"...","description":"...","category":"...","competitorsThatHaveIt":["..."],"bestImplementationHint":"..."}, ...]',
    '',
    'Assign sequential IDs: feat-001, feat-002, ...',
    'Use categories: planning, execution, quality, dx, autonomy, integration, other',
  ].join('\n');

  let response = '';
  try {
    response = await callLLMFn(prompt);
  } catch {
    // Fall back to naive union (no dedup)
    return naiveUnion(rawFeatures);
  }

  const parsed = parseDeduplicatedFeatures(response);
  return parsed.length > 0 ? parsed : naiveUnion(rawFeatures);
}

function parseDeduplicatedFeatures(response: string): FeatureItem[] {
  const jsonMatch = response.match(/\[[\s\S]*\]/);
  if (!jsonMatch) return [];

  try {
    const parsed = JSON.parse(jsonMatch[0]) as unknown[];
    const results: FeatureItem[] = [];

    for (const item of parsed) {
      if (typeof item !== 'object' || item === null) continue;
      const obj = item as Record<string, unknown>;

      const id = typeof obj['id'] === 'string' ? obj['id'] : '';
      const name = typeof obj['name'] === 'string' ? obj['name'] : '';
      const description = typeof obj['description'] === 'string' ? obj['description'] : '';
      const rawCategory = typeof obj['category'] === 'string' ? obj['category'] : 'other';
      const category: FeatureCategory = VALID_CATEGORIES.has(rawCategory as FeatureCategory)
        ? (rawCategory as FeatureCategory)
        : 'other';
      const competitorsThatHaveIt = Array.isArray(obj['competitorsThatHaveIt'])
        ? (obj['competitorsThatHaveIt'] as unknown[])
            .filter((c): c is string => typeof c === 'string')
        : [];
      const bestImplementationHint = typeof obj['bestImplementationHint'] === 'string'
        ? obj['bestImplementationHint']
        : undefined;

      if (!id || !name) continue;
      results.push({ id, name, description, category, competitorsThatHaveIt, bestImplementationHint });
    }

    return results;
  } catch {
    return [];
  }
}

function naiveUnion(rawFeatures: Array<FeatureItem & { fromCompetitor: string }>): FeatureItem[] {
  // No deduplication — just re-assign IDs and attribute competitors
  const seen = new Map<string, FeatureItem>();
  let idx = 1;

  for (const f of rawFeatures) {
    const key = f.name.toLowerCase().slice(0, 40);
    if (seen.has(key)) {
      const existing = seen.get(key)!;
      if (!existing.competitorsThatHaveIt.includes(f.fromCompetitor)) {
        existing.competitorsThatHaveIt.push(f.fromCompetitor);
      }
    } else {
      const id = `feat-${String(idx++).padStart(3, '0')}`;
      seen.set(key, {
        id,
        name: f.name,
        description: f.description,
        category: f.category,
        competitorsThatHaveIt: [f.fromCompetitor],
        bestImplementationHint: f.bestImplementationHint,
      });
    }
  }

  return [...seen.values()];
}

// ── Feature line parser (pipe-delimited) ──────────────────────────────────────

export function parseFeatureLines(
  response: string,
  defaultCompetitors: string[] = [],
): FeatureItem[] {
  const results: FeatureItem[] = [];
  let idx = 1;

  for (const line of response.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('FEATURE|')) continue;

    const parts = trimmed.split('|');
    if (parts.length < 4) continue;

    const [, rawCategory, name, description, ...hintParts] = parts;
    if (!name?.trim() || !description?.trim()) continue;

    const rawCat = rawCategory?.trim() ?? 'other';
    const category: FeatureCategory = VALID_CATEGORIES.has(rawCat as FeatureCategory)
      ? (rawCat as FeatureCategory)
      : 'other';

    const hint = hintParts.join('|').trim() || undefined;
    const id = `feat-${String(idx++).padStart(3, '0')}`;

    results.push({
      id,
      name: name.trim(),
      description: description.trim(),
      category,
      competitorsThatHaveIt: [...defaultCompetitors],
      bestImplementationHint: hint,
    });
  }

  return results;
}

// ── Markdown report formatter ─────────────────────────────────────────────────

export function formatFeatureUniverseReport(
  assessment: FeatureUniverseAssessment,
  target: { minScore: number; featureCoverage: number },
): string {
  const { universe, scores, overallScore, implementedCount, partialCount, missingCount, coveragePercent } = assessment;
  const lines: string[] = [];

  lines.push(`# Feature Universe Report`);
  lines.push(`Generated: ${assessment.timestamp}`);
  lines.push(`${universe.sourceDescription}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push(`Overall score: **${overallScore.toFixed(1)}/10** (target: ${target.minScore.toFixed(1)})`);
  lines.push(`Coverage: **${coveragePercent}%** (target: ${target.featureCoverage}%)`);
  lines.push(`Features: ${implementedCount} implemented | ${partialCount} partial | ${missingCount} missing`);
  lines.push('');

  // Group by category
  const byCategory = new Map<FeatureCategory, FeatureItem[]>();
  for (const f of universe.features) {
    if (!byCategory.has(f.category)) byCategory.set(f.category, []);
    byCategory.get(f.category)!.push(f);
  }

  for (const [cat, features] of byCategory) {
    lines.push(`## ${cat.charAt(0).toUpperCase() + cat.slice(1)} (${features.length})`);
    for (const f of features) {
      const score = scores.find((s) => s.featureId === f.id);
      const scoreStr = score ? `${score.score.toFixed(1)}/10` : '?/10';
      const icon = !score ? '?' : score.score >= 7 ? '✓' : score.score >= 4 ? '△' : '✗';
      const compStr = f.competitorsThatHaveIt.slice(0, 3).join(', ');
      lines.push(`  ${icon} ${f.id}  ${f.name.padEnd(40)} ${scoreStr}  (${compStr})`);
      if (score?.evidence) {
        lines.push(`       ${score.evidence}`);
      }
    }
    lines.push('');
  }

  // Missing features section
  const missing = scores.filter((s) => s.score < 4);
  if (missing.length > 0) {
    lines.push('## Missing Features (need implementation)');
    for (const s of missing) {
      const f = universe.features.find((feat) => feat.id === s.featureId);
      lines.push(`  ✗ ${s.featureId}  ${s.featureName}`);
      if (f?.bestImplementationHint) lines.push(`       Hint: ${f.bestImplementationHint}`);
    }
  }

  return lines.join('\n');
}

// ── Cache I/O ─────────────────────────────────────────────────────────────────

export async function saveFeatureUniverse(
  universe: FeatureUniverse,
  cwd: string,
  _writeFile?: (p: string, c: string) => Promise<void>,
): Promise<void> {
  const writeFn = _writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf-8'));
  const dir = path.join(cwd, '.danteforge');
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  await writeFn(path.join(dir, FEATURE_UNIVERSE_FILE), JSON.stringify(universe, null, 2));
}

export async function loadFeatureUniverse(
  cwd: string,
  _readFile?: (p: string) => Promise<string>,
): Promise<FeatureUniverse | null> {
  const readFn = _readFile ?? ((p: string) => fs.readFile(p, 'utf-8'));
  try {
    const content = await readFn(path.join(cwd, '.danteforge', FEATURE_UNIVERSE_FILE));
    return JSON.parse(content) as FeatureUniverse;
  } catch {
    return null;
  }
}

export async function saveFeatureScores(
  assessment: FeatureUniverseAssessment,
  cwd: string,
  _writeFile?: (p: string, c: string) => Promise<void>,
): Promise<void> {
  const writeFn = _writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf-8'));
  const dir = path.join(cwd, '.danteforge');
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  await writeFn(path.join(dir, FEATURE_SCORES_FILE), JSON.stringify(assessment, null, 2));
}

export async function loadFeatureScores(
  cwd: string,
  _readFile?: (p: string) => Promise<string>,
): Promise<FeatureUniverseAssessment | null> {
  const readFn = _readFile ?? ((p: string) => fs.readFile(p, 'utf-8'));
  try {
    const content = await readFn(path.join(cwd, '.danteforge', FEATURE_SCORES_FILE));
    return JSON.parse(content) as FeatureUniverseAssessment;
  } catch {
    return null;
  }
}

// ── Forge prompt builder for missing/partial features ─────────────────────────

export function buildFeatureForgePrompt(
  score: FeatureScore,
  feature: FeatureItem,
  projectName: string,
): string {
  const action = score.score < 4 ? 'Implement' : 'Improve';
  const competitors = feature.competitorsThatHaveIt.slice(0, 3).join(', ');
  const hint = feature.bestImplementationHint
    ? ` Implementation hint: ${feature.bestImplementationHint}.`
    : '';

  return [
    `${action} the following feature in ${projectName}: "${feature.name}"`,
    `Description: ${feature.description}`,
    `Current status: ${score.verdict} (score: ${score.score}/10). Evidence: ${score.evidence}`,
    `Competitors with this feature: ${competitors}.${hint}`,
    `Target: score 9+/10 on this feature so the feature universe assessment passes.`,
  ].join(' ');
}
