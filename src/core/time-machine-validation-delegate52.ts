import fs from 'node:fs/promises';
import path from 'node:path';

import { loadConfig } from './config.js';
import type { ClassDResult, Delegate52Mode, RunTimeMachineValidationOptions } from './time-machine-validation.js';
import {
  buildImportedDocumentMap,
  type DomainRoundTripResult,
  type MitigationConfig,
  runDelegate52DomainRoundTrip,
  sanitizeDomainKey,
} from './time-machine-validation-delegate52-roundtrip.js';

export async function runClassD(outDir: string, delegate52Mode: Delegate52Mode, options: RunTimeMachineValidationOptions): Promise<ClassDResult> {
  const maxDomains = Math.max(1, Math.min(options.maxDomains ?? 4, 48));
  const imported = options.delegate52Dataset ? await readDelegate52Dataset(options.delegate52Dataset) : [];
  const isDryRun = process.env.DANTEFORGE_DELEGATE52_DRY_RUN === '1';
  const liveBlockers = delegate52Mode === 'live' && !isDryRun ? await getDelegate52LiveBlockers(options) : [];
  const liveEnabled = delegate52Mode === 'live' && liveBlockers.length === 0;
  const domains = imported.length > 0
    ? [...new Set(imported.map(row => row.domain || row.sample_type || 'unknown'))].slice(0, maxDomains)
    : Array.from({ length: maxDomains }, (_, i) => `public-domain-${i + 1}`);

  await fs.writeFile(path.join(outDir, 'artifacts', 'delegate52-harness.json'), JSON.stringify({
    source: 'microsoft/delegate52 public harness',
    arxiv: '2604.15597',
    publicReleasedDomains: 48,
    publicReleasedRows: 234,
    withheldEnvironments: 76,
    mode: delegate52Mode,
    dataset: options.delegate52Dataset ?? null,
    resumeFrom: options.delegate52ResumeFrom ?? null,
    priorSpendUsd: options.priorSpendUsd ?? 0,
    budgetUsd: options.budgetUsd ?? null,
    liveEnabled,
    liveBlockers,
    isDryRun,
  }, null, 2) + '\n', 'utf8');

  if (delegate52Mode === 'live' && (liveEnabled || isDryRun)) {
    const importedByDomain = buildImportedDocumentMap(imported);
    return runDelegate52Live(outDir, domains, options, isDryRun, importedByDomain);
  }

  // Default path: harness/import without live execution.
  const domainRows = domains.map(domain => ({
    domain,
    mode: delegate52Mode,
    status: delegate52Mode === 'live'
      ? 'live_not_enabled_explicit_budget_required'
      : 'harness_ready_not_live_validated',
    corruptionRecovered: delegate52Mode === 'import' ? undefined : false,
    causalSourceIdentified: delegate52Mode === 'import' ? undefined : false,
  }));

  return {
    status: delegate52Mode === 'import'
      ? 'imported_results_evaluated'
      : delegate52Mode === 'live' ? 'live_not_enabled' : 'harness_ready_not_live_validated',
    publicReleasedDomains: 48,
    publicReleasedRows: 234,
    withheldEnvironments: 76,
    liveBlockers: liveBlockers.length > 0 ? liveBlockers : undefined,
    domainRows,
    limitations: [
      'Public DELEGATE-52 release has 48 domains and 234 rows; 76 environments are withheld for license reasons.',
      delegate52Mode === 'live'
        ? `Live mode is opt-in and must record provider, model, budget, and final comparison artifacts. Blockers: ${liveBlockers.length > 0 ? liveBlockers.join(', ') : 'none'}.`
        : 'DELEGATE-52 is not live validated in harness/import-free mode; no publishable live replication claim is allowed.',
    ],
  };
}

