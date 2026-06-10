// capability-test-execute.ts — `danteforge capability-test conduct --execute` — the conductor's ACTION layer.
//
// The plan pass (capability-test-conduct.ts) only DECIDES what every dimension needs; until now nothing
// executed that plan, so the conductor was a brain with no hands. This layer acts on the plan, still with
// no human, by wiring remediateYardsticks to the PRODUCTION executors:
//
//   PROCEED          → verifyDimYardstick: the dynamic sensitivity probe. A decoupled metric (passes with
//                      its callsite broken) is re-routed to authoring instead of trusted.
//   AUTHOR_YARDSTICK → repairStubYardstick FIRST: a failing yardstick whose real wired outcome PASSES is
//                      masking a WORKING capability — repointing it (three execution-proven gates) is the
//                      honest cheap fix. Only when repair declines do we pay for authorYardstickForDim
//                      (live examiner dispatch + the three honesty gates + git isolation).
//   RESEARCH_LADDER  → runCouncilUniversePhase on JUST that dim: a real council member researches the
//                      competitor Score Ladder. No member available ⇒ honest failure, never an invented bar.
//   CEILING          → market-capped dims stay at their honest 5.0; nothing is authored for them.
//
// Expensive actions (author + research) are budget-bounded per pass (--max-actions, default 3) so a
// fleet-scale caller can drip-feed spend; exhausted dims are SKIPPED, not failed. The RemediationReport
// is the product: BLOCKED / AUTHOR_REJECTED outcomes are honest results, not crashes — only a missing
// matrix throws.

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { loadMatrix, saveMatrix, type MatrixDimension } from '../../core/compete-matrix.js';
import { effectiveDimScore } from '../../core/compete-matrix-score.js';
import { loadDimRubric, nextLevel } from '../../core/rubric-ladder.js';
import { logger } from '../../core/logger.js';
import { auditAllCapabilityTests, type YardstickAudit } from '../../matrix/engines/capability-test-integrity.js';
import { buildWiredBasenames } from '../../matrix/engines/outcome-integrity.js';
import { verifyDimYardstick, type SensitivityVerdict } from '../../matrix/engines/capability-test-sensitivity.js';
import { remediateYardsticks, type RemediationReport, type RemediationOutcome } from '../../matrix/engines/capability-test-conductor.js';
import { authorYardstickForDim, isProductionSrc } from '../../matrix/engines/capability-test-author-runtime.js';
import { repairStubYardstick, type YardstickRepairResult } from '../../matrix/engines/yardstick-repair.js';
import type { AuthorResult } from '../../matrix/engines/capability-test-author.js';

export interface CapabilityTestExecuteOptions {
  project?: string;
  json?: boolean;
  /** Cap on expensive actions (author + ladder research) per pass. Default 3. */
  maxActions?: number;
  /** Per-command timeout for probes, repair runs, and authored-test executions. */
  timeoutMs?: number;
  // Seams (tests): every expensive or external action is injectable.
  _verifyFn?: (audit: YardstickAudit, cwd: string) => Promise<SensitivityVerdict>;
  _repairFn?: (dim: MatrixDimension, cwd: string) => Promise<YardstickRepairResult>;
  _authorFn?: (dimId: string) => Promise<AuthorResult>;
  _researchFn?: (dimId: string) => Promise<{ ok: boolean; reason: string }>;
  _installRepair?: (dimId: string, command: string) => Promise<void>;
  _runShell?: (command: string, cwd: string) => Promise<number>;
}

export interface CapabilityTestExecuteResult {
  report: RemediationReport;
  /** Expensive actions consumed this pass (author + research invocations). */
  actionsUsed: number;
  maxActions: number;
}

