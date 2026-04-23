// Sprint Plan — autonomous next-sprint generator + self-critiquing planner.
// Reads all project state (convergence, harvest queue, attribution log, lessons)
// and generates a focused sprint plan in markdown. Then runs the plan critic
// on the generated plan automatically. The full planning loop in one command.
//
// Usage: danteforge sprint-plan [--cycles <n>] [--stakes high] [--auto-approve]

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import { loadConvergence, type ConvergenceState } from '../../core/convergence.js';
import { loadHarvestQueue, type HarvestQueue } from '../../core/harvest-queue.js';
import { loadAttributionLog, getHighROICategories, type AttributionLog } from '../../core/causal-attribution.js';
import { queryLibrary, type GlobalPatternEntry } from '../../core/global-pattern-library.js';
import { critiquePlan, printCritiqueReport, type CritiqueStakes } from '../../core/plan-critic.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SprintPlanOptions {
  cwd?: string;
  /** Maximum harvest-forge cycles in the generated plan (default: 5) */
  maxCycles?: number;
  /** Critique stakes level (default: high — before builds, be thorough) */
  stakes?: CritiqueStakes;
  /** Skip running plan critic after generation */
  skipCritique?: boolean;
  /** Auto-approve plan even if blocking gaps found (for CI/pipeline use) */
  autoApprove?: boolean;
  /** Inject for testing */
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _loadConvergence?: (cwd?: string) => Promise<ConvergenceState | null>;
  _loadQueue?: (cwd?: string) => Promise<HarvestQueue>;
  _loadAttributionLog?: (cwd?: string) => Promise<AttributionLog>;
  _queryLibrary?: (opts: { category?: string; limit?: number }) => Promise<GlobalPatternEntry[]>;
  _writeFile?: (filePath: string, content: string) => Promise<void>;
  _readFile?: (filePath: string) => Promise<string>;
}

export interface SprintPlanResult {
  planMarkdown: string;
  planPath: string;
  critiquePassed: boolean;
  blockingGapCount: number;
  /** Dimensions identified as the highest-priority targets for this sprint */
  focusDimensions: string[];
  /** Estimated cycles to close open gaps at current improvement rate */
  estimatedCyclesToConverge: number;
}

// ── State summarizer ──────────────────────────────────────────────────────────

interface ProjectState {
  convergence: ConvergenceState | null;
  queue: HarvestQueue;
  attribution: AttributionLog;
  topLibraryPatterns: GlobalPatternEntry[];
  highROICategories: string[];
  openGaps: Array<{ dimension: string; score: number; gap: number }>;
  queuedRepos: number;
  totalCycles: number;
  totalCostUsd: number;
  avgImprovementPerCycle: number;
  adoptedCount: number;
}

