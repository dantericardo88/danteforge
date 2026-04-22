// critique-plan — adversarial pre-build plan review.
// Runs 7 critique categories (platform, test-discipline, security, reality,
// interaction, ordering, schema) before any code is written.
// Usage: danteforge critique-plan [plan-file] [--stakes low|medium|high|critical] [--diff <diff-file>]

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../../core/logger.js';
import {
  critiquePlan,
  printCritiqueReport,
  type PlanCriticOptions,
  type CritiqueStakes,
  type CritiquePersona,
} from '../../core/plan-critic.js';

export interface CritiquePlanOptions {
  cwd?: string;
  /** Path to the plan file. Defaults to PLAN.md in cwd. */
  planFile?: string;
  /** Path to a git diff file for --diff mode. */
  diffFile?: string;
  /** Severity threshold — low uses only general persona, critical uses all 4. */
  stakes?: CritiqueStakes;
  /** Force only these personas. */
  personas?: CritiquePersona[];
  /** Source files to load for codebase context. */
  sourceFiles?: string[];
  /** Disable LLM augmentation (deterministic checks only). */
  deterministicOnly?: boolean;
  /** Exit with non-zero when any blocking gap is found. */
  failOnBlocking?: boolean;
  /** Inject for testing */
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  _readFile?: (filePath: string) => Promise<string>;
}

export interface CritiquePlanResult {
  approved: boolean;
  blockingCount: number;
  highCount: number;
  mediumCount: number;
  gapCount: number;
  planFile: string;
}

/**
 * Run adversarial critique on a sprint plan before building begins.
 * Returns a CritiquePlanResult and optionally exits non-zero.
 */
export async function runCritiquePlan(opts: CritiquePlanOptions = {}): Promise<CritiquePlanResult> {
  const cwd = opts.cwd ?? process.cwd();
  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  // Resolve plan file
  const planFilePath = opts.planFile
    ? path.resolve(cwd, opts.planFile)
    : path.join(cwd, 'PLAN.md');

  let planContent: string;
  try {
    planContent = await readFile(planFilePath);
  } catch {
    logger.error(`[critique-plan] Cannot read plan file: ${planFilePath}`);
    logger.info('[critique-plan] Usage: danteforge critique-plan [path/to/plan.md]');
    return { approved: false, blockingCount: 1, highCount: 0, mediumCount: 0, gapCount: 1, planFile: planFilePath };
  }

  // Load optional diff content
  let diffContent: string | undefined;
  if (opts.diffFile) {
    try {
      diffContent = await readFile(path.resolve(cwd, opts.diffFile));
    } catch {
      logger.warn(`[critique-plan] Diff file not found: ${opts.diffFile} — skipping diff mode`);
    }
  }

  // Load source files for codebase grounding (best-effort)
  const defaultSourceFiles = [
    'src/core/harvest-queue.ts',
    'src/core/llm.ts',
    'src/core/mcp-server.ts',
  ];
  const filesToLoad = opts.sourceFiles ?? defaultSourceFiles;

  const criticOpts: PlanCriticOptions = {
    cwd,
    planContent,
    diffContent,
    sourceFilesToRead: filesToLoad.map(f => path.resolve(cwd, f)),
    stakes: opts.stakes ?? 'medium',
    personas: opts.personas,
    enablePremortem: true,
    _llmCaller: opts.deterministicOnly ? undefined : opts._llmCaller,
    _isLLMAvailable: opts.deterministicOnly ? async () => false : opts._isLLMAvailable,
    _readFile: opts._readFile,
  };

  logger.info(`[critique-plan] Critiquing: ${path.relative(cwd, planFilePath)}`);
  logger.info(`[critique-plan] Stakes: ${criticOpts.stakes} | Deterministic: ${opts.deterministicOnly ? 'only' : '+ LLM'}`);

  const report = await critiquePlan(criticOpts);

  // Print human-readable report
  printCritiqueReport(report);

  const mediumCount = report.gapsFound.filter(g => g.severity === 'medium').length;

  if (report.approved) {
    logger.success('[critique-plan] ✓ Plan approved — no blocking gaps. Build can proceed.');
  } else {
    logger.error(`[critique-plan] ✗ Plan BLOCKED — ${report.blockingCount} blocking gap(s) must be fixed before building.`);
    if (opts.failOnBlocking !== false) {
      process.exitCode = 1;
    }
  }

  return {
    approved: report.approved,
    blockingCount: report.blockingCount,
    highCount: report.highCount,
    mediumCount,
    gapCount: report.gapsFound.length,
    planFile: planFilePath,
  };
}
