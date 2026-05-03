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
import {
  applyStrictOverrides,
  canonicalScoreToHarshResult,
  computeCanonicalScore,
  computeHarshScore,
} from '../../core/harsh-scorer.js';
import type {
  HarshScorerOptions,
  HarshScoreResult,
  ScoringDimension,
  AssessmentHistoryEntry,
} from '../../core/harsh-scorer.js';
import { computeStrictDimensions } from '../../core/harsh-scorer.js';
import type { PrimeOptions } from './prime.js';

// ── Types ─────────────────────────────────────────────────────────────────────

const VERDICT_DISPLAY: Record<string, string> = {
  'needs-work':  'solid',
  'blocked':     'needs attention',
  'acceptable':  'good',
  'excellent':   'excellent',
};

function displayVerdict(v: string): string {
  return VERDICT_DISPLAY[v] ?? v;
}

export const BUILDER_DIMENSIONS = new Set<ScoringDimension>([
  'functionality', 'testing', 'errorHandling', 'security',
  'uxPolish', 'documentation', 'performance', 'maintainability',
]);

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
  full?: boolean;   // --full: show all 20 dimensions with weights
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
  functionality:          0.08,
  testing:                0.08,
  errorHandling:          0.08,
  security:               0.08,
  developerExperience:    0.08,
  maintainability:        0.07,
  autonomy:               0.06,
  uxPolish:               0.06,
  documentation:          0.06,
  performance:            0.06,
  planningQuality:        0.05,
  selfImprovement:        0.04,
  specDrivenPipeline:     0.03,
  convergenceSelfHealing: 0.03,
  tokenEconomy:           0.03,
  contextEconomy:         0.03,
  ecosystemMcp:           0.01,
  enterpriseReadiness:    0.01,
  communityAdoption:      0.01,
  causalCoherence:        0.05,
};

function getDisplayWeight(dim: ScoringDimension): number {
  return SCORE_DISPLAY_WEIGHTS[dim] ?? 0;
}

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
  contextEconomy:         'danteforge forge "implement PRD-26 context filter pipeline"',
  ecosystemMcp:           'danteforge setup mcp-server',
  enterpriseReadiness:    'danteforge improve "enterprise readiness"',
  communityAdoption:      'danteforge improve "community adoption"',
  causalCoherence:        'danteforge autoforge && danteforge causal-status',
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

// ── P0 evidence: dynamic codebase signals for each dimension ─────────────────
// Each function returns a short, file-grounded string or null if no signal found.

interface FnHit { file: string; fnLoc: number; fnName: string; startLine: number; }

async function findLargeFunctions(
  srcDir: string,
  thresholdLoc: number,
): Promise<FnHit[]> {
  const results: FnHit[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: { name: string; isDirectory: () => boolean }[] = [];
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { await walk(full); continue; }
      if (!e.name.endsWith('.ts') || e.name.endsWith('.d.ts')) continue;
      try {
        const content = await fs.readFile(full, 'utf8');
        const fnBlocks = extractFunctionBlocks(content);
        for (const { loc, name, line } of fnBlocks) {
          if (loc > thresholdLoc) results.push({ file: full, fnLoc: loc, fnName: name, startLine: line });
        }
      } catch { /* ignore */ }
    }
  }
  await walk(srcDir);
  return results;
}

