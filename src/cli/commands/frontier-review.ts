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
import { effectiveStatus, computeSpecHash, signValidation, verifyBuilderProvenance, type FrontierSpec } from '../../core/frontier-spec.js';
import { writeCeilingReceipt } from '../../core/ceiling-receipt.js';
import { enqueueAudit, type AuditEscrowEntry } from '../../core/audit-escrow.js';
import {
  runFrontierReviewCourt, type FrontierReviewInput, type FrontierReviewResult,
} from '../../matrix/courts/frontier-review-court.js';
import type { CouncilMemberId } from '../../matrix/engines/council-scheduler.js';
import { loadOutcomeEvidence } from '../../matrix/engines/outcome-runner.js';
import { makeEvidenceKey, type OutcomeEvidence } from '../../matrix/types/outcome.js';

export interface FrontierReviewCliOptions {
  dimId: string;
  cwd?: string;
  minJudges?: number;
  /** The member that built this dim (parallel mode) — excluded from judging. */
  builderMemberId?: CouncilMemberId;
  /** ALL members that contributed to the build (sequential/multi-builder mode) — every one excluded
   *  from judging. Leaves only judge-only members (grok) as judges; if that is < minJudges the court
   *  refuses to convene rather than letting a builder judge its own work. (Gap #3-full.) */
  excludeBuilderIds?: CouncilMemberId[];
  /** A KERNEL-signed token (signBuilderProvenance) attesting the REAL builder(s) of this dim. When it verifies
   *  against the excluded builder set, the court seats PEER judges — build-eligible members that did NOT build
   *  this dim (claude judges a codex-built dim) — instead of the over-broad build-eligible floor. An agent
   *  cannot forge it (no kernel secret), so a manual/forged invocation still falls back to the safe floor. */
  builderProvenanceToken?: string;
  write?: boolean;
  json?: boolean;
  _loadMatrix?: (cwd: string) => Promise<CompeteMatrix | null>;
  _saveMatrix?: (m: CompeteMatrix, cwd: string) => Promise<void>;
  _discoverMembers?: () => Promise<CouncilMemberId[]>;
  _runJudge?: (id: CouncilMemberId, prompt: string) => Promise<string>;
  _readArtifact?: (p: string) => Promise<string>;
  _writeCeiling?: (p: string, c: string) => Promise<void>;
  _enqueueAudit?: (cwd: string, entry: AuditEscrowEntry) => Promise<void>;
  _loadEvidence?: (cwd: string) => Promise<OutcomeEvidence>;
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

/** The court's judge-exclusion decision as a PURE function, so the integrity property is unit-tested: a
 *  VERIFYING kernel-signed builder-provenance token seats independent PEERS (excludes only the real builder(s));
 *  anything else — no token, a forged token, a token for the wrong builder/dim — holds the court-audit #4+#5
 *  FLOOR (exclude EVERY build-eligible member so a builder can never judge its own work). `roster` carries the
 *  judge-only flags; an empty roster (test seam) makes the floor a no-op, matching the pre-existing behavior. */
export function computeExcludedJudges(
  dimId: string,
  excludeBuilderIds: CouncilMemberId[],
  builderMemberId: CouncilMemberId | undefined,
  builderProvenanceToken: string | undefined,
  roster: Array<{ id: CouncilMemberId; judgeOnly?: boolean }>,
): Set<CouncilMemberId> {
  const excluded = new Set<CouncilMemberId>(excludeBuilderIds);
  if (builderMemberId) excluded.add(builderMemberId);
  const peerReview = verifyBuilderProvenance(dimId, [...excluded], builderProvenanceToken);
  if (!peerReview) {
    for (const mm of roster) if (!mm.judgeOnly) excluded.add(mm.id);
  }
  return excluded;
}

async function defaultRunJudge(id: CouncilMemberId, prompt: string, cwd: string): Promise<string> {
  const { makeAdapter, makeWorkPacket, makeJudgeLease } = await import('./council.js');
  const { runAdapter } = await import('../../matrix/adapters/adapter-interface.js');
  const adapter = makeAdapter(id, makeWorkPacket(prompt, cwd), true);
  // CH-017: a judge gets a READ-ONLY lease (empty allowedWritePaths) — it audits, it never writes.
  const r = await runAdapter(adapter, { lease: makeJudgeLease(cwd), cwd }) as { finalMessage?: string; status?: string; errorReason?: string };
  // CH-019: a failed/killed judge (provider outage, auth failure, timeout) must surface WHY in its
  // verdict text instead of silently returning '' (which parses to a contentless UNCLEAR with no
  // reason). The court then reads an honest "judge unavailable — <reason>" abstention, and the
  // outage signature (e.g. "usage limit … try again at 8:45 PM") flows into the court JSON, where
  // the orchestrator's provider-outage detector finds it and PAUSES rather than ceiling-ing.
  if (r.status === 'failed' || r.status === 'timed_out') {
    return `VERDICT: UNCLEAR\nCONFIDENCE: LOW\nREASON: judge unavailable — ${r.errorReason ?? r.status}`;
  }
  return r.finalMessage ?? '';
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
  // Widened evidence channel (council finding 2026-06-12): the judges previously received ONLY
  // artifacts[0] truncated to 2000 chars — structurally too narrow to demonstrate a multi-scenario
  // 9-row even when the capability exists. Pass every declared artifact with its own excerpt.
  const artifacts: Array<{ path: string; excerpt: string }> = [];
  for (const a of rup.observable_artifacts.slice(0, 6)) {
    let excerpt = '(artifact not readable)';
    try { excerpt = (await readArtifact(path.join(cwd, a.path))).slice(0, 4000); } catch { /* best-effort */ }
    artifacts.push({ path: a.path, excerpt });
  }

  // DETERMINISTIC pre-court receipt gate. Bind declared real-user-path outcomes to their evidence
  // and require genuine multi-session receipts BEFORE spending judges. A fixture that can't produce
  // ≥2 distinct passing sessions never reaches the council — the gate, not the LLM, blocks it.
  const { receipts, gate } = await gatherReceipts(
    cwd, dim as { id: string; outcomes?: Array<Record<string, unknown>> }, spec,
    options._loadEvidence ?? ((c: string) => loadOutcomeEvidence(c)),
  );
  if (!gate.ok) {
    logger.warn(`[frontier-review] ${options.dimId}: receipt gate FAILED — ${gate.reasons.join('; ')}. Court NOT convened.`);
    const result: FrontierReviewResult = {
      verdict: 'REJECTED',
      vote: { pass: 0, fail: 0, unclear: 0, total: 0, crossMember: 0, summary: `pre-court receipt gate failed: ${gate.reasons.join('; ')}` },
      ceilingSignal: 0, dissent: [], judges: [],
    };
    if (options.json) process.stdout.write(JSON.stringify({ dimId: options.dimId, result, validatedWritten: false, ceilingWritten: false }, null, 2) + '\n');
    return { dimId: options.dimId, result, validatedWritten: false, ceilingWritten: false };
  }

  const reviewInput: FrontierReviewInput = {
    dimId: options.dimId,
    frontierSpec: spec,
    evidence: {
      runCommand: rup.run_command,
      requiredCallsite: rup.required_callsite,
      artifactPath,
      artifactExcerpt,
      artifacts,
      receipts,
    },
  };

  const members = await (options._discoverMembers ?? defaultDiscoverMembers)();
  // Exclude every member that contributed to the build (the single parallel builder AND/OR the full
  // sequential builder roster). What remains is the pool of genuinely independent judges.
  // The exclusion decision (floor vs peer review) is the integrity core — delegate to the pure, unit-tested
  // computeExcludedJudges. The roster (judge-only flags) comes from the real council unless a test injects
  // _discoverMembers, in which case the floor naturally no-ops there exactly as before.
  let roster: Array<{ id: CouncilMemberId; judgeOnly?: boolean }> = [];
  if (!options._discoverMembers) {
    const { discoverCouncil } = await import('./council.js');
    roster = (await discoverCouncil()).map(m => ({ id: m.id as CouncilMemberId, judgeOnly: m.judgeOnly }));
  }
  const excluded = computeExcludedJudges(
    options.dimId, options.excludeBuilderIds ?? [], options.builderMemberId,
    options.builderProvenanceToken, roster,
  );
  const judgeCount = members.filter(m => !excluded.has(m)).length;
  const excludedList = [...excluded];
  if (judgeCount < 2) throw new Error(`Frontier review needs ≥2 independent judges (excluding the builder${excludedList.length ? `s ${excludedList.join('+')}` : ''}); found ${judgeCount} of ${members.length} members. A builder may not judge its own dim — add a judge-only member (e.g. grok-build) or use --parallel so a single member builds.`);
  const runJudge = options._runJudge ?? ((id: CouncilMemberId, prompt: string) => defaultRunJudge(id, prompt, cwd));

  logger.info(`[frontier-review] ${options.dimId}: ${judgeCount} independent judges${excludedList.length ? ` (excluding builder${excludedList.length > 1 ? 's' : ''} ${excludedList.join('+')})` : ''} vs ${spec.leader_target.competitor}…`);
  // Pass the FULLY-computed exclusion set (explicit flags + the safe default) so the court seats only
  // the genuinely independent judges this CLI layer resolved.
  const result = await runFrontierReviewCourt(reviewInput, { members, builderMemberId: options.builderMemberId, excludeMemberIds: excludedList, minJudges: options.minJudges, runJudge });

  let validatedWritten = false;
  let ceilingWritten = false;
  const now = options._now ?? new Date().toISOString();

  const enqueue = options._enqueueAudit ?? enqueueAudit;
  const auditBase = {
    replayCommand: rup.run_command, artifacts: rup.observable_artifacts.map(a => a.path),
    frontierSpecHash: computeSpecHash(spec), receipts: reviewInput.evidence.receipts,
    councilVote: { pass: result.vote.pass, fail: result.vote.fail, summary: result.vote.summary },
    dissent: result.dissent, enqueuedAt: now, status: 'pending' as const,
  };

  if (result.verdict === 'VALIDATED') {
    logger.success(`[frontier-review] ${options.dimId}: VALIDATED — ${result.vote.summary}`);
    if (options.write) {
      // court-audit #1: write a verifiable receipt, not a bare string. It binds the validation to this
      // dim + the exact reviewed content (frozen_hash) + the kernel secret, so the 9.0 cannot be forged
      // by hand-editing matrix.json and goes unvalidated if the spec is edited afterward.
      const passingJudges = result.judges.filter(j => j.verdict === 'PASS').map(j => String(j.judgeId));
      const frozenHash = computeSpecHash(spec);
      spec.status = 'validated';
      spec.validated_by = {
        frozen_hash: frozenHash,
        judge_member_ids: passingJudges,
        builder_member_ids: excludedList, // bind the excluded builders so judge∩builder is verifiable later
        validated_at: now,
        sig: signValidation(options.dimId, frozenHash, passingJudges, excludedList),
      };
      await saveFn(matrix, cwd); validatedWritten = true;
      // Sample into the non-blocking human-audit queue (the court can't catch a perfect fixture).
      await enqueue(cwd, { dimId: options.dimId, kind: 'validated-9.0', ...auditBase });
    }
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
      await enqueue(cwd, { dimId: options.dimId, kind: 'ceiling', ...auditBase });
      logger.info(`[frontier-review] ${options.dimId}: ceiling receipt written (court-rejected).`);
    }
  }

