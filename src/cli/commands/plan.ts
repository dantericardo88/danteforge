import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, recordWorkflowStage, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { displayPrompt, savePrompt } from '../../core/prompt-builder.js';
import { requireClarify, requireSpec, runGate } from '../../core/gates.js';
import { buildLocalPlan, writeArtifact } from '../../core/local-artifacts.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { critiquePlan, printCritiqueReport, type CritiqueStakes } from '../../core/plan-critic.js';
import { scorePlan, type PlanQualityResult } from '../../core/plan-quality-scorer.js';
import { saveSpecHash } from '../../core/spec-drift-detector.js';
import { recordStage } from '../../core/pipeline-tracker.js';

const STATE_DIR = '.danteforge';
const PLAN_QUALITY_THRESHOLD = 7.0;

export interface PlanOptions {
  prompt?: boolean;
  light?: boolean;
  skipCritique?: boolean;
  /** Skip plan quality scoring (e.g. in fast/light mode) */
  noScore?: boolean;
  stakes?: string;
  /** Injection seam — overrides critiquePlan for testing */
  _critiquePlan?: typeof critiquePlan;
  /** Injection seam — overrides scorePlan for testing */
  _scorePlan?: typeof scorePlan;
}

export async function plan(options: PlanOptions = {}) {
  return withErrorBoundary('plan', async () => {
  // --- Decision-node: record start (best-effort) ---
  let _dnStartNodeId: string | undefined;
  const _dnT0 = Date.now();
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    const _dnStart = await recordDecision({ session: _dnSess, actorType: 'agent', prompt: 'plan: generate implementation plan', context: { workflowStage: 'plan' }, result: 'in-progress', success: false });
    _dnStartNodeId = _dnStart.id;
  } catch { /* never block */ }

  if (!(await runGate(() => requireSpec(options.light)))) { process.exitCode = 1; return; }
  if (!(await runGate(() => requireClarify(options.light)))) { process.exitCode = 1; return; }

  logger.info('Generating detailed plan from spec...');

  const state = await loadState();

  let specContent = '';
  let currentState = '';
  try {
    specContent = await fs.readFile(path.join(STATE_DIR, 'SPEC.md'), 'utf8');
  } catch {}
  try {
    currentState = await fs.readFile(path.join(STATE_DIR, 'CURRENT_STATE.md'), 'utf8');
  } catch {}

  const prompt = `You are a senior software architect creating a detailed implementation plan.

${state.constitution ? `Project principles:\n${state.constitution}\n` : ''}
${specContent ? `Specification:\n${specContent.slice(0, 3000)}\n` : '(No spec found - generate a general plan)'}
${currentState ? `Current project state:\n${currentState.slice(0, 2000)}\n` : ''}

Generate a detailed PLAN.md with:
1. **Architecture Overview** - system diagram, key components, data flow
2. **Implementation Phases** - ordered steps with dependencies
3. **Technology Decisions** - frameworks, libraries, patterns with rationale
4. **Risk Mitigations** - identified risks and countermeasures
5. **Testing Strategy** - unit, integration, e2e approach
6. **Timeline** - relative effort estimates per phase (S/M/L/XL)

Output ONLY the markdown content - no preamble.`;

  if (options.prompt) {
    const savedPath = await savePrompt('plan', prompt);
    displayPrompt(prompt, [
      'Paste into your LLM, then run: danteforge import <file> --as PLAN.md',
      `Prompt saved to: ${savedPath}`,
    ].join('\n'));
    state.auditLog.push(`${new Date().toISOString()} | plan: prompt generated`);
    await saveState(state);
    return;
  }

  const llmAvailable = await isLLMAvailable();
  if (llmAvailable) {
    logger.info('Sending to LLM for plan generation...');
    try {
      const planMd = await callLLM(prompt, undefined, { enrichContext: true });
      await writeArtifact('PLAN.md', planMd);

      // Plan quality score (skip with --no-score)
      if (!options.noScore) {
        await runQualityScore(planMd, specContent, options);
      }

      // Auto-critique gate (skip with --skip-critique)
      if (!options.skipCritique) {
        await runCritiqueGate(planMd, options, state);
        if (process.exitCode === 1) return;
      }

      const timestamp = recordWorkflowStage(state, 'plan');
      state.auditLog.push(`${timestamp} | plan: PLAN.md generated via API`);
      await saveState(state);

      // Save spec hash for drift detection (best-effort)
      try { await saveSpecHash(); } catch { /* best-effort */ }
      // Record pipeline stage (best-effort)
      try { await recordStage('plan'); } catch { /* best-effort */ }

      logger.success('PLAN.md generated - run "danteforge tasks" to break it into executable tasks');
      return;
    } catch (err) {
      logger.warn(`API call failed: ${err instanceof Error ? err.message : String(err)}`);
      logger.info('Falling back to local artifact generation...');
    }
  }

  const localPlan = buildLocalPlan(specContent, state.constitution, currentState);
  await writeArtifact('PLAN.md', localPlan);

  // Plan quality score (skip with --no-score)
  if (!options.noScore) {
    await runQualityScore(localPlan, specContent, options);
  }

  // Auto-critique gate on local plan too (skip with --skip-critique)
  if (!options.skipCritique) {
    await runCritiqueGate(localPlan, options, state);
    if (process.exitCode === 1) return;
  }

  const timestamp = recordWorkflowStage(state, 'plan');
  state.auditLog.push(`${timestamp} | plan: PLAN.md generated locally`);
  await saveState(state);

  // Save spec hash for drift detection (best-effort)
  try { await saveSpecHash(); } catch { /* best-effort */ }
  // Record pipeline stage (best-effort)
  try { await recordStage('plan'); } catch { /* best-effort */ }

  logger.success('PLAN.md generated locally - run "danteforge tasks" to break it into executable tasks');
  if (!llmAvailable) {
    logger.info('Tip: Set up an API key for richer plans: danteforge config --set-key "grok:<key>"');
  }

  // --- Decision-node: record completion (best-effort) ---
  try {
    const { getSession, recordDecision } = await import('../../core/decision-node-recorder.js');
    const _dnSess = getSession();
    await recordDecision({ session: _dnSess, parentNodeId: _dnStartNodeId, actorType: 'agent', prompt: 'plan: generate implementation plan [complete]', result: 'PLAN.md written', success: true, latencyMs: Date.now() - _dnT0 });
  } catch { /* best-effort */ }
  });
}