/** Shell runner for the repair engine's execution gates — exit code only, shell-resolved, time-bounded. */
function makeRunShell(timeoutMs: number): (command: string, cwd: string) => Promise<number> {
  return (command, cwd) =>
    new Promise(resolve => {
      const child = execFile(command, { cwd, shell: true, timeout: timeoutMs, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (err) => {
        const code = (err as (NodeJS.ErrnoException & { code?: number | string }) | null)?.code;
        resolve(typeof code === 'number' ? code : (err ? 1 : 0));
      });
      child.on('error', () => resolve(1));
    });
}

/**
 * The production src module an authored yardstick must exercise: the dim's first outcome
 * required_callsite that exists on disk and is production source, else a production source file the
 * capability_test command itself names. null = nothing real to target (the honest answer — the
 * authoring path then declines instead of inventing a module).
 */
export function resolveTargetModule(
  dim: { outcomes?: Array<Record<string, unknown>>; capability_test?: unknown },
  cwd: string,
  exists: (p: string) => boolean = (p) => fs.existsSync(p),
): string | null {
  for (const o of dim.outcomes ?? []) {
    const cs = o['required_callsite'];
    if (typeof cs !== 'string' || !cs || cs.toUpperCase().includes('TODO')) continue;
    if (!isProductionSrc(cs)) continue;
    if (exists(path.join(cwd, cs))) return cs;
  }
  const cmd = (dim.capability_test as { command?: string } | undefined)?.command ?? '';
  for (const m of cmd.match(/(?:src|packages|lib)[\w./\\-]*\.(?:m?[jt]sx?|py|rs|go)\b/gi) ?? []) {
    const rel = m.replace(/\\/g, '/');
    if (isProductionSrc(rel) && exists(path.join(cwd, rel))) return rel;
  }
  return null;
}

export async function runCapabilityTestExecute(options: CapabilityTestExecuteOptions = {}): Promise<CapabilityTestExecuteResult> {
  const cwd = path.resolve(options.project ?? process.cwd());
  const matrix = await loadMatrix(cwd);
  if (!matrix) throw new Error('No compete matrix found. Run `danteforge compete --init` first.');

  // The exact ladder check the conduct plan pass uses — a competitor-grounded "## Score Ladder" section
  // in the dim's universe file. Re-read from disk on every call: a ladder researched EARLIER IN THIS
  // PASS must count when the same pass reaches authoring.
  const universeDir = path.join(cwd, '.danteforge', 'compete', 'universe');
  const hasLadder = (dimId: string): boolean => {
    try { return fs.readFileSync(path.join(universeDir, `${dimId}.md`), 'utf8').search(/##\s*Score Ladder/i) >= 0; }
    catch { return false; }
  };

  const audits = await auditAllCapabilityTests(matrix as unknown as Parameters<typeof auditAllCapabilityTests>[0], cwd, hasLadder);
  const auditByDim = new Map(audits.map(a => [a.dimId, a]));
  const dimById = new Map(matrix.dimensions.map(d => [d.id, d]));

  // Budget: author + research are the expensive (agent-dispatching) actions; probes and repair runs are
  // bounded shell executions and stay free. The counter is consumed INSIDE the wrappers so the cap holds
  // even on the probe-demotion path (where the engine authors without a fresh hasBudget check).
  const maxActions = typeof options.maxActions === 'number' && Number.isFinite(options.maxActions)
    ? Math.max(0, Math.floor(options.maxActions))
    : 3;
  let actionsUsed = 0;
  const takeBudget = (): boolean => { if (actionsUsed >= maxActions) return false; actionsUsed += 1; return true; };

  const runShell = options._runShell ?? makeRunShell(options.timeoutMs ?? 180_000);

  // Wired-basename set: built lazily ONCE via the same buildWiredBasenames the auditor itself calls.
  let wiredCache: Promise<Set<string>> | null = null;
  const getWired = (): Promise<Set<string>> => (wiredCache ??= buildWiredBasenames(cwd));

  const installRepair = options._installRepair ?? (async (dimId: string, command: string): Promise<void> => {
    const fresh = await loadMatrix(cwd);
    if (!fresh) return;
    const dim = fresh.dimensions.find(d => d.id === dimId) as unknown as { capability_test?: Record<string, unknown> } | undefined;
    if (!dim) return;
    dim.capability_test = { ...(dim.capability_test ?? {}), command, description: `Repaired yardstick for ${dimId} — repointed at its real, passing, wired outcome` };
    await saveMatrix(fresh, cwd);
  });

  const verifyRealFn = async (dimId: string): Promise<SensitivityVerdict> => {
    const audit = auditByDim.get(dimId);
    if (!audit) return 'INCONCLUSIVE';
    if (options._verifyFn) return options._verifyFn(audit, cwd);
    return (await verifyDimYardstick(audit, cwd, { timeoutMs: options.timeoutMs })).verdict;
  };

  const productionAuthor = async (dimId: string): Promise<AuthorResult> => {
    const dim = dimById.get(dimId);
    if (!dim) return { dimId, installed: false, reason: 'dimension not found in the matrix.' };
    const targetModule = resolveTargetModule(dim as unknown as Parameters<typeof resolveTargetModule>[0], cwd);
    if (!targetModule) {
      return { dimId, installed: false, reason: 'no production src target on disk (no existing outcome required_callsite, and the capability_test command names none) — wire the capability before authoring its yardstick.' };
    }
    const rubric = await loadDimRubric(cwd, dimId);
    const bar = rubric.find(l => l.score === 9) ?? nextLevel(rubric, effectiveDimScore(dim));
    if (!bar) {
      return { dimId, installed: false, reason: 'the universe ladder defines no row above the current score — no grounded frontier bar to author against.' };
    }
    return authorYardstickForDim({
      dimId, cwd, ladderBar: bar.descriptor, targetModule,
      wired: await getWired(), hasLadder: hasLadder(dimId), timeoutMs: options.timeoutMs,
    });
  };

  const authorFn = async (dimId: string): Promise<AuthorResult> => {
    // Repair-first on the self-fulfilling branch: the repair engine's gates prove by EXECUTION that the
    // current yardstick fails while a real wired outcome passes — repointing then needs no agent spend.
    // It declines every other shape, and only then do we pay for full re-authoring.
    const audit = auditByDim.get(dimId);
    const dim = dimById.get(dimId);
    if (dim && audit?.verdict === 'SELF_FULFILLING_STUB') {
      const repairFn = options._repairFn
        ?? ((d: MatrixDimension, c: string) => repairStubYardstick(d as unknown as Parameters<typeof repairStubYardstick>[0], c, runShell));
      const repair = await repairFn(dim, cwd);
      if (repair.repaired && repair.newCommand) {
        await installRepair(dimId, repair.newCommand);
        return { dimId, installed: true, reason: `repaired, not re-authored: ${repair.reason}` };
      }
    }
    // DETERMINISTIC preconditions BEFORE budget (adversarial-review finding 9): a dim with no
    // production target on disk or no ladder bar refuses without any agent spend — paying a budget
    // slot for a guaranteed refusal starved authorable dims on every setup cycle.
    if (!options._authorFn && dim) {
      const targetModule = resolveTargetModule(dim as unknown as Parameters<typeof resolveTargetModule>[0], cwd);
      if (!targetModule) {
        return { dimId, installed: false, reason: 'no production src target on disk (no existing outcome required_callsite, and the capability_test command names none) — wire the capability before authoring its yardstick. (No budget consumed.)' };
      }
      const rubric = await loadDimRubric(cwd, dimId);
      if (!(rubric.find(l => l.score === 9) ?? nextLevel(rubric, effectiveDimScore(dim)))) {
        return { dimId, installed: false, reason: 'the universe ladder defines no row above the current score — no grounded frontier bar to author against. (No budget consumed.)' };
      }
    }
    if (!takeBudget()) {
      return { dimId, installed: false, reason: `budget exhausted this pass (${actionsUsed}/${maxActions} expensive actions used) — authoring deferred; raise --max-actions or run another pass.` };
    }
    return (options._authorFn ?? productionAuthor)(dimId);
  };

  const researchLadderViaCouncil = async (dimId: string): Promise<{ ok: boolean; reason: string }> => {
    const dim = dimById.get(dimId);
    const { runCouncilUniversePhase } = await import('../../matrix/engines/council-universe-runner.js');
    const result = await runCouncilUniversePhase({
      projectPath: cwd,
      targets: [{
        dimId,
        dimName: dim?.label ?? dimId,
        currentScore: dim ? effectiveDimScore(dim) : 0,
        targetScore: 9,
        ossLeader: dim?.oss_leader || undefined,
      }],
      // The dim was routed here precisely BECAUSE it has no Score Ladder — an existing ladder-less
      // universe file must be re-researched, not skipped.
      skipExisting: false,
    });
    if (!result.written.includes(dimId)) {
      return { ok: false, reason: 'council research produced no universe file (no council member available, or its output failed validation) — the ladder stays missing rather than invented.' };
    }
    if (!hasLadder(dimId)) {
      return { ok: false, reason: 'the researched universe file contains no "## Score Ladder" section — the grounded bar is still missing, so authoring stays blocked.' };
    }
    return { ok: true, reason: 'competitor Score Ladder researched + written by the council.' };
  };

  const researchLadderFn = async (dimId: string): Promise<{ ok: boolean; reason: string }> => {
    if (!takeBudget()) {
      return { ok: false, reason: `budget exhausted this pass (${actionsUsed}/${maxActions} expensive actions used) — ladder research deferred.` };
    }
    return (options._researchFn ?? researchLadderViaCouncil)(dimId);
  };

  const report = await remediateYardsticks(audits, {
    authorFn,
    researchLadderFn,
    verifyRealFn,
    hasBudget: () => actionsUsed < maxActions,
  });

  const result: CapabilityTestExecuteResult = { report, actionsUsed, maxActions };
  if (options.json) { process.stdout.write(JSON.stringify(result, null, 2) + '\n'); return result; }

  logger.info('');
  logger.success(`Conductor EXECUTE pass — ${report.outcomes.length} dimension(s), ${actionsUsed}/${maxActions} expensive action(s) spent`);
  const order: Array<RemediationOutcome['status']> = ['PROCEED', 'AUTHORED', 'AUTHOR_REJECTED', 'CEILING', 'BLOCKED', 'SKIPPED'];
  logger.info('  ' + order.map(s => `${s} ${report.counts[s] ?? 0}`).join('  ·  '));
  const acted = report.outcomes.filter(o => o.status !== 'PROCEED' && o.status !== 'CEILING');
  if (acted.length > 0) {
    logger.info('');
    logger.info('  Acted-on dimensions:');
    for (const o of acted.slice(0, 30)) {
      logger.info(`    ${o.status.padEnd(15)} ${o.dimId}${o.ladderResearched ? ' [ladder researched]' : ''} — ${(o.detail ?? o.reason).slice(0, 160)}`);
    }
    if (acted.length > 30) logger.info(`    … and ${acted.length - 30} more`);
  }
  return result;
}
