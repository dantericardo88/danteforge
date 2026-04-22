// Profile — model personality profiles: view learned behavioral patterns per model.
// Profiles are built automatically from DanteForge verification data.
// Stored in .danteforge/model-profiles/ (project-scoped, not committed).

import { loadState, saveState } from '../../core/state.js';
import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { resolveProvider } from '../../core/config.js';
import { ModelProfileEngine } from '../../core/model-profile-engine.js';
import { classifyTask } from '../../core/model-profile.js';

const PROFILE_DIR_MSG = 'Profiles are stored in .danteforge/model-profiles/ (project-scoped).';

/**
 * Main handler for `danteforge profile [subcommand] [arg]`.
 *
 * Subcommands:
 *   (none)            — Summary of current model's profile
 *   compare           — Side-by-side comparison of all profiled models
 *   report            — Full report for current or specified model
 *   weakness <model>  — Weaknesses for a specific model
 *   recommend <task>  — Which model is best for a task description
 */
export async function profile(
  subcommand?: string,
  arg?: string,
  options: {
    prompt?: boolean;
    _loadState?: typeof loadState;
    _saveState?: typeof saveState;
  } = {},
): Promise<void> {
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;

  return withErrorBoundary('profile', async () => {
    if (options.prompt) {
      showProfilePrompt(subcommand, arg);
      return;
    }

    const state = await loadFn();
    const timestamp = new Date().toISOString();
    const engine = new ModelProfileEngine(process.cwd());

    if (!subcommand || subcommand === 'summary') {
      await showCurrentModelSummary(engine);
      state.auditLog.push(`${timestamp} | profile: viewed current model summary`);
    } else if (subcommand === 'compare') {
      await showCompare(engine);
      state.auditLog.push(`${timestamp} | profile: viewed model comparison`);
    } else if (subcommand === 'report') {
      const modelKey = arg ?? await resolveCurrentModelKey();
      await showFullReport(engine, modelKey);
      state.auditLog.push(`${timestamp} | profile: viewed full report for ${modelKey}`);
    } else if (subcommand === 'weakness') {
      const modelKey = arg ?? await resolveCurrentModelKey();
      await showWeaknesses(engine, modelKey);
      state.auditLog.push(`${timestamp} | profile: viewed weaknesses for ${modelKey}`);
    } else if (subcommand === 'recommend') {
      if (!arg) {
        logger.error('Usage: danteforge profile recommend "<task description>"');
        return;
      }
      await showRecommendation(engine, arg);
      state.auditLog.push(`${timestamp} | profile: task recommendation for "${arg.slice(0, 50)}"`);
    } else {
      // Treat subcommand as a model key for direct model lookup
      await showModelSummary(engine, subcommand);
      state.auditLog.push(`${timestamp} | profile: viewed summary for ${subcommand}`);
    }

    await saveFn(state);
  });
}

// ── Subcommand Handlers ────────────────────────────────────────────────────────

async function showCurrentModelSummary(engine: ModelProfileEngine): Promise<void> {
  const { provider, model } = await resolveProvider();
  const modelKey = `${provider}:${model}`;
  logger.info(`Model Personality Profile — ${modelKey}`);
  logger.info('');
  await showModelSummary(engine, modelKey);
}

async function showModelSummary(engine: ModelProfileEngine, modelKey: string): Promise<void> {
  const p = await engine.getProfile(modelKey);
  if (!p) {
    logger.info(`No profile data yet for: ${modelKey}`);
    logger.info('');
    logger.info('Profiles are built automatically as DanteForge verifies tasks.');
    logger.info(PROFILE_DIR_MSG);
    return;
  }

  logger.info(`Model: ${p.modelKey}`);
  logger.info(`Total tasks profiled: ${p.totalTasks}`);
  logger.info(`Average PDSE: ${p.aggregate.averagePdse.toFixed(1)}`);
  logger.info(`First-pass success rate: ${(p.aggregate.firstPassSuccessRate * 100).toFixed(1)}%`);
  logger.info(`Stub violation rate: ${(p.aggregate.stubViolationRate * 100).toFixed(1)}%`);
  logger.info('');

  if (p.strengths.length > 0) {
    logger.success('Strengths:');
    for (const s of p.strengths) {
      logger.info(`  + ${s.category}: ${s.description}`);
    }
    logger.info('');
  }

  if (p.weaknesses.length > 0) {
    logger.warn('Weaknesses:');
    for (const w of p.weaknesses) {
      const comp = w.compensated ? ' [compensated]' : '';
      logger.info(`  - [${w.severity.toUpperCase()}] ${w.category}: ${w.description}${comp}`);
    }
    logger.info('');
  }

  if (p.weaknesses.length === 0 && p.strengths.length === 0) {
    logger.info(`Profile exists but needs more data for pattern detection (min 20 tasks, currently ${p.totalTasks}).`);
    logger.info('');
  }

  logger.info(`Run "danteforge profile report ${modelKey}" for full details.`);
}

