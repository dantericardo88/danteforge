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

  // Rule 3: If verdict is 'regressed', terminate with failure
  if (context.verdict === 'regressed') {
    return {
      terminate: true,
      reason: `regression_detected: ${context.verdict}`,
      confidence: 0.9
    };
  }

  // Rule 4: Check for diminishing returns (same verdict 3+ cycles)
  const recentVerdicts = context.previousVerdicts.slice(-3);
  if (recentVerdicts.length >= 3 && recentVerdicts.every(v => v === context.verdict)) {
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
  // If this is the first few cycles, always consider it progress
  if (context.cycleCount <= 2) {
    return { hasMeaningfulProgress: true, reason: 'initial_cycles' };
  }

  // Check if gaps are decreasing
  const previousGapCount = context.previousVerdicts.length;
  const currentGapScore = context.gapReport.analysis.score;

  // If gaps are increasing, no progress
  if (currentGapScore > context.gapReport.analysis.score + 5) { // Allow small fluctuations
    return {
      hasMeaningfulProgress: false,
      reason: 'gaps_increasing',
      suggestions: ['review_changes_for_regressions', 'check_test_stability']
    };
  }

  // If gaps haven't changed significantly in last 3 cycles, consider no progress
  if (context.previousVerdicts.length >= 3) {
    const recentVerdicts = context.previousVerdicts.slice(-3);
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