// ── Plan quality score (internal) ─────────────────────────────────────────────

function printQualityTable(result: PlanQualityResult): void {
  const bar = (score: number): string => {
    const filled = Math.round(score);
    return '█'.repeat(filled) + '░'.repeat(10 - filled);
  };
  const fmt = (score: number): string => score.toFixed(1).padStart(4);

  logger.info('\n  PLAN QUALITY SCORE');
  logger.info('  ' + '─'.repeat(52));
  logger.info(`  ${'Dimension'.padEnd(26)} Score  Graph`);
  logger.info('  ' + '─'.repeat(52));

  const dims: Array<[string, number]> = [
    ['Spec Coverage',          result.specCoverage],
    ['Task Granularity',       result.taskGranularity],
    ['Dependency Ordering',    result.dependencyOrdering],
    ['Estimation Present',     result.estimationPresent],
    ['Acceptance Criteria',    result.acceptanceCriteria],
  ];

  for (const [label, score] of dims) {
    logger.info(`  ${label.padEnd(26)}${fmt(score)} / 10  ${bar(score)}`);
  }

  logger.info('  ' + '─'.repeat(52));
  logger.info(`  ${'Overall Score'.padEnd(26)}${fmt(result.overallScore)} / 10`);
  logger.info('');
}

async function runQualityScore(
  planContent: string,
  specContent: string,
  options: PlanOptions,
): Promise<void> {
  try {
    const scorer = options._scorePlan ?? scorePlan;
    const result = scorer(planContent, specContent);
    printQualityTable(result);

    if (result.overallScore < PLAN_QUALITY_THRESHOLD) {
      logger.warn(`[plan] Quality score ${result.overallScore.toFixed(1)} is below threshold (${PLAN_QUALITY_THRESHOLD}). Consider refining.`);
      for (const s of result.suggestions) {
        logger.warn(`  - ${s}`);
      }
    } else {
      logger.info(`[plan] Quality score ${result.overallScore.toFixed(1)} meets threshold.`);
    }
  } catch (err) {
    // Quality scoring is best-effort — never block the plan command
    logger.warn(`[plan] Quality scoring failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Critique gate (internal) ──────────────────────────────────────────────────

async function runCritiqueGate(
  planContent: string,
  options: PlanOptions,
  state: Awaited<ReturnType<typeof loadState>>,
): Promise<void> {
  try {
    const validStakes = ['low', 'medium', 'high', 'critical'];
    const stakes: CritiqueStakes = validStakes.includes(options.stakes ?? '')
      ? (options.stakes as CritiqueStakes)
      : 'medium';

    logger.info('[plan] Running critique gate...');
    const criticFn = options._critiquePlan ?? critiquePlan;
    const report = await criticFn({ planContent, stakes, enablePremortem: false });

    printCritiqueReport(report);

    const timestamp = new Date().toISOString();
    state.auditLog.push(
      `${timestamp} | plan-critique: ${report.blockingCount} blocking, ${report.highCount} high gaps`,
    );

    if (!report.approved) {
      logger.warn('[plan] Critique found blocking gaps — resolve before running "danteforge tasks".');
      logger.warn('[plan] Use --skip-critique to bypass (not recommended).');
      process.exitCode = 1;
    }
  } catch (err) {
    // Critique is best-effort — never block the plan command from completing
    logger.warn(`[plan] Critique failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`);
  }
}
