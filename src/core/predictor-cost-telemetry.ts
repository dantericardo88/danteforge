/**
 * predictor-cost-telemetry.ts
 *
 * Writes per-prediction cost records to .danteforge/economy/
 * so prediction spend is auditable alongside forge-wave costs.
 *
 * PRD-WORLDMODEL-V1 §4.1: "Cost telemetry emits to .danteforge/economy/"
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export interface PredictorCostRecord {
  /** ISO timestamp matching PredictionResult.predictedAt */
  predictedAt: string;
  /** Forge command this prediction was made for */
  command: string;
  /** Estimated USD spent on the predictor LLM call */
  costUsd: number;
  /** 0-1 confidence returned by the predictor */
  confidence: number;
  /** Predictor version string from PredictionResult */
  predictorVersion: string;
  /** SHA-256 receipt hash (present when evidence-chain is available) */
  receiptHash?: string;
}

/**
 * Persist a predictor cost record to .danteforge/economy/.
 * File name: predictor-{safe-timestamp}.json
 *
 * Best-effort: callers wrap in try/catch; this function may throw if the
 * directory cannot be created or the file cannot be written.
 */
export async function writePredictorCostRecord(
  record: PredictorCostRecord,
  cwd?: string,
): Promise<void> {
  const dir = path.join(cwd ?? process.cwd(), '.danteforge', 'economy');
  await fs.mkdir(dir, { recursive: true });
  const safeTs = record.predictedAt.replace(/[:.]/g, '-').replace(/[^a-zA-Z0-9_-]/g, '');
  const filePath = path.join(dir, `predictor-${safeTs}.json`);
  await fs.writeFile(filePath, JSON.stringify(record, null, 2), 'utf8');
}
