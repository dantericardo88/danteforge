// Next — "What Now?" strategic advisor.
// Reads convergence state, harvest queue, and attribution log to generate
// the highest-ROI next action. Three modes: LLM / promptMode / local heuristics.

import { logger } from '../../core/logger.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { loadConvergence, type ConvergenceState } from '../../core/convergence.js';
import { loadHarvestQueue, type HarvestQueue } from '../../core/harvest-queue.js';
import { loadAttributionLog, type AttributionLog } from '../../core/causal-attribution.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NextOptions {
  cwd?: string;
  promptMode?: boolean;
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _loadConvergence?: (cwd?: string) => Promise<ConvergenceState | null>;
  _loadQueue?: (cwd?: string) => Promise<HarvestQueue>;
  _loadAttributionLog?: (cwd?: string) => Promise<AttributionLog>;
}

export interface NextRecommendation {
  topAction: string;
  reasoning: string;
  alternatives: string[];
  estimatedImpact: string;
}

// ── Context building ──────────────────────────────────────────────────────────

interface NextContext {
  openGaps: Array<{ dimension: string; score: number; target: number }>;
  queuedRepos: Array<{ slug: string; priority: number; gapTargets: string[] }>;
  highRoiPatterns: Array<{ name: string; sourceRepo: string; delta: number }>;
}

function buildContext(
  convergence: ConvergenceState | null,
  queue: HarvestQueue,
  attribution: AttributionLog,
): NextContext {
  const target = convergence?.targetScore ?? 9.0;

  const openGaps = (convergence?.dimensions ?? [])
    .filter((d) => d.score < target)
    .map((d) => ({ dimension: d.dimension, score: d.score, target }))
    .sort((a, b) => a.score - b.score);

  const queuedRepos = queue.repos
    .filter((r) => r.status === 'queued')
    .map((r) => ({ slug: r.slug, priority: r.priority, gapTargets: r.gapTargets }))
    .sort((a, b) => b.priority - a.priority);

  const highRoiPatterns = attribution.records
    .filter((r) => r.verifyStatus === 'pass' && r.scoreDelta > 0)
    .sort((a, b) => b.scoreDelta - a.scoreDelta)
    .slice(0, 5)
    .map((r) => ({ name: r.patternName, sourceRepo: r.sourceRepo, delta: r.scoreDelta }));

  return { openGaps, queuedRepos, highRoiPatterns };
}

// ── Local heuristics ──────────────────────────────────────────────────────────

function localRecommendation(ctx: NextContext): NextRecommendation {
  const { openGaps, queuedRepos } = ctx;

  // Highest priority: harvest queued repos if there are open gaps they address
  if (queuedRepos.length > 0) {
    const top = queuedRepos[0];
    const gapStr = top.gapTargets.slice(0, 2).join(', ') || 'quality gaps';
    return {
      topAction: `Run oss-intel to harvest ${top.slug}`,
      reasoning: `Queue contains ${queuedRepos.length} unprocessed repo(s). "${top.slug}" (priority ${top.priority}) targets: ${gapStr}.`,
      alternatives: [
        openGaps.length > 0
          ? `Focus autoforge on ${openGaps[0].dimension} (score ${openGaps[0].score.toFixed(1)})`
          : 'Run universe-scan to discover new improvement dimensions',
        'Run assess to refresh dimension scores before acting',
      ],
      estimatedImpact: `Closes up to ${top.gapTargets.length} open gap dimension(s), adds adoption candidates`,
    };
  }

  // Second priority: lowest-score open gap
  if (openGaps.length > 0) {
    const worst = openGaps[0];
    return {
      topAction: `Focus autoforge on ${worst.dimension} (score ${worst.score.toFixed(1)})`,
      reasoning: `No queued repos remain. Dimension "${worst.dimension}" is the furthest below target ${worst.target}.`,
      alternatives: [
        'Run universe-scan to discover new improvement dimensions',
        openGaps.length > 1
          ? `Also address ${openGaps[1].dimension} (score ${openGaps[1].score.toFixed(1)})`
          : 'Run oss-intel to queue new repos targeting remaining gaps',
      ],
      estimatedImpact: `Raises worst dimension from ${worst.score.toFixed(1)} toward target ${worst.target}`,
    };
  }

  // Fallback: all dimensions converged or no state yet
  return {
    topAction: 'Run universe-scan to discover new improvement dimensions',
    reasoning: 'No open gaps or queued repos found. Expand the improvement frontier.',
    alternatives: [
      'Run assess to verify all dimensions are truly at target',
      'Run oss-intel with a new gap dimension to seed the queue',
    ],
    estimatedImpact: 'Discovers 2-5 new improvement dimensions to sustain compounding gains',
  };
}

