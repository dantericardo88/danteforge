/**
 * Repo Yield Meta-Learning
 * Predicts how many adoptable patterns a repo will yield based on a 6-dim
 * feature vector and cosine similarity to past successful repos.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export type RepoSignature = {
  stars: number;
  language: string;
  projectType: string;
  ageMonths: number;
  hasTests: boolean;
  hasCi: boolean;
};

export type YieldRecord = {
  slug: string;
  signature: RepoSignature;
  patternsExtracted: number;
  patternsAdopted: number;
  harvestedAt: string;
};

const LANGUAGE_SCORES: Record<string, number> = {
  TypeScript: 1.0,
  JavaScript: 0.9,
  Python: 0.8,
  Rust: 0.7,
  Go: 0.6,
};

const PROJECT_TYPE_SCORES: Record<string, number> = {
  cli: 1.0,
  library: 0.9,
  framework: 0.8,
  api: 0.7,
  app: 0.6,
};

/**
 * Computes a 6-dimensional feature vector from a RepoSignature.
 * Each dimension is normalized to [0, 1].
 */
export function computeFeatureVector(sig: RepoSignature): number[] {
  const stars = Math.log10(sig.stars + 1) / 6;
  const language = LANGUAGE_SCORES[sig.language] ?? 0.5;
  const projectType = PROJECT_TYPE_SCORES[sig.projectType] ?? 0.5;
  const ageMonths = Math.min(sig.ageMonths, 120) / 120;
  const hasTests = sig.hasTests ? 1 : 0;
  const hasCi = sig.hasCi ? 1 : 0;

  return [stars, language, projectType, ageMonths, hasTests, hasCi];
}

/**
 * Standard cosine similarity between two vectors.
 * Returns 0 if either vector is the zero vector.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dot = 0;
  let magA = 0;
  let magB = 0;

  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Predicts the adoption rate for a repo given its signature and historical records.
 * Uses cosine similarity as the weight for a weighted average of historical adoption rates.
 * Returns 0.5 if no history is provided.
 */
export function predictYield(signature: RepoSignature, history: YieldRecord[]): number {
  if (history.length === 0) return 0.5;

  const vec = computeFeatureVector(signature);

  let weightedSum = 0;
  let totalWeight = 0;

  for (const record of history) {
    if (record.patternsExtracted === 0) continue;
    const adoptionRate = record.patternsAdopted / record.patternsExtracted;
    const histVec = computeFeatureVector(record.signature);
    const sim = cosineSimilarity(vec, histVec);

    weightedSum += sim * adoptionRate;
    totalWeight += sim;
  }

  if (totalWeight === 0) return 0.5;
  return weightedSum / totalWeight;
}

/**
 * Computes a priority score for a repo combining urgency, quality, and predicted yield.
 * Result is clamped to [0, 10].
 */
export function computeRepoPriority(
  urgency: number,
  repoQuality: number,
  predictedYield: number,
): number {
  const raw = urgency * repoQuality * predictedYield;
  return Math.min(10, Math.max(0, raw));
}

/**
 * Loads yield history from `.danteforge/yield-history.json`.
 * Returns an empty array if the file does not exist or cannot be parsed.
 */
export async function loadYieldHistory(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<YieldRecord[]> {
  const base = cwd ?? process.cwd();
  const filePath = join(base, '.danteforge', 'yield-history.json');
  const reader = _fsRead ?? ((p: string) => readFile(p, 'utf-8'));

  try {
    const raw = await reader(filePath);
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed as YieldRecord[];
    }
    return [];
  } catch {
    return [];
  }
}

/**
 * Appends a YieldRecord to `.danteforge/yield-history.json`.
 * Creates the directory and file if they do not exist.
 */
export async function saveYieldRecord(
  record: YieldRecord,
  cwd?: string,
  _fsWrite?: (p: string, d: string) => Promise<void>,
): Promise<void> {
  const base = cwd ?? process.cwd();
  const filePath = join(base, '.danteforge', 'yield-history.json');

  const existing = await loadYieldHistory(cwd);
  existing.push(record);

  const data = JSON.stringify(existing, null, 2);

  if (_fsWrite) {
    await _fsWrite(filePath, data);
  } else {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, data, 'utf-8');
  }
}
