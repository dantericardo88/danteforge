// Wave coordinator — Phase O of docs/PRDs/autonomous-frontier-reaching.md.
//
// Spawns a research-mode crusade wave for a single dimension. The flow:
//
//   1. Read activation criteria via isResearchActivated. Refuse if blocked.
//   2. Create .danteforge/research/<waveId>/ with manifest.json
//   3. Write shared/ context (dim-state.json, prior-research-summary.md,
//      frontier-definition placeholder)
//   4. Spawn benchmark-designer FIRST and ALONE (PRD section 5). Wait for
//      its frontier-definition.md to land before parallel phase begins.
//      If absent, halt the wave (PRD invariant: don't optimize for vague targets).
//   5. Spawn the remaining roles via the existing spawnParallelAgents path
//      (or a mock via injection seam). Each gets its own worktree, time budget.
//   6. Collect outputs. Partial failures don't block synthesis.
//   7. Run hybrid-synthesizer if it was in the council, else fall back to
//      runDeterministicSynthesis from synthesis-runner.ts.
//   8. Append research lesson via appendResearchLesson (Phase Q feedforward).
//   9. Return ResearchWaveResult.
//
// SHIPS WITH MOCKED AGENT EXECUTION BY DEFAULT (_runAgent injection seam
// returns predictable fixtures). The operator opts into real Claude-Code-as-
// agent runs via configuration. This keeps tests fast and avoids burning
// operator quota during routine substrate work.

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { logger } from '../../core/logger.js';
import { isResearchActivated, type ActivationInput } from './mode-selector.js';
import {
  appendResearchLesson,
  buildPriorResearchSummary,
} from './research-history.js';
import {
  DEFAULT_RESEARCH_MODE_CONFIG,
  type ResearchAgentRole,
  type ResearchModeConfig,
  type ResearchWaveOutcome,
} from './types.js';

const PROMPTS_DIR = 'prompts/research';
const RESEARCH_ROOT = path.join('.danteforge', 'research');

// ── Types ────────────────────────────────────────────────────────────────────

export interface RunAgentInput {
  roleId: string;
  prompt: string;
  workdir: string;
  timeBudgetMs: number;
  waveId: string;
  dimensionId: string;
}

export interface RunAgentResult {
  roleId: string;
  exitCode: number;
  durationMs: number;
  /** Whether the role's required outputs landed on disk. */
  producedRequiredOutputs: boolean;
  /** Path to the role's output directory. */
  outputDir: string;
}

/**
 * Tri-state agent runner.
 *   undefined → default real implementation (spawnHeadlessAgent via subprocess)
 *   null      → disable (testing path; substrate runs orchestration without dispatching)
 *   function  → injected mock (tests pass fixture results)
 */
export type RunAgentFn = (input: RunAgentInput) => Promise<RunAgentResult>;

export interface RunResearchWaveOptions {
  dimensionId: string;
  cwd: string;
  /** Activation criteria input (without dimensionId). */
  activation: Omit<ActivationInput, 'dimensionId'>;
  /** Override the research-mode config (timeouts, council size, etc). */
  config?: Partial<ResearchModeConfig>;
  /** Force activation even when criteria fail (audit-logged). */
  force?: boolean;
  /**
   * When true, dispatch real Claude Code subprocesses per role instead of the
   * mocked default. Consumes operator LLM quota. Logs a loud warning before
   * each wave run. Ignored when `_runAgent` is provided (tests).
   */
  useRealAgents?: boolean;
  /**
   * Agent runner. See `RunAgentFn`. By default uses the mocked fixture
   * implementation (or createRealAgentRunner when useRealAgents=true).
   * Tests inject a mock directly via this seam.
   */
  _runAgent?: RunAgentFn | null;
  /** Test-only seam: override the wave-id (default: timestamp-random). */
  _waveId?: string;
  /** Test-only seam: override the prompts directory. */
  _promptsDir?: string;
}

