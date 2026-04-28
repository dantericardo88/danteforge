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
import { resolve, basename } from 'node:path';

import type {
  Run,
  Strictness,
  BudgetEnvelope,
  Artifact,
  Evidence,
  Verdict,
  NextAction,
  HardwareProfile,
  StopPolicy
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

export async function runTruthLoop(opts: RunnerOptions): Promise<RunnerResult> {
  const now = opts.now ?? new Date();
  const runId = opts.forcedRunId ?? nextRunId(opts.repo, now);
  const runDir = opts.outDir ?? resolve(opts.repo, '.danteforge', 'truth-loop', runId);
  ensureDir(runDir);
  ensureDir(resolve(runDir, 'artifacts'));
  ensureDir(resolve(runDir, 'evidence'));
  ensureDir(resolve(runDir, 'verdict'));
  ensureDir(resolve(runDir, 'next_action'));

  const budget: BudgetEnvelope = {
    budgetEnvelopeId: newBudgetEnvelopeId(runId),
    runId,
    maxUsd: opts.budgetUsd,
    maxMinutes: opts.budgetMinutes ?? 60,
    maxCritics: Math.max(1, opts.critics.length),
    executionMode: opts.mode,
    parallelismAllowed: opts.mode === 'parallel',
    hardwareProfile: opts.hardwareProfile ?? 'rtx_4060_laptop',
    stopPolicy: opts.stopPolicy ?? 'stop_on_budget_or_unresolved_blocker'
  };
  assertValid('budget_envelope', budget);

  const run: Run = {
    runId,
    projectId: basename(resolve(opts.repo)),
    repo: opts.repo,
    commit: '0000000',
    startedAt: now.toISOString(),
    mode: opts.mode,
    initiator: opts.initiator ?? 'agent',
    objective: opts.objective,
    budgetEnvelopeId: budget.budgetEnvelopeId,
    status: 'running'
  };

  const repoState = await collectRepoState({
    repo: opts.repo,
    runId,
    exec: opts.exec
  });
  run.commit = repoState.snapshot.commit;
  assertValid('run', run);

  const testState = await collectTestState({
    repo: opts.repo,
    runId,
    exec: opts.exec,
    testCommand: opts.testCommand,
    skipTests: opts.skipTests
  });

  const priorArtifacts = collectPriorArtifacts(opts.repo, runId);

  const artifacts: Artifact[] = [
    repoState.artifact,
    testState.artifact,
    priorArtifacts.artifact
  ];
  for (const a of artifacts) assertValid('artifact', a);

  const evidence: Evidence[] = [];

  const allClaims = [];
  for (const file of opts.critiqueFiles) {
    if (!existsSync(file.path)) {
      throw new Error(`critique file not found: ${file.path}`);
    }
    const art = importCritique({
      runId,
      source: file.source,
      filePath: file.path
    });
    assertValid('artifact', art);
    artifacts.push(art);
    if (art.claims) allClaims.push(...art.claims.map(c => ({ claim: c, artifactId: art.artifactId })));
  }

  const reconciled = reconcileClaims(
    allClaims.map(c => c.claim),
    {
      repo: opts.repo,
      runId,
      testArtifactId: testState.artifact.artifactId,
      repoArtifactId: repoState.artifact.artifactId,
      test: testState.summary,
      snapshot: repoState.snapshot
    }
  );
  for (const e of reconciled.evidence) {
    assertValid('evidence', e);
    evidence.push(e);
  }

  const evidenceMissing: string[] = [];
  if (testState.summary.attempted && testState.summary.failed > 0) {
    evidenceMissing.push(`${testState.summary.failed} test failure(s) observed`);
  }

  const verdict = buildVerdict({
    runId,
    reconciled: reconciled.reconciled,
    strictness: opts.strictness,
    evidenceMissing
  });
  assertValid('verdict', verdict);

  const promptUri = `file://${resolve(runDir, 'next_action', 'next_action_prompt.md').replace(/\\/g, '/')}`;
  const nextAction = buildNextAction({
    verdict,
    targetRepo: opts.repo,
    strictness: opts.strictness,
    promptUri
  });
  assertValid('next_action', nextAction);

  run.endedAt = new Date().toISOString();
  run.status = verdict.finalStatus === 'complete' ? 'complete' : 'stopped';

  writeFile(runDir, 'run.json', run);
  writeFile(runDir, 'budget.json', budget);
  for (const a of artifacts) {
    writeFile(resolve(runDir, 'artifacts'), `${a.artifactId}.json`, a);
  }
  writeFileSync(resolve(runDir, 'evidence', 'evidence.jsonl'), evidence.map(e => JSON.stringify(e)).join('\n') + (evidence.length > 0 ? '\n' : ''), 'utf-8');
  writeFile(resolve(runDir, 'verdict'), 'verdict.json', verdict);
  writeFileSync(resolve(runDir, 'verdict', 'verdict.md'), renderVerdictMarkdown(verdict), 'utf-8');
  writeFile(resolve(runDir, 'next_action'), 'next_action.json', nextAction);
  writeFileSync(resolve(runDir, 'next_action', 'next_action_prompt.md'), renderPromptPacket(nextAction, verdict), 'utf-8');

  const reportPath = resolve(runDir, 'report.md');
  writeFileSync(reportPath, renderReport({ run, budget, verdict, nextAction, testSummary: testState.summary, repoSnapshot: repoState.snapshot }), 'utf-8');

  updateLatestSymlink(opts.repo, runDir);

  return {
    runDir,
    run,
    budget,
    artifacts,
    evidence,
    verdict,
    nextAction,
    testSummary: testState.summary,
    repoSnapshot: repoState.snapshot,
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

function updateLatestSymlink(repo: string, runDir: string): void {
  const truthLoopDir = resolve(repo, '.danteforge', 'truth-loop');
  const latest = resolve(truthLoopDir, 'latest');
  try {
    if (existsSync(latest)) rmSync(latest, { recursive: true, force: true });
    symlinkSync(basename(runDir), latest, 'junction');
  } catch {
    // Symlink failures are not fatal — Windows requires admin or developer mode.
    // Write a marker file instead.
    writeFileSync(resolve(truthLoopDir, 'LATEST'), basename(runDir), 'utf-8');
  }
}
