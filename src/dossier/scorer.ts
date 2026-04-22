// src/dossier/scorer.ts — LLM-based dimension scoring from evidence array

import type { EvidenceItem, RubricDimension } from './types.js';

export type LLMCallerFn = (prompt: string, provider?: string) => Promise<string>;

export interface ScorerDeps {
  _callLLM?: LLMCallerFn;
}

export interface ScoreResult {
  score: number;
  justification: string;
}

const NO_EVIDENCE_RESULT: ScoreResult = {
  score: 1,
  justification: 'no evidence found',
};

function buildScoringPrompt(
  competitor: string,
  dim: number,
  dimDef: RubricDimension,
  evidence: EvidenceItem[],
): string {
  const criteriaBlock = Object.entries(dimDef.scoreCriteria)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([score, criteria]) =>
      `Score ${score}: ${(criteria as string[]).join(' | ')}`,
    )
    .join('\n');

  const evidenceBlock =
    evidence.length === 0
      ? 'No evidence found.'
      : JSON.stringify(evidence, null, 2);

  return (
    `You are scoring a software product on a single dimension using a strict rubric.\n\n` +
    `COMPETITOR: ${competitor}\n` +
    `DIMENSION: ${dim} — ${dimDef.name}\n\n` +
    `RUBRIC:\n${criteriaBlock}\n\n` +
    `EVIDENCE FOUND:\n${evidenceBlock}\n\n` +
    `Rules:\n` +
    `- Score only based on evidence found. If no evidence, score 1.\n` +
    `- Do not infer or assume capabilities not in the evidence.\n` +
    `- If evidence partially satisfies a criterion, score between brackets (e.g. 8 if mostly 9-level but one criterion missing).\n` +
    `- Score must be a number from 1 to 10 (decimals allowed, e.g. 8.5).\n\n` +
    `Output JSON only (no markdown, no explanation):\n` +
    `{"score":N,"justification":"one sentence citing specific evidence"}`
  );
}

function parseScoreResult(raw: string): ScoreResult | null {
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  const score = Number(obj['score']);
  const justification = String(obj['justification'] ?? '');
  if (isNaN(score)) return null;
  return {
    score: Math.max(1, Math.min(10, Math.round(score * 10) / 10)),
    justification,
  };
}

async function defaultLLMCaller(prompt: string, provider?: string): Promise<string> {
  const { callLLM } = await import('../core/llm.js');
  return callLLM(prompt, (provider ?? 'claude') as never);
}

export async function scoreDimension(
  evidence: EvidenceItem[],
  dim: number,
  dimDef: RubricDimension,
  competitor: string,
  deps: ScorerDeps = {},
): Promise<ScoreResult> {
  if (evidence.length === 0) return NO_EVIDENCE_RESULT;

  const callLLM = deps._callLLM ?? defaultLLMCaller;
  const prompt = buildScoringPrompt(competitor, dim, dimDef, evidence);

  let raw: string;
  try {
    raw = await callLLM(prompt, 'claude');
  } catch {
    return NO_EVIDENCE_RESULT;
  }

  return parseScoreResult(raw) ?? NO_EVIDENCE_RESULT;
}

// Exported for testing
export { buildScoringPrompt, parseScoreResult };
