// autoresearch-hypothesis.ts — grounded hypothesis generation + anchored application for the
// autoresearch loop's lightweight (no-coding-agent) edit path.
//
// The old contract asked the model for "complete new content for that file" and blind-overwrote it —
// so it hallucinated whole files from memory (a shell line inside a .mjs, a Go file rewritten as
// Python). This module replaces that with ANCHORED edits: the model must quote the exact existing text
// it wants to change, and the apply step refuses anything whose anchor isn't present verbatim. That
// makes whole-file destruction and hallucinated-from-scratch content structurally impossible. It also
// grounds the prompt in the capability_test's own source and feeds prior rejection reasons back so the
// model stops repeating a forbidden move. (The high-quality path is the coding-agent dispatch in
// autoresearch-agent-edit.ts; this is the offline/local-LLM fallback.)

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import type { LLMProvider } from '../../core/config.js';
import type { CallLLMOptions } from '../../core/llm-pipeline.js';
import { formatResultsTsv, type AutoResearchConfig, type ExperimentResult } from '../../core/autoresearch-engine.js';
import { collectForbiddenTargets } from './autoresearch-integrity.js';

export type CallLLMFn = (prompt: string, provider?: LLMProvider | undefined, opts?: CallLLMOptions) => Promise<string>;

export interface EditOp { find: string; replace: string; }

export interface Hypothesis {
  description: string;
  fileToChange: string;
  /** Anchored edits against the EXISTING file content (preferred). */
  edits?: EditOp[];
  /** Whole-file content — allowed ONLY when creating a NEW file. */
  change?: string;
}

export interface ApplyResult {
  applied: boolean;
  changedFiles: string[];
  /** Set when the edit was refused (anchor missing, overwrite of existing file, etc.). */
  rejectReason?: string;
}

const MEASUREMENT_SRC_CAP = 4000;

/** Read the source of the first capability_test / measurement script so the model knows the target. */
async function readMeasurementSource(
  config: AutoResearchConfig,
  readFileFn: (p: string) => Promise<string>,
): Promise<string> {
  for (const abs of collectForbiddenTargets(config.measurementCommand, config.cwd)) {
    try {
      const src = await readFileFn(abs);
      if (src.trim()) {
        const rel = path.relative(config.cwd, abs);
        const body = src.length > MEASUREMENT_SRC_CAP ? `${src.slice(0, MEASUREMENT_SRC_CAP)}\n…[truncated]` : src;
        return `The capability_test/measurement script (${rel}) — you must NOT edit this file, only make it pass:\n\`\`\`\n${body}\n\`\`\`\n\n`;
      }
    } catch { /* not a readable file — skip */ }
  }
  return '';
}

export async function generateHypothesis(
  config: AutoResearchConfig,
  experimentId: number,
  previousResults: ExperimentResult[],
  rejectionNotes: string[],
  callLLMFn: CallLLMFn,
  readFileFn: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf8'),
): Promise<Hypothesis> {
  const resultsContext = previousResults.length > 0
    ? `Previous experiments:\n${formatResultsTsv(previousResults)}\n`
    : 'No previous experiments yet.\n';

  // Rejection feedback: the model repeats the same forbidden/broken move unless told why it failed.
  const rejectionContext = rejectionNotes.length > 0
    ? `\nDO NOT repeat these rejected attempts:\n${rejectionNotes.slice(-5).map(r => `- ${r}`).join('\n')}\n`
    : '';

  // Read optional program.md research strategy (Karpathy pattern: human-authored guidance per iteration)
  let programContext = '';
  try {
    const programMd = await readFileFn(path.join(config.cwd, 'autoresearch.program.md'));
    if (programMd.trim()) programContext = `Research strategy (from autoresearch.program.md):\n${programMd.trim()}\n\n`;
  } catch { /* optional file — no-op */ }

  const measurementSrc = await readMeasurementSource(config, readFileFn);

  const prompt = `You are an autonomous code optimizer implementing Karpathy's autoresearch pattern.

Goal: ${config.goal}
Metric: ${config.metric} (lower is better for performance metrics; for a pass/fail capability_test, 0 = passing)
Measurement command: ${config.measurementCommand}
Working directory: ${config.cwd}
Experiment number: ${experimentId}

${measurementSrc}${programContext}${resultsContext}${rejectionContext}
Generate ONE small, surgical change. Edit a REAL source file — NOT the measurement/capability_test
script itself (editing the yardstick is cheating and will be rejected). Quote the exact existing text
you want to change so your edit is anchored to reality.

Respond with EXACTLY this JSON (no other text, no markdown fences):
{
  "description": "<one sentence: what you are changing and why>",
  "fileToChange": "<relative path to an EXISTING source file>",
  "edits": [{ "find": "<exact text that currently exists in the file>", "replace": "<new text>" }]
}
To CREATE a new file instead, omit "edits" and provide "change": "<full file content>".`;

  const response = await callLLMFn(prompt, undefined, { enrichContext: true, cwd: config.cwd });

  try {
    const cleaned = response.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const parsed = JSON.parse(cleaned) as Hypothesis;
    if (!parsed.description || !parsed.fileToChange || (!parsed.edits?.length && !parsed.change)) {
      throw new Error('Missing required fields (need fileToChange and either edits or change)');
    }
    return parsed;
  } catch (err) {
    logger.warn(`Failed to parse LLM hypothesis JSON: ${err instanceof Error ? err.message : String(err)}`);
    // Safe fallback: a no-op hypothesis that won't break anything.
    return { description: `Experiment ${experimentId}: exploratory no-op to establish loop integrity`, fileToChange: '', change: '' };
  }
}

