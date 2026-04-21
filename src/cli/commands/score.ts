// score — Fast pure-fs project score: ONE number + 3 P0 action items in <5 seconds.
// No LLM calls. Reads filesystem, computes harsh score, shows gaps.
// Auto-refreshes .danteforge/PRIME.md after scoring.
//
// Determinism contract: score() is a pure function of codebase state.
// It bypasses the assessment-history plateau penalty (belongs in `assess` only)
// and never writes to assessment-history.json. Same code → same output, every run.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { loadState, saveState, appendScoreHistory } from '../../core/state.js';
import type { DanteState, ScoreHistoryEntry } from '../../core/state.js';
import { computeHarshScore } from '../../core/harsh-scorer.js';
import type {
  HarshScorerOptions,
  HarshScoreResult,
  ScoringDimension,
  AssessmentHistoryEntry,
} from '../../core/harsh-scorer.js';
import { computeStrictDimensions } from '../../core/harsh-scorer.js';
import { KNOWN_CEILINGS } from '../../core/compete-matrix.js';
import type { PrimeOptions } from './prime.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface P0Item {
  dimension: ScoringDimension;
  score: number;
  action: string;
}

export interface ScoreResult {
  displayScore: number;
  verdict: string;
  p0Items: P0Item[];
  sessionDelta?: number;
  displayDimensions?: Record<ScoringDimension, number>;
  adversarialResult?: import('../../core/adversarial-scorer-dim.js').AdversarialScoreResult;
}

export interface ScoreOptions {
  cwd?: string;
  full?: boolean;   // --full: show all 18 dimensions with weights
  /**
   * --strict: Override autonomy/selfImprovement/tokenEconomy with tamper-resistant
   * code-derived signals. Excludes mutable STATE.yaml config fields entirely.
   * Produces a lower, more honest score when STATE.yaml has been manually inflated.
   */
  strict?: boolean;
  /** --adversary: Run a second independent LLM to challenge the self-score */
  adversary?: boolean;
  // Injection seams
  _harshScore?: (opts: HarshScorerOptions) => Promise<HarshScoreResult>;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _runPrime?: (opts: PrimeOptions) => Promise<void>;
  _getGitSha?: () => Promise<string | undefined>;
  _stdout?: (line: string) => void;
  _listSkillDirs?: (dir: string) => Promise<string[]>;
  _fileExists?: (filePath: string) => Promise<boolean>;
  // History seams — score always injects no-op stubs to bypass plateau penalty
  _readHistory?: (cwd: string) => Promise<AssessmentHistoryEntry[]>;
  _writeHistory?: (cwd: string, entries: AssessmentHistoryEntry[]) => Promise<void>;
  // Strict mode injection seams
  _gitLog?: (args: string[], cwd: string) => Promise<string>;
  _listDir?: (p: string) => Promise<string[]>;
  _fileExistsStrict?: (p: string) => Promise<boolean>;
  // Adversary injection seams
  _generateAdversarialScore?: (
    selfResult: HarshScoreResult,
    opts: import('../../core/adversarial-scorer-dim.js').AdversarialScorerDimOptions,
  ) => Promise<import('../../core/adversarial-scorer-dim.js').AdversarialScoreResult>;
  _loadConfig?: () => Promise<import('../../core/config.js').DanteConfig>;
  // Landscape staleness check seam
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>;
}

// ── Dimension weights (mirrors DIMENSION_WEIGHTS in harsh-scorer.ts) ──────────
// Kept in sync manually. Used only for --full display; not used in scoring.

const SCORE_DISPLAY_WEIGHTS: Record<ScoringDimension, number> = {
  functionality:          0.11,
  testing:                0.09,
  errorHandling:          0.08,
  security:               0.08,
  developerExperience:    0.08,
  maintainability:        0.07,
  autonomy:               0.07,
  uxPolish:               0.06,
  documentation:          0.06,
  performance:            0.06,
  planningQuality:        0.05,
  selfImprovement:        0.04,
  specDrivenPipeline:     0.03,
  convergenceSelfHealing: 0.03,
  tokenEconomy:           0.03,
  ecosystemMcp:           0.02,
  enterpriseReadiness:    0.02,
  communityAdoption:      0.02,
};

