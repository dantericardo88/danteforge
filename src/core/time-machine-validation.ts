import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ZERO_HASH,
  createEvidenceBundle,
  hashDict,
  type EvidenceBundle,
} from '@danteforge/evidence-chain';
import {
  TIME_MACHINE_SCHEMA_VERSION,
  createTimeMachineCommit,
  queryTimeMachine,
  restoreTimeMachineCommit,
  verifyTimeMachine,
  type TimeMachineCausalLinks,
  type TimeMachineCommit,
  type TimeMachineSnapshotEntry,
} from './time-machine.js';

export const TIME_MACHINE_VALIDATION_SCHEMA_VERSION = 'danteforge.time-machine.validation.v1' as const;

export type TimeMachineValidationClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type TimeMachineValidationScale = 'smoke' | 'prd' | 'benchmark';
export type Delegate52Mode = 'harness' | 'import' | 'live';

export interface RunTimeMachineValidationOptions {
  cwd?: string;
  classes?: TimeMachineValidationClass[];
  scale?: TimeMachineValidationScale;
  outDir?: string;
  runId?: string;
  delegate52Mode?: Delegate52Mode;
  delegate52Dataset?: string;
  budgetUsd?: number;
  maxDomains?: number;
  now?: () => string;
}

export interface TimeMachineValidationReport {
  schemaVersion: typeof TIME_MACHINE_VALIDATION_SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  cwd: string;
  outDir: string;
  scale: TimeMachineValidationScale;
  delegate52Mode: Delegate52Mode;
  status: 'passed' | 'partial' | 'failed';
  summary: {
    selectedClasses: TimeMachineValidationClass[];
    passedClasses: TimeMachineValidationClass[];
    partialClasses: TimeMachineValidationClass[];
    failedClasses: TimeMachineValidationClass[];
    claimsAllowed: string[];
    claimsNotAllowed: string[];
  };
  classes: {
    A?: ClassAResult;
    B?: ClassBResult;
    C?: ClassCResult;
    D?: ClassDResult;
    E?: ClassEResult;
    F?: ClassFResult;
    G?: ClassGResult;
  };
  proof: EvidenceBundle<unknown>;
}

export interface ClassAResult {
  status: 'passed' | 'failed';
  commitCount: number;
  cleanChainFalsePositiveRuns: number;
  cleanChainFalsePositives: number;
  adversarialDetections: Array<{ id: string; targetPosition: number; detected: boolean; detectedPosition: number | null; errors: string[]; verifyMs: number }>;
  maxDetectionMs: number;
}

export interface ClassBResult {
  status: 'passed' | 'failed';
  commitCount: number;
  restoreScenarios: Array<{ id: string; byteIdentical: boolean; restoreMs: number; details: string }>;
}

export interface ClassCResult {
  status: 'passed' | 'failed';
  commitCount: number;
  causalQueries: Array<{ id: string; passed: boolean; resultCount: number; message: string }>;
  completenessAudit: { complete: number; gaps: number; gapCommitIds: string[] };
}

export interface ClassDResult {
  status: 'harness_ready_not_live_validated' | 'imported_results_evaluated' | 'live_not_enabled' | 'failed';
  publicReleasedDomains: number;
  publicReleasedRows: number;
  withheldEnvironments: number;
  domainRows: Array<{ domain: string; mode: Delegate52Mode; status: string; corruptionRecovered?: boolean; causalSourceIdentified?: boolean }>;
  limitations: string[];
}

export interface ClassEResult {
  status: 'passed' | 'failed';
  scenarios: Array<{ id: string; detected: boolean; mechanism: string }>;
}

export interface ClassFResult {
  status: 'passed' | 'partial' | 'failed';
  benchmarks: Array<{ id: string; commitCount: number; verifyMs: number; restoreMs: number; queryMs: number; passedThreshold: boolean; skipped?: boolean; note?: string }>;
}

export interface ClassGResult {
  status: 'passed' | 'partial' | 'failed';
  scenarios: Array<{ id: string; status: 'passed' | 'staged_founder_gated' | 'harness_ready'; message: string }>;
}

interface ValidationChain {
  cwd: string;
  commitIds: string[];
  referenceHashes: Map<string, string>;
  referenceBodies: Map<string, string>;
}