/**
 * Apply a hypothesis. Anchored `edits` are validated against the real file content and refused if an
 * anchor is missing; whole-file `change` is allowed ONLY for a new file (never to overwrite an
 * existing one). Returns the set of changed files plus a rejectReason when the edit was refused.
 */
export async function applyHypothesis(
  hypothesis: Hypothesis,
  cwd: string,
  fsImpl: { readFile: (p: string) => Promise<string>; writeFile: (p: string, c: string) => Promise<void>; mkdir: (p: string) => Promise<void>; exists: (p: string) => Promise<boolean> } = realFs,
): Promise<ApplyResult> {
  if (!hypothesis.fileToChange) {
    logger.info('No file change in hypothesis — running as-is.');
    return { applied: true, changedFiles: [] };
  }
  const target = path.resolve(cwd, hypothesis.fileToChange);
  const exists = await fsImpl.exists(target);

  if (hypothesis.edits?.length) {
    if (!exists) return { applied: false, changedFiles: [], rejectReason: `anchored edits target a non-existent file (${hypothesis.fileToChange})` };
    let content: string;
    try { content = await fsImpl.readFile(target); }
    catch (err) { return { applied: false, changedFiles: [], rejectReason: `could not read ${hypothesis.fileToChange}: ${err instanceof Error ? err.message : String(err)}` }; }
    for (const edit of hypothesis.edits) {
      const find = String(edit.find ?? '');
      const replace = String(edit.replace ?? '');
      if (!find || !content.includes(find)) {
        return { applied: false, changedFiles: [], rejectReason: `anchor not found in ${hypothesis.fileToChange}: ${JSON.stringify(find.slice(0, 60))}` };
      }
      content = content.replace(find, replace); // first occurrence — surgical
    }
    try { await fsImpl.writeFile(target, content); }
    catch (err) { return { applied: false, changedFiles: [], rejectReason: `write failed: ${err instanceof Error ? err.message : String(err)}` }; }
    return { applied: true, changedFiles: [hypothesis.fileToChange] };
  }

  // Whole-file content: only ever allowed to CREATE a new file — never to overwrite an existing one.
  if (exists) {
    return { applied: false, changedFiles: [], rejectReason: `refusing to overwrite existing file ${hypothesis.fileToChange} with whole-file content — provide anchored edits instead` };
  }
  const content = typeof hypothesis.change === 'string' ? hypothesis.change : JSON.stringify(hypothesis.change ?? '', null, 2);
  try {
    await fsImpl.mkdir(path.dirname(target));
    await fsImpl.writeFile(target, content);
  } catch (err) {
    return { applied: false, changedFiles: [], rejectReason: `create failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  return { applied: true, changedFiles: [hypothesis.fileToChange] };
}

const realFs = {
  readFile: (p: string) => fs.readFile(p, 'utf8'),
  writeFile: (p: string, c: string) => fs.writeFile(p, c, 'utf8'),
  mkdir: async (p: string) => { await fs.mkdir(p, { recursive: true }); },
  exists: async (p: string) => { try { await fs.access(p); return true; } catch { return false; } },
};
