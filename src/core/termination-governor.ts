import { CompletionVerdict } from './completion-oracle.js';
import { ResidualGapReport } from './residual-gap-miner.js';

export interface TerminationDecision {
  terminate: boolean;
  reason: string;
  confidence: number; // 0-1, how confident we are in this decision
  nextActions?: string[];
  blockerDescription?: string;
}

export interface TerminationContext {
  cycleCount: number;
  maxCycles: number;
  verdict: CompletionVerdict;
  gapReport: ResidualGapReport;
  previousVerdicts: CompletionVerdict[];
  startTime: string;
  lastProgressTime: string;
}

/**
 * Evaluates whether autoforge should terminate based on evidence and context.
 * Provides evidence-based termination decisions to prevent infinite loops and false completion.
 */
export async function evaluateTermination(context: TerminationContext): Promise<TerminationDecision> {

  // Rule 1: If we've reached max cycles, terminate
  if (context.cycleCount >= context.maxCycles) {
    return {
      terminate: true,
      reason: `max_cycles_reached: ${context.cycleCount}/${context.maxCycles}`,
      confidence: 1.0
    };
  }

  // Rule 2: If verdict is 'complete', terminate successfully
  if (context.verdict === 'complete') {
    return {
      terminate: true,
      reason: `completion_achieved: ${context.verdict}`,
      confidence: 0.95
    };
  }

  // Rule 3: If verdict is 'regressed', terminate with failure.
  // But only after cycle 1 — a fresh project starting at < 30% is not a regression,
  // it's an initial state. Give the loop at least one attempt before flagging regression.
  if (context.verdict === 'regressed' && context.cycleCount >= 2) {
    return {
      terminate: true,
      reason: `regression_detected: ${context.verdict}`,
      confidence: 0.9
    };
  }

  // Rule 4: Check for diminishing returns (same verdict 5+ cycles).
  // Use 5 cycles (not 3) to allow the loop enough iterations to work through the
  // pipeline stages. 3 was too aggressive — a project making real progress each cycle
  // (SPEC 0→86, PLAN 0→86) was being terminated just because the verdict category
  // ("inconclusive") hadn't changed yet, even with measurable score improvement.
  // Note: 'inconclusive' just means "not done yet" — it is NOT a signal of no progress.
  const recentVerdicts = context.previousVerdicts.slice(-5);
  if (recentVerdicts.length >= 5 && recentVerdicts.every(v => v === context.verdict)) {
    return {
      terminate: true,
      reason: `diminishing_returns: ${context.verdict} repeated ${recentVerdicts.length} cycles`,
      confidence: 0.8
    };
  }

  // Rule 5: Check for blocker conditions
  const blockerReason = detectBlocker(context);
  if (blockerReason) {
    return {
      terminate: true,
      reason: `blocker_detected: ${blockerReason}`,
      confidence: 0.95,
      blockerDescription: blockerReason
    };
  }

  // Rule 6: Check gap report for meaningful progress
  const progressAssessment = assessProgress(context);
  if (!progressAssessment.hasMeaningfulProgress) {
    return {
      terminate: true,
      reason: `no_progress: ${progressAssessment.reason}`,
      confidence: 0.7,
      nextActions: progressAssessment.suggestions
    };
  }

  // Rule 7: Time-based termination (24 hours max)
  const elapsedMs = Date.now() - new Date(context.startTime).getTime();
  const maxElapsedMs = 24 * 60 * 60 * 1000; // 24 hours
  if (elapsedMs > maxElapsedMs) {
    return {
      terminate: true,
      reason: `time_limit_exceeded: ${Math.round(elapsedMs / 1000 / 60)} minutes elapsed`,
      confidence: 1.0
    };
  }

  // Continue if no termination conditions met
  return {
    terminate: false,
    reason: `continue: ${context.verdict} with ${context.gapReport.analysis.score} gaps remaining`,
    confidence: 0.6
  };
}