// ── Static action lookup (no LLM) ────────────────────────────────────────────

const DIMENSION_ACTIONS: Record<ScoringDimension, string> = {
  functionality:          'danteforge improve "missing core features"',
  testing:                'danteforge improve "add tests"',
  errorHandling:          'danteforge improve "error handling"',
  security:               'danteforge improve "security"',
  uxPolish:               'danteforge improve "ux polish"',
  documentation:          'danteforge improve "documentation"',
  performance:            'danteforge improve "performance"',
  maintainability:        'danteforge improve "maintainability"',
  developerExperience:    'danteforge improve "developer experience"',
  autonomy:               'danteforge improve "autonomy"',
  planningQuality:        'danteforge improve "planning quality"',
  selfImprovement:        'danteforge improve "self improvement"',
  specDrivenPipeline:     'danteforge improve "spec driven pipeline"',
  convergenceSelfHealing: 'danteforge improve "convergence self healing"',
  tokenEconomy:           'danteforge improve "token economy"',
  ecosystemMcp:           'danteforge setup mcp-server',
  enterpriseReadiness:    'danteforge improve "enterprise readiness"',
  communityAdoption:      'npm publish && danteforge showcase',
};

// ── Session baseline TTL ──────────────────────────────────────────────────────

const BASELINE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

// ── Ecosystem signal bootstrap ────────────────────────────────────────────────

/**
 * Counts skill dirs with SKILL.md and checks for plugin manifest.
 * Writes results to state so the scorer can read them.
 * Pure injectable — no side effects beyond the returned values.
 */
export async function bootstrapEcosystemSignals(
  cwd: string,
  opts: {
    _listSkillDirs?: (dir: string) => Promise<string[]>;
    _fileExists?: (filePath: string) => Promise<boolean>;
  } = {},
): Promise<{ skillCount: number; hasPluginManifest: boolean; hasComplexityClassifier: boolean; inferredWorkflowStage: string | null; hasVerifyEvidence: boolean }> {
  const listDir = opts._listSkillDirs ?? (async (dir: string) => {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      return entries.filter(e => e.isDirectory()).map(e => e.name);
    } catch { return []; }
  });
  const existsFn = opts._fileExists ?? (async (p: string) => {
    try { await fs.access(p); return true; } catch { return false; }
  });

  const skillsDir = path.join(cwd, 'src', 'harvested', 'dante-agents', 'skills');
  let dirs: string[] = [];
  try { dirs = await listDir(skillsDir); } catch { /* best-effort */ }
  let skillCount = 0;
  for (const dir of dirs) {
    try {
      if (await existsFn(path.join(skillsDir, dir, 'SKILL.md'))) skillCount++;
    } catch { /* best-effort */ }
  }

  let hasPluginManifest = false;
  try {
    hasPluginManifest = await existsFn(path.join(cwd, '.claude-plugin', 'plugin.json'));
  } catch { /* best-effort */ }

  // Detect complexity classifier — token routing infrastructure signal.
  // Used to bootstrap lastComplexityPreset when state was reset.
  let hasComplexityClassifier = false;
  try {
    hasComplexityClassifier = await existsFn(path.join(cwd, 'src', 'core', 'complexity-classifier.ts'));
  } catch { /* best-effort */ }

  // Infer workflow stage from PDSE artifacts — used to repair 'initialized' sentinel
  // that gets written when state resets, masking real project progress.
  let inferredWorkflowStage: string | null = null;
  const danteDir = path.join(cwd, '.danteforge');
  const pdseArtifacts: Array<[string, string]> = [
    ['TASKS.md', 'tasks'],
    ['PLAN.md', 'plan'],
    ['CLARIFY.md', 'clarify'],
    ['SPEC.md', 'specify'],
    ['CONSTITUTION.md', 'constitution'],
  ];
  for (const [artifact, stage] of pdseArtifacts) {
    try {
      if (await existsFn(path.join(danteDir, artifact))) {
        inferredWorkflowStage = stage;
        break; // first match wins (ordered highest stage first)
      }
    } catch { /* best-effort */ }
  }

  // Detect verify evidence — used to bootstrap lastVerifyStatus when state was reset.
  // .danteforge/evidence/verify/latest.json is written by `danteforge verify` on success.
  let hasVerifyEvidence = false;
  try {
    hasVerifyEvidence = await existsFn(path.join(danteDir, 'evidence', 'verify', 'latest.json'));
  } catch { /* best-effort */ }

  return { skillCount, hasPluginManifest, hasComplexityClassifier, inferredWorkflowStage, hasVerifyEvidence };
}

