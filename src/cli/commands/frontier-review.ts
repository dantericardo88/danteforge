// frontier-review.ts — run the frontier-review-court for a dim and record its verdict.
//
//   danteforge frontier-review <dim> [--write]
//
// On VALIDATED (and --write) it sets frontier_spec.status = 'validated' — the ONLY way a dim's
// score is allowed above 8.0 (the frontier gate requires `validated`). On a strong honest-ceiling
// signal it writes a ceiling receipt. The court's judges are independent council members who did
// not build the evidence (builder-never-judges), so this is an automated, non-self-certifying 9.0.

import path from 'node:path';
import fs from 'node:fs/promises';
import { loadMatrix, saveMatrix, type CompeteMatrix } from '../../core/compete-matrix.js';
import { logger } from '../../core/logger.js';
import { effectiveStatus, type FrontierSpec } from '../../core/frontier-spec.js';
import { writeCeilingReceipt } from '../../core/ceiling-receipt.js';
import {
  runFrontierReviewCourt, type FrontierReviewInput, type FrontierReviewResult,
} from '../../matrix/courts/frontier-review-court.js';
import type { CouncilMemberId } from '../../matrix/engines/council-scheduler.js';

export interface FrontierReviewCliOptions {
  dimId: string;
  cwd?: string;
  minJudges?: number;
  write?: boolean;
  json?: boolean;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _saveMatrix?: (m: CompeteMatrix, cwd: string) => Promise<void>;
  _discoverMembers?: () => Promise<CouncilMemberId[]>;
  _runJudge?: (id: CouncilMemberId, prompt: string) => Promise<string>;
  _readArtifact?: (p: string) => Promise<string>;
  _writeCeiling?: (p: string, c: string) => Promise<void>;
  _now?: string;
}

export interface FrontierReviewCliResult {
  dimId: string;
  result: FrontierReviewResult;
  validatedWritten: boolean;
  ceilingWritten: boolean;
}

async function defaultDiscoverMembers(): Promise<CouncilMemberId[]> {
  const { discoverCouncil } = await import('./council.js');
  const members = await discoverCouncil();
  return members.filter(m => m.available).map(m => m.id as CouncilMemberId);
}

async function defaultRunJudge(id: CouncilMemberId, prompt: string, cwd: string): Promise<string> {
  const { makeAdapter, makeWorkPacket, makeLease } = await import('./council.js');
  const { runAdapter } = await import('../../matrix/adapters/adapter-interface.js');
  const adapter = makeAdapter(id, makeWorkPacket(prompt, cwd), true);
  const r = await runAdapter(adapter, { lease: makeLease(cwd), cwd });
  return (r as { finalMessage?: string }).finalMessage ?? '';
}

export async function runFrontierReviewCli(options: FrontierReviewCliOptions): Promise<FrontierReviewCliResult> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const loadFn = options._loadMatrix ?? loadMatrix;
  const saveFn = options._saveMatrix ?? saveMatrix;
  const readArtifact = options._readArtifact ?? ((p: string) => fs.readFile(p, 'utf8'));

  const matrix = await loadFn(cwd);
  if (!matrix) throw new Error('No compete matrix found.');
  const dim = matrix.dimensions.find(d => d.id === options.dimId);
  if (!dim) throw new Error(`Dimension "${options.dimId}" not found.`);
  const spec = (dim as unknown as { frontier_spec?: FrontierSpec }).frontier_spec;
  if (!spec) throw new Error(`"${options.dimId}" has no frontier_spec. Run frontier-spec init/check/freeze first.`);
  if (effectiveStatus(spec) === 'stale') throw new Error(`"${options.dimId}" frontier_spec is STALE (edited after freeze) — re-freeze before review.`);
  if (effectiveStatus(spec) === 'draft') throw new Error(`"${options.dimId}" frontier_spec is not frozen — freeze it before the court reviews.`);

  const rup = spec.real_user_path;
  const artifactPath = rup.observable_artifacts[0]?.path ?? '';
  let artifactExcerpt = '(artifact not readable)';
  try { artifactExcerpt = (await readArtifact(path.join(cwd, artifactPath))).slice(0, 2000); } catch { /* best-effort */ }

  const reviewInput: FrontierReviewInput = {
    dimId: options.dimId,
    frontierSpec: spec,
    evidence: {
      runCommand: rup.run_command,
      requiredCallsite: rup.required_callsite,
      artifactPath,
      artifactExcerpt,
      receipts: gatherReceipts(dim),
    },
  };

  const members = await (options._discoverMembers ?? defaultDiscoverMembers)();
  if (members.length < 2) throw new Error(`Frontier review needs ≥2 independent council members; found ${members.length}.`);
  const runJudge = options._runJudge ?? ((id: CouncilMemberId, prompt: string) => defaultRunJudge(id, prompt, cwd));

  logger.info(`[frontier-review] ${options.dimId}: ${members.length} independent judges vs ${spec.leader_target.competitor}…`);
  const result = await runFrontierReviewCourt(reviewInput, { members, minJudges: options.minJudges, runJudge });

  let validatedWritten = false;
  let ceilingWritten = false;
  const now = options._now ?? new Date().toISOString();

  if (result.verdict === 'VALIDATED') {
    logger.success(`[frontier-review] ${options.dimId}: VALIDATED — ${result.vote.summary}`);
    if (options.write) { spec.status = 'validated'; await saveFn(matrix, cwd); validatedWritten = true; }
  } else {
    logger.warn(`[frontier-review] ${options.dimId}: REJECTED — ${result.vote.summary} (ceiling signal ${result.ceilingSignal}/${result.vote.total})`);
    // Strong, agreed honest-ceiling signal → record a ceiling so the orchestrator stops grinding it.
    if (options.write && result.ceilingSignal > result.vote.total / 2) {
      await writeCeilingReceipt(cwd, {
        dimId: options.dimId, cap: 8.0, cause: 'court-rejected',
        detail: `Frontier-review court judged this an honest ceiling: ${result.judges.find(j => j.ceiling)?.reason ?? ''}`.slice(0, 400),
        failedGates: ['frontier-review-court'],
        councilVote: { pass: result.vote.pass, fail: result.vote.fail, summary: result.vote.summary },
        recordedAt: now,
      }, options._writeCeiling);
      ceilingWritten = true;
      logger.info(`[frontier-review] ${options.dimId}: ceiling receipt written (court-rejected).`);
    }
  }

  for (const d of result.dissent) logger.info(`  dissent: ${d}`);
  if (options.json) process.stdout.write(JSON.stringify({ dimId: options.dimId, result, validatedWritten, ceilingWritten }, null, 2) + '\n');
  return { dimId: options.dimId, result, validatedWritten, ceilingWritten };
}

function gatherReceipts(dim: unknown): Array<{ sessionId: string; passed: boolean; tier: string }> {
  const outcomes = (dim as { outcomes?: Array<Record<string, unknown>> }).outcomes ?? [];
  // Best-effort: surface declared real-user-path outcomes as the receipts under review.
  return outcomes
    .filter(o => (o.input_source as { type?: string } | undefined)?.type === 'real-user-path')
    .map((o, i) => ({ sessionId: `s${i + 1}`, passed: true, tier: String(o.tier ?? 'T7') }));
}
