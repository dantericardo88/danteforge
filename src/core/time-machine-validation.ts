import fs from 'node:fs/promises';
import path from 'node:path';

import {
  createEvidenceBundle,
  type EvidenceBundle,
} from '@danteforge/evidence-chain';
import { createTimeMachineCommit } from './time-machine.js';
import { runClassA, runClassB, runClassC } from './time-machine-validation-abc.js';
import { runClassD } from './time-machine-validation-delegate52.js';
import type { CorruptionLocation } from './time-machine-validation-delegate52-roundtrip.js';
import { runClassE, runClassF, runClassG } from './time-machine-validation-efg.js';
export { computeDiffLocations } from './time-machine-validation-delegate52-roundtrip.js';
export type { CorruptionLocation } from './time-machine-validation-delegate52-roundtrip.js';

export const TIME_MACHINE_VALIDATION_SCHEMA_VERSION = 'danteforge.time-machine.validation.v1' as const;

export type TimeMachineValidationClass = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G';
export type TimeMachineValidationScale = 'smoke' | 'prd' | 'prd-real' | 'benchmark';
export type Delegate52Mode = 'harness' | 'import' | 'live';
export type Delegate52MitigationStrategy = 'substrate-restore-retry' | 'prompt-only-retry' | 'no-mitigation' | 'smart-retry' | 'edit-journal' | 'surgical-patch';

export interface RunTimeMachineValidationOptions {
  cwd?: string;
  classes?: TimeMachineValidationClass[];
  scale?: TimeMachineValidationScale;
  outDir?: string;
  runId?: string;
  delegate52Mode?: Delegate52Mode;
  delegate52Dataset?: string;
  /** Continue a DELEGATE-52 live run by loading completed per-domain receipts from this outDir. */
  delegate52ResumeFrom?: string;
  /** Prior live spend not represented by completed per-domain receipts; counts against budgetUsd. */
  priorSpendUsd?: number;
  budgetUsd?: number;
  maxDomains?: number;
  now?: () => string;
  /**
   * Injection seam for the LLM caller. Default in production: `callLLM` from src/core/llm.ts.
   * Tests pass a mock that simulates provider responses without spending. Required only when
   * `delegate52Mode === 'live'` AND `DANTEFORGE_DELEGATE52_LIVE === '1'`.
   */
  _llmCaller?: (prompt: string) => Promise<{ output: string; costUsd: number }>;
  /**
   * Round-trips per domain (PRD §3.4 specifies 10 forward+backward pairs = 20 LLM interactions).
   * Reduced for testing/dry-run to avoid wall-time blowup.
   */
  roundTripsPerDomain?: number;
  /**
   * Optional Class A chain-size override for validation sub-runs that need fresh chains at
   * a specific length without switching the whole harness into PRD scale.
   */
  commitCountOverride?: number;
  /** Class F maximum commit count. Explicit option wins over the env var cap. */
  maxCommits?: number;
  /** Class F wall-clock budget in minutes. Exhaustion returns a partial report. */
  benchmarkTimeBudgetMinutes?: number;
  /**
   * Substrate-mediated corruption mitigation (Pass 29).
   * When `restoreOnDivergence` is true and a round-trip's byte-equality check fails, the harness
   * restores the workspace from the last clean Time Machine commit and re-prompts up to
   * `retriesOnDivergence` times. Tracks mitigated vs unmitigated divergences per domain.
   * Default: passive observer (current behavior).
   */
  mitigation?: {
    restoreOnDivergence?: boolean;
    retriesOnDivergence?: number;
    /**
     * Pass 40/45 — strategy selector for the counter-mitigation comparison harness.
     * - `'substrate-restore-retry'` (default when restoreOnDivergence=true): full Pass 29 behavior;
     *    on divergence, restore workspace from TM commit + re-prompt with the same prompt
     * - `'prompt-only-retry'`: re-prompt without restoring; the LLM sees the corrupted state and
     *    is asked to "fix" it. Tests whether substrate-mediated state recovery is necessary.
     * - `'no-mitigation'`: substrate-passive baseline (records divergence but doesn't recover).
     * - `'smart-retry'` (Pass 45): substrate-restore-retry PLUS diff-based feedback. After a failed
     *    round-trip, the substrate computes the diff between the failed attempt and the clean
     *    baseline (using Pass 39's computeDiffLocations), then includes the changed line ranges
     *    in the backward-edit prompt so Claude knows where its previous attempt drifted.
     * - `'edit-journal'` (Pass 46): DanteForge-native protocol. The substrate records the forward
     *    diff (what changed original→edited) at commit time and injects it into the backward prompt
     *    as an explicit undo recipe — the model sees exactly what to reverse rather than guessing.
     *    On failure, a structured critique is generated (what was correctly restored vs what still
     *    differs) and added to the next retry. Substrate restore remains the safety net.
     */
    strategy?: 'substrate-restore-retry' | 'prompt-only-retry' | 'no-mitigation' | 'smart-retry' | 'edit-journal' | 'surgical-patch';
  };
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
  status: 'harness_ready_not_live_validated' | 'imported_results_evaluated' | 'live_not_enabled' | 'live_completed' | 'live_partial' | 'live_dry_run' | 'failed';
  publicReleasedDomains: number;
  publicReleasedRows: number;
  withheldEnvironments: number;
  /** Live-run only: explicit no-fabrication blockers when paid validation is requested but cannot start. */
  liveBlockers?: Array<'blocked_by_missing_live_confirmation' | 'blocked_by_missing_budget' | 'blocked_by_missing_credentials' | 'blocked_by_missing_model'>;
  domainRows: Array<{
    domain: string;
    mode: Delegate52Mode;
    status: string;
    corruptionRecovered?: boolean;
    causalSourceIdentified?: boolean;
    /** Live-run only: # of round-trips executed before corruption first detected (or null if no corruption) */
    firstCorruptionRoundTrip?: number | null;
    /** Live-run only: total forward+backward LLM interactions */
    interactionCount?: number;
    /** Live-run only: cost spent on this domain in USD */
    costUsd?: number;
    /** Live-run only: hash of the original document */
    originalHash?: string;
    /** Live-run only: hash of the final document after all round-trips */
    finalHash?: string;
    /** Live-run only: whether final hash matches original (==> no net corruption) */
    byteIdenticalAfterRoundTrips?: boolean;
    /** Live-run only: per-edit Time Machine commit IDs (forward + backward, alternating) */
    timeMachineCommitIds?: string[];
    /** Live-run only: source of the document content fed to the LLM ('imported' or 'synthetic') */
    documentSource?: 'imported' | 'synthetic';
    /** Pass 29: total retry attempts triggered by divergence detection in this domain */
    retryCount?: number;
    /** Pass 29: divergences successfully recovered via restore + retry within budget */
    mitigatedDivergences?: number;
    /** Pass 29: divergences where retries were exhausted (substrate-on but mitigation failed) */
    unmitigatedDivergences?: number;
    /** Pass 36: divergences where retries aborted early due to detected LLM oscillation (cycle of corrupted hashes) */
    oscillatedDivergences?: number;
    /** Pass 36: divergences where graceful degradation kicked in (workspace restored to last clean state on retry exhaustion) */
    gracefullyDegradedDivergences?: number;
    /** Pass 39: per-divergence diff descriptors — quantitative D3 causal-source identification */
    corruptionLocations?: CorruptionLocation[];
    /** Pass 39: of all divergences observed in this domain, how many had a clean single-region attribution */
    causalSourceIdentifiedCount?: number;
    /** Pass 39: total divergences observed (raw + retry attempts; denominator for the per-domain D3 rate) */
    totalDivergences?: number;
    /** Live-run only: recoverability/failure detail for durable partial receipts. */
    recoverable?: boolean;
    errorMessage?: string;
    primaryErrorMessage?: string;
    sampleId?: string;
    model?: string;
    fallbackModel?: string;
    providerFallbackUsed?: boolean;
    completedAt?: string;
    resumedFrom?: string;
  }>;
  /** Live-run only: aggregate cost across all domains */
  totalCostUsd?: number;
  /** Live-run only: aggregate raw LLM divergence rate before substrate repair; analog to Microsoft corruption baseline */
  corruptionRate?: number;
  /** Pass 29: aggregate final-document corruption rate that the user observes after substrate mitigation */
  userObservedCorruptionRate?: number;
  /** Pass 29: aggregate raw LLM divergence rate (matches `corruptionRate` for compatibility; explicit alias) */
  rawCorruptionRate?: number;
  /** Pass 29: total retry attempts across all domains */
  totalRetries?: number;
  /** Pass 29: total mitigated divergences across all domains */
  totalMitigatedDivergences?: number;
  /** Pass 29: total unmitigated divergences across all domains (substrate-on failures) */
  totalUnmitigatedDivergences?: number;
  /** Pass 36: total oscillation-detected divergences across all domains */
  totalOscillatedDivergences?: number;
  /** Pass 36: total gracefully-degraded divergences (substrate restored to clean state) */
  totalGracefullyDegradedDivergences?: number;
  /** Pass 39: aggregate D3 causal-source identification rate across all domains (0..1) */
  causalSourceIdentificationRate?: number;
  /** Pass 39: total divergences across all domains; denominator for causalSourceIdentificationRate */
  totalDivergencesObserved?: number;
  /** Pass 39: total divergences with clean single-region attribution; numerator for D3 rate */
  totalCausalSourceIdentified?: number;
  /** Pass 29: mitigation configuration used for live/dry-run validation */
  mitigation?: {
    restoreOnDivergence: boolean;
    retriesOnDivergence: number;
    strategy: Delegate52MitigationStrategy;
  };
  budgetExhausted?: boolean;
  priorSpendUsd?: number;
  completedDomainCount?: number;
  failedDomainCount?: number;
  limitations: string[];
}