async function getDelegate52LiveBlockers(options: RunTimeMachineValidationOptions): Promise<NonNullable<ClassDResult['liveBlockers']>> {
  const blockers: NonNullable<ClassDResult['liveBlockers']> = [];
  const hasInjectedCaller = typeof options._llmCaller === 'function';
  const config = await loadConfig({ cwd: options.cwd }).catch(() => undefined);
  const defaultProvider = config?.defaultProvider;
  const delegateModel = process.env.DANTEFORGE_DELEGATE52_MODEL ?? process.env.ANTHROPIC_MODEL ?? '';
  const providerFromModel = delegateModel.startsWith('claude') ? 'claude'
    : delegateModel.startsWith('gpt') || delegateModel.startsWith('o1') || delegateModel.startsWith('o3') ? 'openai'
    : delegateModel.startsWith('gemini') ? 'gemini'
    : delegateModel.startsWith('grok') ? 'grok'
    : undefined;
  const providersToCheck = [
    providerFromModel,
    defaultProvider,
    'claude',
  ].filter((provider): provider is string => Boolean(provider));
  const hasBudget = (options.budgetUsd ?? 0) > 0;
  const hasLiveConfirmation = process.env.DANTEFORGE_DELEGATE52_LIVE === '1';
  const hasCredentials = hasInjectedCaller
    || Boolean(
      process.env.ANTHROPIC_API_KEY
      || process.env.DANTEFORGE_CLAUDE_API_KEY
      || process.env.DANTEFORGE_ANTHROPIC_API_KEY
      || process.env.DANTEFORGE_LLM_API_KEY,
    )
    || providersToCheck.some(provider => Boolean(config?.providers?.[provider]?.apiKey));
  const hasPinnedModel = hasInjectedCaller
    || Boolean(process.env.ANTHROPIC_MODEL || process.env.DANTEFORGE_DELEGATE52_MODEL)
    || providersToCheck.some(provider => Boolean(config?.providers?.[provider]?.model));
  if (!hasLiveConfirmation) blockers.push('blocked_by_missing_live_confirmation');
  if (!hasBudget) blockers.push('blocked_by_missing_budget');
  if (!hasCredentials) blockers.push('blocked_by_missing_credentials');
  if (!hasPinnedModel) blockers.push('blocked_by_missing_model');
  return blockers;
}

/**
 * Real DELEGATE-52 round-trip executor (Pass 19).
 *
 * For each domain: take a synthetic source document, ask the LLM to perform a forward edit
 * (e.g., "split this CSV by department"), then ask the LLM to undo that edit. Repeat 10 times
 * (= 20 LLM interactions per domain per the PRD). Compare the final hash to the original.
 *
 * Modes:
 *   - dry-run (DANTEFORGE_DELEGATE52_DRY_RUN=1): simulates LLM responses with identity
 *     transformations; does NOT call any provider; no $ spent. Validates the harness shape.
 *   - live (DANTEFORGE_DELEGATE52_LIVE=1 + --budget-usd N): calls the real provider via _llmCaller.
 *
 * Cost tracking: every LLM call returns costUsd; aggregate is enforced against options.budgetUsd.
 * If cumulative cost exceeds budget, the executor stops mid-loop and reports the partial result.
 */
