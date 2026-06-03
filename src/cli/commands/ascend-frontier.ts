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
import { effectiveStatus, resolveRunCommand, type FrontierSpec } from '../../core/frontier-spec.js';
import { loadCeilingReceipt, writeCeilingReceipt } from '../../core/ceiling-receipt.js';
import { loadAttemptLedger, recordAttempt, isNovelAttempt, type AttemptFingerprint } from '../../core/evidence-novelty.js';
import { planNextAction, type DimState, type AscendAction } from '../../core/ascend-frontier-engine.js';
import { assignRound, runParallelRound, type PushOutcome } from '../../core/ascend-frontier-parallel.js';
import type { CouncilMemberId } from '../../matrix/engines/council-scheduler.js';

const execFileAsync = promisify(execFile);
const MARKET_DIMS = new Set(['community_adoption', 'enterprise_readiness']);

/** A push runner reports the court verdict and the fingerprint of the evidence it produced. */
export interface PushResult { verdict: 'VALIDATED' | 'REJECTED'; fingerprint: AttemptFingerprint; }

export interface AscendFrontierOptions {
  cwd?: string;
  dryRun?: boolean;
  /** Parallel fan-out: each live council member owns a different dim and pushes concurrently. */
  parallel?: boolean;
  maxCycles?: number;
  maxAttemptsPerDim?: number;
  json?: boolean;
  // Seams (production defaults shell out to the real commands).
  _buildState?: (cwd: string) => Promise<DimState[]>;
  _runSetup?: (cwd: string, dims: string[]) => Promise<void>;
  _runBuildTo7?: (cwd: string, dims: string[]) => Promise<void>;
  _runPushTo9?: (cwd: string, dimId: string) => Promise<PushResult>;
  /** Parallel mode: discover live council members. */
  _discoverMembers?: () => Promise<CouncilMemberId[]>;
  /** Parallel mode: push one (member, dim) pair — returns the court outcome incl. who passed. */
  _runParallelPush?: (cwd: string, a: { memberId: CouncilMemberId; dimId: string }) => Promise<PushOutcome>;
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

// ── Phase command routing (pure — sequential vs council-parallel) ────────────────
// In --parallel mode the council fans the work out: define via member-split council-universe
// research (cross-verify on by default), build-to-7 via council --parallel (isolated worktrees +
// cross-member merge court + post-merge validate — the correct concurrent build). Scaffolding and
// outcome migration stay serial: they are fast local file ops, so worktree fan-out is pure overhead.

export function setupCommands(parallel: boolean, members: string[]): string[][] {
  const cmds: string[][] = [];
  if (parallel && members.length >= 2) cmds.push(['council-universe', '--members', members.join(','), '--propose-outcomes']);
  cmds.push(['evidence-scaffold'], ['migrate-outcomes', '--write']);
  return cmds;
}

export function buildTo7Commands(parallel: boolean, members: string[], dims: string[]): string[][] {
  return (parallel && members.length >= 2 && dims.length > 0)
    ? [['council', '--parallel', '--members', members.join(','), '--focus-dims', dims.join(','), '--rounds', '1']]
    : [['harden-crusade', '--loop', '--target', '7']];
}

// ── Orchestrator loop ───────────────────────────────────────────────────────────

export async function runAscendFrontier(options: AscendFrontierOptions): Promise<AscendFrontierResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const maxCycles = options.maxCycles ?? 200;
  const maxAttemptsPerDim = options.maxAttemptsPerDim ?? 3;
  const now = options._now ?? (() => new Date().toISOString());
  const buildState = options._buildState ?? defaultBuildState;
  // Discover the council once (parallel mode) — reused by define, build-to-7, and push fan-out.
  const members = (options.parallel && !options.dryRun)
    ? await (options._discoverMembers ?? defaultDiscoverMembers)()
    : [];
  const runSetup = options._runSetup ?? (async (c: string, dims: string[]) => {
    for (const cmd of setupCommands(!!options.parallel, members)) await df(c, cmd);
    void dims;
  });
  const runBuildTo7 = options._runBuildTo7 ?? (async (c: string, dims: string[]) => {
    for (const cmd of buildTo7Commands(!!options.parallel, members, dims)) await df(c, cmd);
  });
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
        if (options.parallel) {
          // Fan out: assign the weakest dims to live members and push concurrently, each gated by
          // the frontier-review-court with the builder excluded (builder-never-judges). Reciprocal
          // passes are auto-queued for human audit inside runParallelRound.
          const liveMembers = members.length > 0 ? members : await (options._discoverMembers ?? defaultDiscoverMembers)();
          const assignments = assignRound(state, liveMembers, { nowIso: now() });
          if (assignments.length === 0) break;
          logger.info(`[ascend-frontier] parallel round: ${assignments.map(a => `${a.memberId}→${a.dimId}`).join(', ')}`);
          const round = await runParallelRound(cwd, assignments, {
            runPush: (a) => (options._runParallelPush ?? defaultParallelPush)(cwd, a),
            nowIso: now(),
          });
          // Record an attempt per pushed dim so attempt-counts advance (a fresh HEAD makes it novel).
          const sha = await headSha(cwd);
          for (const o of round.outcomes) {
            await recordAttempt(cwd, { dimId: o.dimId, command: `parallel:${o.builderId}`, artifactPath: '', gitSha: sha },
              o.verdict === 'VALIDATED' ? 'validated' : 'rejected', now());
          }
          break;
        }
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
  // freeze → capability work → real-user-path capture (per-session variant) → validate ×N → court.
  await df(cwd, ['frontier-spec', 'freeze', dimId, '--write']);
  await df(cwd, ['council-crusade', '--focus-dims', dimId, '--goal', `Close frontier_spec for ${dimId}`]);

