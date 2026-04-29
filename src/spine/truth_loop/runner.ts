/**
 * Truth Loop runner. Orchestrates the seven-step pipeline from PRD-26 §5.3:
 *   1 collect-repo-state
 *   2 collect-tests
 *   3 collect-artifacts
 *   4 import-critic-claims
 *   5 reconcile
 *   6 verdict
 *   7 commit-next-action
 */

import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { resolve, basename, relative, isAbsolute } from 'node:path';

import type {
  Run,
  Strictness,
  BudgetEnvelope,
  Artifact,
  Evidence,
  Verdict,
  NextAction,
  HardwareProfile,
  StopPolicy,
  Claim,
  ReconciledClaim
} from './types.js';
import {
  collectRepoState,
  collectTestState,
  collectPriorArtifacts,
  type ExecFn,
  type TestSummary,
  type RepoSnapshot
} from './collectors.js';
import { importCritique } from './critic-importer.js';
import { reconcileClaims } from './reconciler.js';
import { buildVerdict } from './verdict-writer.js';
import { buildNextAction, renderPromptPacket } from './next-action-writer.js';
import {
  nextRunId,
  newBudgetEnvelopeId
} from './ids.js';
import { assertValid } from './schema-validator.js';
import { proofArtifact, proofEvidence, proofVerdict } from './proof.js';
import { createTimeMachineCommit } from '../../core/time-machine.js';

export interface RunnerOptions {
  repo: string;
  objective: string;
  critics: string[];
  critiqueFiles: { source: 'codex' | 'claude' | 'grok' | 'gemini' | 'human'; path: string }[];
  budgetUsd: number;
  budgetMinutes?: number;
  mode: 'sequential' | 'parallel';
  strictness: Strictness;
  outDir?: string;
  initiator?: Run['initiator'];
  hardwareProfile?: HardwareProfile;
  stopPolicy?: StopPolicy;
  /** Inject for tests; defaults to a node-built-in execFile wrapper. */
  exec?: ExecFn;
  /** Skip running tests (used by pilots that don't need full suite). */
  skipTests?: boolean;
  /** Override the test command. */
  testCommand?: { cmd: string; args: string[] };
  /** Inject "now" for deterministic IDs. */
  now?: Date;
  /** Inject sequence-known runId for tests. */
  forcedRunId?: string;
  /**
   * Cost accumulator the runner consults before each step. If this returns
   * a value ≥ budgetUsd, the run aborts with `budget_stopped`.
   * In production, wire to BudgetFence.currentSpendUsd; in tests, inject a stub.
   */
  costAccumulator?: () => number;
  /**
   * Override the wall-clock time source for budget enforcement. Defaults to Date.now.
   * Tests inject a function that returns startTime + many minutes to simulate elapsed time.
   */
  clock?: () => number;
}

export interface RunnerResult {
  runDir: string;
  run: Run;
  budget: BudgetEnvelope;
  artifacts: Artifact[];
  evidence: Evidence[];
  verdict: Verdict;
  nextAction: NextAction;
  testSummary: TestSummary;
  repoSnapshot: RepoSnapshot;
  reportPath: string;
}

// ── Phase helpers (extracted from runTruthLoop to keep top-level fn ≤100 LOC) ──

interface SetupResult { runId: string; runDir: string; }
function setupRunDirs(opts: RunnerOptions): SetupResult {
  const now = opts.now ?? new Date();
  const runId = opts.forcedRunId ?? nextRunId(opts.repo, now);
  const runDir = opts.outDir ?? resolve(opts.repo, '.danteforge', 'truth-loop', runId);
  for (const sub of ['artifacts', 'evidence', 'verdict', 'next_action']) ensureDir(resolve(runDir, sub));
  ensureDir(runDir);
  return { runId, runDir };
}