function detectBlocker(context: TerminationContext): string | null {
  // Check for external dependency issues
  if (context.gapReport.analysis.staleTruthSurfaces.some((surface: string) =>
    surface.includes('external') || surface.includes('dependency')
  )) {
    return 'external_dependency_unavailable';
  }

  // Check for fundamental architecture issues
  if (context.gapReport.analysis.confirmedGaps.some((gap: string) =>
    gap.includes('architecture') || gap.includes('fundamental')
  )) {
    return 'architecture_blocker';
  }

  // Check for repeated inconclusive results (may indicate test flakiness)
  const inconclusiveCount = context.previousVerdicts.filter(v => v === 'inconclusive').length;
  if (inconclusiveCount >= 5) {
    return 'test_flakiness_or_inconclusive_results';
  }

  return null;
}

function assessProgress(context: TerminationContext): {
  hasMeaningfulProgress: boolean;
  reason: string;
  suggestions?: string[];
} {
  // If this is the first several cycles, always consider it progress.
  // A pipeline run needs at least 5 cycles to go through constitution→specify→clarify→plan→tasks.
  if (context.cycleCount <= 5) {
    return { hasMeaningfulProgress: true, reason: 'initial_cycles' };
  }

  // Check if gaps are decreasing (note: this comparison is tautological as written —
  // gapReport does not yet carry historical gap counts, so this guard is always false).
  const currentGapScore = context.gapReport.analysis.score;
  if (currentGapScore > context.gapReport.analysis.score + 5) { // Allow small fluctuations
    return {
      hasMeaningfulProgress: false,
      reason: 'gaps_increasing',
      suggestions: ['review_changes_for_regressions', 'check_test_stability']
    };
  }

  // Stalled: same verdict for the last 6 cycles with no change → give up
  if (context.previousVerdicts.length >= 6) {
    const recentVerdicts = context.previousVerdicts.slice(-6);
    if (recentVerdicts.every(v => v === context.verdict)) {
      return {
        hasMeaningfulProgress: false,
        reason: 'stalled_on_same_verdict',
        suggestions: ['analyze_why_verdict_not_changing', 'try_different_approach']
      };
    }
  }

  return { hasMeaningfulProgress: true, reason: 'progress_detected' };
}

/**
 * Determines the next wave scope based on residual gaps.
 * Scopes work to highest-value unresolved gaps.
 */
export function scopeNextWave(gapReport: ResidualGapReport): {
  scope: string[];
  priority: 'P0' | 'P1' | 'P2';
  estimatedEffort: number; // hours
} {
  const highPriorityGaps = gapReport.analysis.confirmedGaps.filter((gap: string) =>
    gap.includes('autoforge') ||
    gap.includes('closure') ||
    gap.includes('integration') ||
    gap.includes('E2E') ||
    gap.includes('enterprise') ||
    gap.includes('security')
  );

  const mediumPriorityGaps = gapReport.analysis.confirmedGaps.filter((gap: string) =>
    gap.includes('performance') ||
    gap.includes('test') ||
    gap.includes('validation')
  );

  const lowPriorityGaps = gapReport.analysis.confirmedGaps.filter((gap: string) =>
    !highPriorityGaps.includes(gap) && !mediumPriorityGaps.includes(gap)
  );

  if (highPriorityGaps.length > 0) {
    return {
      scope: highPriorityGaps.slice(0, 3), // Top 3 high priority
      priority: 'P0',
      estimatedEffort: highPriorityGaps.length * 4 // 4 hours per gap
    };
  } else if (mediumPriorityGaps.length > 0) {
    return {
      scope: mediumPriorityGaps.slice(0, 2), // Top 2 medium priority
      priority: 'P1',
      estimatedEffort: mediumPriorityGaps.length * 2 // 2 hours per gap
    };
  } else if (lowPriorityGaps.length > 0) {
    return {
      scope: lowPriorityGaps.slice(0, 1), // Top 1 low priority
      priority: 'P2',
      estimatedEffort: 1 // 1 hour for polish
    };
  }

  // No gaps remaining
  return {
    scope: [],
    priority: 'P2',
    estimatedEffort: 0
  };
}