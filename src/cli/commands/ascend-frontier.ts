// ascend-frontier.ts — the unattended autonomous frontier orchestrator (M2).
//
//   danteforge ascend-frontier [--dry-run] [--max-cycles N] [--max-attempts N]
//
// Chains the whole campaign with NO interactive prompts: Phase A (define) → Phase B (build-to-7) →
// Phase C (push each dim to a court-validated 9.0, one at a time). It loops planNextAction →
// dispatch → re-read state until every dim is at the validated frontier OR carries an honest
// ceiling. Anti-grind: the evidence-novelty ledger (a push that changed nothing real is ceilinged
// immediately) plus a global --max-cycles stop. The heavy phase work is delegated to existing
// commands (crusade/council-crusade/session-record/validate/frontier-review); all are seam-injectable.

import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { loadMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { effectiveDimScore } from '../../core/compete-matrix-score.js';
import { effectiveStatus, type FrontierSpec } from '../../core/frontier-spec.js';
import { loadCeilingReceipt, writeCeilingReceipt } from '../../core/ceiling-receipt.js';
import { loadAttemptLedger, recordAttempt, isNovelAttempt, type AttemptFingerprint } from '../../core/evidence-novelty.js';
import { planNextAction, type DimState, type AscendAction } from '../../core/ascend-frontier-engine.js';

const execFileAsync = promisify(execFile);
const MARKET_DIMS = new Set(['community_adoption', 'enterprise_readiness']);

/** A push runner reports the court verdict and the fingerprint of the evidence it produced. */
export interface PushResult { verdict: 'VALIDATED' | 'REJECTED'; fingerprint: AttemptFingerprint; }

export interface AscendFrontierOptions {
  cwd?: string;
  dryRun?: boolean;
  maxCycles?: number;
  maxAttemptsPerDim?: number;
  json?: boolean;
  // Seams (production defaults shell out to the real commands).
  _buildState?: (cwd: string) => Promise<DimState[]>;
  _runSetup?: (cwd: string, dims: string[]) => Promise<void>;
  _runBuildTo7?: (cwd: string, dims: string[]) => Promise<void>;
  _runPushTo9?: (cwd: string, dimId: string) => Promise<PushResult>;
  _now?: () => string;
}

export interface AscendFrontierResult {
  terminal: 'done' | 'stalled' | 'max-cycles' | 'dry-run';
  cycles: number;
  actions: string[];
  summary: string;
}

// ── Production state builder ────────────────────────────────────────────────────

async function defaultBuildState(cwd: string): Promise<DimState[]> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error('No compete matrix found. (Phase A define has not run.)');
  const ledger = await loadAttemptLedger(cwd);
  const out: DimState[] = [];
  for (const dim of matrix.dimensions) {
    const spec = (dim as unknown as { frontier_spec?: FrontierSpec }).frontier_spec;
    const ceiling = await loadCeilingReceipt(cwd, dim.id);
    const d = dim as unknown as { capability_test?: unknown; outcomes?: unknown[] };
    out.push({
      id: dim.id,
      effectiveScore: effectiveDimScore(dim as Parameters<typeof effectiveDimScore>[0]),
      frontierStatus: spec ? effectiveStatus(spec) : 'none',
      ceiling,
      attempts: ledger.filter(a => a.dimId === dim.id).length,
      isMarketCapped: MARKET_DIMS.has(dim.id),
      needsSetup: d.capability_test === undefined || !Array.isArray(d.outcomes) || d.outcomes.length === 0,
    });
  }
  return out;
}

async function df(cwd: string, args: string[]): Promise<void> {
  const [node, cli] = [process.execPath, process.argv[1] ?? 'dist/index.js'];
  await execFileAsync(node, [cli, ...args], { cwd, timeout: 30 * 60_000, maxBuffer: 32 * 1024 * 1024 }).catch(() => { /* best-effort; state re-read decides progress */ });
}

// ── Orchestrator loop ───────────────────────────────────────────────────────────

