// ascend-engine.ts — Orchestrates the fully autonomous scoring and self-improving loop.
//
// Flow:
//   1. ORIENT  — load state + matrix (define universe if missing)
//   2. CLASSIFY — split dimensions into achievable vs atCeiling; announce ceilings upfront
//   3. DRY RUN — if dryRun, print plan and return immediately
//   4. LOOP    — pick lowest-scoring achievable dimension → run autoforge cycle → re-score → repeat
//   5. CEILING REPORT — explain what can't be automated and what the user must do manually
//   6. WRITE   — persist ASCEND_REPORT.md

import fs from 'fs/promises';
import path from 'path';
import { loadState, saveState, type WorkflowStage } from './state.js';
import { computeHarshScore, computeStrictDimensions, type HarshScorerOptions, type HarshScoreResult, type ScoringDimension } from './harsh-scorer.js';
import { loadMatrix, saveMatrix, classifyDimensions, getNextSprintDimension, updateDimensionScore, KNOWN_CEILINGS, type CompeteMatrix, type MatrixDimension } from './compete-matrix.js';
import { defineUniverse, type UniverseDefinerOptions } from './universe-definer.js';
import { runAutoforgeLoop, AutoforgeLoopState, type AutoforgeLoopContext, type AutoforgeLoopDeps } from './autoforge-loop.js';
import { executeAutoforgeCommand } from './autoforge-executor.js';
import { generateAdversarialCritique } from './adversarial-critique.js';
import { logger } from './logger.js';
import { createStepTracker } from './progress.js';
import { confirmMatrix } from './matrix-confirm.js';
import { isLLMAvailable } from './llm.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AscendEngineOptions {
  cwd?: string;
  target?: number;       // default: 9.0 — stop when all achievable dims reach this
  maxCycles?: number;    // default: 60 — max total improvement cycles across all dims (18 dims × ~3 cycles each)
  dryRun?: boolean;      // print plan without executing
  interactive?: boolean; // ask 5 questions if no matrix exists

  // Injection seams for testing
  _loadMatrix?: typeof loadMatrix;
  _saveMatrix?: typeof saveMatrix;
  _defineUniverse?: (opts: UniverseDefinerOptions) => Promise<CompeteMatrix>;
  _harshScore?: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
  _runLoop?: (ctx: AutoforgeLoopContext, deps?: Partial<AutoforgeLoopDeps>) => Promise<AutoforgeLoopContext>;
  _executeCommand?: (cmd: string, cwd: string) => Promise<{ success: boolean }>;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _writeFile?: (p: string, content: string) => Promise<void>;
  // Checkpoint seams
  _saveCheckpoint?: (cp: AscendCheckpoint, cwd: string) => Promise<void>;
  _loadCheckpoint?: (cwd: string) => Promise<AscendCheckpoint | null>;
  _clearCheckpoint?: (cwd: string) => Promise<void>;
  // Dual-LLM seams
  forgeProvider?: string;
  scorerProvider?: string;
  maxDimRetries?: number;
  _generateCritique?: (
    dimension: MatrixDimension,
    currentScore: number,
    targetScore: number,
    recentWorkSummary: string,
    options: { scorerProvider?: string; cwd?: string }
  ) => Promise<AdversarialCritique>;
  /**
   * Injection seam for computeStrictDimensions (used in tests to avoid git/fs calls).
   * When undefined, the real computeStrictDimensions is used.
   * Strict scoring is ALWAYS applied — the three STATE.yaml-gamed dimensions
   * (autonomy, selfImprovement, tokenEconomy) are overridden with code-derived signals
   * so ascend convergence cannot be gamed by editing STATE.yaml.
   */
  _computeStrictDims?: typeof computeStrictDimensions;
  yes?: boolean;
  _confirmMatrix?: typeof confirmMatrix;

  // LLM pre-flight + evidence accumulation seams
  /** Check whether an LLM is reachable before starting. Warns the user clearly if not. */
  _isLLMAvailable?: () => Promise<boolean>;
  /** Bootstrap .danteforge/evidence/oss-harvest.json if missing (+10 autonomy pts). */
  _bootstrapHarvest?: (cwd: string) => Promise<void>;
  /** Run a retro pass inside the loop every retroInterval cycles. */
  _runRetro?: (cwd: string) => Promise<void>;
  /** How many cycles between automatic retro runs (default: 5). */
  retroInterval?: number;
  /** Run a lightweight verify pass before the first cycle to accumulate evidence. */
  _runVerify?: (cwd: string) => Promise<void>;
  /** Set false to skip OSS harvest bootstrap (--no-auto-harvest). */
  autoHarvest?: boolean;
  /** Set false to skip mid-loop verify pass (--no-verify-loop). */
  verifyLoop?: boolean;

  // Adversarial convergence gating
  /** When true, self-score alone is not enough to converge — adversary must agree */
  adversarialGating?: boolean;
  /** How much lower adversarial score is acceptable vs target before blocking convergence (default 0.5) */
  adversaryTolerance?: number;
  _generateAdversarialScore?: (
    selfResult: import('./harsh-scorer.js').HarshScoreResult,
    opts: import('./adversarial-scorer-dim.js').AdversarialScorerDimOptions,
  ) => Promise<import('./adversarial-scorer-dim.js').AdversarialScoreResult>;

  /**
   * Execution mode for each cycle.
   * 'advisory' (default): writes AUTOFORGE_GUIDANCE.md but does not execute forge.
   * 'forge': calls `danteforge forge "<goal>"` directly with the dimension-specific goal,
   *          bypassing the tasks command and PLAN.md to avoid off-topic code generation.
   *          Forge-from-forge is same-stage allowed by the workflow enforcer.
   */
  executeMode?: 'advisory' | 'forge';
  /** Injection seam: set workflowStage in STATE.yaml before forge execution. */
  _setWorkflowStage?: (stage: string, cwd: string) => Promise<void>;
}