interface RunMetadata { budget: BudgetEnvelope; run: Run; budgetExceeded: () => { exceeded: boolean; reason: string }; now: Date; }
function initRunMetadata(opts: RunnerOptions, runId: string, _runDir: string): RunMetadata {
  const now = opts.now ?? new Date();
  const clock = opts.clock ?? Date.now;
  const startMs = clock();
  const budgetMinutes = opts.budgetMinutes ?? 60;
  const budgetUsd = opts.budgetUsd;
  const costAcc = opts.costAccumulator ?? (() => 0);
  const budgetExceeded = (): { exceeded: boolean; reason: string } => {
    const elapsedMin = (clock() - startMs) / 60_000;
    if (elapsedMin >= budgetMinutes) return { exceeded: true, reason: `wall-clock budget exceeded: ${elapsedMin.toFixed(2)}min ≥ ${budgetMinutes}min` };
    const spent = costAcc();
    if (spent >= budgetUsd) return { exceeded: true, reason: `cost budget exceeded: $${spent.toFixed(2)} ≥ $${budgetUsd.toFixed(2)}` };
    return { exceeded: false, reason: '' };
  };
  const budget: BudgetEnvelope = {
    budgetEnvelopeId: newBudgetEnvelopeId(runId), runId, maxUsd: opts.budgetUsd, maxMinutes: budgetMinutes,
    maxCritics: Math.max(1, opts.critics.length), executionMode: opts.mode, parallelismAllowed: opts.mode === 'parallel',
    hardwareProfile: opts.hardwareProfile ?? 'rtx_4060_laptop',
    stopPolicy: opts.stopPolicy ?? 'stop_on_budget_or_unresolved_blocker'
  };
  assertValid('budget_envelope', budget);
  const run: Run = {
    runId, projectId: basename(resolve(opts.repo)), repo: opts.repo, commit: '0000000',
    startedAt: now.toISOString(), mode: opts.mode, initiator: opts.initiator ?? 'agent',
    objective: opts.objective, budgetEnvelopeId: budget.budgetEnvelopeId, status: 'running'
  };
  return { budget, run, budgetExceeded, now };
}

interface CollectedState {
  repoState: { artifact: Artifact; snapshot: RepoSnapshot };
  testState: { artifact: Artifact; summary: TestSummary };
  priorArtifacts: { artifact: Artifact };
  artifacts: Artifact[];
}
async function collectInitialArtifacts(opts: RunnerOptions, runId: string, run: Run): Promise<CollectedState> {
  const repoState = await collectRepoState({ repo: opts.repo, runId, exec: opts.exec });
  run.commit = repoState.snapshot.commit;
  assertValid('run', run);
  const testState = await collectTestState({ repo: opts.repo, runId, exec: opts.exec, testCommand: opts.testCommand, skipTests: opts.skipTests });
  const priorArtifacts = collectPriorArtifacts(opts.repo, runId);
  const artifacts: Artifact[] = [repoState.artifact, testState.artifact, priorArtifacts.artifact];
  for (const a of artifacts) assertValid('artifact', a);
  return { repoState, testState, priorArtifacts, artifacts };
}

async function importCritiquesAndArtifacts(opts: RunnerOptions, runId: string, baseArtifacts: Artifact[]) {
  const artifacts: Artifact[] = [...baseArtifacts];
  const evidence: Evidence[] = [];
  const allClaims = [];
  for (const file of opts.critiqueFiles) {
    if (!existsSync(file.path)) throw new Error(`critique file not found: ${file.path}`);
    const art = importCritique({ runId, source: file.source, filePath: file.path });
    assertValid('artifact', art);
    artifacts.push(art);
    if (art.claims) allClaims.push(...art.claims.map(c => ({ claim: c, artifactId: art.artifactId })));
  }
  return { artifacts, evidence, allClaims };
}

function reconcileAndCollectEvidence(opts: RunnerOptions, runId: string, allClaims: { claim: Claim; artifactId: string }[], collected: CollectedState, evidence: Evidence[]) {
  const reconciled = reconcileClaims(allClaims.map(c => c.claim), {
    repo: opts.repo, runId,
    testArtifactId: collected.testState.artifact.artifactId,
    repoArtifactId: collected.repoState.artifact.artifactId,
    test: collected.testState.summary, snapshot: collected.repoState.snapshot
  });
  for (const e of reconciled.evidence) { assertValid('evidence', e); evidence.push(e); }
  return reconciled;
}

function constructVerdict(runId: string, opts: RunnerOptions, reconciled: ReconciledClaim[], testState: { summary: TestSummary }, lateBudget: { exceeded: boolean; reason: string }): Verdict {
  const evidenceMissing: string[] = [];
  if (testState.summary.attempted && testState.summary.failed > 0) evidenceMissing.push(`${testState.summary.failed} test failure(s) observed`);
  const verdict = buildVerdict({ runId, reconciled, strictness: opts.strictness, evidenceMissing, budgetExhausted: lateBudget.exceeded });
  if (lateBudget.exceeded && verdict.blockingGaps) verdict.blockingGaps.push(lateBudget.reason);
  assertValid('verdict', verdict);
  return verdict;
}