  const specBefore = (await loadMatrix(cwd))?.dimensions.find(d => d.id === dimId);
  const spec0 = (specBefore as unknown as { frontier_spec?: FrontierSpec } | undefined)?.frontier_spec;
  if (spec0) {
    const callsite = spec0.real_user_path.required_callsite;
    const artifact = spec0.real_user_path.observable_artifacts[0]?.path ?? '';
    const sessions = Math.max(2, spec0.required_receipts.min_distinct_sessions);
    for (let s = 0; s < sessions; s++) {
      // Each session runs a DIFFERENT realistic input (variant rotation) so one prepared fixture
      // cannot satisfy the whole multi-session proof — the anti-circular defense.
      const cmd = resolveRunCommand(spec0, s);
      await df(cwd, ['session-record', dimId, '--run', cmd, '--callsite', callsite, '--artifact', artifact, '--write']);
      await df(cwd, ['validate', dimId, '--force-cold']);
    }
  }
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

// ── Parallel production helpers ──────────────────────────────────────────────────

async function headSha(cwd: string): Promise<string | null> {
  try { return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd })).stdout.trim(); } catch { return null; }
}

async function defaultDiscoverMembers(): Promise<CouncilMemberId[]> {
  const { discoverCouncil } = await import('./council.js');
  return (await discoverCouncil()).filter(m => m.available).map(m => m.id as CouncilMemberId);
}

async function dfCapture(cwd: string, args: string[]): Promise<string> {
  const [node, cli] = [process.execPath, process.argv[1] ?? 'dist/index.js'];
  try { return (await execFileAsync(node, [cli, ...args], { cwd, timeout: 30 * 60_000, maxBuffer: 32 * 1024 * 1024 })).stdout; }
  catch (e) { return (e as { stdout?: string }).stdout ?? ''; }
}

/** Push one (member, dim) pair, then run the court with that member EXCLUDED from judging. */
async function defaultParallelPush(cwd: string, a: { memberId: CouncilMemberId; dimId: string }): Promise<PushOutcome> {
  await df(cwd, ['frontier-spec', 'freeze', a.dimId, '--write']);
  await df(cwd, ['council-crusade', '--focus-dims', a.dimId, '--goal', `Close frontier_spec for ${a.dimId} (builder ${a.memberId})`]);
  const specBefore = (await loadMatrix(cwd))?.dimensions.find(d => d.id === a.dimId);
  const spec0 = (specBefore as unknown as { frontier_spec?: FrontierSpec } | undefined)?.frontier_spec;
  if (spec0) {
    const callsite = spec0.real_user_path.required_callsite;
    const artifact = spec0.real_user_path.observable_artifacts[0]?.path ?? '';
    const sessions = Math.max(2, spec0.required_receipts.min_distinct_sessions);
    for (let s = 0; s < sessions; s++) {
      await df(cwd, ['session-record', a.dimId, '--run', resolveRunCommand(spec0, s), '--callsite', callsite, '--artifact', artifact, '--write']);
      await df(cwd, ['validate', a.dimId, '--force-cold']);
    }
  }
  // Court with builder-never-judges: the OTHER members judge (unanimous 2-of-2 in a 3-member council).
  const out = await dfCapture(cwd, ['frontier-review', a.dimId, '--builder', a.memberId, '--min-judges', '2', '--json', '--write']);
  let verdict: PushOutcome['verdict'] = 'REJECTED';
  let passedByJudges: CouncilMemberId[] = [];
  try {
    const j = JSON.parse(out.slice(out.indexOf('{')));
    verdict = j?.result?.verdict === 'VALIDATED' ? 'VALIDATED' : 'REJECTED';
    passedByJudges = (j?.result?.judges ?? []).filter((x: { verdict: string }) => x.verdict === 'PASS').map((x: { judgeId: CouncilMemberId }) => x.judgeId);
  } catch { /* best-effort: REJECTED on unparseable output */ }
  return { dimId: a.dimId, builderId: a.memberId, verdict, passedByJudges };
}