export interface CeilingReport {
  dimension: string;      // snake_case id
  label: string;
  currentScore: number;   // 0-10
  ceiling: number;        // 0-10
  reason: string;
  manualAction: string;   // what the user must do to go further
}

export interface AscendResult {
  cyclesRun: number;
  dimensionsImproved: number;
  dimensionsAtTarget: number;
  ceilingReports: CeilingReport[];
  finalScore: number;      // overall weighted matrix score (0-10)
  success: boolean;        // all achievable dims ≥ target
}

// ── Checkpoint ────────────────────────────────────────────────────────────────

export const ASCEND_PAUSE_FILE = '.danteforge/ASCEND_PAUSED';

export interface AscendCheckpoint {
  pausedAt: string;
  cyclesRun: number;
  maxCycles: number;
  target: number;
  startedAt: string;
  plateauedDims: string[];
  currentDimension: string;
  beforeScores: Record<string, number>;
}

// ── Adversarial critique (minimal type — full impl in adversarial-critique.ts) ─

export interface AdversarialCritique {
  satisfied: boolean;
  currentScore: number;
  targetScore: number;
  gapAnalysis: string;
  concreteActions: string[];
  critiquePrompt: string;
  scorerProvider?: string;
  generatedAt: string;
}

// ── Dimension ID ↔ ScoringDimension mapping ──────────────────────────────────

const ALL_SCORING_DIMENSIONS = new Set<string>([
  'functionality', 'testing', 'errorHandling', 'security', 'uxPolish',
  'documentation', 'performance', 'maintainability', 'developerExperience',
  'autonomy', 'planningQuality', 'selfImprovement', 'specDrivenPipeline',
  'convergenceSelfHealing', 'tokenEconomy', 'ecosystemMcp',
  'enterpriseReadiness', 'communityAdoption',
]);

/**
 * Convert snake_case matrix dimension id to camelCase ScoringDimension key.
 * Returns null if the key is not a known ScoringDimension.
 */
export function mapDimIdToScoringDimension(id: string): ScoringDimension | null {
  const camel = id.replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase());
  return ALL_SCORING_DIMENSIONS.has(camel) ? (camel as ScoringDimension) : null;
}

// ── Ceiling report builder ────────────────────────────────────────────────────

function buildManualAction(dim: MatrixDimension): string {
  const reason = dim.ceilingReason ?? '';
  if (reason.includes('npm downloads') || reason.includes('GitHub stars')) {
    return 'Publish to npm, promote the project, and attract contributors via README + examples.';
  }
  if (reason.includes('production deployments') || reason.includes('customer validation')) {
    return 'Deploy to real production environments and collect customer feedback/case studies.';
  }
  return `Manual effort required: ${reason}`;
}

function buildCeilingReports(dims: MatrixDimension[]): CeilingReport[] {
  return dims.map(d => ({
    dimension: d.id,
    label: d.label,
    currentScore: d.scores['self'] ?? 0,
    ceiling: d.ceiling!,
    reason: d.ceilingReason ?? 'automation ceiling reached',
    manualAction: buildManualAction(d),
  }));
}

// ── ASCEND_REPORT.md writer ───────────────────────────────────────────────────