function constructNextAction(runDir: string, opts: RunnerOptions, verdict: Verdict): NextAction {
  const promptUri = `file://${resolve(runDir, 'next_action', 'next_action_prompt.md').replace(/\\/g, '/')}`;
  const nextAction = buildNextAction({ verdict, targetRepo: opts.repo, strictness: opts.strictness, promptUri });
  assertValid('next_action', nextAction);
  return nextAction;
}

function sealTruthLoopRecords(
  artifacts: Artifact[],
  evidence: Evidence[],
  verdict: Verdict,
  gitSha: string | null,
): { artifacts: Artifact[]; evidence: Evidence[]; verdict: Verdict } {
  const sealedArtifacts = artifacts.map(artifact => proofArtifact(artifact, gitSha));
  const sealedEvidence = evidence.map(record => proofEvidence(record, gitSha));
  const sealedVerdict = proofVerdict(verdict, gitSha);
  for (const a of sealedArtifacts) assertValid('artifact', a);
  for (const e of sealedEvidence) assertValid('evidence', e);
  assertValid('verdict', sealedVerdict);
  return { artifacts: sealedArtifacts, evidence: sealedEvidence, verdict: sealedVerdict };
}

interface PersistArgs {
  runDir: string; run: Run; budget: BudgetEnvelope; artifacts: Artifact[]; evidence: Evidence[];
  verdict: Verdict; nextAction: NextAction; testSummary: TestSummary; repoSnapshot: RepoSnapshot;
}
function persistRun(p: PersistArgs): void {
  writeFile(p.runDir, 'run.json', p.run);
  writeFile(p.runDir, 'budget.json', p.budget);
  for (const a of p.artifacts) writeFile(resolve(p.runDir, 'artifacts'), `${a.artifactId}.json`, a);
  writeFileSync(resolve(p.runDir, 'evidence', 'evidence.jsonl'), p.evidence.map(e => JSON.stringify(e)).join('\n') + (p.evidence.length > 0 ? '\n' : ''), 'utf-8');
  writeFile(resolve(p.runDir, 'verdict'), 'verdict.json', p.verdict);
  writeFileSync(resolve(p.runDir, 'verdict', 'verdict.md'), renderVerdictMarkdown(p.verdict), 'utf-8');
  writeFile(resolve(p.runDir, 'next_action'), 'next_action.json', p.nextAction);
  writeFileSync(resolve(p.runDir, 'next_action', 'next_action_prompt.md'), renderPromptPacket(p.nextAction, p.verdict), 'utf-8');
  const reportPath = resolve(p.runDir, 'report.md');
  writeFileSync(reportPath, renderReport({ run: p.run, budget: p.budget, verdict: p.verdict, nextAction: p.nextAction, testSummary: p.testSummary, repoSnapshot: p.repoSnapshot }), 'utf-8');
}

export async function runTruthLoop(opts: RunnerOptions): Promise<RunnerResult> {
  const setup = setupRunDirs(opts);
  const { budget, run, budgetExceeded, now } = initRunMetadata(opts, setup.runId, setup.runDir);

  const earlyBudget = budgetExceeded();
  if (earlyBudget.exceeded) {
    return finalizeBudgetStop(opts, setup.runId, setup.runDir, run, budget, earlyBudget.reason, now);
  }

  const collected = await collectInitialArtifacts(opts, setup.runId, run);
  const { artifacts, evidence, allClaims } = await importCritiquesAndArtifacts(opts, setup.runId, collected.artifacts);
  const reconciled = reconcileAndCollectEvidence(opts, setup.runId, allClaims, collected, evidence);
  const lateBudget = budgetExceeded();
  const verdict = constructVerdict(setup.runId, opts, reconciled.reconciled, collected.testState, lateBudget);
  const sealed = sealTruthLoopRecords(artifacts, evidence, verdict, run.commit);
  const nextAction = constructNextAction(setup.runDir, opts, sealed.verdict);

  run.endedAt = new Date().toISOString();
  run.status = sealed.verdict.finalStatus === 'complete' ? 'complete' : 'stopped';

  persistRun({
    runDir: setup.runDir, run, budget, artifacts: sealed.artifacts, evidence: sealed.evidence,
    verdict: sealed.verdict, nextAction, testSummary: collected.testState.summary, repoSnapshot: collected.repoState.snapshot
  });
  updateLatestSymlink(setup.runDir);
  await snapshotTruthLoopRun(opts, setup.runId, setup.runDir, run.commit);

  return {
    runDir: setup.runDir,
    run,
    budget,
    artifacts: sealed.artifacts,
    evidence: sealed.evidence,
    verdict: sealed.verdict,
    nextAction,
    testSummary: collected.testState.summary,
    repoSnapshot: collected.repoState.snapshot,
    reportPath: resolve(setup.runDir, 'report.md')
  };
}