async function showCompare(engine: ModelProfileEngine): Promise<void> {
  logger.info('Model Personality Profiles — Side-by-Side Comparison');
  logger.info('');

  const profiles = await engine.getAllProfiles();
  if (profiles.length === 0) {
    logger.info('No profiles found. Profiles are built automatically as DanteForge verifies tasks.');
    logger.info(PROFILE_DIR_MSG);
    return;
  }

  const sorted = [...profiles].sort((a, b) => b.aggregate.averagePdse - a.aggregate.averagePdse);

  // Header row
  const col = (s: string, w: number) => s.padEnd(w).slice(0, w);
  logger.info(
    `${col('Model', 32)} ${col('Tasks', 7)} ${col('Avg PDSE', 10)} ${col('1st-Pass', 10)} ${col('Stubs', 7)} Strengths`,
  );
  logger.info('─'.repeat(90));

  for (const p of sorted) {
    const strengths = p.strengths.map(s => s.category).join(', ') || '—';
    logger.info(
      `${col(p.modelKey, 32)} ${col(String(p.totalTasks), 7)} ${col(p.aggregate.averagePdse.toFixed(1), 10)} ${col((p.aggregate.firstPassSuccessRate * 100).toFixed(0) + '%', 10)} ${col((p.aggregate.stubViolationRate * 100).toFixed(0) + '%', 7)} ${strengths}`,
    );
  }

  logger.info('');
  logger.info(`${profiles.length} model(s) profiled.`);
  logger.info('Run "danteforge profile report <model>" for detailed analysis of any model.');
}

async function showFullReport(engine: ModelProfileEngine, modelKey: string): Promise<void> {
  logger.info(`Model Personality Profile Report — ${modelKey}`);
  logger.info('');
  const report = await engine.generateReport(modelKey);
  process.stdout.write(report + '\n');
}

async function showWeaknesses(engine: ModelProfileEngine, modelKey: string): Promise<void> {
  const p = await engine.getProfile(modelKey);
  if (!p) {
    logger.info(`No profile found for: ${modelKey}`);
    return;
  }

  logger.info(`Known Weaknesses — ${modelKey} (${p.totalTasks} tasks profiled)`);
  logger.info('');

  if (p.weaknesses.length === 0) {
    logger.success('No weaknesses detected yet.');
    logger.info(`Pattern detection requires at least 20 tasks (currently ${p.totalTasks}).`);
    return;
  }

  const byCategory = new Map<string, typeof p.weaknesses>();
  for (const w of p.weaknesses) {
    const list = byCategory.get(w.category) ?? [];
    list.push(w);
    byCategory.set(w.category, list);
  }

  for (const [cat, weaknesses] of byCategory) {
    logger.info(`## ${cat}`);
    for (const w of weaknesses) {
      const comp = w.compensated ? ' ✓' : ' (not compensated)';
      logger.info(`  [${w.severity.toUpperCase()}] ${w.description}${comp}`);
      logger.info(`  Seen ${w.occurrenceCount}x | Last: ${w.lastSeen.slice(0, 10)}`);
      if (w.rootCause) logger.info(`  Root cause: ${w.rootCause}`);
    }
    logger.info('');
  }

  const activeComps = p.compensations.filter(c =>
    p.weaknesses.some(w => w.id === c.weaknessId),
  );
  if (activeComps.length > 0) {
    logger.info('Active compensating instructions:');
    for (const c of activeComps) {
      logger.info(`  [${c.appliesTo.join(', ')}] ${c.instruction.slice(0, 100)}...`);
    }
  }
}

async function showRecommendation(engine: ModelProfileEngine, taskDescription: string): Promise<void> {
  logger.info(`Model Recommendation for: "${taskDescription}"`);
  logger.info('');

  const categories = classifyTask(taskDescription);
  logger.info(`Task categories: ${categories.join(', ')}`);
  logger.info('');

  const allProfiles = await engine.getAllProfiles();
  if (allProfiles.length === 0) {
    logger.info('No profiles available yet. Run some tasks with DanteForge to build profiles.');
    return;
  }

  const availableModels = allProfiles.map(p => p.modelKey);
  const rankings = await engine.rankModelsForTask(taskDescription, availableModels);

  if (rankings.length === 0) {
    logger.info('No profiles have sufficient data for this task type yet.');
    logger.info(`Profiled models: ${availableModels.join(', ')}`);
    return;
  }

  logger.info('Ranked recommendations:');
  logger.info('');

  for (let i = 0; i < rankings.length; i++) {
    const r = rankings[i]!;
    const confidence = r.confidence >= 0.8 ? 'high' : r.confidence >= 0.5 ? 'medium' : 'low';
    logger.info(`${i + 1}. ${r.modelKey}`);
    logger.info(`   Predicted PDSE: ${r.predictedPdse.toFixed(1)} | Confidence: ${confidence} (${(r.confidence * 100).toFixed(0)}%)`);
    logger.info(`   ${r.reasoning}`);
    if (r.compensations.length > 0) {
      logger.info(`   Compensations to inject: ${r.compensations.length}`);
      logger.info(`   → ${r.compensations[0]!.slice(0, 100)}...`);
    }
    logger.info('');
  }
}

// ── Prompt Mode ────────────────────────────────────────────────────────────────

function showProfilePrompt(subcommand?: string, arg?: string): void {
  const target = arg ?? subcommand ?? 'current model';
  const prompt = `## DanteForge Model Personality Profile Query

You are reviewing model behavioral profiles to understand which LLM performs best on specific task categories.

**Request:** Analyze the profile for ${target}.

**Profile Data:** Check .danteforge/model-profiles/ for JSON files containing:
- Aggregate PDSE scores, first-pass success rates, stub violation rates
- Category-level stats (authentication, database, api, testing, ui, etc.)
- Weakness patterns and compensating instructions
- Strength patterns by category

**Output Required:**
1. Summary of overall model performance
2. Top 3 category strengths with evidence
3. Top 3 weaknesses with severity and compensation status
4. Routing recommendation: which task types to prefer this model for
5. Any active compensating instructions for known weak areas

Be specific, data-driven, and actionable.`;

  process.stdout.write(prompt + '\n');
}

// ── Utilities ──────────────────────────────────────────────────────────────────

async function resolveCurrentModelKey(): Promise<string> {
  const { provider, model } = await resolveProvider();
  return `${provider}:${model}`;
}
