// score-maintainability.ts — Maintainability dimension scorer
// Returns a 0-10 score based on static complexity metrics + structural rewards.

import path from 'path';
import { analyzeProjectComplexity, type ProjectComplexityReport } from './complexity-analyzer.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MaintainabilityScoreResult {
  score: number;
  report: ProjectComplexityReport;
  penalties: Array<{ reason: string; amount: number }>;
  rewards: Array<{ reason: string; amount: number }>;
}

export interface MaintainabilityOptions {
  _analyzeProject?: typeof analyzeProjectComplexity;
  _fileExists?: (p: string) => Promise<boolean>;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function defaultFileExists(p: string): Promise<boolean> {
  try {
    const fs = await import('fs/promises');
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

// ── Scoring ───────────────────────────────────────────────────────────────────

export async function scoreMaintainability(
  cwd: string,
  options: MaintainabilityOptions = {},
): Promise<number> {
  const result = await scoreMaintainabilityFull(cwd, options);
  return result.score;
}

export async function scoreMaintainabilityFull(
  cwd: string,
  options: MaintainabilityOptions = {},
): Promise<MaintainabilityScoreResult> {
  const analyzeProject = options._analyzeProject ?? analyzeProjectComplexity;
  const fileExists = options._fileExists ?? defaultFileExists;

  const srcDir = path.join(cwd, 'src');
  const report = await analyzeProject(srcDir);

  let score = 10.0;
  const penalties: Array<{ reason: string; amount: number }> = [];
  const rewards: Array<{ reason: string; amount: number }> = [];

  // Penalty: files over 500 non-blank LOC
  if (report.filesExceedingLocLimit.length > 0) {
    const penalty = report.filesExceedingLocLimit.length * 0.5;
    const capped = Math.min(penalty, 3.0);
    penalties.push({
      reason: `${report.filesExceedingLocLimit.length} file(s) exceed 500 LOC`,
      amount: capped,
    });
    score -= capped;
  }

  // Penalty: average cyclomatic complexity over 10
  const avgComplex = report.avgComplexityScore;
  if (avgComplex > 10) {
    const penalty = Math.min((avgComplex - 10) * 0.2, 1.0);
    penalties.push({
      reason: `Average complexity score ${avgComplex.toFixed(1)} exceeds 10`,
      amount: penalty,
    });
    score -= penalty;
  }

  // Penalty: functions over 50 LOC
  if (report.functionsExceedingLocLimit.length > 0) {
    const penalty = Math.min(report.functionsExceedingLocLimit.length * 0.3, 2.0);
    penalties.push({
      reason: `${report.functionsExceedingLocLimit.length} function(s) exceed 50 LOC`,
      amount: penalty,
    });
    score -= penalty;
  }

  // Reward: presence of shared-options.ts
  const sharedOptionsPath = path.join(cwd, 'src', 'cli', 'shared-options.ts');
  if (await fileExists(sharedOptionsPath)) {
    rewards.push({ reason: 'shared-options.ts exists (DRY CLI options)', amount: 0.5 });
    score += 0.5;
  }

  // Reward: presence of complexity.ts command
  const complexityCmdPath = path.join(cwd, 'src', 'cli', 'commands', 'complexity.ts');
  if (await fileExists(complexityCmdPath)) {
    rewards.push({ reason: 'complexity.ts command exists (complexity tracking)', amount: 0.5 });
    score += 0.5;
  }

  // Reward: presence of shared type files in core
  const sharedTypePaths = [
    path.join(cwd, 'src', 'core', 'complexity-analyzer.ts'),
    path.join(cwd, 'src', 'core', 'score-maintainability.ts'),
  ];
  let sharedTypeCount = 0;
  for (const p of sharedTypePaths) {
    if (await fileExists(p)) sharedTypeCount++;
  }
  if (sharedTypeCount > 0) {
    const amount = Math.min(sharedTypeCount * 0.3, 0.6);
    rewards.push({ reason: `${sharedTypeCount} shared type/utility file(s)`, amount });
    score += amount;
  }

  const finalScore = Math.min(Math.max(Math.round(score * 10) / 10, 0), 10);

  return {
    score: finalScore,
    report,
    penalties,
    rewards,
  };
}