async function runDelegate52Live(
  outDir: string,
  domains: string[],
  options: RunTimeMachineValidationOptions,
  isDryRun: boolean,
  importedByDomain: Map<string, { content: string; forwardInstructions?: string; backwardInstructions?: string; sampleId?: string }>,
): Promise<ClassDResult> {
  const roundTrips = Math.max(1, Math.min(options.roundTripsPerDomain ?? 10, 20));
  const budgetUsd = options.budgetUsd ?? 0;
  const priorSpendUsd = Math.max(0, options.priorSpendUsd ?? 0);
  const resumeFrom = options.delegate52ResumeFrom ? path.resolve(options.delegate52ResumeFrom) : undefined;
  const llmCaller = options._llmCaller ?? makeDefaultLlmCaller(isDryRun);
  const roundTripDir = path.join(outDir, 'delegate52-round-trips');
  const artifactsDir = path.join(outDir, 'artifacts');
  await fs.mkdir(roundTripDir, { recursive: true });
  await fs.mkdir(artifactsDir, { recursive: true });
  // Pass 40 — derive the mitigation strategy. Explicit strategy wins; otherwise infer from restoreOnDivergence.
  const mitigation = resolveDelegate52Mitigation(options);
  const resumedRows = await readResumableDelegate52Rows(resumeFrom, domains, isDryRun);
  const recoverableFailureLimit = Math.max(
    1,
    Number.parseInt(process.env.DANTEFORGE_DELEGATE52_RECOVERABLE_FAILURE_LIMIT ?? '3', 10) || 3,
  );

  const domainRows: ClassDResult['domainRows'] = [];
  let consecutiveRecoverableFailures = 0;
  let providerCircuitOpen = false;

  for (const domain of domains) {
    const resumedRow = resumedRows.get(domain);
    if (resumedRow) {
      consecutiveRecoverableFailures = 0;
      domainRows.push(resumedRow);
      await writeDelegate52DomainReceipt(outDir, resumedRow, {
        complete: true,
        roundTrips,
        mitigation,
        resumeFrom,
      });
      await writeDelegate52Progress(outDir, domains, domainRows, {
        isDryRun,
        roundTrips,
        budgetUsd,
        priorSpendUsd,
        mitigation,
        resumeFrom,
      });
      continue;
    }

    const beforeDomain = aggregateDelegate52Rows(domainRows, domains.length, priorSpendUsd);
    if (!isDryRun && beforeDomain.totalCostUsd >= budgetUsd) {
      const row = buildBudgetExhaustedDomainRow(domain);
      domainRows.push(row);
      await writeDelegate52DomainReceipt(outDir, row, {
        complete: false,
        roundTrips,
        mitigation,
        resumeFrom,
      });
      await writeDelegate52Progress(outDir, domains, domainRows, {
        isDryRun,
        roundTrips,
        budgetUsd,
        priorSpendUsd,
        mitigation,
        resumeFrom,
      });
      continue;
    }
    const importedEntry = importedByDomain.get(domain);
    try {
      const result = await runDelegate52DomainRoundTrip(
        domain,
        roundTrips,
        llmCaller,
        Math.max(0, budgetUsd - beforeDomain.totalCostUsd),
        isDryRun,
        importedEntry?.content,
        roundTripDir,
        mitigation,
        importedEntry?.forwardInstructions,
        importedEntry?.backwardInstructions,
      );
      const row = buildDelegate52DomainRow(
        domain,
        result,
        isDryRun ? 'live_dry_run_completed' : 'live_completed',
        importedEntry?.content !== undefined ? 'imported' : 'synthetic',
        {
          sampleId: importedEntry?.sampleId,
          model: resolveDelegate52ActiveModel(),
        },
      );
      consecutiveRecoverableFailures = 0;
      domainRows.push(row);
      await writeDelegate52DomainReceipt(outDir, row, {
        complete: true,
        roundTrips,
        mitigation,
        resumeFrom,
      });
    } catch (err) {
      const fallbackModel = resolveDelegate52FallbackModel(err, isDryRun);
      if (fallbackModel) {
        try {
          const result = await runDelegate52DomainRoundTrip(
            domain,
            roundTrips,
            makeDefaultLlmCaller(false, fallbackModel),
            Math.max(0, budgetUsd - beforeDomain.totalCostUsd),
            isDryRun,
            importedEntry?.content,
            roundTripDir,
            mitigation,
            importedEntry?.forwardInstructions,
            importedEntry?.backwardInstructions,
          );
          const row = buildDelegate52DomainRow(
            domain,
            result,
            'live_completed',
            importedEntry?.content !== undefined ? 'imported' : 'synthetic',
            {
              sampleId: importedEntry?.sampleId,
              model: resolveDelegate52ActiveModel(),
              fallbackModel,
              providerFallbackUsed: true,
              primaryErrorMessage: errorMessage(err).slice(0, 2000),
            },
          );
          consecutiveRecoverableFailures = 0;
          domainRows.push(row);
          await writeDelegate52DomainReceipt(outDir, row, {
            complete: true,
            roundTrips,
            mitigation,
            resumeFrom,
          });
          await writeDelegate52Progress(outDir, domains, domainRows, {
            isDryRun,
            roundTrips,
            budgetUsd,
            priorSpendUsd,
            mitigation,
            resumeFrom,
          });
          continue;
        } catch (fallbackErr) {
          const recoverable = isRecoverableDelegate52Error(fallbackErr);
          const row = buildFailedDelegate52DomainRow(domain, fallbackErr, recoverable, {
            sampleId: importedEntry?.sampleId,
            model: resolveDelegate52ActiveModel(),
            fallbackModel,
            providerFallbackUsed: true,
            primaryErrorMessage: errorMessage(err).slice(0, 2000),
          });
          consecutiveRecoverableFailures = recoverable ? consecutiveRecoverableFailures + 1 : 0;
          domainRows.push(row);
          await writeDelegate52DomainReceipt(outDir, row, {
            complete: false,
            roundTrips,
            mitigation,
            resumeFrom,
          });
          await writeDelegate52Progress(outDir, domains, domainRows, {
            isDryRun,
            roundTrips,
            budgetUsd,
            priorSpendUsd,
            mitigation,
            resumeFrom,
          });
          continue;
        }
      }
      const recoverable = isRecoverableDelegate52Error(err);
      const row = buildFailedDelegate52DomainRow(domain, err, recoverable, {
        sampleId: importedEntry?.sampleId,
        model: resolveDelegate52ActiveModel(),
      });
      consecutiveRecoverableFailures = recoverable ? consecutiveRecoverableFailures + 1 : 0;
      domainRows.push(row);
      await writeDelegate52DomainReceipt(outDir, row, {
        complete: false,
        roundTrips,
        mitigation,
        resumeFrom,
      });
    }

    await writeDelegate52Progress(outDir, domains, domainRows, {
      isDryRun,
      roundTrips,
      budgetUsd,
      priorSpendUsd,
      mitigation,
      resumeFrom,
    });

    if (consecutiveRecoverableFailures >= recoverableFailureLimit) {
      providerCircuitOpen = true;
      break;
    }
  }

  const aggregate = aggregateDelegate52Rows(domainRows, domains.length, priorSpendUsd);
  const budgetExhausted = domainRows.some(row => row.status === 'budget_exhausted')
    || (!isDryRun && aggregate.totalCostUsd >= budgetUsd && aggregate.completedDomainCount < domains.length);
  const hasFailedRows = aggregate.failedDomainCount > 0;
  const classStatus: ClassDResult['status'] = isDryRun && !hasFailedRows && !budgetExhausted
    ? 'live_dry_run'
    : budgetExhausted || hasFailedRows || aggregate.completedDomainCount < domains.length
      ? 'live_partial'
      : 'live_completed';

  await writeDelegate52Progress(outDir, domains, domainRows, {
    isDryRun,
    roundTrips,
    budgetUsd,
    priorSpendUsd,
    mitigation,
    resumeFrom,
  });
  await writeDelegate52LiveResult(outDir, {
    isDryRun,
    domains: domains.length,
    roundTrips,
    budgetUsd,
    priorSpendUsd,
    mitigation,
    budgetExhausted,
    domainRows,
    aggregate,
    resumeFrom,
    providerCircuitOpen,
    recoverableFailureLimit,
  });

  return {
    status: classStatus,
    publicReleasedDomains: 48,
    publicReleasedRows: 234,
    withheldEnvironments: 76,
    domainRows,
    totalCostUsd: aggregate.totalCostUsd,
    corruptionRate: aggregate.corruptionRate,
    rawCorruptionRate: aggregate.rawCorruptionRate,
    userObservedCorruptionRate: aggregate.userObservedCorruptionRate,
    totalRetries: aggregate.totalRetries,
    totalMitigatedDivergences: aggregate.totalMitigatedDivergences,
    totalUnmitigatedDivergences: aggregate.totalUnmitigatedDivergences,
    totalOscillatedDivergences: aggregate.totalOscillatedDivergences,
    totalGracefullyDegradedDivergences: aggregate.totalGracefullyDegradedDivergences,
    causalSourceIdentificationRate: aggregate.causalSourceIdentificationRate,
    totalDivergencesObserved: aggregate.totalDivergencesObserved,
    totalCausalSourceIdentified: aggregate.totalCausalSourceIdentified,
    mitigation,
    budgetExhausted,
    priorSpendUsd,
    completedDomainCount: aggregate.completedDomainCount,
    failedDomainCount: aggregate.failedDomainCount,
    limitations: [
      isDryRun
        ? 'Dry-run mode: LLM responses simulated; no real provider called; cost tracking is placeholder.'
        : `Live run: ${aggregate.completedDomainCount}/${domains.length} completed domain(s), ${aggregate.failedDomainCount} failed domain(s), at $${aggregate.totalCostUsd.toFixed(2)}/$${budgetUsd} total budget including $${priorSpendUsd.toFixed(2)} prior spend.`,
      resumeFrom
        ? `Resume mode: only complete per-domain receipts from ${resumeFrom} were skipped; incomplete workspaces were rerun.`
        : 'Fresh live validation run; no prior per-domain receipts were reused.',
      'Time Machine restore-to-commit-0 is always available regardless of corruption (Property 2: Reversibility); corruptionRecovered=true reflects substrate guarantee, not per-run measurement.',
      mitigation.restoreOnDivergence
        ? `Substrate-mediated mitigation active: restore + retry (${mitigation.retriesOnDivergence} max) on byte-equality divergence. user-observed corruption rate ${(aggregate.userObservedCorruptionRate * 100).toFixed(1)}% (vs raw LLM rate ${(aggregate.rawCorruptionRate * 100).toFixed(1)}%).`
        : 'Substrate-passive mode: divergence is recorded but not mitigated. Set mitigation.restoreOnDivergence=true to enable restore+retry.',
      budgetExhausted ? 'Budget exhausted before all domains completed; partial result.' : 'All requested domains completed within budget.',
      hasFailedRows ? 'One or more domains failed; recoverable failures are intentionally preserved as receipts and must be resumed or rerun before evidence closure.' : 'No failed domain receipts recorded.',
      providerCircuitOpen
        ? `Provider circuit opened after ${recoverableFailureLimit} consecutive recoverable domain failures; remaining domains were left pending for resume.`
        : 'Provider circuit did not open.',
    ],
  };
}