async function gatherState(opts: SprintPlanOptions, cwd: string): Promise<ProjectState> {
  const loadConv = opts._loadConvergence ?? loadConvergence;
  const loadQueue = opts._loadQueue ?? loadHarvestQueue;
  const loadLog = opts._loadAttributionLog ?? loadAttributionLog;
  const queryLib = opts._queryLibrary ?? ((o: { category?: string; limit?: number }) => queryLibrary(o));

  const [convergence, queue, attribution, topLibraryPatterns] = await Promise.all([
    loadConv(cwd).catch((): null => null),
    loadQueue(cwd).catch((): HarvestQueue => ({ version: '1.0.0', repos: [], gaps: [], updatedAt: new Date().toISOString(), harvestCycles: 0, totalPatternsExtracted: 0, totalPatternsAdopted: 0 })),
    loadLog(cwd).catch((): AttributionLog => ({ version: '1.0.0', records: [], updatedAt: new Date().toISOString() })),
    queryLib({ limit: 5 }).catch((): GlobalPatternEntry[] => []),
  ]);

  const highROICategories = getHighROICategories(attribution);

  const openGaps = (convergence?.dimensions ?? [])
    .filter(d => !d.converged)
    .map(d => ({
      dimension: d.dimension,
      score: d.score,
      gap: (convergence?.targetScore ?? 9.0) - d.score,
    }))
    .sort((a, b) => b.gap - a.gap);

  const totalCycles = convergence?.lastCycle ?? 0;
  const totalCostUsd = convergence?.totalCostUsd ?? 0;

  // Compute average improvement per cycle from cycle history
  const cycleHistory = convergence?.cycleHistory ?? [];
  let avgImprovementPerCycle = 0;
  if (cycleHistory.length >= 2) {
    const improvements = cycleHistory.slice(-5).map(c => {
      const before = Object.values(c.scoresBefore);
      const after = Object.values(c.scoresAfter);
      if (before.length === 0 || after.length !== before.length) return 0;
      const avgBefore = before.reduce((a, b) => a + b, 0) / before.length;
      const avgAfter = after.reduce((a, b) => a + b, 0) / after.length;
      return avgAfter - avgBefore;
    });
    avgImprovementPerCycle = improvements.reduce((a, b) => a + b, 0) / improvements.length;
  }

  const adoptedCount = convergence?.adoptedPatternsSummary?.length ?? 0;

  return {
    convergence,
    queue,
    attribution,
    topLibraryPatterns,
    highROICategories,
    openGaps,
    queuedRepos: queue.repos.filter(r => r.status === 'queued' || r.status === 'shallow').length,
    totalCycles,
    totalCostUsd,
    avgImprovementPerCycle,
    adoptedCount,
  };
}

// ── Plan prompt builder ───────────────────────────────────────────────────────

function buildSprintPlanPrompt(state: ProjectState, maxCycles: number): string {
  const gapList = state.openGaps.slice(0, 8)
    .map(g => `- ${g.dimension}: score ${g.score.toFixed(1)} (gap ${g.gap.toFixed(1)})`)
    .join('\n') || '- No open gaps detected — all dimensions may be at target';

  const roiList = state.highROICategories.slice(0, 5)
    .map(cat => `- ${cat}: high ROI (from attribution log)`)
    .join('\n') || '- No attribution data yet (run with --attribution to collect)';

  const queueInfo = state.queuedRepos > 0
    ? `${state.queuedRepos} repos queued for harvest`
    : 'Harvest queue empty — oss-intel needed to discover repos';

  const libraryPatterns = state.topLibraryPatterns.length > 0
    ? state.topLibraryPatterns.map(p => `- ${p.patternName} (ROI: ${(p.avgRoi * 100).toFixed(0)}%, complexity: ${p.adoptionComplexity})`).join('\n')
    : '- Global library empty or not accessible';

  const velocityNote = state.avgImprovementPerCycle > 0
    ? `Current velocity: +${state.avgImprovementPerCycle.toFixed(2)} score/cycle`
    : 'No velocity data yet (need at least 2 completed cycles)';

  return `You are a senior engineering architect generating a focused sprint plan for an AI-powered code quality tool.

## Current Project State

**Open Quality Gaps** (sorted by priority):
${gapList}

**High-ROI Pattern Categories** (from causal attribution):
${roiList}

**OSS Harvest Status**: ${queueInfo}

**Global Pattern Library** (top available patterns):
${libraryPatterns}

**Progress**: ${state.totalCycles} cycles completed, ${state.adoptedCount} patterns adopted, $${state.totalCostUsd.toFixed(2)} spent
**${velocityNote}**

## Your Task

Generate a focused sprint plan in markdown that:
1. Targets the top 3 open gaps by ROI (highest gap × highest historical ROI)
2. Specifies 1-3 harvest-forge waves, each with a clear goal and acceptance criteria
3. Includes one oss-intel refresh if queue has < 5 repos
4. Lists explicit verification gates (which dimension scores must reach what values)
5. Caps the plan at ${maxCycles} harvest-forge cycles maximum
6. Calls out any patterns from the global library that should be adopted before running forge

## REQUIRED Format

Output ONLY this markdown structure (no preamble):

# Sprint [N]: [Short Goal Title]

## Target Dimensions
- [dimension]: [current] → [target]

## Waves

### Wave 1: [Goal]
- **Actions**: [specific commands to run]
- **Patterns to adopt**: [from global library, or 'none pre-loaded']
- **Acceptance criteria**: [measurable score thresholds]
- **Max cycles**: [N]

### Wave 2: [Goal] (if needed)
...

## Verification Gate
- [dimension] ≥ [score]
- All gates must pass before marking sprint complete

## Estimated Cost
~$[N] at current token rates

## Definition of Done
[2-3 sentences: what success looks like for this sprint]`;
}