// ── LLM recommendation ────────────────────────────────────────────────────────

function buildPrompt(ctx: NextContext): string {
  return `You are a strategic advisor for a software quality improvement system.

Current state:
- Open gaps (sorted worst first): ${JSON.stringify(ctx.openGaps, null, 2)}
- Queued repos to harvest: ${JSON.stringify(ctx.queuedRepos, null, 2)}
- Highest-ROI patterns from attribution log: ${JSON.stringify(ctx.highRoiPatterns, null, 2)}

Generate the single highest-ROI next action as JSON matching this exact schema:
{
  "topAction": "string — specific actionable command or task",
  "reasoning": "string — 1-2 sentences explaining why this is highest ROI",
  "alternatives": ["string", "string"],
  "estimatedImpact": "string — concrete outcome (closes N gaps, raises score by X)"
}

Respond with only the JSON object, no markdown fences.`;
}

function parseRecommendation(raw: string, fallback: NextRecommendation): NextRecommendation {
  try {
    const trimmed = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    const parsed = JSON.parse(trimmed) as Partial<NextRecommendation>;
    if (
      typeof parsed.topAction === 'string' &&
      typeof parsed.reasoning === 'string' &&
      Array.isArray(parsed.alternatives) &&
      typeof parsed.estimatedImpact === 'string'
    ) {
      return parsed as NextRecommendation;
    }
  } catch {
    // fall through to fallback
  }
  return fallback;
}

// ── Prompt text (copy-paste mode) ─────────────────────────────────────────────

function buildPromptModeOutput(ctx: NextContext): string {
  return [
    '── Next Action Advisor ───────────────────────────────────────',
    'Paste the following into your LLM of choice:',
    '',
    buildPrompt(ctx),
  ].join('\n');
}

// ── Main export ───────────────────────────────────────────────────────────────

export async function runNext(options: NextOptions = {}): Promise<NextRecommendation> {
  const { cwd, promptMode = false } = options;

  const loadConv = options._loadConvergence ?? loadConvergence;
  const loadQueue = options._loadQueue ?? loadHarvestQueue;
  const loadLog = options._loadAttributionLog ?? loadAttributionLog;
  const checkLLM = options._isLLMAvailable ?? isLLMAvailable;
  const caller = options._llmCaller ?? callLLM;

  const [convergence, queue, attribution] = await Promise.all([
    loadConv(cwd).catch(() => null),
    loadQueue(cwd).catch((): HarvestQueue => ({
      version: '1.0.0',
      repos: [],
      gaps: [],
      harvestCycles: 0,
      totalPatternsExtracted: 0,
      totalPatternsAdopted: 0,
      updatedAt: new Date().toISOString(),
    })),
    loadLog(cwd).catch((): AttributionLog => ({
      version: '1.0.0',
      records: [],
      updatedAt: new Date().toISOString(),
    })),
  ]);

  const ctx = buildContext(convergence, queue, attribution);
  const heuristic = localRecommendation(ctx);

  if (promptMode) {
    logger.info(buildPromptModeOutput(ctx));
    return heuristic;
  }

  const llmAvailable = await checkLLM().catch(() => false);

  let recommendation: NextRecommendation;
  if (llmAvailable) {
    try {
      const raw = await caller(buildPrompt(ctx));
      recommendation = parseRecommendation(raw, heuristic);
    } catch {
      recommendation = heuristic;
    }
  } else {
    recommendation = heuristic;
  }

  logger.info('── What Now? ─────────────────────────────────────────────────');
  logger.info(`Top Action : ${recommendation.topAction}`);
  logger.info(`Reasoning  : ${recommendation.reasoning}`);
  logger.info(`Impact     : ${recommendation.estimatedImpact}`);
  if (recommendation.alternatives.length > 0) {
    logger.info('Alternatives:');
    for (const alt of recommendation.alternatives) {
      logger.info(`  • ${alt}`);
    }
  }

  return recommendation;
}
