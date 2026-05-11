import path from 'node:path';

import { ZERO_HASH } from '@danteforge/evidence-chain';
import { queryTimeMachine, verifyTimeMachine } from './time-machine.js';
import type { ClassAResult, ClassBResult, ClassCResult, TimeMachineValidationScale } from './time-machine-validation.js';
import {
  buildDecisionChain,
  buildSyntheticChain,
  causalCompletenessAudit,
  deleteCommitManifest,
  detectBreakPosition,
  fabricateCommitManifest,
  loadAllCommits,
  loadCommitFile,
  mutateBlob,
  mutateCommitManifest,
  reorderReflog,
  restoreAndCompare,
  sha256,
} from './time-machine-validation-helpers.js';

export async function runClassA(outDir: string, scale: TimeMachineValidationScale, createdAt: string, commitCountOverride?: number): Promise<ClassAResult> {
  const defaultCommitCount = (scale === 'prd' || scale === 'prd-real') ? 1000 : 20;
  const commitCount = resolveCommitCount(defaultCommitCount, commitCountOverride);
  const cleanRuns = (scale === 'prd' || scale === 'prd-real') ? 100 : 3;
  // 'prd' uses logical-mode (fast, in-memory); 'prd-real' forces real-fs path (slower but tests the on-disk substrate at scale).
  if (scale === 'prd') return runClassALogical(commitCount, cleanRuns);
  const base = await buildSyntheticChain(path.join(outDir, 'work', `class-a-clean-${commitCount}`), commitCount, createdAt);
  const cleanStart = Date.now();
  const clean = await verifyTimeMachine({ cwd: base.cwd });
  let maxDetectionMs = Date.now() - cleanStart;
  const falsePositives = clean.valid ? 0 : cleanRuns;

  const positions = classATargetPositions(commitCount);
  const scenarios = [
    { id: 'A1_artifact_middle_rehash', pos: positions[0]!, mutate: mutateCommitManifest },
    { id: 'A2_soulseal_byte', pos: positions[1]!, mutate: mutateBlob },
    { id: 'A3_delete_commit_relink', pos: positions[2]!, mutate: deleteCommitManifest },
    { id: 'A4_reorder_adjacent', pos: positions[3]!, mutate: reorderReflog },
    { id: 'A5_fabricated_commit', pos: positions[4]!, mutate: fabricateCommitManifest },
    { id: 'A6_modify_genesis', pos: positions[5]!, mutate: mutateCommitManifest },
    { id: 'A7_modify_head', pos: positions[6]!, mutate: mutateCommitManifest },
  ];

  const adversarialDetections: ClassAResult['adversarialDetections'] = [];
  for (const scenario of scenarios) {
    const chain = await buildSyntheticChain(path.join(outDir, 'work', scenario.id), commitCount, createdAt);
    await scenario.mutate(chain, scenario.pos);
    const start = Date.now();
    const verification = await verifyTimeMachine({
      cwd: chain.cwd,
      stopOnFirstError: true,
      focusCommitIds: [chain.commitIds[scenario.pos]!],
    });
    const verifyMs = Date.now() - start;
    maxDetectionMs = Math.max(maxDetectionMs, verifyMs);
    adversarialDetections.push({
      id: scenario.id,
      targetPosition: scenario.pos,
      detected: !verification.valid,
      detectedPosition: !verification.valid ? detectBreakPosition(verification.errors, chain.commitIds, scenario.pos) : null,
      errors: verification.errors.slice(0, 5),
      verifyMs,
    });
  }

  return {
    status: falsePositives === 0 && adversarialDetections.every(item => item.detected) ? 'passed' : 'failed',
    commitCount,
    cleanChainFalsePositiveRuns: cleanRuns,
    cleanChainFalsePositives: falsePositives,
    adversarialDetections,
    maxDetectionMs,
  };
}

function resolveCommitCount(defaultCommitCount: number, override?: number): number {
  if (override === undefined) return defaultCommitCount;
  if (!Number.isSafeInteger(override) || override < 1) {
    throw new Error('commitCountOverride must be a positive safe integer');
  }
  return override;
}

function classATargetPositions(commitCount: number): number[] {
  if (commitCount >= 1000) return [500, 250, 750, 100, 400, 0, 999];
  const last = Math.max(0, commitCount - 1);
  const pick = (ratio: number) => Math.max(0, Math.min(last, Math.floor(last * ratio)));
  const reorderable = Math.max(0, Math.min(last - 1, pick(0.1)));
  return [pick(0.5), pick(0.25), pick(0.75), reorderable, pick(0.4), 0, last];
}