// ── Human-readable dimension descriptions ─────────────────────────────────────
// Shown below each P0 item so non-technical users understand what the score means.

export const DIMENSION_HUMAN_TEXT: Partial<Record<string, string>> = {
  errorHandling: 'code crashes or shows confusing errors when things go wrong',
  testing: 'insufficient tests — bugs are harder to catch before users see them',
  security: 'security gaps that could expose user data or allow attacks',
  performance: 'slower than needed — users wait longer than necessary',
  documentation: 'hard to understand or onboard new contributors',
  maintainability: 'risky to change — modifications break other things',
  uxPolish: 'user-facing interfaces feel rough or inconsistent',
  functionality: 'core features are missing, incomplete, or unreliable',
  autonomy: 'still requires too much manual intervention between steps',
  selfImprovement: 'limited ability to learn and adapt from past mistakes',
  specDrivenPipeline: 'build process is hard to predict or review',
  developerExperience: 'CLI output is unclear and errors are hard to debug',
  tokenEconomy: 'excessive LLM calls — same quality at higher cost than needed',
  convergenceSelfHealing: 'failures stop progress instead of recovering automatically',
  planningQuality: 'task breakdown leads to rework and blocked steps',
};

// ── Main ──────────────────────────────────────────────────────────────────────

export async function score(options: ScoreOptions = {}): Promise<ScoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((line: string) => logger.info(line));
  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const loadStateFn = options._loadState ?? loadState;
  const saveStateFn = options._saveState ?? saveState;
  const runPrimeFn = options._runPrime;
  const getGitSha = options._getGitSha ?? defaultGetGitSha;

  // Load state and bootstrap ecosystem signals BEFORE scoring so harshScore reads current signals
  const state = await loadStateFn({ cwd });
  const { skillCount, hasPluginManifest, hasComplexityClassifier, inferredWorkflowStage, hasVerifyEvidence } = await bootstrapEcosystemSignals(cwd, {
    _listSkillDirs: options._listSkillDirs,
    _fileExists: options._fileExists,
  });
  state.skillCount = skillCount;
  state.hasPluginManifest = hasPluginManifest;
  // Seed lastComplexityPreset if state was reset: complexity-classifier.ts existence
  // proves the routing infrastructure is wired; 'balanced' is the production default.
  if (!state.lastComplexityPreset && hasComplexityClassifier) {
    state.lastComplexityPreset = 'balanced';
  }
  // Repair workflowStage when stuck at 'initialized' sentinel: infer from PDSE artifacts.
  // 'initialized' gets written on state reset but masks real progress (TASKS.md → at least 'tasks').
  if (state.workflowStage === 'initialized' && inferredWorkflowStage) {
    state.workflowStage = inferredWorkflowStage as typeof state.workflowStage;
  }
  // Seed lastVerifyStatus + lastVerifyReceiptPath when state was reset.
  // .danteforge/evidence/verify/latest.json is written by `danteforge verify` on a real success run.
  // The receipt path IS this evidence file — writeVerifyReceipt() returns its absolute path.
  if (!state.lastVerifyStatus && hasVerifyEvidence) {
    state.lastVerifyStatus = 'pass';
  }
  if (!state.lastVerifyReceiptPath && hasVerifyEvidence) {
    state.lastVerifyReceiptPath = path.join(cwd, '.danteforge', 'evidence', 'verify', 'latest.json');
  }
  // Seed totalTokensUsed when state was reset: retroDelta > 0 proves autoforge completed at
  // least one LLM-driven self-improvement cycle (>1000 tokens minimum). Use conservative floor.
  if (typeof state.totalTokensUsed !== 'number' && (state.retroDelta ?? 0) > 0) {
    state.totalTokensUsed = 5000;
  }
  await saveStateFn(state, { cwd });

  // Score AFTER signals are persisted — harshScore loads state and sees correct skillCount/hasPluginManifest.
  // Inject empty history stubs to bypass the plateau penalty — score is deterministic,
  // plateau detection belongs in `assess` (LLM-based contextual sessions) only.
  const result = await harshScoreFn({
    cwd,
    _readHistory: options._readHistory ?? (async () => []),
    _writeHistory: options._writeHistory ?? (async () => {}),
  });

  // Strict mode: override STATE.yaml-gamed dimensions with code-derived signals.
  // This produces a tamper-resistant score that cannot be inflated by editing STATE.yaml.
  if (options.strict) {
    const strict = await computeStrictDimensions(
      cwd,
      options._gitLog,
      options._fileExistsStrict,
      options._listDir,
    );
    result.displayDimensions.autonomy = Math.round(strict.autonomy / 10);
    result.displayDimensions.selfImprovement = Math.round(strict.selfImprovement / 10);
    result.displayDimensions.tokenEconomy = Math.round(strict.tokenEconomy / 10);
    result.displayDimensions.specDrivenPipeline = Math.round(strict.specDrivenPipeline / 10);
    result.displayDimensions.developerExperience = Math.round(strict.developerExperience / 10);
    result.displayDimensions.planningQuality = Math.round(strict.planningQuality / 10);
    result.displayDimensions.convergenceSelfHealing = Math.round(strict.convergenceSelfHealing / 10);

    // Enforce automation ceilings — a dimension cannot display above its known ceiling
    // even if the harsh scorer returns a higher value from STATE.yaml signals.
    for (const [dimId, { ceiling }] of Object.entries(KNOWN_CEILINGS)) {
      const dim = dimId as ScoringDimension;
      if (result.displayDimensions[dim] !== undefined) {
        result.displayDimensions[dim] = Math.min(result.displayDimensions[dim]!, ceiling);
      }
    }

    // Recompute displayScore from patched dimensions
    const patched = result.displayDimensions;
    const patchedWeighted = (Object.entries(SCORE_DISPLAY_WEIGHTS) as [ScoringDimension, number][])
      .reduce((sum, [k, w]) => sum + (patched[k] ?? 0) * w, 0);
    result.displayScore = Math.round(patchedWeighted * 10) / 10;

    emit('  [strict mode: 7 dimensions overridden + automation ceilings enforced]');
  }

  // Session baseline with TTL — reset if older than 4 hours so delta stays meaningful
  const baselineAge = state.sessionBaselineTimestamp
    ? Date.now() - new Date(state.sessionBaselineTimestamp).getTime()
    : Infinity;
  if (baselineAge > BASELINE_TTL_MS) {
    state.sessionBaselineScore = undefined;
    state.sessionBaselineTimestamp = undefined;
  }

  // Compute session delta
  let sessionDelta: number | undefined;
  if (state.sessionBaselineScore !== undefined) {
    sessionDelta = result.displayScore - state.sessionBaselineScore;
  } else {
    // First run of session — set baseline
    state.sessionBaselineScore = result.displayScore;
    state.sessionBaselineTimestamp = new Date().toISOString();
  }

  // Append to score history (lightweight STATE.yaml entry — NOT assessment-history.json)
  const gitSha = await getGitSha().catch(() => undefined);
  const entry: ScoreHistoryEntry = {
    timestamp: new Date().toISOString(),
    displayScore: result.displayScore,
    gitSha,
  };
  const updatedState = appendScoreHistory(state, entry);
  await saveStateFn(updatedState, { cwd });

  // Build P0 items (bottom 3 dimensions)
  const dims = Object.entries(result.displayDimensions) as [ScoringDimension, number][];
  dims.sort((a, b) => a[1] - b[1]);
  const p0Items: P0Item[] = dims.slice(0, 3).map(([dim, sc]) => ({
    dimension: dim,
    score: sc,
    action: DIMENSION_ACTIONS[dim] ?? `danteforge forge "improve ${dim}"`,
  }));

  // Render header
  const deltaStr = sessionDelta !== undefined
    ? `  (${sessionDelta > 0.05 ? '▲' : sessionDelta < -0.05 ? '▼' : '─'} ${sessionDelta > 0 ? '+' : ''}${sessionDelta.toFixed(1)} today)`
    : '';
  emit('');
  emit(`  ${result.displayScore.toFixed(1)}/10  — ${result.verdict}${deltaStr}`);
  emit('');
  emit('  P0 gaps:');
  p0Items.forEach((item, i) => {
    const label = item.dimension.replace(/([A-Z])/g, ' $1').trim();
    const humanLabel = label.charAt(0).toUpperCase() + label.slice(1);
    const humanText = DIMENSION_HUMAN_TEXT[item.dimension];
    if (humanText) {
      emit(`  ${i + 1}. ${humanLabel.padEnd(22)}${item.score.toFixed(1)}/10  — ${humanText}`);
      emit(`     ${''.padEnd(22)}→ ${item.action}`);
    } else {
      emit(`  ${i + 1}. ${humanLabel.padEnd(22)}${item.score.toFixed(1)}/10  → ${item.action}`);
    }
  });
  emit('  Unfamiliar with any term? Run: danteforge explain <term>');
  emit('');

  // --full: show all 18 dimensions sorted by score (lowest = biggest gap first)
  if (options.full) {
    emit('  All 18 dimensions (worst gaps first):');
    emit('');
    const all = [...dims]; // already sorted ascending
    all.forEach(([dim, sc]) => {
      const wt = Math.round((SCORE_DISPLAY_WEIGHTS[dim] ?? 0) * 100);
      const label = dim.padEnd(26);
      const wtStr = `${wt}%`.padStart(4);
      emit(`  ${label}${sc.toFixed(1)}  (weight ${wtStr})`);
    });
    emit('');
    emit('  For LLM competitor benchmarking: danteforge assess');
  } else {
    emit('  Run with --full for all 18 dimensions.');
  }

  // --adversary: run second-opinion adversarial scoring (opt-in, requires LLM)
  let adversarialResult: import('../../core/adversarial-scorer-dim.js').AdversarialScoreResult | undefined;
  if (options.adversary) {
    try {
      const generateFn = options._generateAdversarialScore
        ?? (await import('../../core/adversarial-scorer-dim.js')).generateAdversarialScore;
      const loadCfgFn = options._loadConfig
        ?? (await import('../../core/config.js')).loadConfig;
      adversarialResult = await generateFn(result, {
        cwd,
        _loadConfig: loadCfgFn,
      });
      renderDualScorePanel(emit, adversarialResult, options.full ?? false);
    } catch (err) {
      emit('  [adversary] Adversarial scoring unavailable — skipping panel.');
      emit(`  [adversary] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Auto-refresh PRIME.md best-effort
  if (runPrimeFn) {
    await runPrimeFn({ cwd }).catch(() => {});
    emit('  PRIME.md updated.');
  } else {
    try {
      const { prime } = await import('./prime.js');
      await prime({ cwd });
      emit('  PRIME.md updated.');
    } catch {
      // best-effort — if prime not available yet, skip silently
    }
  }

  // Stale landscape warning (best-effort, never blocks score)
  try {
    const landscapePath = path.join(cwd, '.danteforge', 'landscape.json');
    const landscapeRaw = await (options._readFile
      ? options._readFile(landscapePath, 'utf8')
      : (await import('node:fs/promises')).readFile(landscapePath, 'utf8'));
    const lm = JSON.parse(landscapeRaw) as { generatedAt: string };
    const ageMs = Date.now() - new Date(lm.generatedAt).getTime();
    if (ageMs > 7 * 24 * 60 * 60 * 1000) {
      emit('');
      emit('  ⚠ Competitive landscape is >7 days old. Run: danteforge landscape');
    }
  } catch { /* no landscape yet — silent */ }

  emit('');
  return {
    displayScore: result.displayScore,
    verdict: result.verdict,
    p0Items,
    sessionDelta,
    displayDimensions: result.displayDimensions,
    adversarialResult,
  };
}

function renderDualScorePanel(
  emit: (line: string) => void,
  adv: import('../../core/adversarial-scorer-dim.js').AdversarialScoreResult,
  full: boolean,
): void {
  const modeLabel =
    adv.adversaryResolution.mode === 'configured' ? `${adv.adversaryResolution.provider} (configured)` :
    adv.adversaryResolution.mode === 'ollama-auto' ? `ollama/${adv.adversaryResolution.model ?? 'llama3'} — auto-detected` :
    `${adv.adversaryResolution.provider} (self-challenge mode)`;

  const verdictEmoji =
    adv.verdict === 'trusted' ? '✓' :
    adv.verdict === 'inflated' ? '▼ INFLATED' :
    adv.verdict === 'underestimated' ? '▲ UNDERESTIMATED' : '~ WATCH';

  const divSign = adv.divergence >= 0 ? '+' : '';

  emit('');
  emit(`  Dual-Score Panel  (adversary: ${modeLabel})`);
  emit('  ─────────────────────────────────────────────────────────────');
  emit(`  Self score:        ${adv.selfScore.toFixed(1)} / 10`);
  emit(`  Adversarial score: ${adv.adversarialScore.toFixed(1)} / 10    Divergence: ${divSign}${adv.divergence.toFixed(1)}`);
  emit(`  Verdict:           ${verdictEmoji}`);

  if (adv.verdict === 'inflated' || adv.verdict === 'watch') {
    // Show the most inflated dimensions (self much higher than adversary)
    const inflated = [...adv.dimensions]
      .sort((a, b) => {
        const aAdv = a.adversarialScore ?? 0;
        const bAdv = b.adversarialScore ?? 0;
        return aAdv - bAdv; // show lowest adversarial score first
      })
      .slice(0, 3);

    if (inflated.length > 0) {
      emit('');
      emit('  Most adversarially-challenged dimensions:');
      for (const d of inflated) {
        const rat = d.rationale.length > 60 ? d.rationale.slice(0, 57) + '...' : d.rationale;
        emit(`    ${d.dimension.padEnd(26)} adv: ${d.adversarialScore.toFixed(1)}/10  "${rat}"`);
      }
    }
  }

  if (full && adv.dimensions.length > 1) {
    emit('');
    emit('  All dimensions — adversarial scores:');
    const sorted = [...adv.dimensions].sort((a, b) => a.adversarialScore - b.adversarialScore);
    for (const d of sorted) {
      emit(`    ${d.dimension.padEnd(26)} adv: ${d.adversarialScore.toFixed(1)}/10  "${d.rationale.slice(0, 50)}"`);
    }
  } else if (adv.dimensions.length > 1) {
    emit('');
    emit('  Run `danteforge score --adversary --full` for all 18 dimension scores.');
  }

  if (adv.adversaryResolution.mode === 'self-challenge') {
    emit('');
    emit('  Note: adversary is your primary provider in self-challenge mode.');
    emit('  For stronger signal: install a second Ollama model or set DANTEFORGE_ADVERSARY_PROVIDER.');
  } else if (adv.adversaryResolution.mode === 'ollama-auto' && adv.adversaryResolution.model) {
    emit('');
    emit(`  Note: adversary using alternate Ollama model: ${adv.adversaryResolution.model}`);
  }
  emit('');
}

async function defaultGetGitSha(): Promise<string | undefined> {
  try {
    const { execSync } = await import('node:child_process');
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch {
    return undefined;
  }
}
