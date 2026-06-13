// harden-crusade-runners.ts — the default subprocess drivers for harden-crusade (file-size split).
//
// Extracted from harden-crusade.ts (750-line hard cap, triggered when the wave-ledger wiring landed):
// the autoresearch subprocess + isolated-branch merge-back + the per-cycle measurement defaults
// (capability_test probe, outcomes refresh, re-score, harden gate). harden-crusade wires these as its
// injection-seam defaults; tests still override them. Behavior is byte-for-byte the pre-split code.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { loadMatrix, decisionDimScore, type MatrixDimension } from '../../core/compete-matrix.js';
import { runGit } from '../../core/git-safe.js';
import type { HardenDimResult } from './harden-crusade.js';

// ── Default subprocess drivers ──────────────────────────────────────────────

export async function resolveDanteForgeExec(cwd: string): Promise<{ file: string; argsPrefix: string[] }> {
  const localDistEntry = path.join(cwd, 'dist', 'index.js');
  try {
    await fs.access(localDistEntry);
    return { file: process.execPath, argsPrefix: [localDistEntry] };
  } catch {
    // Fall through to the currently executing CLI entry, then finally PATH.
  }

  const currentEntry = process.argv[1];
  if (currentEntry && currentEntry.endsWith('index.js')) {
    return { file: process.execPath, argsPrefix: [currentEntry] };
  }

  return { file: 'danteforge', argsPrefix: [] };
}

/**
 * Run a child to completion with its stdio INHERITED (streamed straight to the terminal) — NOT
 * buffered. A long autoresearch run (30 min) easily exceeds execFile's default ~1 MB stdout buffer,
 * which destroys the pipe and surfaces as EPIPE / exit 127 mid-build (DanteSecurity DS-024). Inherit
 * has no buffer to overflow. Resolves on exit 0, rejects on non-zero / spawn error / timeout.
 */
async function spawnStreamed(file: string, args: string[], cwd: string, timeoutMs: number): Promise<void> {
  const { spawn } = await import('node:child_process');
  const { trackChild, untrackChild, killTree, SPAWN_DETACHED } = await import('../../core/process-tree.js');
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    // stdin:'ignore' — an unattended autoresearch that hits a prompt gets EOF and fails fast instead
    // of blocking forever (the silent ~15-min hang the fleet hit). stdout/stderr inherit (no buffer).
    const child = spawn(file, args, { cwd, stdio: ['ignore', 'inherit', 'inherit'], windowsHide: true, detached: SPAWN_DETACHED });
    trackChild(child.pid);
    const finish = (fn: () => void) => { if (!settled) { settled = true; clearTimeout(timer); untrackChild(child.pid); fn(); } };
    // Tree-kill on timeout — autoresearch spawns its own workers; killing only the direct child orphans them.
    const timer = setTimeout(() => { killTree(child.pid); finish(() => reject(new Error(`timed out after ${Math.round(timeoutMs / 60000)}m`))); }, timeoutMs);
    child.on('error', (e: NodeJS.ErrnoException) => finish(() => reject(e)));
    child.on('close', (code, signal) => finish(() => code === 0 ? resolve() : reject(new Error(`exit ${code ?? signal}`))));
  });
}

