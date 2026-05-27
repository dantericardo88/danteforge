// autoforge-planning.ts — GitHub issue context enrichment + predictor factory.
// Split from autoforge.ts to keep files under the 750-LOC hard cap.
import { exec as execCallback } from 'child_process';
import { promisify } from 'util';
import { loadCausalWeightMatrix } from './causal-weight-matrix.js';

const execAsync = promisify(execCallback);

// ---------------------------------------------------------------------------
// GitHub issue context enrichment
// ---------------------------------------------------------------------------

/** Injectable exec function for testing. */
export type ExecFn = (cmd: string, opts: { cwd: string }) => Promise<{ stdout: string; stderr: string }>;

/**
 * Fetch linked GitHub issue context for the current git repo.
 *
 * Parses git log for issue references (#123), then attempts to read local
 * issue template files for additional context. Returns a context string
 * to prepend to forge prompts, or an empty string if nothing is found.
 *
 * @param cwd - Working directory (defaults to process.cwd())
 * @param _execFn - Injectable exec for testing
 */
export async function fetchLinkedIssueContext(
  cwd: string = process.cwd(),
  _execFn?: ExecFn,
): Promise<string> {
  const runner = _execFn ?? ((cmd: string, opts: { cwd: string }) => execAsync(cmd, opts));
  const parts: string[] = [];

  // 1. Parse recent git log for issue references
  try {
    const { stdout } = await runner('git log --oneline -20', { cwd });
    const issuePattern = /#(\d+)/g;
    const issueNums: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = issuePattern.exec(stdout)) !== null) {
      if (!issueNums.includes(m[1])) issueNums.push(m[1]);
    }
    if (issueNums.length > 0) {
      parts.push(`[Issue refs from recent git history: ${issueNums.map(n => `#${n}`).join(', ')}]`);
    }
  } catch {
    // git may not be available or no commits yet — non-fatal
  }

  // 2. Read local issue template files for project context
  const templateDirs = [
    path.join(cwd, '.github', 'ISSUE_TEMPLATE'),
    path.join(cwd, 'docs', 'issues'),
  ];
  for (const dir of templateDirs) {
    try {
      const entries = await fs.readdir(dir);
      for (const entry of entries.slice(0, 3)) {
        if (!entry.endsWith('.md') && !entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
        try {
          const content = await fs.readFile(path.join(dir, entry), 'utf8');
          const trimmed = content.slice(0, 500);
          parts.push(`[Issue template "${entry}":\n${trimmed}]`);
        } catch {
          // individual file read failed — skip
        }
      }
    } catch {
      // directory does not exist — skip
    }
  }

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Predictor auto-wire factory
// ---------------------------------------------------------------------------

/**
 * Build a live PredictStepFn using the configured LLM provider.
 * Used by executeAutoForgePlan to enable prediction layer in production runs.
 * Returns undefined when no LLM is available, disabling prediction silently.
 */
export async function buildPredictStepFn(cwd?: string): Promise<PredictStepFn | undefined> {
  try {
    const { callLLM } = await import('./llm.js');
    const matrix = await loadCausalWeightMatrix(cwd);
    const { predict } = await import('../../packages/predictor/src/predictor.js');
    const { DEFAULT_PREDICTOR_CONFIG } = await import('../../packages/predictor/src/types.js');
    type PriorRecord = import('../../packages/predictor/src/types.js').PriorPredictionRecord;

    const llmCaller = async (prompt: string) => callLLM(prompt);

    return async (command: string, reason: string, currentOverall: number): Promise<{ delta: number; confidence: number }> => {
      const causalWeights: Partial<Record<string, number>> = {};
      for (const [dim, acc] of Object.entries(matrix.perDimensionAccuracy)) {
        if (acc && acc.sampleCount >= 3) causalWeights[dim] = acc.directionAccuracy;
      }

      // Build recentHistory from the rolling attribution window stored in the matrix
      const recentHistory: PriorRecord[] = (matrix.recentAttributions ?? [])
        .slice(-DEFAULT_PREDICTOR_CONFIG.contextWindowSize)
        .map((attr) => ({
          action: attr.actionType,
          predictedDelta: { [attr.dimension]: attr.predictedDelta },
          measuredDelta: { [attr.dimension]: attr.measuredDelta },
          aligned: attr.classification === 'causally-aligned',
        }));

      const result = await predict(
        {
          proposedAction: { command, reason, estimatedComplexity: 'medium' },
          currentState: {
            workflowStage: command,
            dimensionScores: { functionality: currentOverall / 10 },
            totalCostUsd: 0,
            cycleCount: matrix.totalAttributions,
          },
          recentHistory,
          causalWeights,
          budgetEnvelope: { maxUsd: DEFAULT_PREDICTOR_CONFIG.maxBudgetUsd, maxLatencyMs: 30_000 },
        },
        llmCaller,
        DEFAULT_PREDICTOR_CONFIG,
      );

      const primaryDelta = Object.values(result.predicted.scoreImpact)[0] ?? 0;

      // Emit proof-anchored receipt (best-effort — never blocks prediction)
      try {
        const { createReceipt } = await import('../../packages/evidence-chain/src/index.js');
        const receipt = createReceipt({
          action: 'autoforge:predict',
          payload: {
            command,
            reason,
            predictedAt: result.predictedAt,
            confidence: result.predicted.confidence,
            scoreImpact: result.predicted.scoreImpact,
          },
        });
        result.receiptHash = receipt.hash;
      } catch {
        // evidence-chain unavailable — proceed without receipt
      }

      // Emit cost telemetry to .danteforge/economy/ (PRD §4.1 — best-effort)
      try {
        const { writePredictorCostRecord } = await import('./predictor-cost-telemetry.js');
        await writePredictorCostRecord({
          predictedAt: result.predictedAt,
          command,
          costUsd: result.predicted.costUsd,
          confidence: result.predicted.confidence,
          predictorVersion: result.predictorVersion,
          receiptHash: result.receiptHash,
        }, cwd);
      } catch {
        // economy dir unavailable — proceed without cost record
      }

      return { delta: primaryDelta, confidence: result.predicted.confidence };
    };
  } catch {
    return undefined;
  }
}

/** Injected for testing — given a step command + context, returns predicted score delta and confidence */
export type PredictStepFn = (command: string, reason: string, currentOverall: number, cwd?: string) => Promise<{ delta: number; confidence: number }>;