function resolveDelegate52Mitigation(options: RunTimeMachineValidationOptions): MitigationConfig {
  const explicitStrategy = options.mitigation?.strategy;
  const inferredStrategy: MitigationConfig['strategy'] = options.mitigation?.restoreOnDivergence
    ? 'substrate-restore-retry'
    : 'no-mitigation';
  const strategy = explicitStrategy ?? inferredStrategy;
  return {
    restoreOnDivergence: strategy === 'substrate-restore-retry'
      || strategy === 'smart-retry'
      || strategy === 'edit-journal'
      || strategy === 'surgical-patch',
    retriesOnDivergence: Math.max(0, Math.min(options.mitigation?.retriesOnDivergence ?? 0, 10)),
    strategy,
  };
}

type Delegate52DomainRow = ClassDResult['domainRows'][number];

interface Delegate52DomainReceipt {
  schemaVersion: 'danteforge.delegate52.domain-result.v1';
  complete: boolean;
  row: Delegate52DomainRow;
  roundTrips: number;
  mitigation: MitigationConfig;
  resumeFrom?: string;
  writtenAt: string;
}

function isCompletedDelegate52DomainRow(row: Delegate52DomainRow): boolean {
  return (row.status === 'live_completed'
      || row.status === 'live_dry_run_completed'
      || row.status === 'llm_timeout_recovered')
    && typeof row.originalHash === 'string'
    && typeof row.finalHash === 'string'
    && typeof row.interactionCount === 'number'
    && typeof row.costUsd === 'number'
    && Array.isArray(row.timeMachineCommitIds);
}