function deterministicSprintPlan(state: ProjectState, maxCycles: number): string {
  const now = new Date().toISOString().slice(0, 10);
  const sprintNum = state.totalCycles + 1;

  const topGaps = state.openGaps.slice(0, 3);
  const targetDimensions = topGaps.length > 0
    ? topGaps.map(g => `- ${g.dimension}: ${g.score.toFixed(1)} → ${(g.score + Math.min(g.gap, 2.0)).toFixed(1)}`).join('\n')
    : '- No open gaps — run universe-scan to discover dimensions';

  const verificationGates = topGaps.length > 0
    ? topGaps.map(g => `- ${g.dimension} ≥ ${(g.score + Math.min(g.gap * 0.5, 1.0)).toFixed(1)}`).join('\n')
    : '- Run universe-scan to establish baseline';

  const needsOssIntel = state.queuedRepos < 5;

  return `# Sprint ${sprintNum}: ${topGaps.length > 0 ? `Close ${topGaps[0]!.dimension} Gap` : 'Discover Dimensions'}

*Generated: ${now} (deterministic fallback — LLM unavailable)*

## Target Dimensions
${targetDimensions}

## Waves

### Wave 1: ${needsOssIntel ? 'OSS Discovery' : 'Pattern Adoption'}
- **Actions**: ${needsOssIntel ? 'danteforge oss-intel --max-repos 10\ndanteforge harvest-forge --auto --max-cycles 3' : 'danteforge harvest-forge --auto --attribution --max-cycles 3'}
- **Patterns to adopt**: from global library if available, else from harvest queue
- **Acceptance criteria**: at least 1 pattern adopted per targeted dimension
- **Max cycles**: ${Math.min(maxCycles, 3)}

${topGaps.length > 1 ? `### Wave 2: Consolidate Gains
- **Actions**: danteforge harvest-forge --auto --max-cycles ${Math.min(maxCycles - 3, 2)}
- **Acceptance criteria**: all target dimensions improve by ≥ 0.5
- **Max cycles**: ${Math.min(maxCycles - 3, 2)}
` : ''}
## Verification Gate
${verificationGates}

## Estimated Cost
~$${(state.queuedRepos * 0.05 + 0.15).toFixed(2)} at current token rates

## Definition of Done
Target dimensions each improve by at least 0.5 points. All verification gates pass. Sprint closes with danteforge certify.`;
}

// ── Plan generator ────────────────────────────────────────────────────────────

async function generateSprintPlanMarkdown(state: ProjectState, maxCycles: number, opts: SprintPlanOptions): Promise<string> {
  const isAvailable = opts._isLLMAvailable ?? (async () => {
    try { const { isLLMAvailable } = await import('../../core/llm.js'); return isLLMAvailable(); } catch { return false; }
  });
  const llmAvailable = await isAvailable().catch(() => false);
  if (!llmAvailable) {
    logger.info('[sprint-plan] LLM unavailable — generating deterministic plan');
    return deterministicSprintPlan(state, maxCycles);
  }
  try {
    const llm = opts._llmCaller ?? (async (p: string) => {
      const { callLLM } = await import('../../core/llm.js');
      return callLLM(p);
    });
    logger.info('[sprint-plan] Generating plan with LLM...');
    const result = await llm(buildSprintPlanPrompt(state, maxCycles));
    return result.trim().startsWith('#') ? result : `# Sprint Plan\n\n${result}`;
  } catch (err) {
    logger.warn(`[sprint-plan] LLM failed — using deterministic plan: ${err instanceof Error ? err.message : String(err)}`);
    return deterministicSprintPlan(state, maxCycles);
  }
}