async function finalizeBudgetStop(
  opts: RunnerOptions,
  runId: string,
  runDir: string,
  run: Run,
  budget: BudgetEnvelope,
  reason: string,
  now: Date
): Promise<RunnerResult> {
  // Best-effort minimal artifact set so the run dir is consistent.
  const stubArtifact: Artifact = {
    artifactId: 'art_budget_stop',
    runId,
    type: 'static_analysis',
    source: 'repo',
    createdAt: now.toISOString(),
    uri: `inline://budget_stop/${runId}`,
    hash: '0'.repeat(64),
    label: 'budget_stop_marker'
  };
  const verdict = buildVerdict({
    runId,
    reconciled: [],
    strictness: opts.strictness,
    budgetExhausted: true,
    evidenceMissing: [reason]
  });
  if (verdict.blockingGaps) verdict.blockingGaps.push(reason);
  const sealedStubArtifact = proofArtifact(stubArtifact, run.commit);
  const sealedVerdict = proofVerdict(verdict, run.commit);
  const promptUri = `file://${resolve(runDir, 'next_action', 'next_action_prompt.md').replace(/\\/g, '/')}`;
  const nextAction = buildNextAction({
    verdict: sealedVerdict,
    targetRepo: opts.repo,
    strictness: opts.strictness,
    promptUri
  });
  run.endedAt = new Date().toISOString();
  run.status = 'stopped';
  // Persist
  ensureDir(resolve(runDir, 'verdict'));
  ensureDir(resolve(runDir, 'next_action'));
  writeFile(runDir, 'run.json', run);
  writeFile(runDir, 'budget.json', budget);
  writeFile(resolve(runDir, 'verdict'), 'verdict.json', sealedVerdict);
  writeFile(resolve(runDir, 'next_action'), 'next_action.json', nextAction);
  writeFileSync(resolve(runDir, 'verdict', 'verdict.md'), `# Verdict ${sealedVerdict.verdictId}\n\nbudget_stopped: ${reason}\n`, 'utf-8');
  writeFileSync(resolve(runDir, 'next_action', 'next_action_prompt.md'), renderPromptPacket(nextAction, sealedVerdict), 'utf-8');
  const reportPath = resolve(runDir, 'report.md');
  writeFileSync(reportPath, `# Truth Loop Report — ${runId}\n\nbudget_stopped: ${reason}\n`, 'utf-8');
  return {
    runDir,
    run,
    budget,
    artifacts: [sealedStubArtifact],
    evidence: [],
    verdict: sealedVerdict,
    nextAction,
    testSummary: { attempted: false, passed: 0, failed: 0, total: 0, raw: '' },
    repoSnapshot: { branch: 'unknown', commit: '0000000', dirtyFiles: 0, fileCount: 0 },
    reportPath
  };
}

function ensureDir(d: string): void {
  mkdirSync(d, { recursive: true });
}

function writeFile(dir: string, name: string, body: unknown): void {
  writeFileSync(resolve(dir, name), JSON.stringify(body, null, 2) + '\n', 'utf-8');
}