async function readResumableDelegate52Rows(
  resumeFrom: string | undefined,
  domains: string[],
  isDryRun: boolean,
): Promise<Map<string, Delegate52DomainRow>> {
  const out = new Map<string, Delegate52DomainRow>();
  if (!resumeFrom) return out;
  const receiptDir = path.join(resumeFrom, 'artifacts', 'delegate52-domain-results');
  for (const domain of domains) {
    const receiptPath = path.join(receiptDir, `${sanitizeDomainKey(domain)}.json`);
    try {
      const parsed = JSON.parse(await fs.readFile(receiptPath, 'utf8')) as Partial<Delegate52DomainReceipt>;
      const row = parsed.row;
      if (!parsed.complete || !row || row.domain !== domain || row.mode !== 'live') continue;
      if (!isCompletedDelegate52DomainRow(row)) continue;
      if (isDryRun && row.status !== 'live_dry_run_completed') continue;
      out.set(domain, { ...row, resumedFrom: resumeFrom });
    } catch {
      // Missing or malformed receipts are intentionally not resumable; rerun that domain.
    }
  }
  return out;
}

async function writeDelegate52DomainReceipt(
  outDir: string,
  row: Delegate52DomainRow,
  options: { complete: boolean; roundTrips: number; mitigation: MitigationConfig; resumeFrom?: string },
): Promise<void> {
  const receiptDir = path.join(outDir, 'artifacts', 'delegate52-domain-results');
  await fs.mkdir(receiptDir, { recursive: true });
  const receipt: Delegate52DomainReceipt = {
    schemaVersion: 'danteforge.delegate52.domain-result.v1',
    complete: options.complete,
    row,
    roundTrips: options.roundTrips,
    mitigation: options.mitigation,
    ...(options.resumeFrom ? { resumeFrom: options.resumeFrom } : {}),
    writtenAt: new Date().toISOString(),
  };
  await fs.writeFile(path.join(receiptDir, `${sanitizeDomainKey(row.domain)}.json`), JSON.stringify(receipt, null, 2) + '\n', 'utf8');
}

function isRecoverableDelegate52Error(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes('request timed out after')
    || msg.includes('timed out')
    || msg.includes('returned an empty response')
    || msg.includes('content filtering policy')
    || msg.includes('fetch failed')
    || msg.includes('rate limit')
    || msg.includes('429')
    || msg.includes('502')
    || msg.includes('503')
    || msg.includes('econnreset')
    || msg.includes('socket hang up');
}