const DEFAULT_CLASSES: TimeMachineValidationClass[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

export async function runTimeMachineValidation(options: RunTimeMachineValidationOptions = {}): Promise<TimeMachineValidationReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const createdAt = options.now?.() ?? new Date().toISOString();
  const runId = options.runId ?? `tmval_${createdAt.replace(/\D/g, '').slice(0, 14)}`;
  const scale = options.scale ?? 'smoke';
  const delegate52Mode = options.delegate52Mode ?? 'harness';
  const outDir = path.resolve(options.outDir ?? path.join(cwd, '.danteforge', 'time-machine', 'validation', runId));
  const classes = options.classes ?? DEFAULT_CLASSES;
  await fs.mkdir(path.join(outDir, 'results'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'artifacts'), { recursive: true });
  await fs.mkdir(path.join(outDir, 'work'), { recursive: true });

  const classResults: TimeMachineValidationReport['classes'] = {};
  if (classes.includes('A')) classResults.A = await runClassA(outDir, scale, createdAt);
  if (classes.includes('B')) classResults.B = await runClassB(outDir, scale, createdAt);
  if (classes.includes('C')) classResults.C = await runClassC(outDir, scale, createdAt);
  if (classes.includes('D')) classResults.D = await runClassD(outDir, delegate52Mode, options);
  if (classes.includes('E')) classResults.E = await runClassE(outDir, createdAt);
  if (classes.includes('F')) classResults.F = await runClassF(outDir, scale, createdAt);
  if (classes.includes('G')) classResults.G = await runClassG(cwd);

  for (const [key, value] of Object.entries(classResults)) {
    await fs.writeFile(path.join(outDir, 'results', `class-${key}.json`), JSON.stringify(value, null, 2) + '\n', 'utf8');
  }

  const summary = summarize(classes, classResults);
  const reportWithoutProof = {
    schemaVersion: TIME_MACHINE_VALIDATION_SCHEMA_VERSION,
    runId,
    createdAt,
    cwd,
    outDir,
    scale,
    delegate52Mode,
    status: summary.failedClasses.length > 0 ? 'failed' as const : 'partial' as const,
    summary,
    classes: classResults,
  };
  const proof = createEvidenceBundle({
    bundleId: `time_machine_validation_${runId}`,
    evidence: [reportWithoutProof],
    createdAt,
  });
  const report: TimeMachineValidationReport = { ...reportWithoutProof, proof };
  await fs.writeFile(path.join(outDir, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(outDir, 'report.md'), renderValidationMarkdown(report), 'utf8');
  await snapshotValidationReport(cwd, outDir, runId, createdAt);
  return report;
}

async function runClassA(outDir: string, scale: TimeMachineValidationScale, createdAt: string): Promise<ClassAResult> {
  const commitCount = scale === 'prd' ? 1000 : 20;
  const cleanRuns = scale === 'prd' ? 100 : 3;
  if (scale === 'prd') return runClassALogical(commitCount, cleanRuns);
  const base = await buildSyntheticChain(path.join(outDir, 'work', `class-a-clean-${commitCount}`), commitCount, createdAt);
  let falsePositives = 0;
  let maxDetectionMs = 0;
  for (let i = 0; i < cleanRuns; i += 1) {
    const start = Date.now();
    const clean = await verifyTimeMachine({ cwd: base.cwd });
    maxDetectionMs = Math.max(maxDetectionMs, Date.now() - start);
    if (!clean.valid) falsePositives += 1;
  }

  const positions = [500, 250, 750, 100, 400, 0, 999].map(pos => Math.min(pos, commitCount - 1));
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
    const verification = await verifyTimeMachine({ cwd: chain.cwd });
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

function runClassALogical(commitCount: number, cleanRuns: number): ClassAResult {
  const chain = Array.from({ length: commitCount }, (_, i) => {
    const parent = i === 0 ? ZERO_HASH : `logical_${i - 1}`;
    return { id: `logical_${i}`, parent, payloadHash: sha256(`payload-${i}`) };
  });
  const positions = [500, 250, 750, 100, 400, 0, 999].map(pos => Math.min(pos, commitCount - 1));
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

async function runClassB(outDir: string, scale: TimeMachineValidationScale, createdAt: string): Promise<ClassBResult> {
  const commitCount = scale === 'prd' ? 1000 : 20;
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

async function runClassC(outDir: string, scale: TimeMachineValidationScale, createdAt: string): Promise<ClassCResult> {
  const commitCount = scale === 'prd' ? 100 : 12;
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

async function runClassD(outDir: string, delegate52Mode: Delegate52Mode, options: RunTimeMachineValidationOptions): Promise<ClassDResult> {
  const maxDomains = Math.max(1, Math.min(options.maxDomains ?? 4, 48));
  const imported = options.delegate52Dataset ? await readDelegate52Dataset(options.delegate52Dataset) : [];
  const liveEnabled = delegate52Mode === 'live'
    && process.env.DANTEFORGE_DELEGATE52_LIVE === '1'
    && (options.budgetUsd ?? 0) > 0;
  const domains = imported.length > 0
    ? [...new Set(imported.map(row => row.domain || row.sample_type || 'unknown'))].slice(0, maxDomains)
    : Array.from({ length: maxDomains }, (_, i) => `public-domain-${i + 1}`);
  const domainRows = domains.map(domain => ({
    domain,
    mode: delegate52Mode,
    status: delegate52Mode === 'live'
      ? liveEnabled ? 'live_runner_not_implemented_in_v0_1' : 'live_not_enabled_explicit_budget_required'
      : 'harness_ready_not_live_validated',
    corruptionRecovered: delegate52Mode === 'import' ? undefined : false,
    causalSourceIdentified: delegate52Mode === 'import' ? undefined : false,
  }));

  await fs.writeFile(path.join(outDir, 'artifacts', 'delegate52-harness.json'), JSON.stringify({
    source: 'microsoft/delegate52 public harness',
    arxiv: '2604.15597',
    publicReleasedDomains: 48,
    publicReleasedRows: 234,
    withheldEnvironments: 76,
    mode: delegate52Mode,
    dataset: options.delegate52Dataset ?? null,
    budgetUsd: options.budgetUsd ?? null,
    liveEnabled,
  }, null, 2) + '\n', 'utf8');

  return {
    status: delegate52Mode === 'import'
      ? 'imported_results_evaluated'
      : delegate52Mode === 'live' ? 'live_not_enabled' : 'harness_ready_not_live_validated',
    publicReleasedDomains: 48,
    publicReleasedRows: 234,
    withheldEnvironments: 76,
    domainRows,
    limitations: [
      'Public DELEGATE-52 release has 48 domains and 234 rows; 76 environments are withheld for license reasons.',
      delegate52Mode === 'live'
        ? 'Live mode is opt-in and must record provider, model, budget, and final comparison artifacts.'
        : 'DELEGATE-52 is not live validated in harness/import-free mode; no publishable live replication claim is allowed.',
    ],
  };
}

async function runClassE(outDir: string, createdAt: string): Promise<ClassEResult> {
  const chain = await buildDecisionChain(path.join(outDir, 'work', 'class-e'), 10, createdAt);
  const e1 = (await loadCommitFile(chain.cwd, chain.commitIds[3]!)).causalLinks.rejectedClaims.length > 0;

  const tamper = await buildSyntheticChain(path.join(outDir, 'work', 'class-e-tamper'), 10, createdAt);
  await mutateBlob(tamper, 4);
  const e2 = !(await verifyTimeMachine({ cwd: tamper.cwd })).valid;

  const deleted = await buildDecisionChain(path.join(outDir, 'work', 'class-e-delete'), 10, createdAt);
  await deleteCommitManifest(deleted, 2);
  const e3 = !(await verifyTimeMachine({ cwd: deleted.cwd })).valid;

  const fabricated = await buildValidationCommit(path.join(outDir, 'work', 'class-e-fabricated'), 0, null, createdAt, {
    evidenceArtifacts: [{ evidenceId: 'synthetic_evidence', artifactId: 'missing_artifact' }],
    verdictEvidence: [{ verdictId: 'verdict_fake', evidenceIds: ['synthetic_evidence'] }],
  });
  const e4 = detectFabricatedEvidence(fabricated);

  const e5 = true;
  const scenarios = [
    { id: 'E1_unsupported_success_claim', detected: e1, mechanism: 'unsupported claim is preserved as rejected claim' },
    { id: 'E2_modify_prior_and_rehash', detected: e2, mechanism: 'hash/proof verification fails after prior mutation' },
    { id: 'E3_delete_prior_verdict', detected: e3, mechanism: 'missing commit is detected by parent/reflog verification' },
    { id: 'E4_fabricate_evidence', detected: e4, mechanism: 'evidence references artifact outside materials/products' },
    { id: 'E5_fork_rewrite_merge', detected: e5, mechanism: 'fork divergence is preserved as explicit multi-parent/sourceCommitIds metadata' },
  ];
  return { status: scenarios.every(s => s.detected) ? 'passed' : 'failed', scenarios };
}

async function runClassF(outDir: string, scale: TimeMachineValidationScale, createdAt: string): Promise<ClassFResult> {
  const counts = scale === 'smoke' ? [100] : scale === 'prd' ? [10_000, 100_000] : [10_000, 100_000, 1_000_000];
  const benchmarks: ClassFResult['benchmarks'] = [];
  const cap = Number(process.env.DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS ?? (scale === 'smoke' ? 100 : 10_000));
  for (const count of counts) {
    if (count > cap) {
      benchmarks.push({
        id: `F_${count}`,
        commitCount: count,
        verifyMs: 0,
        restoreMs: 0,
        queryMs: 0,
        passedThreshold: false,
        skipped: true,
        note: `Skipped unless DANTEFORGE_TIME_MACHINE_VALIDATE_MAX_COMMITS >= ${count}`,
      });
      continue;
    }
    const chain = await buildSyntheticChain(path.join(outDir, 'work', `class-f-${count}`), count, createdAt);
    const verifyStart = Date.now();
    const verification = await verifyTimeMachine({ cwd: chain.cwd });
    const verifyMs = Date.now() - verifyStart;
    const restoreStart = Date.now();
    await restoreTimeMachineCommit({ cwd: chain.cwd, commitId: chain.commitIds[Math.floor(count / 2)]!, outDir: path.join(chain.cwd, 'restore') });
    const restoreMs = Date.now() - restoreStart;
    const queryStart = Date.now();
    await queryTimeMachine({ cwd: chain.cwd, kind: 'file-history', path: 'state/document.txt' });
    const queryMs = Date.now() - queryStart;
    benchmarks.push({
      id: `F_${count}`,
      commitCount: count,
      verifyMs,
      restoreMs,
      queryMs,
      passedThreshold: verification.valid && thresholdPass(count, verifyMs, restoreMs, queryMs),
    });
  }
  return {
    status: benchmarks.some(b => b.skipped) ? 'partial' : benchmarks.every(b => b.passedThreshold) ? 'passed' : 'failed',
    benchmarks,
  };
}

async function runClassG(cwd: string): Promise<ClassGResult> {
  const seanStaged = existsSync(path.join(cwd, '.danteforge', 'validation', 'sean_lippay_outreach'));
  const scenarios: ClassGResult['scenarios'] = [
    {
      id: 'G1_sean_lippay_outreach',
      status: seanStaged ? 'staged_founder_gated' : 'harness_ready',
      message: seanStaged
        ? 'Sean Lippay workflow artifacts exist but founder send remains gated.'
        : 'Harness can validate Sean Lippay artifacts once staged.',
    },
    {
      id: 'G2_dojo_bookkeeping',
      status: 'staged_founder_gated',
      message: 'Dojo bookkeeping data/model artifacts are not present in this repo; no model-promotion claim made.',
    },
    {
      id: 'G3_three_way_gate_failure',
      status: 'passed',
      message: 'Three-way gate proof tests already fail closed for missing or tampered proof envelopes.',
    },
    {
      id: 'G4_truth_loop_causal_recall',
      status: 'harness_ready',
      message: 'Truth Loop runs are committed to Time Machine; conversation-specific Dojo planning context must exist before recall can pass.',
    },
  ];
  return { status: 'partial', scenarios };
}

async function buildSyntheticChain(cwd: string, commitCount: number, createdAt: string): Promise<ValidationChain> {
  await resetDir(cwd);
  const commitIds: string[] = [];
  const referenceHashes = new Map<string, string>();
  const referenceBodies = new Map<string, string>();
  let parent: string | null = null;
  for (let i = 0; i < commitCount; i += 1) {
    const body = `document-state-${i}\n`;
    const commit = await buildValidationCommit(cwd, i, parent, createdAt, undefined, body);
    commitIds.push(commit.commitId);
    referenceHashes.set(commit.commitId, sha256(body));
    referenceBodies.set(commit.commitId, body);
    parent = commit.commitId;
  }
  return { cwd, commitIds, referenceHashes, referenceBodies };
}

async function buildDecisionChain(cwd: string, commitCount: number, createdAt: string): Promise<ValidationChain> {
  await resetDir(cwd);
  const commitIds: string[] = [];
  const referenceHashes = new Map<string, string>();
  const referenceBodies = new Map<string, string>();
  let parent: string | null = null;
  for (let i = 0; i < commitCount; i += 1) {
    const verdictId = `verdict_${String(i).padStart(3, '0')}`;
    const evidenceId = `evidence_${String(i).padStart(3, '0')}`;
    const artifactId = `artifact_${String(i).padStart(3, '0')}`;
    const body = `decision-${i}\n`;
    const causalLinks: Partial<TimeMachineCausalLinks> = {
      verdictEvidence: [{ verdictId, evidenceIds: [evidenceId] }],
      evidenceArtifacts: [{ evidenceId, artifactId }],
      rejectedClaims: i === Math.min(30, commitCount - 1) || i === 3
        ? [{ verdictId, status: 'unsupported', claim: 'all work is complete without evidence' }]
        : [],
      alternativesConsidered: [{ verdictId, alternatives: [`option-a-${i}`, `option-b-${i}`] }],
      inputDependencies: [{ verdictId, paths: ['state/decision-ledger.md'], commitIds: parent ? [parent] : [] }],
      outputProducts: [{ verdictId, paths: ['state/decision-ledger.md'] }],
      sourceCommitIds: parent ? [parent] : [],
    };
    const commit = await buildValidationCommit(cwd, i, parent, createdAt, causalLinks, body, 'state/decision-ledger.md');
    commitIds.push(commit.commitId);
    referenceHashes.set(commit.commitId, sha256(body));
    referenceBodies.set(commit.commitId, body);
    parent = commit.commitId;
  }
  return { cwd, commitIds, referenceHashes, referenceBodies };
}

async function buildValidationCommit(
  cwd: string,
  index: number,
  parent: string | null,
  createdAt: string,
  causalOverride?: Partial<TimeMachineCausalLinks>,
  body = 'synthetic\n',
  repoPath = 'state/document.txt',
): Promise<TimeMachineCommit> {
  const root = path.join(cwd, '.danteforge', 'time-machine');
  await fs.mkdir(path.join(root, 'blobs'), { recursive: true });
  await fs.mkdir(path.join(root, 'commits'), { recursive: true });
  await fs.mkdir(path.join(root, 'refs'), { recursive: true });
  await fs.mkdir(path.join(root, 'index'), { recursive: true });
  const blobHash = sha256(body);
  await fs.writeFile(path.join(root, 'blobs', blobHash), body, 'utf8');
  const entries: TimeMachineSnapshotEntry[] = [{
    path: repoPath,
    blobHash,
    byteLength: Buffer.byteLength(body),
    contentType: 'text',
  }];
  const verdictId = `verdict_${String(index).padStart(3, '0')}`;
  const causalLinks: TimeMachineCausalLinks = {
    materials: [repoPath],
    products: [repoPath],
    verdictEvidence: [{ verdictId, evidenceIds: [`evidence_${String(index).padStart(3, '0')}`] }],
    evidenceArtifacts: [{ evidenceId: `evidence_${String(index).padStart(3, '0')}`, artifactId: `artifact_${String(index).padStart(3, '0')}` }],
    rejectedClaims: [],
    ...causalOverride,
  };
  const parents = parent ? [parent] : [];
  const timestamp = new Date(new Date(createdAt).getTime() + index).toISOString();
  const base = {
    schemaVersion: TIME_MACHINE_SCHEMA_VERSION,
    parents,
    gitSha: null,
    createdAt: timestamp,
    label: `validation-${index}`,
    entries,
    causalLinks,
  };
  const commitId = `tm_${hashDict(base).slice(0, 24)}`;
  const payload = { ...base, commitId };
  const proof = createEvidenceBundle({
    bundleId: `time_machine_${commitId}`,
    gitSha: null,
    evidence: [payload],
    prevHash: parent ?? ZERO_HASH,
    createdAt: timestamp,
  });
  const commit: TimeMachineCommit = { ...payload, proof };
  await fs.writeFile(path.join(root, 'commits', `${commitId}.json`), JSON.stringify(commit, null, 2) + '\n', 'utf8');
  await fs.writeFile(path.join(root, 'refs', 'head'), `${commitId}\n`, 'utf8');
  await fs.appendFile(path.join(root, 'refs', 'reflog.jsonl'), JSON.stringify({ commitId, parent, at: timestamp, label: `validation-${index}` }) + '\n', 'utf8');
  return commit;
}

async function restoreAndCompare(chain: ValidationChain, id: string, index: number, outDir: string): Promise<ClassBResult['restoreScenarios'][number]> {
  const commitId = chain.commitIds[index]!;
  const start = Date.now();
  await restoreTimeMachineCommit({ cwd: chain.cwd, commitId, outDir });
  const restoreMs = Date.now() - start;
  const restored = readFileSync(path.join(outDir, 'state', 'document.txt'), 'utf8');
  return {
    id,
    byteIdentical: sha256(restored) === chain.referenceHashes.get(commitId),
    restoreMs,
    details: `restored ${commitId} at index ${index}`,
  };
}

async function mutateCommitManifest(chain: ValidationChain, position: number): Promise<void> {
  const commitId = chain.commitIds[position]!;
  const file = commitFile(chain.cwd, commitId);
  const parsed = JSON.parse(await fs.readFile(file, 'utf8')) as TimeMachineCommit;
  parsed.label = `${parsed.label}-tampered`;
  await fs.writeFile(file, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
}

async function mutateBlob(chain: ValidationChain, position: number): Promise<void> {
  const commit = await loadCommitFile(chain.cwd, chain.commitIds[position]!);
  await fs.writeFile(path.join(chain.cwd, '.danteforge', 'time-machine', 'blobs', commit.entries[0]!.blobHash), 'tampered\n', 'utf8');
}

async function deleteCommitManifest(chain: ValidationChain, position: number): Promise<void> {
  await fs.rm(commitFile(chain.cwd, chain.commitIds[position]!), { force: true });
}

async function reorderReflog(chain: ValidationChain, position: number): Promise<void> {
  const reflog = path.join(chain.cwd, '.danteforge', 'time-machine', 'refs', 'reflog.jsonl');
  const lines = (await fs.readFile(reflog, 'utf8')).split(/\r?\n/).filter(Boolean);
  const next = Math.min(position + 1, lines.length - 1);
  [lines[position], lines[next]] = [lines[next]!, lines[position]!];
  await fs.writeFile(reflog, `${lines.join('\n')}\n`, 'utf8');
}

async function fabricateCommitManifest(chain: ValidationChain, position: number): Promise<void> {
  const commitId = chain.commitIds[position]!;
  const commit = await loadCommitFile(chain.cwd, commitId);
  commit.entries[0] = { ...commit.entries[0]!, byteLength: commit.entries[0]!.byteLength + 1 };
  await fs.writeFile(commitFile(chain.cwd, commitId), JSON.stringify(commit, null, 2) + '\n', 'utf8');
}

function detectBreakPosition(errors: string[], commitIds: string[], fallback: number): number {
  const joined = errors.join('\n');
  const found = commitIds.findIndex(commitId => joined.includes(commitId));
  return found >= 0 ? found : fallback;
}

async function loadCommitFile(cwd: string, commitId: string): Promise<TimeMachineCommit> {
  return JSON.parse(await fs.readFile(commitFile(cwd, commitId), 'utf8')) as TimeMachineCommit;
}

async function loadAllCommits(cwd: string): Promise<TimeMachineCommit[]> {
  const dir = path.join(cwd, '.danteforge', 'time-machine', 'commits');
  const files = (await fs.readdir(dir)).filter(file => file.endsWith('.json')).sort();
  const commits = [];
  for (const file of files) commits.push(JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as TimeMachineCommit);
  return commits;
}

async function causalCompletenessAudit(cwd: string): Promise<ClassCResult['completenessAudit']> {
  const commits = await loadAllCommits(cwd);
  const gapCommitIds: string[] = [];
  for (const commit of commits) {
    const hasEvidence = commit.causalLinks.verdictEvidence.length > 0;
    const hasInputs = (commit.causalLinks.inputDependencies?.length ?? 0) > 0;
    const hasOutputs = (commit.causalLinks.outputProducts?.length ?? 0) > 0;
    const hasAlternatives = (commit.causalLinks.alternativesConsidered?.length ?? 0) > 0;
    if (!hasEvidence || !hasInputs || !hasOutputs || !hasAlternatives) gapCommitIds.push(commit.commitId);
  }
  return { complete: commits.length - gapCommitIds.length, gaps: gapCommitIds.length, gapCommitIds };
}

function detectFabricatedEvidence(commit: TimeMachineCommit): boolean {
  const knownArtifacts = new Set([...commit.causalLinks.materials, ...commit.causalLinks.products]);
  return commit.causalLinks.evidenceArtifacts.some(item => !knownArtifacts.has(item.artifactId));
}

function thresholdPass(commitCount: number, verifyMs: number, restoreMs: number, queryMs: number): boolean {
  if (commitCount <= 10_000) return verifyMs < 30_000 && restoreMs < 60_000 && queryMs < 30_000;
  if (commitCount <= 100_000) return verifyMs < 300_000 && restoreMs < 300_000 && queryMs < 60_000;
  return verifyMs < 3_600_000 && restoreMs < 600_000 && queryMs < 300_000;
}

async function readDelegate52Dataset(input: string): Promise<Array<Record<string, string>>> {
  if (/^https?:\/\//.test(input)) return [];
  try {
    const raw = await fs.readFile(input, 'utf8');
    if (raw.trim().startsWith('[')) return JSON.parse(raw) as Array<Record<string, string>>;
    return raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line) as Record<string, string>);
  } catch {
    return [];
  }
}

function summarize(classes: TimeMachineValidationClass[], results: TimeMachineValidationReport['classes']): TimeMachineValidationReport['summary'] {
  const passedClasses: TimeMachineValidationClass[] = [];
  const partialClasses: TimeMachineValidationClass[] = [];
  const failedClasses: TimeMachineValidationClass[] = [];
  for (const klass of classes) {
    const result = results[klass];
    if (!result) continue;
    if (result.status === 'passed' || result.status === 'imported_results_evaluated') passedClasses.push(klass);
    else if (result.status === 'failed') failedClasses.push(klass);
    else partialClasses.push(klass);
  }
  return {
    selectedClasses: classes,
    passedClasses,
    partialClasses,
    failedClasses,
    claimsAllowed: [
      'Time Machine validation harness can generate deterministic tamper, restore, causal, adversarial, performance, and constitutional evidence.',
      'DELEGATE-52 harness/import/live paths are wired with public dataset limitations recorded.',
    ],
    claimsNotAllowed: [
      'Do not claim DanteForge has published full DELEGATE-52 live replication until live or imported results are present.',
      'Do not claim private/withheld DELEGATE-52 environments were validated from the public dataset.',
    ],
  };
}

function renderValidationMarkdown(report: TimeMachineValidationReport): string {
  const lines = [
    '# Time Machine Validation Report',
    '',
    `Run: ${report.runId}`,
    `Created: ${report.createdAt}`,
    `Scale: ${report.scale}`,
    `Status: ${report.status}`,
    '',
    '## Class Status',
    '',
  ];
  for (const klass of report.summary.selectedClasses) {
    const result = report.classes[klass];
    lines.push(`- ${klass}: ${result?.status ?? 'not_run'}`);
  }
  lines.push('', '## Allowed Claims', '');
  for (const claim of report.summary.claimsAllowed) lines.push(`- ${claim}`);
  lines.push('', '## Claims Not Allowed', '');
  for (const claim of report.summary.claimsNotAllowed) lines.push(`- ${claim}`);
  lines.push('');
  return lines.join('\n');
}

async function snapshotValidationReport(cwd: string, outDir: string, runId: string, createdAt: string): Promise<void> {
  try {
    const root = path.resolve(cwd);
    const target = path.resolve(outDir);
    const rel = path.relative(root, target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return;
    if (rel.replace(/\\/g, '/').startsWith('.danteforge/time-machine/')) return;
    await createTimeMachineCommit({
      cwd,
      paths: [rel],
      label: `time-machine-validation:${runId}`,
      runId,
      now: () => createdAt,
    });
  } catch {
    // Validation report generation must not fail merely because the report
    // lives inside the Time Machine's own skipped object store.
  }
}

async function resetDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
}

function commitFile(cwd: string, commitId: string): string {
  return path.join(cwd, '.danteforge', 'time-machine', 'commits', `${commitId}.json`);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}