export interface ResearchWaveResult {
  waveId: string;
  dimensionId: string;
  outcome: ResearchWaveOutcome;
  startedAt: string;
  completedAt: string;
  /** Wave directory (relative to cwd). */
  waveDir: string;
  /** Per-role results. */
  agents: RunAgentResult[];
  /** Reason from synthesis recommendation. */
  reason?: string;
  /** When the wave refused to start, the activation reason. */
  refusalReason?: string;
}

// ── ID generation ────────────────────────────────────────────────────────────

function genWaveId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(4).toString('hex');
  return `wave_${stamp}_${suffix}`;
}

// ── Mocked agent runner (default for tests) ──────────────────────────────────

/**
 * Default `_runAgent` implementation when none is supplied. Writes fixture
 * required-outputs to the agent's workdir so downstream synthesis has
 * something to read. Returns success.
 *
 * In production, the operator overrides this with a real Claude-Code-CLI
 * spawner that invokes the agent's prompt against an isolated worktree.
 */
async function defaultRunAgent(input: RunAgentInput): Promise<RunAgentResult> {
  const start = Date.now();
  const outputDir = input.workdir;
  await fs.mkdir(outputDir, { recursive: true });

  // Write fixture outputs that downstream synthesis can read.
  if (input.roleId === 'benchmark-designer') {
    await fs.writeFile(
      path.join(outputDir, 'frontier-definition.md'),
      `# Frontier definition — ${input.dimensionId}\n\n` +
      `(default mock — replace with real benchmark-designer output by injecting _runAgent)\n` +
      `## What user-observable "frontier" means for this dim\n` +
      `placeholder\n\n` +
      `## Proposed new outcomes at T4/T5/T6\n` +
      `(none yet — run with real agents)\n`,
      'utf8',
    );
  } else {
    await fs.writeFile(
      path.join(outputDir, 'findings.md'),
      `# Findings — ${input.roleId} (mock)\n\n(operator: inject _runAgent for real outputs)\n`,
      'utf8',
    );
    await fs.writeFile(
      path.join(outputDir, 'hypothesis.md'),
      `# Hypothesis — ${input.roleId} (mock)\n\nPlaceholder hypothesis.\n`,
      'utf8',
    );
  }
  return {
    roleId: input.roleId,
    exitCode: 0,
    durationMs: Date.now() - start,
    producedRequiredOutputs: true,
    outputDir,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Run a research wave end-to-end. Returns a ResearchWaveResult describing
 * the outcome (or refusal).
 */
export async function runResearchWave(options: RunResearchWaveOptions): Promise<ResearchWaveResult> {
  const startedAt = new Date().toISOString();
  const waveId = options._waveId ?? genWaveId();
  const config: ResearchModeConfig = { ...DEFAULT_RESEARCH_MODE_CONFIG, ...(options.config ?? {}) };

  // ── Step 1: activation criteria ──────────────────────────────────────────
  const activationInput: ActivationInput = {
    dimensionId: options.dimensionId,
    ...options.activation,
    config,
    ...(options.force !== undefined ? { force: options.force } : {}),
  };
  const activation = isResearchActivated(activationInput);
  if (!activation.shouldActivate) {
    logger.warn(`[research-wave] refusing to spawn: ${activation.blockingReason}`);
    return {
      waveId,
      dimensionId: options.dimensionId,
      outcome: null,
      startedAt,
      completedAt: new Date().toISOString(),
      waveDir: path.join(RESEARCH_ROOT, waveId),
      agents: [],
      refusalReason: activation.blockingReason ?? 'unknown',
    };
  }
  const council = activation.council ?? [];
  if (council.length === 0) {
    return {
      waveId,
      dimensionId: options.dimensionId,
      outcome: 'cap',
      startedAt,
      completedAt: new Date().toISOString(),
      waveDir: path.join(RESEARCH_ROOT, waveId),
      agents: [],
      reason: 'mode-selector returned an empty council',
    };
  }

  // ── Step 2: create wave dir + manifest ───────────────────────────────────
  const waveDir = path.join(options.cwd, RESEARCH_ROOT, waveId);
  await fs.mkdir(path.join(waveDir, 'shared'), { recursive: true });
  await writeManifest(waveDir, {
    waveId,
    dimensionId: options.dimensionId,
    startedAt,
    config,
    council: council.map(r => ({ id: r.id, label: r.label, cognitive_mode: r.cognitive_mode })),
    status: 'in-progress',
  });

  // ── Step 3: write shared context ─────────────────────────────────────────
  await writeSharedContext(options.cwd, waveDir, options.dimensionId);

  // ── Step 4: benchmark-designer first and alone ───────────────────────────
  let runAgent: RunAgentFn | null;
  if (options._runAgent === null) {
    runAgent = null;
  } else if (options._runAgent) {
    runAgent = options._runAgent;
  } else if (options.useRealAgents) {
    logger.warn('[research-wave] real-agent mode enabled — operator LLM quota WILL be consumed for each role in the council');
    const { createRealAgentRunner } = await import('./real-agent-runner.js');
    runAgent = createRealAgentRunner();
  } else {
    runAgent = defaultRunAgent;
  }
  if (runAgent === null) {
    // null = disable (test path that wants to skip dispatch entirely)
    return {
      waveId,
      dimensionId: options.dimensionId,
      outcome: null,
      startedAt,
      completedAt: new Date().toISOString(),
      waveDir,
      agents: [],
      reason: '_runAgent: null — dispatch disabled',
    };
  }

  const benchmarkRole = council.find(r => r.id === 'benchmark-designer');
  const promptsDir = options._promptsDir ?? PROMPTS_DIR;
  const benchmarkResult = benchmarkRole
    ? await spawnSingleAgent(runAgent, benchmarkRole, waveDir, options.cwd, waveId, options.dimensionId, promptsDir)
    : null;

  // Stop condition: benchmark-designer must produce frontier-definition.md
  if (benchmarkRole && benchmarkResult) {
    const frontierPath = path.join(benchmarkResult.outputDir, 'frontier-definition.md');
    const exists = await fileExists(frontierPath);
    if (!exists) {
      logger.warn('[research-wave] benchmark-designer did not produce frontier-definition.md — halting before parallel phase per PRD invariant');
      return {
        waveId,
        dimensionId: options.dimensionId,
        outcome: 'cap',
        startedAt,
        completedAt: new Date().toISOString(),
        waveDir,
        agents: [benchmarkResult],
        reason: 'benchmark-designer failed to produce frontier-definition.md',
      };
    }
    // Copy frontier-definition into shared/ so other agents can read it
    try {
      const frontier = await fs.readFile(frontierPath, 'utf8');
      await fs.writeFile(path.join(waveDir, 'shared', 'frontier-definition.md'), frontier, 'utf8');
    } catch { /* best-effort */ }
  }

  // ── Step 5: parallel phase ───────────────────────────────────────────────
  const parallelRoles = council.filter(r => r.id !== 'benchmark-designer' && r.id !== 'hybrid-synthesizer');
  const parallelResults: RunAgentResult[] = [];
  for (const role of parallelRoles) {
    // For now: sequential dispatch (pseudo-parallel per PRD section 6) since
    // mocked _runAgent returns instantly anyway. Real parallel via the
    // substrate's existing spawnParallelAgents is a follow-up wire-up.
    const r = await spawnSingleAgent(runAgent, role, waveDir, options.cwd, waveId, options.dimensionId, promptsDir);
    parallelResults.push(r);
  }

  // ── Step 6: hybrid-synthesizer (if present) ──────────────────────────────
  const synthRole = council.find(r => r.id === 'hybrid-synthesizer');
  let synthResult: RunAgentResult | null = null;
  if (synthRole) {
    synthResult = await spawnSingleAgent(runAgent, synthRole, waveDir, options.cwd, waveId, options.dimensionId, promptsDir);
  }

  // ── Step 7: deterministic synthesis fallback ─────────────────────────────
  const { runDeterministicSynthesis } = await import('./synthesis-runner.js');
  const recommendation = await runDeterministicSynthesis({
    waveDir,
    roleIds: council.map(r => r.id),
  });

  // ── Step 8: write synthesis-recommendation.md ────────────────────────────
  const synthesisPath = path.join(waveDir, 'synthesis-recommendation.md');
  await fs.writeFile(synthesisPath, recommendation.markdown, 'utf8');

  // ── Step 9: append lesson ─────────────────────────────────────────────────
  const outcomeLabel = recommendation.outcome ?? 'unknown';
  const lesson = `${String(outcomeLabel).toUpperCase()}: ${recommendation.reason}`;
  await appendResearchLesson(options.cwd, waveId, options.dimensionId, recommendation.outcome, lesson);

  // ── Step 10: update manifest with final outcome ──────────────────────────
  const completedAt = new Date().toISOString();
  const allAgents = [
    ...(benchmarkResult ? [benchmarkResult] : []),
    ...parallelResults,
    ...(synthResult ? [synthResult] : []),
  ];
  await writeManifest(waveDir, {
    waveId,
    dimensionId: options.dimensionId,
    startedAt,
    completedAt,
    outcome: recommendation.outcome,
    reason: recommendation.reason,
    config,
    council: council.map(r => ({ id: r.id, label: r.label, cognitive_mode: r.cognitive_mode })),
    agents: allAgents.map(a => ({ roleId: a.roleId, exitCode: a.exitCode, durationMs: a.durationMs })),
    status: 'complete',
  });

  return {
    waveId,
    dimensionId: options.dimensionId,
    outcome: recommendation.outcome,
    startedAt,
    completedAt,
    waveDir,
    agents: allAgents,
    reason: recommendation.reason,
  };
}

// ── Single-agent dispatch ────────────────────────────────────────────────────

async function spawnSingleAgent(
  runAgent: RunAgentFn,
  role: ResearchAgentRole,
  waveDir: string,
  cwd: string,
  waveId: string,
  dimensionId: string,
  promptsDir: string,
): Promise<RunAgentResult> {
  const roleOutputDir = path.join(waveDir, role.id);
  await fs.mkdir(roleOutputDir, { recursive: true });
  const prompt = await loadPrompt(role.id, cwd, promptsDir);
  return runAgent({
    roleId: role.id,
    prompt,
    workdir: roleOutputDir,
    timeBudgetMs: role.time_budget_minutes * 60_000,
    waveId,
    dimensionId,
  });
}

async function loadPrompt(roleId: string, cwd: string, promptsDir: string): Promise<string> {
  // Operator override takes precedence: .danteforge/prompts/research/<role>.md
  const overridePath = path.join(cwd, '.danteforge', 'prompts', 'research', `${roleId}.md`);
  try { return await fs.readFile(overridePath, 'utf8'); }
  catch { /* fall through */ }
  // Project-shipped prompt
  const shippedPath = path.join(cwd, promptsDir, `${roleId}.md`);
  try { return await fs.readFile(shippedPath, 'utf8'); }
  catch { /* fall through */ }
  return `# Role: ${roleId}\n\n(no prompt template found at ${overridePath} or ${shippedPath})\n`;
}

// ── Manifest + shared context ────────────────────────────────────────────────

async function writeManifest(waveDir: string, manifest: Record<string, unknown>): Promise<void> {
  await fs.writeFile(path.join(waveDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8');
}

async function writeSharedContext(cwd: string, waveDir: string, dimensionId: string): Promise<void> {
  // dim-state.json: snapshot of the dim's matrix entry
  try {
    const { loadMatrix } = await import('../../core/compete-matrix.js');
    const matrix = await loadMatrix(cwd);
    const dim = matrix?.dimensions.find(d => d.id === dimensionId);
    if (dim) {
      await fs.writeFile(
        path.join(waveDir, 'shared', 'dim-state.json'),
        JSON.stringify(dim, null, 2),
        'utf8',
      );
    }
  } catch { /* best-effort */ }

  // prior-research-summary.md from Phase Q
  try {
    const summary = await buildPriorResearchSummary(cwd, dimensionId);
    await fs.writeFile(
      path.join(waveDir, 'shared', 'prior-research-summary.md'),
      summary,
      'utf8',
    );
  } catch { /* best-effort */ }
}

async function fileExists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}