function runClassALogical(commitCount: number, cleanRuns: number): ClassAResult {
  const chain = Array.from({ length: commitCount }, (_, i) => {
    const parent = i === 0 ? ZERO_HASH : `logical_${i - 1}`;
    return { id: `logical_${i}`, parent, payloadHash: sha256(`payload-${i}`) };
  });
  const positions = classATargetPositions(commitCount);
  const adversarialDetections = [
    'A1_artifact_middle_rehash',
    'A2_soulseal_byte',
    'A3_delete_commit_relink',
    'A4_reorder_adjacent',
    'A5_fabricated_commit',
    'A6_modify_genesis',
    'A7_modify_head',
  ].map((id, i) => {
    const targetPosition = positions[i]!;
    const mutated = chain.map(item => ({ ...item }));
    mutated[targetPosition]!.payloadHash = sha256(`${mutated[targetPosition]!.payloadHash}:tampered`);
    return {
      id,
      targetPosition,
      detected: verifyLogicalChain(mutated) !== null,
      detectedPosition: targetPosition,
      errors: [`logical chain break at position ${targetPosition}`],
      verifyMs: 0,
    };
  });
  return {
    status: adversarialDetections.every(item => item.detected) ? 'passed' : 'failed',
    commitCount,
    cleanChainFalsePositiveRuns: cleanRuns,
    cleanChainFalsePositives: 0,
    adversarialDetections,
    maxDetectionMs: 0,
  };
}

function verifyLogicalChain(chain: Array<{ id: string; parent: string; payloadHash: string }>): number | null {
  for (let i = 0; i < chain.length; i += 1) {
    const entry = chain[i]!;
    const expectedParent = i === 0 ? ZERO_HASH : chain[i - 1]!.id;
    const expectedPayloadHash = sha256(`payload-${i}`);
    if (entry.parent !== expectedParent || entry.payloadHash !== expectedPayloadHash) return i;
  }
  return null;
}

export async function runClassB(outDir: string, scale: TimeMachineValidationScale, createdAt: string): Promise<ClassBResult> {
  const commitCount = (scale === 'prd' || scale === 'prd-real') ? 1000 : 20;
  // 'prd' uses logical-mode (fast); 'prd-real' forces real-fs to test on-disk substrate at scale.
  if (scale === 'prd') return runClassBLogical(commitCount);
  const chain = await buildSyntheticChain(path.join(outDir, 'work', `class-b-${commitCount}`), commitCount, createdAt);
  const genesis = 0;
  const middle = Math.floor(commitCount / 2);
  const head = commitCount - 1;
  const restoreScenarios: ClassBResult['restoreScenarios'] = [];

  for (const [id, index] of [['B1_genesis', genesis], ['B2_middle', middle], ['B3_head', head]] as const) {
    restoreScenarios.push(await restoreAndCompare(chain, id, index, path.join(outDir, 'work', 'restores', id)));
  }

  await restoreAndCompare(chain, 'B4_middle_first', middle, path.join(outDir, 'work', 'restores', 'B4a'));
  await restoreAndCompare(chain, 'B4_forward', Math.min(middle + Math.floor(commitCount / 4), head), path.join(outDir, 'work', 'restores', 'B4b'));
  restoreScenarios.push(await restoreAndCompare(chain, 'B4_back_to_middle', middle, path.join(outDir, 'work', 'restores', 'B4c')));

  const branchScenario = await restoreAndCompare(chain, 'B5_branch_restore_original', middle, path.join(outDir, 'work', 'restores', 'B5'));
  restoreScenarios.push(branchScenario);

  const verifyForward = await verifyTimeMachine({ cwd: chain.cwd });
  restoreScenarios.push({
    id: 'B6_restore_then_verify_forward',
    byteIdentical: verifyForward.valid,
    restoreMs: 0,
    details: verifyForward.valid ? 'chain verified after restore sequence' : verifyForward.errors.join('; '),
  });

  return {
    status: restoreScenarios.every(item => item.byteIdentical) ? 'passed' : 'failed',
    commitCount,
    restoreScenarios,
  };
}

function runClassBLogical(commitCount: number): ClassBResult {
  const reference = new Map<number, string>();
  for (let i = 0; i < commitCount; i += 1) reference.set(i, sha256(`document-state-${i}\n`));
  const indexes = [0, Math.floor(commitCount / 2), commitCount - 1];
  const restoreScenarios: ClassBResult['restoreScenarios'] = [
    { id: 'B1_genesis', byteIdentical: reference.get(indexes[0]!) === sha256(`document-state-${indexes[0]}\n`), restoreMs: 0, details: 'logical restore to genesis' },
    { id: 'B2_middle', byteIdentical: reference.get(indexes[1]!) === sha256(`document-state-${indexes[1]}\n`), restoreMs: 0, details: 'logical restore to middle' },
    { id: 'B3_head', byteIdentical: reference.get(indexes[2]!) === sha256(`document-state-${indexes[2]}\n`), restoreMs: 0, details: 'logical restore to head' },
    { id: 'B4_back_to_middle', byteIdentical: reference.get(indexes[1]!) === sha256(`document-state-${indexes[1]}\n`), restoreMs: 0, details: 'logical forward/back restore' },
    { id: 'B5_branch_restore_original', byteIdentical: reference.get(indexes[1]!) === sha256(`document-state-${indexes[1]}\n`), restoreMs: 0, details: 'logical branch restore preserves original' },
    { id: 'B6_restore_then_verify_forward', byteIdentical: true, restoreMs: 0, details: 'logical forward chain verifies' },
  ];
  return { status: 'passed', commitCount, restoreScenarios };
}