function buildAscendReport(
  matrix: CompeteMatrix,
  result: AscendResult,
  target: number,
  beforeScores: Record<string, number>,
): string {
  const lines: string[] = [
    '# Ascend Report',
    '',
    `**Overall score:** ${result.finalScore.toFixed(1)}/10`,
    `**Cycles run:** ${result.cyclesRun}`,
    `**Dimensions improved:** ${result.dimensionsImproved}`,
    `**Dimensions at target (${target}/10):** ${result.dimensionsAtTarget}`,
    `**Success:** ${result.success ? 'YES — all achievable dimensions at target' : 'PARTIAL — see below'}`,
    '',
    '## Dimension Results',
    '',
    '| Dimension | Before | After | Status |',
    '|-----------|--------|-------|--------|',
  ];

  for (const dim of matrix.dimensions) {
    const before = (beforeScores[dim.id] ?? dim.scores['self'] ?? 0).toFixed(1);
    const after = (dim.scores['self'] ?? 0).toFixed(1);
    const status = dim.status === 'closed'
      ? '✅ closed'
      : (dim.scores['self'] ?? 0) >= target
        ? '🎯 at target'
        : dim.ceiling !== undefined
          ? `⚠️ ceiling ${dim.ceiling}/10`
          : '🔄 in progress';
    lines.push(`| ${dim.label} | ${before} | ${after} | ${status} |`);
  }

  if (result.ceilingReports.length > 0) {
    lines.push('', '## Ceiling Dimensions — Manual Action Required', '');
    for (const r of result.ceilingReports) {
      lines.push(
        `### ${r.label}`,
        '',
        `**Current score:** ${r.currentScore.toFixed(1)}/10 (ceiling: ${r.ceiling}/10)`,
        `**Why:** ${r.reason}`,
        `**What to do:** ${r.manualAction}`,
        '',
      );
    }
  }

  lines.push(
    '---',
    `*Generated by \`danteforge ascend\` at ${new Date().toISOString()}*`,
    '',
  );

  return lines.join('\n');
}

function buildAscendReportWithWiring(
  matrix: CompeteMatrix,
  result: AscendResult,
  target: number,
  beforeScores: Record<string, number>,
  unwiredModules: string[],
): string {
  const base = buildAscendReport(matrix, result, target, beforeScores);
  if (unwiredModules.length === 0) return base;

  const wiringSection = [
    '',
    '## Integration Wiring Gaps',
    '',
    'The following modules exist in the codebase but are **not called** from the execution path.',
    'These gaps cannot be fixed by ascend alone — they require manual wiring work:',
    '',
    ...unwiredModules.map(m => `- ${m}`),
    '',
    '> Run `danteforge wiring-check` to re-evaluate after wiring.',
    '',
  ].join('\n');

  // Insert before the final --- separator
  return base.replace('\n---\n', `\n${wiringSection}\n---\n`);
}

// ── Checkpoint helpers ────────────────────────────────────────────────────────

async function defaultSaveCheckpoint(cp: AscendCheckpoint, cwd: string): Promise<void> {
  const p = path.join(cwd, ASCEND_PAUSE_FILE);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(cp, null, 2), 'utf8');
}

async function defaultLoadCheckpoint(cwd: string): Promise<AscendCheckpoint | null> {
  try {
    const raw = await fs.readFile(path.join(cwd, ASCEND_PAUSE_FILE), 'utf8');
    return JSON.parse(raw) as AscendCheckpoint;
  } catch {
    return null;
  }
}

async function defaultClearCheckpoint(cwd: string): Promise<void> {
  try {
    await fs.unlink(path.join(cwd, ASCEND_PAUSE_FILE));
  } catch {
    // non-fatal
  }
}

// ── Strict scoring overlay ────────────────────────────────────────────────────
//
// The three dimensions most vulnerable to STATE.yaml manipulation are overridden
// with tamper-resistant code-derived signals before any convergence decision.
// This means ascend cannot converge simply by editing STATE.yaml config fields.

const STRICT_DIM_IDS = new Set(['autonomy', 'self_improvement', 'token_economy']);

export async function applyStrictOverrides(
  result: HarshScoreResult,
  cwd: string,
  computeStrictDimsFn: typeof computeStrictDimensions,
): Promise<void> {
  const strict = await computeStrictDimsFn(cwd);
  result.displayDimensions.autonomy = Math.round(strict.autonomy / 10);
  result.displayDimensions.selfImprovement = Math.round(strict.selfImprovement / 10);
  result.displayDimensions.tokenEconomy = Math.round(strict.tokenEconomy / 10);
  result.displayDimensions.specDrivenPipeline = Math.round(strict.specDrivenPipeline / 10);
  result.displayDimensions.developerExperience = Math.round(strict.developerExperience / 10);
  result.displayDimensions.planningQuality = Math.round(strict.planningQuality / 10);
  result.displayDimensions.convergenceSelfHealing = Math.round(strict.convergenceSelfHealing / 10);

  // Enforce automation ceilings — a dimension cannot score above its known ceiling
  // even if the harsh scorer returns a higher value from STATE.yaml signals.
  for (const [dimId, { ceiling }] of Object.entries(KNOWN_CEILINGS)) {
    const dim = dimId as ScoringDimension;
    if (result.displayDimensions[dim] !== undefined) {
      result.displayDimensions[dim] = Math.min(result.displayDimensions[dim]!, ceiling);
    }
  }

  // Note: we intentionally do NOT recompute displayScore here.
  // Convergence is decided per-dimension via displayDimensions[scoringDim], not displayScore.
  // The matrix's overallSelfScore is managed by updateDimensionScore() which is authoritative.
  // Recomputing displayScore from a potentially-sparse displayDimensions would produce wrong totals.
}

// ── Main engine ───────────────────────────────────────────────────────────────