function isProviderContentFilterError(err: unknown): boolean {
  return err instanceof Error && err.message.toLowerCase().includes('content filtering policy');
}

function resolveDelegate52ActiveModel(): string | undefined {
  return process.env.DANTEFORGE_DELEGATE52_MODEL ?? process.env.ANTHROPIC_MODEL;
}

function resolveDelegate52FallbackModel(err: unknown, isDryRun: boolean): string | undefined {
  if (isDryRun || !isProviderContentFilterError(err)) return undefined;
  const fallbackModel = process.env.DANTEFORGE_DELEGATE52_FALLBACK_MODEL?.trim();
  return fallbackModel || undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

interface Delegate52Aggregate {
  totalCostUsd: number;
  rawCorruptedDomains: number;
  userObservedCorruptedDomains: number;
  corruptionRate: number;
  rawCorruptionRate: number;
  userObservedCorruptionRate: number;
  totalRetries: number;
  totalMitigatedDivergences: number;
  totalUnmitigatedDivergences: number;
  totalOscillatedDivergences: number;
  totalGracefullyDegradedDivergences: number;
  causalSourceIdentificationRate: number;
  totalDivergencesObserved: number;
  totalCausalSourceIdentified: number;
  completedDomainCount: number;
  failedDomainCount: number;
}

function aggregateDelegate52Rows(rows: Delegate52DomainRow[], domainCount: number, priorSpendUsd: number): Delegate52Aggregate {
  const totalDivergencesObserved = rows.reduce((sum, row) => sum + (row.totalDivergences ?? 0), 0);
  const totalCausalSourceIdentified = rows.reduce((sum, row) => sum + (row.causalSourceIdentifiedCount ?? 0), 0);
  const rawCorruptedDomains = rows.filter(row => (row.totalDivergences ?? 0) > 0).length;
  const failedDomainCount = rows.filter(row => row.status === 'failed_recoverable' || row.status === 'failed_unrecoverable').length;
  const userObservedCorruptedDomains = rows.filter(row => row.status === 'failed_recoverable'
    || row.status === 'failed_unrecoverable'
    || row.byteIdenticalAfterRoundTrips === false).length;
  const denominator = domainCount === 0 ? 1 : domainCount;
  return {
    totalCostUsd: priorSpendUsd + rows.reduce((sum, row) => sum + (row.costUsd ?? 0), 0),
    rawCorruptedDomains,
    userObservedCorruptedDomains,
    corruptionRate: rawCorruptedDomains / denominator,
    rawCorruptionRate: rawCorruptedDomains / denominator,
    userObservedCorruptionRate: userObservedCorruptedDomains / denominator,
    totalRetries: rows.reduce((sum, row) => sum + (row.retryCount ?? 0), 0),
    totalMitigatedDivergences: rows.reduce((sum, row) => sum + (row.mitigatedDivergences ?? 0), 0),
    totalUnmitigatedDivergences: rows.reduce((sum, row) => sum + (row.unmitigatedDivergences ?? 0), 0),
    totalOscillatedDivergences: rows.reduce((sum, row) => sum + (row.oscillatedDivergences ?? 0), 0),
    totalGracefullyDegradedDivergences: rows.reduce((sum, row) => sum + (row.gracefullyDegradedDivergences ?? 0), 0),
    causalSourceIdentificationRate: totalDivergencesObserved === 0 ? 1 : totalCausalSourceIdentified / totalDivergencesObserved,
    totalDivergencesObserved,
    totalCausalSourceIdentified,
    completedDomainCount: rows.filter(isCompletedDelegate52DomainRow).length,
    failedDomainCount,
  };
}

async function writeDelegate52Progress(
  outDir: string,
  domains: string[],
  rows: Delegate52DomainRow[],
  options: {
    isDryRun: boolean;
    roundTrips: number;
    budgetUsd: number;
    priorSpendUsd: number;
    mitigation: MitigationConfig;
    resumeFrom?: string;
  },
): Promise<void> {
  const aggregate = aggregateDelegate52Rows(rows, domains.length, options.priorSpendUsd);
  const processed = new Set(rows.map(row => row.domain));
  const progress = {
    schemaVersion: 'danteforge.delegate52.live-progress.v1',
    updatedAt: new Date().toISOString(),
    isDryRun: options.isDryRun,
    domainsRequested: domains.length,
    roundTripsPerDomain: options.roundTrips,
    budgetUsd: options.budgetUsd,
    priorSpendUsd: options.priorSpendUsd,
    resumeFrom: options.resumeFrom ?? null,
    mitigation: options.mitigation,
    completedDomainCount: aggregate.completedDomainCount,
    failedDomainCount: aggregate.failedDomainCount,
    processedDomainCount: rows.length,
    pendingDomains: domains.filter(domain => !processed.has(domain)),
    totalCostUsd: aggregate.totalCostUsd,
    budgetExhausted: !options.isDryRun && aggregate.totalCostUsd >= options.budgetUsd && aggregate.completedDomainCount < domains.length,
    domainRows: rows,
  };
  await fs.writeFile(path.join(outDir, 'artifacts', 'delegate52-live-progress.json'), JSON.stringify(progress, null, 2) + '\n', 'utf8');
}

async function writeDelegate52LiveResult(
  outDir: string,
  payload: {
    isDryRun: boolean;
    domains: number;
    roundTrips: number;
    budgetUsd: number;
    priorSpendUsd: number;
    mitigation: MitigationConfig;
    budgetExhausted: boolean;
    domainRows: Delegate52DomainRow[];
    aggregate: Delegate52Aggregate;
    resumeFrom?: string;
    providerCircuitOpen?: boolean;
    recoverableFailureLimit?: number;
  },
): Promise<void> {
  await fs.writeFile(path.join(outDir, 'artifacts', 'delegate52-live-result.json'), JSON.stringify({
    isDryRun: payload.isDryRun,
    domains: payload.domains,
    roundTripsPerDomain: payload.roundTrips,
    budgetUsd: payload.budgetUsd,
    priorSpendUsd: payload.priorSpendUsd,
    totalCostUsd: payload.aggregate.totalCostUsd,
    corruptedDomains: payload.aggregate.rawCorruptedDomains,
    rawCorruptedDomains: payload.aggregate.rawCorruptedDomains,
    userObservedCorruptedDomains: payload.aggregate.userObservedCorruptedDomains,
    corruptionRate: payload.aggregate.corruptionRate,
    rawCorruptionRate: payload.aggregate.rawCorruptionRate,
    userObservedCorruptionRate: payload.aggregate.userObservedCorruptionRate,
    totalRetries: payload.aggregate.totalRetries,
    totalMitigatedDivergences: payload.aggregate.totalMitigatedDivergences,
    totalUnmitigatedDivergences: payload.aggregate.totalUnmitigatedDivergences,
    totalOscillatedDivergences: payload.aggregate.totalOscillatedDivergences,
    totalGracefullyDegradedDivergences: payload.aggregate.totalGracefullyDegradedDivergences,
    causalSourceIdentificationRate: payload.aggregate.causalSourceIdentificationRate,
    totalDivergencesObserved: payload.aggregate.totalDivergencesObserved,
    totalCausalSourceIdentified: payload.aggregate.totalCausalSourceIdentified,
    completedDomainCount: payload.aggregate.completedDomainCount,
    failedDomainCount: payload.aggregate.failedDomainCount,
    mitigation: payload.mitigation,
    budgetExhausted: payload.budgetExhausted,
    providerCircuitOpen: payload.providerCircuitOpen ?? false,
    recoverableFailureLimit: payload.recoverableFailureLimit ?? null,
    microsoftBaselineCorruptionRate: 0.25,
    resumeFrom: payload.resumeFrom ?? null,
    domainRows: payload.domainRows,
  }, null, 2) + '\n', 'utf8');
}

function buildDelegate52DomainRow(
  domain: string,
  result: DomainRoundTripResult,
  status: string,
  documentSource: 'imported' | 'synthetic',
  options: {
    sampleId?: string;
    model?: string;
    fallbackModel?: string;
    providerFallbackUsed?: boolean;
    primaryErrorMessage?: string;
  } = {},
): Delegate52DomainRow {
  return {
    domain,
    mode: 'live',
    status,
    corruptionRecovered: true,
    causalSourceIdentified: result.firstCorruptionRoundTrip !== null,
    firstCorruptionRoundTrip: result.firstCorruptionRoundTrip,
    interactionCount: result.interactionCount,
    costUsd: result.costUsd,
    originalHash: result.originalHash,
    finalHash: result.finalHash,
    byteIdenticalAfterRoundTrips: result.byteIdenticalAfterRoundTrips,
    timeMachineCommitIds: result.timeMachineCommitIds,
    documentSource,
    ...(options.sampleId ? { sampleId: options.sampleId } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.fallbackModel ? { fallbackModel: options.fallbackModel } : {}),
    ...(options.providerFallbackUsed !== undefined ? { providerFallbackUsed: options.providerFallbackUsed } : {}),
    ...(options.primaryErrorMessage ? { primaryErrorMessage: options.primaryErrorMessage } : {}),
    retryCount: result.retryCount,
    mitigatedDivergences: result.mitigatedDivergences,
    unmitigatedDivergences: result.unmitigatedDivergences,
    oscillatedDivergences: result.oscillatedDivergences,
    gracefullyDegradedDivergences: result.gracefullyDegradedDivergences,
    corruptionLocations: result.corruptionLocations,
    causalSourceIdentifiedCount: result.causalSourceIdentified,
    totalDivergences: result.totalDivergences,
    completedAt: new Date().toISOString(),
  };
}

function buildBudgetExhaustedDomainRow(domain: string): Delegate52DomainRow {
  return {
    domain,
    mode: 'live',
    status: 'budget_exhausted',
    corruptionRecovered: undefined,
    causalSourceIdentified: undefined,
    interactionCount: 0,
    costUsd: 0,
    recoverable: true,
    errorMessage: 'Budget exhausted before this domain started.',
    completedAt: new Date().toISOString(),
  };
}

function buildFailedDelegate52DomainRow(
  domain: string,
  err: unknown,
  recoverable: boolean,
  options: {
    sampleId?: string;
    model?: string;
    fallbackModel?: string;
    providerFallbackUsed?: boolean;
    primaryErrorMessage?: string;
  } = {},
): Delegate52DomainRow {
  return {
    domain,
    mode: 'live',
    status: recoverable ? 'failed_recoverable' : 'failed_unrecoverable',
    corruptionRecovered: false,
    causalSourceIdentified: false,
    interactionCount: 0,
    costUsd: 0,
    recoverable,
    errorMessage: errorMessage(err).slice(0, 2000),
    ...(options.sampleId ? { sampleId: options.sampleId } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.fallbackModel ? { fallbackModel: options.fallbackModel } : {}),
    ...(options.providerFallbackUsed !== undefined ? { providerFallbackUsed: options.providerFallbackUsed } : {}),
    ...(options.primaryErrorMessage ? { primaryErrorMessage: options.primaryErrorMessage } : {}),
    completedAt: new Date().toISOString(),
  };
}

function makeDefaultLlmCaller(isDryRun: boolean, modelOverride?: string): (prompt: string) => Promise<{ output: string; costUsd: number }> {
  if (isDryRun) {
    // Dry-run: simulate by returning the input document unchanged (passes round-trip equality trivially).
    return async (prompt: string) => {
      // Extract the document from the prompt (everything after the last "Document:" or "Edited document:")
      const docMarker = prompt.lastIndexOf('Edited document:\n');
      const fallbackMarker = prompt.lastIndexOf('Document:\n');
      const start = docMarker >= 0 ? docMarker + 'Edited document:\n'.length : fallbackMarker + 'Document:\n'.length;
      const doc = start > 0 ? prompt.slice(start).split('\n\nReference shape:')[0]!.trim() + '\n' : prompt;
      return { output: doc, costUsd: 0 };
    };
  }
  // Live default: dynamic-import callLLM and convert to our shape.
  // DANTEFORGE_DELEGATE52_MODEL overrides the global config provider so the live run uses Claude
  // even when the local danteforge config is pointed at Ollama. Without this override the live
  // gate passes (key/model checks use env vars) but the actual LLM call goes to the wrong target.
  return async (prompt: string) => {
    const { callLLM } = await import('./llm.js');
    const delegateModel = modelOverride ?? process.env.DANTEFORGE_DELEGATE52_MODEL ?? '';
    const providerOverride = delegateModel.startsWith('claude') ? 'claude'
      : delegateModel.startsWith('gpt') || delegateModel.startsWith('o1') || delegateModel.startsWith('o3') ? 'openai'
      : delegateModel.startsWith('gemini') ? 'gemini'
      : delegateModel.startsWith('grok') ? 'grok'
      : undefined;
    const output = await callLLM(prompt, providerOverride, { model: delegateModel || undefined });
    return { output, costUsd: estimateRoundTripCost(prompt, output) };
  };
}

function estimateRoundTripCost(prompt: string, output: string): number {
  // Conservative cost estimate: ~$3/M input tokens, ~$15/M output tokens (Claude Sonnet pricing).
  // 4 chars per token rough average.
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.ceil(output.length / 4);
  return (inputTokens * 3 / 1_000_000) + (outputTokens * 15 / 1_000_000);
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