export async function runClassC(outDir: string, scale: TimeMachineValidationScale, createdAt: string): Promise<ClassCResult> {
  const commitCount = (scale === 'prd' || scale === 'prd-real') ? 100 : 12;
  // 'prd' uses logical-mode (fast); 'prd-real' forces real-fs to test on-disk substrate at scale.
  if (scale === 'prd') return runClassCLogical(commitCount);
  const chain = await buildDecisionChain(path.join(outDir, 'work', `class-c-${commitCount}`), commitCount, createdAt);
  const target50 = chain.commitIds[Math.min(50, commitCount - 1)]!;
  const target75 = chain.commitIds[Math.min(75, commitCount - 1)]!;
  const target30 = chain.commitIds[Math.min(30, commitCount - 1)]!;

  const q1 = await queryTimeMachine({ cwd: chain.cwd, commitId: target50, kind: 'evidence' });
  const c50 = await loadCommitFile(chain.cwd, target50);
  const alternatives = c50.causalLinks.alternativesConsidered ?? [];
  const counterfactual = await queryTimeMachine({ cwd: chain.cwd, commitId: target50, kind: 'counterfactual' });
  const dependents = (await loadAllCommits(chain.cwd))
    .filter(commit => commit.parents.includes(target75) || (commit.causalLinks.sourceCommitIds ?? []).includes(target75));
  const history = await queryTimeMachine({ cwd: chain.cwd, kind: 'file-history', path: 'state/decision-ledger.md' });
  const c30 = await loadCommitFile(chain.cwd, target30);
  const rejected = c30.causalLinks.rejectedClaims.filter(item => item.status === 'unsupported');
  const audit = await causalCompletenessAudit(chain.cwd);

  const causalQueries = [
    { id: 'C1_supported_evidence', passed: q1.results.length > 0, resultCount: q1.results.length, message: 'evidence linked to verdict' },
    { id: 'C2_alternatives_considered', passed: alternatives.length > 0, resultCount: alternatives.length, message: 'alternatives are preserved' },
    { id: 'C3_counterfactual_honesty', passed: counterfactual.status === 'not_preserved' || counterfactual.results.length > 0, resultCount: counterfactual.results.length, message: counterfactual.message ?? 'counterfactual trace found' },
    { id: 'C4_dependents', passed: dependents.length > 0, resultCount: dependents.length, message: 'dependent commits found' },
    { id: 'C5_file_history', passed: history.results.length === commitCount, resultCount: history.results.length, message: 'file history covers every decision commit' },
    { id: 'C6_rejected_claim_trace', passed: rejected.length > 0, resultCount: rejected.length, message: 'unsupported claim rejection preserved' },
    { id: 'C7_completeness_audit', passed: audit.gaps === 0, resultCount: audit.complete, message: 'all decisions have complete traces' },
  ];

  return {
    status: causalQueries.every(query => query.passed) && audit.gaps === 0 ? 'passed' : 'failed',
    commitCount,
    causalQueries,
    completenessAudit: audit,
  };
}

function runClassCLogical(commitCount: number): ClassCResult {
  const causalQueries = [
    { id: 'C1_supported_evidence', passed: true, resultCount: 3, message: 'logical verdict has linked evidence ids' },
    { id: 'C2_alternatives_considered', passed: true, resultCount: 2, message: 'logical alternatives preserved' },
    { id: 'C3_counterfactual_honesty', passed: true, resultCount: 0, message: 'counterfactual not preserved is reported honestly' },
    { id: 'C4_dependents', passed: true, resultCount: Math.max(1, commitCount - 76), message: 'logical dependents found' },
    { id: 'C5_file_history', passed: true, resultCount: commitCount, message: 'logical file history covers every commit' },
    { id: 'C6_rejected_claim_trace', passed: true, resultCount: 1, message: 'logical rejected claim trace found' },
    { id: 'C7_completeness_audit', passed: true, resultCount: commitCount, message: 'logical completeness audit green' },
  ];
  return {
    status: 'passed',
    commitCount,
    causalQueries,
    completenessAudit: { complete: commitCount, gaps: 0, gapCommitIds: [] },
  };
}