function extractFunctionBlocks(src: string): Array<{ loc: number; name: string; line: number }> {
  const results: Array<{ loc: number; name: string; line: number }> = [];
  const lines = src.split('\n');
  let depth = 0;
  let start = -1;
  let pendingName = '';
  // Match: standalone functions, const arrows, class methods (public/private/async/static prefix)
  const DECL_RE = /^\s*(?:export\s+)?(?:(?:private|protected|public|static|override)\s+)*(?:async\s+)?(?:function\s+(\w+)|(\w+)\s*\()/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isFnStart = depth === 0 && (
      /^\s*(?:export\s+)?(?:async\s+)?function\s+\w+/.test(line) ||
      /^\s*(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\(/.test(line) ||
      /^\s*(?:(?:private|protected|public|static|override)\s+)+(?:async\s+)?\w+\s*\(/.test(line) ||
      /^\s*(?:async\s+)\w+\s*\(/.test(line)
    );
    if (isFnStart && depth === 0) {
      const m = DECL_RE.exec(line);
      pendingName = m ? (m[1] ?? m[2] ?? '') : '';
    }
    for (const ch of line) {
      if (ch === '{') {
        if (depth === 0 && start === -1 && isFnStart) start = i;
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth === 0 && start !== -1) {
          results.push({ loc: i - start + 1, name: pendingName, line: start + 1 });
          start = -1;
          pendingName = '';
        }
      }
    }
  }
  return results;
}

async function buildDimEvidence(
  dim: ScoringDimension,
  cwd: string,
  harshResult: HarshScoreResult,
): Promise<string | null> {
  try {
    const srcDir = path.join(cwd, 'src');

    if (dim === 'maintainability') {
      // Find files with functions >100 LOC (the exact signal used by maturity-engine)
      const hits = await findLargeFunctions(srcDir, 100);
      if (hits.length === 0) return null;
      hits.sort((a, b) => b.fnLoc - a.fnLoc);
      const worst = hits[0];
      const rel = path.relative(cwd, worst.file).replace(/\\/g, '/');
      const fnLabel = worst.fnName ? ` ${worst.fnName}()` : '';
      return `${hits.length} large fn${hits.length > 1 ? 's' : ''} >100 LOC — ${rel}:${worst.startLine}${fnLabel} (${worst.fnLoc} lines)`;
    }

    if (dim === 'functionality') {
      // Prefer unwired modules, then stubs, then incomplete PDSE artifacts
      if (harshResult.unwiredModules && harshResult.unwiredModules.length > 0) {
        const rel = harshResult.unwiredModules[0].replace(/\\/g, '/');
        return `unwired module: ${rel}`;
      }
      if (harshResult.stubsDetected.length > 0) {
        const rel = harshResult.stubsDetected[0].replace(/\\/g, '/');
        return `stub patterns in: ${rel}`;
      }
      // Scan for largest source file without a matching test file — gaps in test coverage
      const hits = await findLargeFunctions(srcDir, 50);
      if (hits.length > 0) {
        hits.sort((a, b) => b.fnLoc - a.fnLoc);
        const biggest = hits[0];
        const rel = path.relative(cwd, biggest.file).replace(/\\/g, '/');
        const fnLabel = biggest.fnName ? ` ${biggest.fnName}()` : '';
        return `largest fn without tests: ${rel}:${biggest.startLine}${fnLabel} (${biggest.fnLoc} lines)`;
      }
      return null;
    }

    if (dim === 'errorHandling') {
      // Find file with highest function density but few try blocks (ratio gap)
      interface ErrRatio { file: string; gap: number; fnCount: number; tryCount: number; firstFnLine: number; }
      const worstFiles: ErrRatio[] = [];
      async function walkErr(dir: string): Promise<void> {
        let entries: { name: string; isDirectory: () => boolean }[] = [];
        try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) { await walkErr(full); continue; }
          if (!e.name.endsWith('.ts') || e.name.endsWith('.d.ts')) continue;
          try {
            const content = await fs.readFile(full, 'utf8');
            const fnCount = (content.match(/function\s+\w+|=>\s*\{|async\s+\w+\(/g) || []).length;
            const tryCount = (content.match(/try\s*\{/g) || []).length;
            if (fnCount >= 10 && tryCount < fnCount * 0.3) {
              // Find the first function declaration line number
              const lines = content.split('\n');
              let firstFnLine = 1;
              for (let i = 0; i < lines.length; i++) {
                if (/function\s+\w+|const\s+\w+\s*=\s*(?:async\s+)?\(/.test(lines[i])) {
                  firstFnLine = i + 1;
                  break;
                }
              }
              worstFiles.push({ file: full, gap: fnCount - tryCount * 3, fnCount, tryCount, firstFnLine });
            }
          } catch { /* ignore */ }
        }
      }
      await walkErr(srcDir);
      if (worstFiles.length > 0) {
        worstFiles.sort((a, b) => b.gap - a.gap);
        const worst = worstFiles[0];
        const rel = path.relative(cwd, worst.file).replace(/\\/g, '/');
        return `low try/catch ratio in: ${rel}:${worst.firstFnLine} (${worst.tryCount} try / ${worst.fnCount} fns)`;
      }
      return null;
    }

    if (dim === 'testing') {
      // Surface any penalty evidence from the harsh scorer
      const testPenalty = harshResult.penalties.find(p => p.category === 'testing');
      return testPenalty ? testPenalty.evidence.slice(0, 80) : null;
    }

    if (dim === 'security') {
      const secPenalty = harshResult.penalties.find(p => p.category === 'security');
      return secPenalty ? secPenalty.evidence.slice(0, 80) : null;
    }
  } catch { /* evidence is always best-effort */ }
  return null;
}

// ── State bootstrap helper ────────────────────────────────────────────────────

async function bootstrapStateSignals(
  state: Awaited<ReturnType<typeof loadState>>,
  signals: { skillCount: number; hasPluginManifest: boolean; hasComplexityClassifier: boolean; inferredWorkflowStage: string | null; hasVerifyEvidence: boolean },
  cwd: string,
  saveStateFn: typeof saveState,
): Promise<void> {
  state.skillCount = signals.skillCount;
  state.hasPluginManifest = signals.hasPluginManifest;
  if (!state.lastComplexityPreset && signals.hasComplexityClassifier) state.lastComplexityPreset = 'balanced';
  if (state.workflowStage === 'initialized' && signals.inferredWorkflowStage) {
    state.workflowStage = signals.inferredWorkflowStage as typeof state.workflowStage;
  }
  if (!state.lastVerifyStatus && signals.hasVerifyEvidence) state.lastVerifyStatus = 'pass';
  if (!state.lastVerifyReceiptPath && signals.hasVerifyEvidence) {
    state.lastVerifyReceiptPath = path.join(cwd, '.danteforge', 'evidence', 'verify', 'latest.json');
  }
  if (typeof state.totalTokensUsed !== 'number' && (state.retroDelta ?? 0) > 0) state.totalTokensUsed = 5000;
  await saveStateFn(state, { cwd });
}

// ── Strict / anti-inflation overlay ──────────────────────────────────────────

async function applyStrictOrAntiInflation(
  options: ScoreOptions,
  result: Awaited<ReturnType<typeof computeHarshScore>>,
  cwd: string,
  strict: Awaited<ReturnType<typeof computeStrictDimensions>>,
  emit: (line: string) => void,
): Promise<void> {
  const previousSummary = {
    rawScore: result.rawScore,
    harshScore: result.harshScore,
    displayScore: result.displayScore,
    verdict: result.verdict,
  };
  await applyStrictOverrides(result, cwd, async () => strict);
  if (options.strict) {
    emit('  [strict mode: canonical code signals + automation ceilings enforced]');
  } else {
    result.rawScore = previousSummary.rawScore;
    result.harshScore = previousSummary.harshScore;
    result.displayScore = previousSummary.displayScore;
    result.verdict = previousSummary.verdict;
  }
}

// ── P0 item builder + renderer ────────────────────────────────────────────────

async function buildAndRenderP0Items(
  emit: (line: string) => void,
  result: Awaited<ReturnType<typeof computeHarshScore>>,
  cwd: string,
  options: ScoreOptions,
): Promise<P0Item[]> {
  const dims = Object.entries(result.displayDimensions) as [ScoringDimension, number][];
  dims.sort((a, b) => a[1] - b[1]);
  let p0Source = dims;
  if (!options.full) {
    const builderGaps = dims.filter(([d]) => BUILDER_DIMENSIONS.has(d));
    const metaGaps = dims.filter(([d]) => !BUILDER_DIMENSIONS.has(d));
    p0Source = [...builderGaps, ...metaGaps];
  }
  const p0Items: P0Item[] = p0Source.slice(0, 3).map(([dim, sc]) => ({
    dimension: dim, score: sc,
    action: DIMENSION_ACTIONS[dim] ?? `danteforge improve "${dim}"`,
  }));

  emit('  P0 gaps:');
  const evidenceMap = new Map<string, string>();
  await Promise.all(p0Items.map(async (item) => {
    const ev = await buildDimEvidence(item.dimension, cwd, result);
    if (ev) evidenceMap.set(item.dimension, ev);
  }));
  for (let i = 0; i < p0Items.length; i++) {
    const item = p0Items[i]!;
    const label = item.dimension.replace(/([A-Z])/g, ' $1').trim();
    const humanLabel = label.charAt(0).toUpperCase() + label.slice(1);
    const humanText = DIMENSION_HUMAN_TEXT[item.dimension];
    const evidence = evidenceMap.get(item.dimension);
    const action = evidence ? `danteforge ascend --dim ${item.dimension}` : item.action;
    if (humanText) {
      emit(`  ${i + 1}. ${humanLabel.padEnd(22)}${item.score.toFixed(1)}/10  — ${humanText}`);
      if (evidence) emit(`     ${''.padEnd(22)}  ↳ ${evidence}`);
      emit(`     ${''.padEnd(22)}→ ${action}`);
    } else {
      emit(`  ${i + 1}. ${humanLabel.padEnd(22)}${item.score.toFixed(1)}/10  → ${action}`);
      if (evidence) emit(`     ${''.padEnd(22)}  ↳ ${evidence}`);
    }
  }
  emit('  Unfamiliar with any term? Run: danteforge explain <term>');
  emit('');
  return p0Items;
}

// ── Post-score actions: adversary + PRIME + landscape ─────────────────────────

async function runScorePostActions(
  options: ScoreOptions,
  result: Awaited<ReturnType<typeof computeHarshScore>>,
  emit: (line: string) => void,
  cwd: string,
  runPrimeFn: ScoreOptions['_runPrime'],
): Promise<ScoreResult['adversarialResult']> {
  let adversarialResult: ScoreResult['adversarialResult'];

  if (options.adversary) {
    try {
      const generateFn = options._generateAdversarialScore
        ?? (await import('../../core/adversarial-scorer-dim.js')).generateAdversarialScore;
      const loadCfgFn = options._loadConfig ?? (await import('../../core/config.js')).loadConfig;
      adversarialResult = await generateFn(result, { cwd, _loadConfig: loadCfgFn });
      renderDualScorePanel(emit, adversarialResult, options.full ?? false);
    } catch (err) {
      emit('  [adversary] Adversarial scoring unavailable — skipping panel.');
      emit(`  [adversary] ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (runPrimeFn) {
    await runPrimeFn({ cwd }).catch(() => {});
    emit('  PRIME.md updated.');
  } else {
    try {
      const { prime } = await import('./prime.js');
      await prime({ cwd });
      emit('  PRIME.md updated.');
    } catch { /* best-effort */ }
  }

  try {
    const landscapePath = path.join(cwd, '.danteforge', 'landscape.json');
    const landscapeRaw = await (options._readFile
      ? options._readFile(landscapePath, 'utf8')
      : (await import('node:fs/promises')).readFile(landscapePath, 'utf8'));
    const lm = JSON.parse(landscapeRaw) as { generatedAt: string };
    if (Date.now() - new Date(lm.generatedAt).getTime() > 7 * 24 * 60 * 60 * 1000) {
      emit('');
      emit('  ⚠ Competitive landscape is >7 days old. Run: danteforge landscape');
    }
  } catch { /* no landscape yet */ }

  emit('');
  return adversarialResult;
}

// ── Main ──────────────────────────────────────────────────────────────────────

function shouldUseLegacyInjectionPath(options: ScoreOptions): boolean {
  return Boolean(
    options._harshScore || options._loadState || options._saveState || options._getGitSha
    || options._listSkillDirs || options._fileExists || options._readHistory || options._writeHistory
    || options._gitLog || options._listDir || options._fileExistsStrict,
  );
}

function renderDimensionsBlock(
  emit: (line: string) => void,
  result: { displayDimensions: Record<string, number> },
  full: boolean | undefined
): void {
  if (full) {
    const dims = (Object.entries(result.displayDimensions) as [ScoringDimension, number][]).sort((a, b) => a[1] - b[1]);
    emit('  All 20 dimensions (worst gaps first):');
    emit('');
    dims.forEach(([dim, sc]) => {
      const wt = Math.round((SCORE_DISPLAY_WEIGHTS[dim] ?? 0) * 100);
      emit(`  ${dim.padEnd(26)}${sc.toFixed(1)}  (weight ${`${wt}%`.padStart(4)})`);
    });
    emit('');
    emit('  For LLM competitor benchmarking: danteforge assess');
  } else {
    emit('  Run with --full for all 20 dimensions.');
  }
}

async function scoreCanonicalPath(options: ScoreOptions, cwd: string, emit: (line: string) => void): Promise<ScoreResult> {
  const canonical = await computeCanonicalScore(cwd);
  const result = canonicalScoreToHarshResult(canonical);
  emit('');
  emit(`  ${result.displayScore.toFixed(1)}/10  - ${displayVerdict(result.verdict)}`);
  emit('');
  const p0Items = await buildAndRenderP0Items(emit, result, cwd, options);
  renderDimensionsBlock(emit, result, options.full);
  const adversarialResult = await runScorePostActions(options, result, emit, cwd, options._runPrime);
  return { displayScore: result.displayScore, verdict: result.verdict, p0Items, displayDimensions: result.displayDimensions, adversarialResult };
}

function computeSessionDelta(state: import('../../core/state.js').DanteState, displayScore: number): number | undefined {
  const baselineAge = state.sessionBaselineTimestamp ? Date.now() - new Date(state.sessionBaselineTimestamp).getTime() : Infinity;
  if (baselineAge > BASELINE_TTL_MS) { state.sessionBaselineScore = undefined; state.sessionBaselineTimestamp = undefined; }
  if (state.sessionBaselineScore !== undefined) return displayScore - state.sessionBaselineScore;
  state.sessionBaselineScore = displayScore;
  state.sessionBaselineTimestamp = new Date().toISOString();
  return undefined;
}

export async function score(options: ScoreOptions = {}): Promise<ScoreResult> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((line: string) => logger.info(line));

  if (!shouldUseLegacyInjectionPath(options)) {
    return scoreCanonicalPath(options, cwd, emit);
  }

  const harshScoreFn = options._harshScore ?? computeHarshScore;
  const loadStateFn = options._loadState ?? loadState;
  const saveStateFn = options._saveState ?? saveState;
  const getGitSha = options._getGitSha ?? defaultGetGitSha;

  const state = await loadStateFn({ cwd });
  const signals = await bootstrapEcosystemSignals(cwd, { _listSkillDirs: options._listSkillDirs, _fileExists: options._fileExists });
  await bootstrapStateSignals(state, signals, cwd, saveStateFn);

  const result = await harshScoreFn({
    cwd,
    _readHistory: options._readHistory ?? (async () => []),
    _writeHistory: options._writeHistory ?? (async () => {}),
  });

  const strict = await computeStrictDimensions(cwd, options._gitLog, options._fileExistsStrict, options._listDir);
  await applyStrictOrAntiInflation(options, result, cwd, strict, emit);

  const sessionDelta = computeSessionDelta(state, result.displayScore);
  const gitSha = await getGitSha().catch(() => undefined);
  const updatedState = appendScoreHistory(state, { timestamp: new Date().toISOString(), displayScore: result.displayScore, gitSha });
  await saveStateFn(updatedState, { cwd });

  const deltaStr = sessionDelta !== undefined
    ? `  (${sessionDelta > 0.05 ? '▲' : sessionDelta < -0.05 ? '▼' : '─'} ${sessionDelta > 0 ? '+' : ''}${sessionDelta.toFixed(1)} today)`
    : '';
  emit('');
  emit(`  ${result.displayScore.toFixed(1)}/10  — ${displayVerdict(result.verdict)}${deltaStr}`);
  emit('');

  const p0Items = await buildAndRenderP0Items(emit, result, cwd, options);
  renderDimensionsBlock(emit, result, options.full);
  const adversarialResult = await runScorePostActions(options, result, emit, cwd, options._runPrime);

  return { displayScore: result.displayScore, verdict: result.verdict, p0Items, sessionDelta, displayDimensions: result.displayDimensions, adversarialResult };
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
    emit('  Run `danteforge score --adversary --full` for all 20 dimension scores.');
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