  for (const d of result.dissent) logger.info(`  dissent: ${d}`);
  if (options.json) process.stdout.write(JSON.stringify({ dimId: options.dimId, result, validatedWritten, ceilingWritten }, null, 2) + '\n');
  return { dimId: options.dimId, result, validatedWritten, ceilingWritten };
}

interface ReceiptGate { ok: boolean; reasons: string[]; distinctSessions: number; passingT5plus: number }

function tierNum(tier: string): number {
  const m = /^T(\d+)$/.exec(String(tier).trim());
  return m ? Number(m[1]) : -1;
}

/**
 * Surface the dim's REAL real-user-path receipts from the outcome-evidence files (not synthesized),
 * and run a DETERMINISTIC pre-court gate. The court's LLM judges cannot verify session-distinctness
 * or that a receipt actually passed — so we bind each declared real-user-path outcome to its evidence
 * entry (via makeEvidenceKey) and require, from the EVIDENCE: >=min_t5_plus_outcomes passing T5+
 * receipts across >=min_distinct_sessions distinct session_ids, with none failing. A declared outcome
 * with NO evidence at this SHA is NOT a receipt (the old code surfaced it as a fabricated passed:true). This
 * mirrors derived-score's structural T7 veto so a single staged fixture cannot reach the court.
 */
