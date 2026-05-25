// loop-recovery.ts — structured recovery action set for autonomous loop failures.
// Identifies the failure kind and selects the highest-leverage recovery action.
// Pure logic — no IO. Integrated into crusade/frontier loops via the autonomy rules chain.

// ── Types ─────────────────────────────────────────────────────────────────────

export type FailureKind =
  | 'zero-patterns'        // OSS harvest returned 0 patterns
  | 'forge-wave-failed'    // magic/forge subprocess failed
  | 'score-no-progress'    // 3+ cycles with delta < threshold
  | 'capability-test-fail' // Fix A gate blocked the score
  | 'evidence-stale'       // outcome evidence files are old
  | 'llm-unreachable'      // LLM provider not responding
  | 'unknown';

export type RecoveryActionKind =
  | 'retry-oss'            // retry OSS harvest with different domain
  | 'run-autoresearch'     // switch to autoresearch mode
  | 'validate-evidence'    // re-run validate --force-cold to refresh receipts
  | 'switch-dimension'     // skip this dim, try another
  | 'halt-operator'        // stop and surface to operator
  | 'wait-llm'             // pause and retry LLM
  | 'fix-capability-test'; // investigate and fix the failing capability_test

export interface RecoveryContext {
  dimensionId: string;
  consecutiveFailures: number;
  lastPatternCount: number;
  lastScoreDelta: number;
  cyclesWithoutProgress: number;
  llmAvailable: boolean;
}

export interface RecoveryAction {
  kind: RecoveryActionKind;
  description: string;
  urgency: 'low' | 'medium' | 'high' | 'critical';
  command?: string;
}

// ── Selection logic ───────────────────────────────────────────────────────────

export function selectRecoveryAction(failure: FailureKind, ctx: RecoveryContext): RecoveryAction {
  if (!ctx.llmAvailable) {
    return {
      kind: 'wait-llm',
      urgency: 'critical',
      description: 'LLM provider unreachable. Pause autonomous loop until provider is available.',
    };
  }

  switch (failure) {
    case 'zero-patterns':
      if (ctx.consecutiveFailures >= 2) {
        return {
          kind: 'run-autoresearch',
          urgency: 'high',
          description: `OSS harvest has returned 0 patterns ${ctx.consecutiveFailures} times. Switch to autoresearch to synthesize from model knowledge instead.`,
          command: `danteforge autoresearch --metric ${ctx.dimensionId} --time 20 --allow-dirty`,
        };
      }
      return {
        kind: 'retry-oss',
        urgency: 'medium',
        description: 'OSS harvest returned 0 patterns. Retry with a broader domain scope.',
        command: `danteforge oss --max-repos 8`,
      };

    case 'forge-wave-failed':
      if (ctx.consecutiveFailures >= 3) {
        return {
          kind: 'switch-dimension',
          urgency: 'high',
          description: `Forge wave has failed ${ctx.consecutiveFailures} times on ${ctx.dimensionId}. Skip to next dimension to preserve forward progress.`,
        };
      }
      return {
        kind: 'retry-oss',
        urgency: 'medium',
        description: 'Forge wave failed — likely missing OSS context. Re-run OSS harvest then retry.',
        command: `danteforge oss --max-repos 5`,
      };

    case 'score-no-progress':
      if (ctx.cyclesWithoutProgress >= 5) {
        return {
          kind: 'halt-operator',
          urgency: 'critical',
          description: `${ctx.dimensionId} has had no progress for ${ctx.cyclesWithoutProgress} cycles. Halting for operator review — this dimension may be at its honest ceiling.`,
        };
      }
      return {
        kind: 'run-autoresearch',
        urgency: 'high',
        description: `No score progress for ${ctx.cyclesWithoutProgress} cycles on ${ctx.dimensionId}. Autoresearch will synthesize new approaches from model knowledge.`,
        command: `danteforge autoresearch --metric ${ctx.dimensionId} --time 30 --allow-dirty`,
      };

    case 'capability-test-fail':
      return {
        kind: 'fix-capability-test',
        urgency: 'critical',
        description: `Fix A gate blocked ${ctx.dimensionId}: capability_test is failing. The code must be fixed — do not raise the score ceiling to work around the test.`,
      };

    case 'evidence-stale':
      return {
        kind: 'validate-evidence',
        urgency: 'medium',
        description: `Outcome evidence for ${ctx.dimensionId} is stale. Re-run validate to write fresh receipts.`,
        command: `danteforge validate ${ctx.dimensionId} --force-cold`,
      };

    case 'llm-unreachable':
      return {
        kind: 'wait-llm',
        urgency: 'critical',
        description: 'LLM provider is not reachable. Cannot run forge or autoresearch waves.',
      };

    default:
      return {
        kind: 'halt-operator',
        urgency: 'high',
        description: `Unknown failure on ${ctx.dimensionId}. Surface to operator for investigation.`,
      };
  }
}

// ── Failure kind inference ────────────────────────────────────────────────────

export function inferFailureKind(ctx: {
  patternsFound: number;
  forgeSucceeded: boolean;
  scoreDelta: number;
  cyclesWithoutProgress: number;
  capabilityTestFailed: boolean;
  llmAvailable: boolean;
}): FailureKind {
  if (!ctx.llmAvailable) return 'llm-unreachable';
  if (ctx.capabilityTestFailed) return 'capability-test-fail';
  if (ctx.patternsFound === 0) return 'zero-patterns';
  if (!ctx.forgeSucceeded) return 'forge-wave-failed';
  if (ctx.cyclesWithoutProgress >= 3) return 'score-no-progress';
  return 'unknown';
}

// ── Summary formatter ─────────────────────────────────────────────────────────

export function formatRecoveryPlan(action: RecoveryAction): string {
  const lines = [
    `Recovery [${action.urgency.toUpperCase()}]: ${action.kind}`,
    `  ${action.description}`,
  ];
  if (action.command) {
    lines.push(`  Command: ${action.command}`);
  }
  return lines.join('\n');
}