export async function defaultRunAutoResearch(
  dimensionId: string, goal: string, cwd: string, timeMinutes: number, measurementCommand?: string,
): Promise<void> {
  const cli = await resolveDanteForgeExec(cwd);
  // timeMinutes + 1 min slack on the subprocess timeout (in ms).
  const timeoutMs = (timeMinutes + 1) * 60 * 1000;
  // The dim's capability_test IS the natural metric. Without --measurement-command, autoresearch
  // can't measure an arbitrary dimension id and exits 1 ("needs an explicit measurement command")
  // — the root cause of the build-to-7 crash/hang. Always pass it; the caller guarantees one exists.
  // --require-agent: the autonomous build loop drives the CAPABLE coding agent (claude/codex) and must
  // NOT silently degrade to the JSON-hypothesis/Ollama path (which stalls when no provider is configured —
  // the "set-and-forget loop hangs" failure). With no agent available it fails fast (exit 2 = a fixable
  // environment ceiling), so the conductor records an honest signal instead of churning blind.
  // --isolate (NEVER --allow-dirty): the fleet run proved main-tree autoresearch is self-sabotage —
  // it branch-switched the operator's checkout and git-reset uncommitted matrix declarations + wiring,
  // REGRESSING two repos' honest means. Experiments now run in a worktree off HEAD; the operator's tree
  // is untouchable. Kept commits land on a deterministic branch we merge back below, gate-verified.
  const branch = `autoresearch/hc-${dimensionId}-${Date.now()}`;
  const args = [...cli.argsPrefix, 'autoresearch', goal, '--metric', dimensionId, '--time', `${timeMinutes}m`,
    '--isolate', '--isolate-branch', branch, '--require-agent'];
  // --exit-code-metric ALWAYS accompanies --measurement-command: the measurement IS the dim's
  // capability_test — pass/fail by exit code, never a number scraped from its stdout. Without it
  // the harness greps stdout for digits (DanteSecurity parsed a bogus "-7" out of dates in
  // dante.py's banner and could never improve it — the metric measured nothing real).
  if (measurementCommand) args.push('--measurement-command', measurementCommand, '--exit-code-metric');
  // Record the operator's ref BEFORE the long run: merge-back must land on the branch the run
  // STARTED on — if the operator switched/detached meanwhile, landing kept work on whatever HEAD
  // happens to be now would be silent misdelivery (adversarial-review finding).
  const startRef = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd).then(s => s.trim()).catch(() => '');
  // Streamed (inherit) — a 30-min autoresearch must not buffer into an EPIPE/127.
  // MERGE-BACK IN FINALLY (live DanteForge run finding): autoresearch exits non-zero when the
  // 30-min budget expires without reaching target — but its KEPT experiment commits are real,
  // gate-verified improvements sitting on the isolate branch. The old post-await placement
  // skipped the merge on any non-zero exit, stranding kept work and making the next cycle
  // rebuild from scratch. Kept commits always deserve a landing attempt; the harden gate and
  // outcome refresh that follow every cycle remain the judges of what landed.
  try {
    await spawnStreamed(cli.file, args, cwd, timeoutMs);
  } finally {
    // Not caught: a wedged-tree throw from the merge MUST stop the cycle loudly (it is the more
    // actionable error than a non-zero autoresearch exit it may replace).
    await mergeBackIsolatedBranch(cwd, branch, dimensionId, startRef);
  }
}

/**
 * Land an isolated run's kept work on the CURRENT branch — without ever switching the operator's
 * checkout. No kept commits → silent no-op (the branch was already auto-pruned). A merge conflict
 * aborts cleanly and reports build-failed-to-land; the commits stay on the branch for review. The
 * harden gate + outcome refresh that follow every cycle remain the quality judges of what landed.
 */
export async function mergeBackIsolatedBranch(cwd: string, branch: string, dimensionId: string, expectedRef = ''): Promise<void> {
  const exists = await runGit(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], cwd).then(() => true).catch(() => false);
  if (!exists) return; // nothing kept — teardown pruned the branch
  // Guards (adversarial-review finding 8): never merge onto a DIFFERENT ref than the run started
  // on, never onto a detached HEAD, and never into a tree already mid-merge — each of those lands
  // kept work in the wrong place or compounds a wedged state. Kept commits stay on their branch.
  const currentRef = await runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd).then(s => s.trim()).catch(() => '');
  if (!currentRef) {
    logger.warn(`[harden-crusade:${dimensionId}] HEAD is detached — NOT merging; kept work remains on ${branch} for review.`);
    return;
  }
  if (expectedRef && currentRef !== expectedRef) {
    logger.warn(`[harden-crusade:${dimensionId}] checkout moved (${expectedRef} → ${currentRef}) during the isolated run — NOT merging onto the new branch; kept work remains on ${branch} for review.`);
    return;
  }
  const midMerge = await runGit(['rev-parse', '--verify', '--quiet', 'MERGE_HEAD'], cwd).then(() => true).catch(() => false);
  if (midMerge) {
    logger.error(`[harden-crusade:${dimensionId}] the tree is already MID-MERGE (MERGE_HEAD present) — resolve or abort it first. Kept work remains on ${branch}.`);
    return;
  }
  const ahead = await runGit(['rev-list', '--count', `HEAD..${branch}`], cwd).then(s => parseInt(s.trim(), 10)).catch(() => 0);
  if (!ahead) {
    await runGit(['branch', '-D', branch], cwd).catch(() => { /* best-effort prune */ });
    return;
  }
  try {
    await runGit(['merge', '--no-ff', '--no-edit', branch], cwd);
    await runGit(['branch', '-D', branch], cwd).catch(() => { /* merged — prune is cosmetic */ });
    logger.info(`[harden-crusade:${dimensionId}] merged ${ahead} kept commit(s) from the isolated run (${branch})`);
  } catch (err) {
    try {
      await runGit(['merge', '--abort'], cwd);
      logger.warn(`[harden-crusade:${dimensionId}] isolated work could NOT be merged (${err instanceof Error ? err.message.split('\n')[0] : String(err)}) — aborted cleanly; kept on branch ${branch} for review; this cycle lands nothing.`);
    } catch (abortErr) {
      // A failed abort leaves MERGE_HEAD + conflict markers in the OPERATOR'S tree: every later
      // gate/build would run against garbage and blame the dims. This must STOP the loop loudly.
      throw new Error(`[harden-crusade:${dimensionId}] merge of ${branch} conflicted AND \`git merge --abort\` failed (${abortErr instanceof Error ? abortErr.message.split('\n')[0] : String(abortErr)}) — the tree is mid-merge. Resolve manually (git merge --abort) before re-running.`);
    }
  }
}