async function gatherReceipts(
  cwd: string,
  dim: { id: string; outcomes?: Array<Record<string, unknown>> },
  spec: FrontierSpec,
  loadEvidence: (cwd: string) => Promise<OutcomeEvidence>,
): Promise<{ receipts: Array<{ sessionId: string; passed: boolean; tier: string }>; gate: ReceiptGate }> {
  const evidence = await loadEvidence(cwd);
  const receipts: Array<{ sessionId: string; passed: boolean; tier: string }> = [];
  // Grading-integrity #2 (lockstep with derived-score): also track the COMMAND per passing T5+ receipt,
  // so the court can reject one command cloned N times — the session check alone never caught it.
  const t5Commands: string[] = [];
  for (const o of dim.outcomes ?? []) {
    if ((o.input_source as { type?: string } | undefined)?.type !== 'real-user-path') continue;
    const e = evidence.get(makeEvidenceKey(dim.id, String(o.id ?? '')));
    if (!e) continue; // no real evidence at this SHA → not a receipt
    const tier = String(o.tier ?? e.tier ?? '');
    receipts.push({ sessionId: e.session_id ?? '(no-session)', passed: e.passed, tier });
    if (e.passed && tierNum(tier) >= 5) {
      t5Commands.push(((o as { command?: string }).command ?? '').trim().replace(/\s+/g, ' '));
    }
  }
  const passingT5plus = receipts.filter(r => r.passed && tierNum(r.tier) >= 5);
  const distinct = new Set(passingT5plus.map(r => r.sessionId).filter(s => s && s !== '(no-session)'));
  // Only DECLARED commands count toward clone-detection — outcomes that declare no command are a
  // different concern (other gates handle them), not "cloning". Penalize only ≥2 real identical commands.
  const realCommands = t5Commands.filter(c => c.length > 0);
  const needOutcomes = spec.required_receipts.min_t5_plus_outcomes;
  const needSessions = spec.required_receipts.min_distinct_sessions;
  const reasons: string[] = [];
  if (passingT5plus.length < needOutcomes) reasons.push(`${passingT5plus.length}/${needOutcomes} passing T5+ real-user-path receipts on disk`);
  if (distinct.size < needSessions) reasons.push(`${distinct.size}/${needSessions} distinct evidence session(s) — a single sitting cannot self-certify`);
  if (realCommands.length >= 2 && new Set(realCommands).size < 2) reasons.push(`all ${realCommands.length} T5+ receipts run the SAME command — one command cloned is not multi-receipt consensus (need ≥2 distinct commands)`);
  if (receipts.some(r => !r.passed)) reasons.push('one or more real-user-path receipts FAILED');
  return { receipts, gate: { ok: reasons.length === 0, reasons, distinctSessions: distinct.size, passingT5plus: passingT5plus.length } };
}