// ── Main entry ────────────────────────────────────────────────────────────────

export async function runSprintPlan(opts: SprintPlanOptions = {}): Promise<SprintPlanResult> {
  const cwd = opts.cwd ?? process.cwd();
  const maxCycles = opts.maxCycles ?? 5;
  const stakes = opts.stakes ?? 'high';

  const writeFile = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));

  logger.info('[sprint-plan] Gathering project state...');
  const state = await gatherState(opts, cwd);

  const focusDimensions = state.openGaps.slice(0, 3).map(g => g.dimension);
  const largestGap = state.openGaps[0]?.gap ?? 0;
  const estimatedCyclesToConverge = state.avgImprovementPerCycle > 0
    ? Math.ceil(largestGap / state.avgImprovementPerCycle)
    : (largestGap > 0 ? 10 : 0);

  const planMarkdown = await generateSprintPlanMarkdown(state, maxCycles, opts);

  // Save plan to file
  const planDir = path.join(cwd, '.danteforge', 'sprint-plans');
  await fs.mkdir(planDir, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const planPath = path.join(planDir, `sprint-plan-${timestamp}.md`);
  await writeFile(planPath, planMarkdown);
  logger.info(`[sprint-plan] Plan saved to: ${path.relative(cwd, planPath)}`);

  // Auto-run plan critic on the generated plan
  let critiquePassed = true;
  let blockingGapCount = 0;

  if (!opts.skipCritique) {
    logger.info('[sprint-plan] Running plan critic on generated plan...');
    const critiqueReport = await critiquePlan({
      cwd,
      planContent: planMarkdown,
      stakes,
      enablePremortem: false, // Skip pre-mortem for self-generated plans (reduces noise)
      _llmCaller: opts._llmCaller,
      _isLLMAvailable: opts._isLLMAvailable,
    });

    printCritiqueReport(critiqueReport);

    blockingGapCount = critiqueReport.blockingCount;
    critiquePassed = critiqueReport.approved || !!opts.autoApprove;

    if (!critiqueReport.approved) {
      if (opts.autoApprove) {
        logger.warn(`[sprint-plan] ${blockingGapCount} blocking gap(s) found but --auto-approve set — proceeding`);
      } else {
        logger.error(`[sprint-plan] Plan has ${blockingGapCount} blocking gap(s) — revise before executing`);
        logger.info(`[sprint-plan] Plan saved to: ${path.relative(cwd, planPath)} — edit and re-run critique-plan`);
      }
    } else {
      logger.success('[sprint-plan] ✓ Plan approved by critic — ready to execute');
    }
  }

  // Print summary
  logger.info('');
  logger.info('═══════════════════════════════════════════════');
  logger.info('  SPRINT PLAN SUMMARY');
  logger.info('═══════════════════════════════════════════════');
  if (focusDimensions.length > 0) {
    logger.info(`  Focus dimensions: ${focusDimensions.join(', ')}`);
  }
  if (estimatedCyclesToConverge > 0) {
    logger.info(`  Estimated cycles to converge: ${estimatedCyclesToConverge}`);
  }
  logger.info(`  Critique: ${critiquePassed ? '✓ approved' : '✗ blocked'}`);
  logger.info(`  Plan: ${path.relative(cwd, planPath)}`);
  logger.info('═══════════════════════════════════════════════');

  return {
    planMarkdown,
    planPath,
    critiquePassed,
    blockingGapCount,
    focusDimensions,
    estimatedCyclesToConverge,
  };
}