export interface ClassEResult {
  status: 'passed' | 'failed';
  scenarios: Array<{ id: string; detected: boolean; mechanism: string }>;
}

export interface ClassFResult {
  status: 'passed' | 'partial' | 'failed';
  benchmarks: Array<{
    id: string;
    commitCount: number;
    targetCommits?: number;
    completedCommits?: number;
    buildMs?: number;
    verifyMs: number;
    restoreMs: number;
    queryMs: number;
    passedThreshold: boolean;
    buildCompleted?: boolean;
    skipped?: boolean;
    note?: string;
    failureReason?: string;
  }>;
}

export interface ClassGResult {
  status: 'passed' | 'partial' | 'failed';
  scenarios: Array<{ id: string; status: 'passed' | 'staged_founder_gated' | 'harness_ready'; message: string }>;
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
  if (classes.includes('A')) classResults.A = await runClassA(outDir, scale, createdAt, options.commitCountOverride);
  if (classes.includes('B')) classResults.B = await runClassB(outDir, scale, createdAt);
  if (classes.includes('C')) classResults.C = await runClassC(outDir, scale, createdAt);
  if (classes.includes('D')) classResults.D = await runClassD(outDir, delegate52Mode, options);
  if (classes.includes('E')) classResults.E = await runClassE(outDir, createdAt);
  if (classes.includes('F')) classResults.F = await runClassF(outDir, scale, createdAt, options);
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
    status: summary.failedClasses.length > 0
      ? 'failed' as const
      : summary.partialClasses.length > 0 || summary.passedClasses.length < classes.length
        ? 'partial' as const
        : 'passed' as const,
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