/** L8 default probe: run the dim's capability_test once in-process and return its exit code.
 *  Cheap relative to an 18-minute builder dispatch; any error reads as failing (1) so the
 *  builder path stays available when the probe itself cannot run. */
export async function defaultRunCapTest(dim: MatrixDimension, cwd: string): Promise<number> {
  try {
    const { runCapabilityTest } = await import('../../matrix/engines/capability-test-runner.js');
    const ct = (dim as unknown as { capability_test?: { command: string } }).capability_test;
    if (!ct?.command) return 1;
    const verdict = runCapabilityTest({ dimensionId: dim.id, capabilityTest: ct as Parameters<typeof runCapabilityTest>[0]['capabilityTest'], cwd });
    return verdict.result?.exitCode ?? (verdict.allowed ? 0 : 1);
  } catch {
    return 1;
  }
}

/** Resolve a dim's capability_test shell command (the autoresearch measurement metric), or null. */
export function capabilityTestCommand(dim: MatrixDimension): string | null {
  const ct = (dim as unknown as { capability_test?: { command?: string }; no_capability_test?: boolean });
  if (ct.no_capability_test) return null;
  return ct.capability_test?.command ?? null;
}

export async function defaultRunOutcomesForDim(dimensionId: string, cwd: string): Promise<void> {
  // After autoresearch commits code, the SHA changes and prior SHA-pinned evidence
  // is stale. Re-run only this dim's outcomes so getScore returns an honest value.
  // Times out in 10 min (most dims have 1–3 outcomes; T1=compile is fastest).
  const cli = await resolveDanteForgeExec(cwd);
  try {
    // Streamed (inherit) — same EPIPE/buffer-overflow guard as autoresearch.
    await spawnStreamed(cli.file, [...cli.argsPrefix, 'outcomes', '--dim', dimensionId, '--force-cold'], cwd, 10 * 60 * 1000);
  } catch (err) {
    logger.warn(`[harden-crusade:${dimensionId}] outcomes refresh failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export async function defaultGetScore(dimensionId: string, cwd: string): Promise<number> {
  const matrix = await loadMatrix(cwd);
  if (!matrix) return 0;
  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  return dim ? decisionDimScore(dim) : 0; // effective, not raw self (anti-inflation)
}

export async function defaultRunHardenForDim(dimensionId: string, cwd: string): Promise<HardenDimResult> {
  // Use the in-process harden engine directly — avoids spawning a subprocess
  // for every cycle. Matches the proposal-merge gate behavior exactly.
  const { runHardenGate } = await import('../../matrix/engines/hardener.js');
  const matrix = await loadMatrix(cwd);
  if (!matrix) {
    return { allowed: false, scoreCap: 0, failedChecks: ['no-matrix'] };
  }
  const dim = matrix.dimensions.find(d => d.id === dimensionId);
  if (!dim) {
    return { allowed: false, scoreCap: 0, failedChecks: ['unknown-dim'] };
  }
  const verdict = await runHardenGate({ dimensionId, dim, cwd });
  return {
    allowed: verdict.allowed,
    scoreCap: verdict.scoreCap,
    failedChecks: verdict.checks.filter(c => !c.passed && !c.skipped).map(c => c.check),
  };
}