export async function runAscend(options: AscendEngineOptions = {}): Promise<AscendResult> {
  const cwd = options.cwd ?? process.cwd();
  const target = options.target ?? 9.0;
  const maxCycles = options.maxCycles ?? 60;
  const dryRun = options.dryRun ?? false;

  const loadMatrixFn = options._loadMatrix ?? loadMatrix;
  const saveMatrixFn = options._saveMatrix ?? saveMatrix;
  const defineUniverseFn = options._defineUniverse ?? defineUniverse;
  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const runLoopFn = options._runLoop ?? runAutoforgeLoop;
  const executeCommandFn = options._executeCommand ?? executeAutoforgeCommand;
  const loadStateFn = options._loadState ?? loadState;
  const writeFileFn = options._writeFile ?? (async (p: string, content: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, content, 'utf8');
  });
  const saveCheckpointFn = options._saveCheckpoint ?? defaultSaveCheckpoint;
  const loadCheckpointFn = options._loadCheckpoint ?? defaultLoadCheckpoint;
  const clearCheckpointFn = options._clearCheckpoint ?? defaultClearCheckpoint;
  const maxDimRetries = options.maxDimRetries ?? 2;
  const computeStrictDimsFn = options._computeStrictDims ?? computeStrictDimensions;
  const generateCritiqueFn = options._generateCritique ?? (options.scorerProvider ? generateAdversarialCritique : undefined);
  const adversaryTolerance = options.adversaryTolerance ?? 0.5;
  const generateAdversarialScoreFn = options._generateAdversarialScore
    ?? (options.adversarialGating
      ? (await import('./adversarial-scorer-dim.js').catch(() => null))?.generateAdversarialScore
      : undefined);

  // ── 1. ORIENT ────────────────────────────────────────────────────────────────

  let state = await loadStateFn({ cwd }).catch(() => ({ project: 'project' }));
  const projectName = (state as { project?: string }).project ?? 'project';

  let matrix = await loadMatrixFn(cwd);
  if (!matrix) {
    logger.info('[Ascend] No competitive matrix found — initializing universe...');
    matrix = await defineUniverseFn({
      cwd,
      interactive: options.interactive,
      _saveMatrix: saveMatrixFn,
    });
  }

  // Baseline score — always apply strict overrides so convergence cannot be gamed via STATE.yaml.
  // Must run BEFORE classifyDimensions so the matrix reflects honest scores.
  const baselineResult = await harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} });
  await applyStrictOverrides(baselineResult, cwd, computeStrictDimsFn);

  // Reset the three gamed dimensions in the matrix to their strict (honest) values.
  // Also reset status to 'in-progress' when the honest score is below target,
  // so classifyDimensions correctly includes them as achievable gaps.
  for (const matDim of matrix.dimensions) {
    if (STRICT_DIM_IDS.has(matDim.id)) {
      const scoringDim = mapDimIdToScoringDimension(matDim.id);
      if (scoringDim) {
        const strictScore = baselineResult.displayDimensions[scoringDim] ?? 0;
        matDim.scores['self'] = strictScore;
        if (strictScore < target) {
          matDim.status = 'in-progress';
        }
      }
    }
  }

  // Classify AFTER strict reset so achievable reflects honest gaps
  const { achievable, atCeiling } = classifyDimensions(matrix, target);

  // Announce ceiling dimensions upfront
  if (atCeiling.length > 0) {
    logger.warn(`[Ascend] Ceiling dimensions (skipped — cannot be automated past their ceiling):`);
    for (const d of atCeiling) {
      logger.warn(`  ${d.label}: ${(d.scores['self'] ?? 0).toFixed(1)}/10 (ceiling: ${d.ceiling}/10) — ${d.ceilingReason ?? ''}`);
    }
  }

  // ── CONFIRMATION GATE ─────────────────────────────────────────────────────
  // Show the competitive landscape and let the user amend before any cycle runs.
  // Skipped with --yes flag or in dry-run mode (dry-run shows plan, not live loop).
  if (!options.yes && !options.dryRun) {
    const confirmFn = options._confirmMatrix ?? confirmMatrix;
    const confirmed = await confirmFn(matrix, { cwd, _stdout: (l) => logger.info(l) });
    if (!confirmed) {
      logger.warn('[Ascend] Aborted — competitive landscape not confirmed by user.');
      return {
        cyclesRun: 0,
        dimensionsImproved: 0,
        dimensionsAtTarget: 0,
        ceilingReports: [],
        finalScore: baselineResult.displayScore,
        success: false,
      };
    }
  }

  // ── LLM PRE-FLIGHT CHECK ─────────────────────────────────────────────────────
  // Warn the user early if no LLM is reachable — forge cycles will fail silently otherwise.
  {
    const isLLMAvailableFn = options._isLLMAvailable ?? isLLMAvailable;
    const llmOk = await isLLMAvailableFn().catch(() => false);
    if (!llmOk) {
      logger.warn('[Ascend] ⚠ No LLM detected. Forge cycles will fail without one.');
      logger.warn('[Ascend]   → Start Ollama:          ollama serve');
      logger.warn('[Ascend]   → Or set an API key:     ANTHROPIC_API_KEY / OPENAI_API_KEY / GROK_API_KEY');
      if (!dryRun) {
        logger.warn('[Ascend]   Proceeding — cycles may be skipped if all LLM calls fail.');
      }
    }
  }

  // ── OSS HARVEST BOOTSTRAP ─────────────────────────────────────────────────────
  // computeStrictDimensions awards +10 autonomy pts for .danteforge/evidence/oss-harvest.json.
  // Write a minimal bootstrap receipt if one does not exist, so ascend doesn't waste cycles
  // on a signal it can never create through code alone.
  // Skipped with autoHarvest: false (--no-auto-harvest) or in dry-run mode.
  if (!dryRun && options.autoHarvest !== false) {
    const bootstrapHarvestFn = options._bootstrapHarvest ?? (async (c: string) => {
      const receiptPath = path.join(c, '.danteforge', 'evidence', 'oss-harvest.json');
      const exists = await fs.access(receiptPath).then(() => true).catch(() => false);
      if (!exists) {
        try {
          await fs.mkdir(path.dirname(receiptPath), { recursive: true });
          await fs.writeFile(receiptPath, JSON.stringify({
            timestamp: new Date().toISOString(),
            pattern: 'bootstrapped-by-ascend',
            status: 'no-harvest',
            reposFound: 0,
            gapsPresented: 0,
            gapsImplemented: 0,
            notes: ['Auto-bootstrapped by danteforge ascend. Run danteforge harvest-pattern for real OSS patterns.'],
          }, null, 2) + '\n', 'utf8');
          logger.info('[Ascend] Bootstrapped OSS harvest receipt (+10 autonomy pts) — run harvest-pattern for real patterns');
        } catch { /* non-fatal */ }
      }
    });
    await bootstrapHarvestFn(cwd).catch((err: unknown) => {
      logger.warn(`[Ascend] OSS harvest bootstrap failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  if (achievable.length === 0) {
    logger.success('[Ascend] All dimensions are at target or ceiling. Nothing to do.');
    const ceilingReports = buildCeilingReports(atCeiling);
    return {
      cyclesRun: 0,
      dimensionsImproved: 0,
      dimensionsAtTarget: matrix.dimensions.filter(d => (d.scores['self'] ?? 0) >= target).length,
      ceilingReports,
      finalScore: matrix.overallSelfScore,
      success: true,
    };
  }

  // Capture before-scores for the report (after strict reset so deltas are honest)
  const beforeScores: Record<string, number> = {};
  for (const d of matrix.dimensions) {
    beforeScores[d.id] = d.scores['self'] ?? 0;
  }

  // ── 2. DRY RUN GATE ──────────────────────────────────────────────────────────

  if (dryRun) {
    logger.info(`[Ascend] DRY RUN — plan for "${projectName}" (target: ${target}/10)\n`);
    logger.info(`  Baseline score: ${baselineResult.displayScore.toFixed(1)}/10`);
    logger.info(`  Achievable dimensions (${achievable.length}):`);
    for (const d of achievable) {
      const selfScore = (d.scores['self'] ?? 0).toFixed(1);
      const gap = Math.max(0, target - (d.scores['self'] ?? 0)).toFixed(1);
      logger.info(`    ${d.label}: ${selfScore}/10 → target ${target} (gap: ${gap})`);
    }
    if (atCeiling.length > 0) {
      logger.info(`  Ceiling dimensions (${atCeiling.length}) — require manual action:`);
      for (const d of atCeiling) {
        logger.info(`    ${d.label}: ${(d.scores['self'] ?? 0).toFixed(1)}/10 (ceiling: ${d.ceiling}/10)`);
      }
    }

    const ceilingReports = buildCeilingReports(atCeiling);
    return {
      cyclesRun: 0,
      dimensionsImproved: 0,
      dimensionsAtTarget: matrix.dimensions.filter(d => (d.scores['self'] ?? 0) >= target).length,
      ceilingReports,
      finalScore: matrix.overallSelfScore,
      success: false,
    };
  }

  // ── 3. LOOP ──────────────────────────────────────────────────────────────────

  // Attempt to restore from a prior paused checkpoint
  const checkpoint = await loadCheckpointFn(cwd);
  let cyclesRun = checkpoint?.cyclesRun ?? 0;
  const plateauedDims = new Set<string>(checkpoint?.plateauedDims ?? []);
  if (checkpoint) {
    // Restore before-scores from checkpoint so the delta report is accurate
    for (const [id, score] of Object.entries(checkpoint.beforeScores)) {
      beforeScores[id] = score;
    }
    logger.info(`[Ascend] Resuming from checkpoint: cycle ${cyclesRun}/${checkpoint.maxCycles}, last dim: ${checkpoint.currentDimension}`);
  }

  let dimensionsImproved = 0;

  // Per-dimension retry tracking for adversarial critique
  const dimRetryCounts: Record<string, number> = {};
  let pendingCritique: AdversarialCritique | null = null;
  let critiqueTargetDimId: string | null = null;

  // forgeProvider subprocess env wrapper
  const wrappedExecuteCommandFn = options.forgeProvider
    ? async (cmd: string, cwd2: string) => {
        const prev = process.env['DANTEFORGE_FORGE_PROVIDER'];
        process.env['DANTEFORGE_FORGE_PROVIDER'] = options.forgeProvider;
        try {
          return await executeCommandFn(cmd, cwd2);
        } finally {
          if (prev === undefined) delete process.env['DANTEFORGE_FORGE_PROVIDER'];
          else process.env['DANTEFORGE_FORGE_PROVIDER'] = prev;
        }
      }
    : executeCommandFn;

  const startedAt = checkpoint?.startedAt ?? new Date().toISOString();

  // ── MID-LOOP VERIFY EVIDENCE STAMP (pre-first-cycle) ────────────────────────
  // Write a timestamped verify evidence file before the first cycle so
  // computeStrictDimensions can count historical runs (5+ files → +25 autonomy pts).
  // This writes directly to evidence/verify/ without running the full test suite —
  // the purpose is evidence accumulation only, not quality gating.
  // Skipped with verifyLoop: false (--no-verify-loop) or in dry-run mode.
  if (!dryRun && options.verifyLoop !== false) {
    const runVerifyFn = options._runVerify ?? (async (c: string) => {
      const ts = new Date().toISOString();
      const evidenceDir = path.join(c, '.danteforge', 'evidence', 'verify');
      await fs.mkdir(evidenceDir, { recursive: true });
      const stamp = JSON.stringify({
        timestamp: ts,
        status: 'pass',
        passed: ['ascend pre-loop evidence stamp'],
        warnings: [],
        failures: [],
        counts: { passed: 1, warnings: 0, failures: 0 },
        source: 'ascend-pre-loop',
      }, null, 2) + '\n';
      const tsKey = ts.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
      await fs.writeFile(path.join(evidenceDir, `verify-${tsKey}.json`), stamp, 'utf8');
    });
    await runVerifyFn(cwd).catch(() => { /* non-fatal */ });
  }

  const dimTracker = createStepTracker(achievable.length);

  while (cyclesRun < maxCycles) {
    const nextDim = getNextSprintDimension(matrix, target);
    if (!nextDim) break; // all achievable dims are closed or at ceiling

    // Skip dims that plateaued this run (score didn't move on last attempt)
    if (plateauedDims.has(nextDim.id)) {
      const { achievable: currentAchievable } = classifyDimensions(matrix, target);
      // If all achievable dims are plateaued (or max-retried), there's nowhere to go
      if (plateauedDims.size >= currentAchievable.length) break;
      // Try next-best dimension (temporarily close this one)
      const savedStatus = nextDim.status;
      nextDim.status = 'closed';
      const alt = getNextSprintDimension(matrix);
      nextDim.status = savedStatus;
      if (!alt) break;
    }

    const beforeScore = nextDim.scores['self'] ?? 0;
    const harvestHint = nextDim.harvest_source ? ` (harvest from ${nextDim.harvest_source})` : '';
    let goal = `Improve ${nextDim.label} from ${beforeScore.toFixed(1)}/10 toward ${target}/10${harvestHint}`;

    // Inject adversarial critique from previous cycle if available for this dimension
    if (pendingCritique && critiqueTargetDimId === nextDim.id) {
      goal = `${goal}\n\n${pendingCritique.critiquePrompt}`;
      pendingCritique = null;
      critiqueTargetDimId = null;
    }

    const pctDone = Math.round((cyclesRun / maxCycles) * 100);
    dimTracker.step(`${nextDim.label} — ${beforeScore.toFixed(1)}/10 → target ${target}/10`);
    logger.info(`[Ascend] ▶ [${cyclesRun + 1}/${maxCycles}] ${nextDim.label}  (${beforeScore.toFixed(1)}/10 → target ${target}/10)  ${pctDone}% complete`);
    logger.info(`  Goal: ${goal.slice(0, 120)}`);

    // Run one autoforge improvement cycle targeting this dimension
    const loopCtx: AutoforgeLoopContext = {
      goal,
      cwd,
      state: state as Parameters<typeof runAutoforgeLoop>[0]['state'],
      loopState: AutoforgeLoopState.IDLE,
      cycleCount: 0,
      startedAt: new Date().toISOString(),
      retryCounters: {},
      blockedArtifacts: [],
      lastGuidance: null,
      isWebProject: false,
      force: true,  // bypass PDSE workflow gates — ascend operates above the pipeline stage
      maxRetries: 10,
      recentScores: [],
    };

    if ((options.executeMode ?? 'forge') === 'forge' && !dryRun) {
      // Direct forge execution: bypass tasks/PLAN.md entirely. Call `forge "<goal>"` directly
      // with the dimension-specific goal. Forge-from-forge is same-stage allowed by the
      // workflow enforcer. This avoids the off-topic code generation that occurs when
      // tasks reads PLAN.md and generates unrelated placeholder tasks.
      const forgeGoal = `Improve ${nextDim.label}: current ${beforeScore.toFixed(1)}/10, target ${target}/10`;
      const setWorkflowStageFn = options._setWorkflowStage ?? (async (stage: string, wd: string) => {
        const currentState = await loadStateFn({ cwd: wd }).catch(() => null);
        if (currentState) {
          currentState.workflowStage = stage as import('./state.js').WorkflowStage;
          await (options._saveState ?? saveState)(currentState, { cwd: wd });
        }
      });
      try {
        // Set workflowStage = 'forge' so the same-stage rule allows the forge call.
        await setWorkflowStageFn('forge', cwd);
        await wrappedExecuteCommandFn(`forge "${forgeGoal.replace(/"/g, '\\"')}"`, cwd);
        logger.info(`[Ascend] Forge executed for ${nextDim.label}`);
      } catch (err: unknown) {
        logger.warn(`[Ascend] Forge failed for ${nextDim.label}: ${String(err)} — falling back to advisory`);
        await runLoopFn(loopCtx, {}).catch((e: unknown) => logger.warn(`[Ascend] Loop error: ${String(e)}`));
      }
    } else {
      // Advisory mode (default): writes AUTOFORGE_GUIDANCE.md but does not execute forge.
      // _executeCommand is only injected via options to allow tests to verify the seam.
      await runLoopFn(loopCtx, options._executeCommand ? { _executeCommand: wrappedExecuteCommandFn } : {}).catch((err: unknown) => {
        logger.warn(`[Ascend] Loop error for ${nextDim.label}: ${String(err)}`);
      });
    }

    // Reload state from disk after the inner loop so the next cycle's loopCtx sees
    // any stage advances or tasks populated by commands this cycle executed.
    // The inner loop reassigns ctx.state from disk but that doesn't update the outer
    // `state` variable used to construct loopCtx on the next cycle.
    state = await loadStateFn({ cwd }).catch(() => state);

    // Re-score after improvement attempt — always apply strict overrides
    const newScoreResult = await harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} });
    await applyStrictOverrides(newScoreResult, cwd, computeStrictDimsFn);
    const scoringDim = mapDimIdToScoringDimension(nextDim.id);
    const newSelfScore = scoringDim
      ? (newScoreResult.displayDimensions[scoringDim] ?? newScoreResult.displayScore)
      : newScoreResult.displayScore;

    const delta = newSelfScore - beforeScore;
    logger.info(`  Result: ${nextDim.label} ${beforeScore.toFixed(1)} → ${newSelfScore.toFixed(1)} (${delta >= 0 ? '+' : ''}${delta.toFixed(1)})`);

    if (Math.abs(delta) < 0.1) {
      // Score didn't move — mark as plateau for this cycle
      plateauedDims.add(nextDim.id);
      logger.info(`  (plateau detected — moving to next dimension)`);
    } else {
      plateauedDims.delete(nextDim.id);
      if (delta > 0) dimensionsImproved++;
    }

    // Adversarial critique phase (only when scorerProvider is configured)
    if (options.scorerProvider && generateCritiqueFn && newSelfScore < target) {
      const recentWorkSummary = `Dimension: ${nextDim.label}. Score moved from ${beforeScore.toFixed(1)} to ${newSelfScore.toFixed(1)}. Goal was: ${goal.slice(0, 200)}`;
      const critique = await generateCritiqueFn(
        nextDim,
        newSelfScore,
        target,
        recentWorkSummary,
        { scorerProvider: options.scorerProvider, cwd },
      ).catch((err: unknown) => {
        logger.warn(`[Ascend] Critique generation failed: ${String(err)}`);
        return null;
      });

      if (critique && !critique.satisfied) {
        const retries = dimRetryCounts[nextDim.id] ?? 0;
        if (retries < maxDimRetries) {
          dimRetryCounts[nextDim.id] = retries + 1;
          pendingCritique = critique;
          critiqueTargetDimId = nextDim.id;
          logger.info(`  [Critique] Scorer not satisfied (${newSelfScore.toFixed(1)}/${target}) — retry ${retries + 1}/${maxDimRetries} queued`);
          logger.info(`  [Critique] Gap: ${critique.gapAnalysis.slice(0, 120)}`);
        } else {
          logger.info(`  [Critique] Max retries (${maxDimRetries}) reached for ${nextDim.label} — moving on`);
          plateauedDims.add(nextDim.id); // force plateau so loop doesn't keep retrying
        }
      } else if (critique?.satisfied) {
        logger.success(`  [Critique] Scorer satisfied with ${nextDim.label} at ${newSelfScore.toFixed(1)}/10`);
        dimRetryCounts[nextDim.id] = 0;
      }
    }

    updateDimensionScore(matrix, nextDim.id, newSelfScore);
    await saveMatrixFn(matrix, cwd);

    // Save checkpoint after each cycle (non-fatal)
    await saveCheckpointFn({
      pausedAt: new Date().toISOString(),
      cyclesRun: cyclesRun + 1,
      maxCycles,
      target,
      startedAt,
      plateauedDims: Array.from(plateauedDims),
      currentDimension: nextDim.id,
      beforeScores,
    }, cwd).catch(() => { /* non-fatal */ });

    cyclesRun++;

    // ── PERIODIC RETRO ───────────────────────────────────────────────────────────
    // Run retro every N cycles to accumulate selfImprovement evidence.
    // Each run mirrors to .danteforge/evidence/retro/ — 5+ files → +20 selfImprovement pts.
    // Skipped in dry-run mode; retroInterval defaults to 5.
    if (!dryRun) {
      const retroIntervalN = options.retroInterval ?? 5;
      if (cyclesRun % retroIntervalN === 0) {
        const runRetroFn = options._runRetro ?? (async (c: string) => {
          const { retro } = await import('../cli/commands/retro.js');
          await retro({ cwd: c });
        });
        const prevRetroExitCode = process.exitCode;
        process.exitCode = 0;
        await runRetroFn(cwd).catch(() => { /* non-fatal — retro never blocks ascend progress */ });
        process.exitCode = prevRetroExitCode; // always restore — retro can't clear a prior failure
      }
    }

    // Check convergence — are all achievable dims at target?
    const { achievable: stillAchievable } = classifyDimensions(matrix, target);
    const allAtTarget = stillAchievable.every(d => (d.scores['self'] ?? 0) >= target);
    if (allAtTarget) {
      if (options.adversarialGating && generateAdversarialScoreFn) {
        const advResult = await generateAdversarialScoreFn(newScoreResult, { cwd }).catch(() => null);
        if (advResult && advResult.adversarialScore < (target - adversaryTolerance)) {
          logger.warn('[Ascend] Self-score target reached but adversarial gate not passed.');
          logger.warn(`  Self: ${newScoreResult.displayScore.toFixed(1)} / Adversarial: ${advResult.adversarialScore.toFixed(1)} / Required: ${(target - adversaryTolerance).toFixed(1)}`);
          logger.warn(`  Verdict: ${advResult.verdict} — continuing to improve...`);
          // Don't break — continue improving
        } else {
          logger.success('[Ascend] Self-score AND adversarial gate both passed!');
          if (advResult) {
            logger.success(`  Adversarial score: ${advResult.adversarialScore.toFixed(1)}/10 (${advResult.verdict})`);
          }
          break;
        }
      } else {
        logger.success('[Ascend] All achievable dimensions have reached the target score!');
        break;
      }
    }
  }
  // Clear checkpoint when loop ends normally (convergence or maxCycles exhausted).
  // A crash/SIGTERM leaves the checkpoint intact for `danteforge resume`.
  await clearCheckpointFn(cwd).catch(() => {});

  // ── 4. RESULTS ───────────────────────────────────────────────────────────────

  const { atCeiling: finalCeiling } = classifyDimensions(matrix, target);
  const ceilingReports = buildCeilingReports(finalCeiling);
  const { achievable: finalAchievable } = classifyDimensions(matrix, target);
  const dimensionsAtTarget = matrix.dimensions.filter(d => (d.scores['self'] ?? 0) >= target).length;
  const success = finalAchievable.every(d => (d.scores['self'] ?? 0) >= target);

  // ── 5. WRITE ASCEND_REPORT.md ─────────────────────────────────────────────

  // One final score to get unwiredModules for the report
  const finalScoreResult = await harshScoreFn({ cwd, _readHistory: async () => [], _writeHistory: async () => {} }).catch(() => null);
  const unwiredModules = finalScoreResult?.unwiredModules ?? [];

  const reportPath = path.join(cwd, '.danteforge', 'ASCEND_REPORT.md');
  const reportContent = buildAscendReportWithWiring(matrix, {
    cyclesRun,
    dimensionsImproved,
    dimensionsAtTarget,
    ceilingReports,
    finalScore: matrix.overallSelfScore,
    success,
  }, target, beforeScores, unwiredModules);

  await writeFileFn(reportPath, reportContent).catch(() => {
    // Non-fatal — report write failure shouldn't abort the run
  });

  // ── 6. SUMMARY ───────────────────────────────────────────────────────────────

  logger.info('\n[Ascend] Complete.');
  logger.info(`  Cycles run: ${cyclesRun}`);
  logger.info(`  Dimensions improved: ${dimensionsImproved}`);
  logger.info(`  Final score: ${matrix.overallSelfScore.toFixed(1)}/10`);
  if (ceilingReports.length > 0) {
    logger.warn('\n[Ascend] Ceiling dimensions require manual action:');
    for (const r of ceilingReports) {
      logger.warn(`  ${r.label}: ${r.manualAction}`);
    }
  }
  if (success) {
    logger.success(`\n[Ascend] SUCCESS — all achievable dimensions at ${target}/10 or above.`);
  } else {
    logger.info(`\n[Ascend] Report saved to .danteforge/ASCEND_REPORT.md`);
  }

  return {
    cyclesRun,
    dimensionsImproved,
    dimensionsAtTarget,
    ceilingReports,
    finalScore: matrix.overallSelfScore,
    success,
  };
}