function renderVerdictMarkdown(v: Verdict): string {
  const lines: string[] = [];
  lines.push(`# Verdict ${v.verdictId}`);
  lines.push('');
  lines.push(`**Run:** ${v.runId}`);
  lines.push(`**Final status:** ${v.finalStatus}`);
  lines.push(`**Score:** ${v.score.toFixed(2)} / 10`);
  lines.push(`**Confidence:** ${v.confidence}`);
  lines.push('');
  lines.push(v.summary);
  if (v.blockingGaps && v.blockingGaps.length > 0) {
    lines.push('');
    lines.push('## Blocking gaps');
    for (const g of v.blockingGaps) lines.push(`- ${g}`);
  }
  for (const [title, list] of [
    ['Supported claims', v.supportedClaims],
    ['Unsupported claims', v.unsupportedClaims],
    ['Contradicted claims', v.contradictedClaims],
    ['Opinion claims', v.opinionClaims]
  ] as const) {
    if (!list || list.length === 0) continue;
    lines.push('');
    lines.push(`## ${title}`);
    for (const c of list) lines.push(`- ${c}`);
  }
  return lines.join('\n') + '\n';
}

interface ReportInputs {
  run: Run;
  budget: BudgetEnvelope;
  verdict: Verdict;
  nextAction: NextAction;
  testSummary: TestSummary;
  repoSnapshot: RepoSnapshot;
}

function renderReport(r: ReportInputs): string {
  return [
    `# Truth Loop Report — ${r.run.runId}`,
    '',
    `**Project:** ${r.run.projectId}`,
    `**Repo:** ${r.run.repo}`,
    `**Commit:** ${r.run.commit}`,
    `**Branch:** ${r.repoSnapshot.branch}`,
    `**Objective:** ${r.run.objective}`,
    `**Mode:** ${r.run.mode}`,
    `**Initiator:** ${r.run.initiator}`,
    `**Started:** ${r.run.startedAt}`,
    `**Ended:** ${r.run.endedAt ?? '(in progress)'}`,
    '',
    `## Tests`,
    r.testSummary.attempted
      ? `- attempted: yes\n- passed: ${r.testSummary.passed}\n- failed: ${r.testSummary.failed}\n- total: ${r.testSummary.total}`
      : '- attempted: no (skipped)',
    '',
    `## Verdict`,
    `- finalStatus: ${r.verdict.finalStatus}`,
    `- score: ${r.verdict.score.toFixed(2)} / 10`,
    `- confidence: ${r.verdict.confidence}`,
    `- supported: ${(r.verdict.supportedClaims?.length ?? 0)}`,
    `- unsupported: ${(r.verdict.unsupportedClaims?.length ?? 0)}`,
    `- contradicted: ${(r.verdict.contradictedClaims?.length ?? 0)}`,
    `- opinion: ${(r.verdict.opinionClaims?.length ?? 0)}`,
    '',
    `## Next Action`,
    `- ${r.nextAction.priority} — ${r.nextAction.title}`,
    `- type: ${r.nextAction.actionType}`,
    `- executor: ${r.nextAction.recommendedExecutor}`,
    '',
    `## Budget`,
    `- maxUsd: $${r.budget.maxUsd.toFixed(2)}`,
    `- maxMinutes: ${r.budget.maxMinutes}`,
    `- maxCritics: ${r.budget.maxCritics}`,
    `- hardware: ${r.budget.hardwareProfile}`,
    ''
  ].join('\n');
}

function updateLatestSymlink(runDir: string): void {
  // Place the LATEST marker in the run's parent directory so explicit outDir
  // overrides land their pointer alongside the run rather than in the repo's
  // .danteforge/truth-loop/ directory.
  const parent = resolve(runDir, '..');
  if (!existsSync(parent)) return;
  const latest = resolve(parent, 'latest');
  try {
    if (existsSync(latest)) rmSync(latest, { recursive: true, force: true });
    symlinkSync(basename(runDir), latest, 'junction');
  } catch {
    // Symlink failures are not fatal — Windows requires admin or developer mode.
    try { writeFileSync(resolve(parent, 'LATEST'), basename(runDir), 'utf-8'); }
    catch { /* best-effort */ }
  }
}

function isPathInside(root: string, target: string): boolean {
  const rel = relative(resolve(root), resolve(target));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

async function snapshotTruthLoopRun(opts: RunnerOptions, runId: string, runDir: string, gitSha: string): Promise<void> {
  if (!isPathInside(opts.repo, runDir)) return;
  await createTimeMachineCommit({
    cwd: opts.repo,
    paths: [runDir],
    label: `truth-loop:${runId}`,
    runId,
    gitSha,
  });
}
