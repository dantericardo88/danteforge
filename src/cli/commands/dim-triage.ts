// dim-triage — CLI: classify every sub-target competitive dimension and route it to the loop that can
// actually move it (autoresearch for surgical, matrixdev/forge for feature work, fix-test for a
// mis-specified yardstick, none for a genuine ceiling). Optionally --apply explicit ceilings to the
// dead targets so dimension selection stops burning budget on them.

import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadMatrix, saveMatrix, type CompeteMatrix, type MatrixDimension } from '../../core/compete-matrix.js';
import { MARKET_DIMS_SCORE_CAP } from '../../core/compete-matrix-score.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  classifyDimDeterministic,
  buildClassifyPrompt,
  parseClassifyResponse,
  extractCommandPaths,
  formatTriageReport,
  summarize,
  ADVANCE_TARGET,
  type DimSignals,
  type DimClassification,
} from '../../core/dim-triage.js';

type LooseDim = MatrixDimension & { capability_test?: { command?: string }; no_capability_test?: boolean };

interface DimTriageOpts {
  target?: number;
  apply?: boolean;
  json?: boolean;
  _loadMatrix?: typeof loadMatrix;
  _saveMatrix?: typeof saveMatrix;
  _isLLMAvailable?: () => Promise<boolean>;
  _callLLM?: (prompt: string) => Promise<string>;
  _fileExists?: (p: string) => Promise<boolean>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _mkdir?: (p: string) => Promise<void>;
}

const realFileExists = async (p: string): Promise<boolean> => { try { await fs.access(p); return true; } catch { return false; } };

/** Gather the static signals for one dimension (existence of its capability_test script included). */
async function gatherSignals(dim: LooseDim, cwd: string, fileExists: (p: string) => Promise<boolean>): Promise<DimSignals> {
  const command = dim.capability_test?.command?.trim();
  let scriptExists: boolean | undefined;
  if (command) {
    const paths = extractCommandPaths(command);
    if (paths.length > 0) {
      const checks = await Promise.all(paths.map(rel => fileExists(path.resolve(cwd, rel))));
      scriptExists = checks.some(Boolean); // at least one referenced script is present
    }
  }
  return {
    id: dim.id,
    label: dim.label,
    score: dim.scores?.self ?? 0,
    ceiling: dim.ceiling,
    closingStrategy: dim.closingStrategy,
    noCapabilityTest: dim.no_capability_test,
    capabilityTestCommand: command,
    scriptExists,
    isMarketCapped: MARKET_DIMS_SCORE_CAP.has(dim.id),
  };
}

/** Read the first existing referenced script so the LLM judges against the real test. */
async function readScriptSource(signals: DimSignals, cwd: string, readFile: (p: string) => Promise<string>): Promise<string> {
  if (!signals.capabilityTestCommand) return '';
  for (const rel of extractCommandPaths(signals.capabilityTestCommand)) {
    try { return await readFile(path.resolve(cwd, rel)); } catch { /* try next */ }
  }
  return '';
}