export async function runAscendFrontier(options: AscendFrontierOptions): Promise<AscendFrontierResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const maxCycles = options.maxCycles ?? 200;
  const maxAttemptsPerDim = options.maxAttemptsPerDim ?? 3;
  const now = options._now ?? (() => new Date().toISOString());
  const buildState = options._buildState ?? defaultBuildState;
  const runSetup = options._runSetup ?? ((c, dims) => df(c, ['evidence-scaffold']).then(() => df(c, ['migrate-outcomes', '--write'])).then(() => { void dims; }));
  const runBuildTo7 = options._runBuildTo7 ?? ((c, dims) => df(c, ['harden-crusade', '--loop', '--target', '7']).then(() => { void dims; }));
  const runPushTo9 = options._runPushTo9 ?? defaultPushTo9;

  const actions: string[] = [];
  let cycles = 0;

  while (true) {
    const state = await buildState(cwd);
    const action = planNextAction(state, { maxAttemptsPerDim, nowIso: now() });

    if (action.type === 'done') { actions.push('done'); return finish('done', cycles, actions, action.summary, options); }
    if (action.type === 'stalled') { actions.push(`stalled:${action.reason}`); return finish('stalled', cycles, actions, action.reason, options); }

    if (options.dryRun) {
      actions.push(describe(action));
      logger.info(`[ascend-frontier] DRY RUN — next action: ${describe(action)}`);
      return finish('dry-run', cycles, actions, `next: ${describe(action)}`, options);
    }

    if (cycles >= maxCycles) { return finish('max-cycles', cycles, actions, `stopped at --max-cycles ${maxCycles}`, options); }
    cycles++;
    logger.info(`[ascend-frontier] cycle ${cycles}: ${describe(action)}`);
    actions.push(describe(action));

    switch (action.type) {
      case 'setup': await runSetup(cwd, action.dims); break;
      case 'build-to-7': await runBuildTo7(cwd, action.dims); break;
      case 'ceiling':
        await writeCeilingReceipt(cwd, { dimId: action.dimId, cap: scoreOf(state, action.dimId), cause: action.cause,
          detail: action.detail, failedGates: [action.cause], recordedAt: now() });
        break;
      case 'push-to-9': {
        const result = await runPushTo9(cwd, action.dimId);
        const ledger = await loadAttemptLedger(cwd);
        if (!isNovelAttempt(ledger, result.fingerprint)) {
          // The push produced no NEW evidence (same code/command/artifact) — it can't progress.
          await writeCeilingReceipt(cwd, { dimId: action.dimId, cap: scoreOf(state, action.dimId), cause: 'generator-ceiling',
            detail: 'Push produced no novel evidence (unchanged code/command/artifact) — cannot advance.', failedGates: ['evidence-novelty'], recordedAt: now() });
        } else {
          await recordAttempt(cwd, result.fingerprint, result.verdict === 'VALIDATED' ? 'validated' : 'rejected', now());
        }
        break;
      }
    }
  }
}

function scoreOf(state: DimState[], id: string): number { return state.find(d => d.id === id)?.effectiveScore ?? 0; }

function describe(a: AscendAction): string {
  switch (a.type) {
    case 'setup': return `setup(${a.dims.length} dims)`;
    case 'build-to-7': return `build-to-7(${a.dims.length} dims)`;
    case 'push-to-9': return `push-to-9(${a.dimId})`;
    case 'ceiling': return `ceiling(${a.dimId}:${a.cause})`;
    case 'done': return 'done';
    case 'stalled': return `stalled(${a.reason})`;
  }
}

function finish(terminal: AscendFrontierResult['terminal'], cycles: number, actions: string[], summary: string, options: AscendFrontierOptions): AscendFrontierResult {
  const result: AscendFrontierResult = { terminal, cycles, actions, summary };
  logger.info(`[ascend-frontier] ${terminal.toUpperCase()} after ${cycles} cycle(s) — ${summary}`);
  if (options.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  return result;
}

// ── Production push runner (one dim, full depth pass) ─────────────────────────────

async function defaultPushTo9(cwd: string, dimId: string): Promise<PushResult> {
  // freeze (if needed) → capability work → session-record → validate ×2 → frontier-review.
  await df(cwd, ['frontier-spec', 'freeze', dimId, '--write']);
  await df(cwd, ['council-crusade', '--focus-dims', dimId, '--goal', `Close frontier_spec for ${dimId}`]);
  // session-record args come from the frozen spec; the orchestrator passes them through frontier-spec.
  await df(cwd, ['validate', dimId, '--force-cold']);
  await df(cwd, ['validate', dimId, '--force-cold']); // second session
  await df(cwd, ['frontier-review', dimId, '--write']);
  // Re-read the spec status to learn the court verdict; fingerprint from the spec + HEAD.
  const matrix = await loadMatrix(cwd);
  const dim = matrix?.dimensions.find(d => d.id === dimId);
  const spec = (dim as unknown as { frontier_spec?: FrontierSpec } | undefined)?.frontier_spec;
  const verdict: PushResult['verdict'] = spec && effectiveStatus(spec) === 'validated' ? 'VALIDATED' : 'REJECTED';
  let gitSha: string | null = null;
  try { gitSha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim(); } catch { /* none */ }
  return {
    verdict,
    fingerprint: {
      dimId,
      command: spec?.real_user_path.run_command ?? '',
      artifactPath: spec?.real_user_path.observable_artifacts[0]?.path ?? '',
      gitSha,
    },
  };
}
