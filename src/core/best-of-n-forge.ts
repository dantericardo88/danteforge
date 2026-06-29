// best-of-n-forge.ts — wires the best-of-N idea into the LIVE forge executor at the cheapest, safest seam.
// Instead of generating ONE LLM candidate per task and applying it blind, the executor can generate N
// candidates and SELECT the best one BEFORE applying — using COMPILOT's Layer-1 cheap pre-filter as the
// selector. Crucially this needs no worktrees and no clobbering: each candidate is PARSED (not written) to
// its proposed file operations, scored by the deterministic pre-filter, and only the winner is applied
// through the executor's existing apply+test pipeline.
//
// This is the honest "wire best-of-N into the live loop" increment: it kills stub / oversized / trust-surface
// candidates (the "~two-thirds unproductive proposals" COMPILOT measured) before the expensive apply+test
// step, with zero regression risk (N=1 reproduces today's behavior exactly). Full Layer-2/3 test-MEASURED
// selection across applied candidates (worktree-isolated) is the next depth wave; this is Layer-1 selection.

import { prefilterCandidate, type ChangedFile, type PrefilterResult } from './candidate-prefilter.js';

/** Minimal shape of a parsed code operation (subset of code-writer's FileOperation). */
export interface ParsedOp {
  filePath: string;
  replaceBlock?: string;
}

export interface ForgeCandidate {
  index: number;
  /** Raw LLM result string (applied verbatim by the executor if chosen). */
  result: string;
  files: ChangedFile[];
  opCount: number;
}

export interface ForgeSelection {
  chosen: ForgeCandidate | null;
  ranked: Array<{ candidate: ForgeCandidate; reward: number; clean: boolean; findings: number }>;
  /** Candidates dropped because they parsed to zero operations (nothing to apply). */
  emptyCandidates: number;
}

export interface SelectForgeDeps {
  /** Parse an LLM result into proposed ops. Default: code-writer's parseCodeOperations. Injected for tests. */
  parse?: (result: string) => ParsedOp[];
  /** Reward for a candidate given its pre-filter result. Default: defaultForgeReward. */
  reward?: (candidate: ForgeCandidate, pre: PrefilterResult) => number;
  log?: (msg: string) => void;
}

/** Map parsed ops to the {path, content} shape the pre-filter scores. */
export function opsToChangedFiles(ops: ParsedOp[]): ChangedFile[] {
  return ops.map((o) => ({ path: o.filePath.replace(/\\/g, '/'), content: o.replaceBlock ?? '' }));
}

/**
 * Default reward: prefer candidates that change MORE real files while carrying FEWER pre-filter findings. A
 * trust-surface or stub finding is heavily penalized so a clean candidate always outranks a dirty one. Pure.
 */
export function defaultForgeReward(candidate: ForgeCandidate, pre: PrefilterResult): number {
  return candidate.opCount - pre.findings.length * 100;
}

async function defaultParse(result: string): Promise<ParsedOp[]> {
  const { parseCodeOperations } = await import('./code-writer.js');
  return parseCodeOperations(result) as ParsedOp[];
}

/**
 * A measured reward for the scaffold loop (Ornith): how good was the selected candidate? Positive when a
 * clean candidate with real ops was applied; negative when the best available was dirty (pre-filter findings)
 * or when nothing applied. This is the signal scaffolder.applyReward folds into the per-task-type scaffold.
 * PURE.
 */
export function forgeSelectionReward(selection: ForgeSelection): number {
  if (!selection.chosen) return -1;
  const top = selection.ranked.find((r) => r.candidate.index === selection.chosen!.index);
  if (!top) return -1;
  return top.clean ? selection.chosen.opCount : -top.findings;
}

/**
 * Select the best of N candidate LLM results by the Layer-1 pre-filter. Returns the chosen candidate (to be
 * applied by the caller via the normal apply pipeline), the full ranking, and how many candidates were empty.
 *
 * Selection rule: among candidates that parsed to >=1 op, prefer CLEAN ones (zero pre-filter findings) ranked
 * by reward; if every candidate is dirty, fall back to the highest-reward (least-bad) one so forge still
 * progresses — never returns null when at least one candidate proposed a real change.
 */
export async function selectBestForgeCandidate(results: string[], deps: SelectForgeDeps = {}): Promise<ForgeSelection> {
  const log = deps.log ?? (() => {});
  const reward = deps.reward ?? defaultForgeReward;
  const ranked: ForgeSelection['ranked'] = [];
  let emptyCandidates = 0;

  for (let i = 0; i < results.length; i++) {
    const ops = deps.parse ? deps.parse(results[i]!) : await defaultParse(results[i]!);
    if (ops.length === 0) { emptyCandidates++; continue; }
    const files = opsToChangedFiles(ops);
    const candidate: ForgeCandidate = { index: i, result: results[i]!, files, opCount: ops.length };
    const pre = prefilterCandidate(files);
    ranked.push({ candidate, reward: reward(candidate, pre), clean: pre.pass, findings: pre.findings.length });
    log(`[best-of-n-forge] candidate ${i}: ${ops.length} op(s), ${pre.pass ? 'CLEAN' : `${pre.findings.length} finding(s)`}, reward=${reward(candidate, pre)}`);
  }

  if (ranked.length === 0) return { chosen: null, ranked, emptyCandidates };

  // Prefer clean candidates; among the chosen tier rank by reward (stable: earlier index wins ties).
  const clean = ranked.filter((r) => r.clean);
  const pool = clean.length > 0 ? clean : ranked;
  const best = pool.reduce((acc, r) => (acc === null || r.reward > acc.reward ? r : acc), pool[0]!);
  log(`[best-of-n-forge] selected candidate ${best.candidate.index} (${clean.length > 0 ? 'clean' : 'least-bad'}, reward=${best.reward}) from ${ranked.length} non-empty of ${results.length}`);
  return { chosen: best.candidate, ranked, emptyCandidates };
}