export async function dimTriage(opts: DimTriageOpts = {}): Promise<void> {
  return withErrorBoundary('dim-triage', async () => {
    const cwd = process.cwd();
    const target = opts.target ?? ADVANCE_TARGET;
    const loadMatrixFn = opts._loadMatrix ?? loadMatrix;
    const saveMatrixFn = opts._saveMatrix ?? saveMatrix;
    const isLLMAvailableFn = opts._isLLMAvailable ?? isLLMAvailable;
    const callLLMFn = opts._callLLM ?? ((p: string) => callLLM(p, undefined, { enrichContext: false, cwd }));
    const fileExists = opts._fileExists ?? realFileExists;
    const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    const writeFile = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
    const mkdir = opts._mkdir ?? (async (p: string) => { await fs.mkdir(p, { recursive: true }); });

    const matrix = await loadMatrixFn(cwd);
    if (!matrix) { logger.error('No competitive matrix found (.danteforge/compete/matrix.json). Run `danteforge compete` first.'); process.exitCode = 1; return; }

    const excluded = new Set(matrix.excludedDimensions ?? []);
    const todo = (matrix.dimensions as LooseDim[]).filter(d => (d.scores?.self ?? 0) < target && !excluded.has(d.id));
    if (todo.length === 0) { logger.success(`All dimensions are at or above target ${target}. Nothing to triage.`); return; }

    logger.info(`Triaging ${todo.length} sub-${target} dimension(s)...`);
    const llmOk = await isLLMAvailableFn();
    if (!llmOk) logger.warn('No LLM available — deterministic triage only; ambiguous dims are left as "unknown" (manual review).');

    const classes: DimClassification[] = [];
    for (const dim of todo) {
      const signals = await gatherSignals(dim, cwd, fileExists);
      let cls = classifyDimDeterministic(signals);
      if (cls.needsLLM && llmOk) {
        try {
          const src = await readScriptSource(signals, cwd, readFile);
          const parsed = parseClassifyResponse(signals, await callLLMFn(buildClassifyPrompt(signals, src)));
          if (parsed) cls = parsed;
        } catch (err) { logger.warn(`LLM triage failed for ${dim.id}: ${err instanceof Error ? err.message : String(err)} — leaving as unknown.`); }
      }
      classes.push(cls);
    }

    // Write the report (untracked, under .danteforge/).
    const reportDir = path.join(cwd, '.danteforge', 'triage');
    await mkdir(reportDir).catch(() => { /* best-effort */ });
    const report = formatTriageReport(matrix.project, classes);
    await writeFile(path.join(reportDir, 'DIM_TRIAGE.md'), report).catch(() => { /* best-effort */ });
    await writeFile(path.join(reportDir, 'dim-triage.json'), JSON.stringify(classes, null, 2)).catch(() => { /* best-effort */ });

    const applied = opts.apply ? await applyCeilings(matrix, classes, cwd, saveMatrixFn) : 0;

    if (opts.json) { process.stdout.write(JSON.stringify({ summary: summarize(classes), classes, applied }, null, 2) + '\n'); return; }
    printSummary(classes, target, reportDir, opts.apply ? applied : null);
  });
}

/** Set an explicit ceiling on each ceilinged dim that lacks one — stops selection re-picking dead targets. */
async function applyCeilings(matrix: CompeteMatrix, classes: DimClassification[], cwd: string, saveMatrixFn: typeof saveMatrix): Promise<number> {
  const byId = new Map(matrix.dimensions.map(d => [d.id, d]));
  let applied = 0;
  for (const c of classes) {
    if (c.category !== 'ceilinged' || c.suggestedCeiling === undefined) continue;
    const dim = byId.get(c.id);
    if (!dim || dim.ceiling !== undefined) continue; // never overwrite an operator-set ceiling
    dim.ceiling = c.suggestedCeiling;
    dim.ceilingReason = c.reason;
    applied++;
  }
  if (applied > 0) { await saveMatrixFn(matrix, cwd); logger.success(`Applied explicit ceilings to ${applied} dimension(s) — selection will now skip them.`); }
  else logger.info('--apply: no new ceilings to set (ceilinged dims already capped, or none found).');
  return applied;
}

function printSummary(classes: DimClassification[], target: number, reportDir: string, applied: number | null): void {
  const s = summarize(classes);
  logger.info('');
  logger.success('=== Dimension Triage ===');
  logger.info(`  surgical            → autoresearch:   ${s.byCategory.surgical}`);
  logger.info(`  feature_construction → matrixdev/forge: ${s.byCategory.feature_construction}`);
  logger.info(`  yardstick_bug       → fix the test:    ${s.byCategory.yardstick_bug}`);
  logger.info(`  ceilinged           → mark + skip:     ${s.byCategory.ceilinged}`);
  logger.info(`  unknown             → manual review:   ${s.byCategory.unknown}`);
  logger.info('');
  if (applied !== null) logger.info(`Ceilings applied: ${applied}`);
  logger.info(`Report: ${path.join(reportDir, 'DIM_TRIAGE.md')}`);
  if (s.byCategory.surgical > 0) logger.info(`Next: run autoresearch on the ${s.byCategory.surgical} surgical dim(s); route feature_construction to matrixdev.`);
}
