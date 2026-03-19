// Standalone Mode — run DanteForge verification without full DanteCode environment
// Enables CI/CD integration and independent quality checks.

import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';
import { loadState } from './state.js';
import { scoreAllArtifacts } from './pdse.js';
import { detectAIDrift } from './drift-detector.js';
import type { Violation } from './fix-packet.js';
import type { ScoreResult } from './pdse.js';

// --- Detection ---------------------------------------------------------------

export function isStandalone(): boolean {
  // Running outside DanteCode: no .claude-plugin context or DANTECODE_ROOT env
  return !process.env.DANTECODE_ROOT && !process.env.CLAUDE_PLUGIN_ROOT;
}

// --- Standalone Verification -------------------------------------------------

export interface StandaloneResult {
  score: number;
  issues: Violation[];
  pdseScores: Record<string, ScoreResult>;
  projectType: string;
  timestamp: string;
}

export async function standaloneVerify(cwd = process.cwd()): Promise<StandaloneResult> {
  logger.info('Running standalone verification...');

  const state = await loadState({ cwd });

  // PDSE scoring
  let pdseScores: Record<string, ScoreResult> = {};
  try {
    pdseScores = await scoreAllArtifacts(cwd, state);
  } catch {
    logger.warn('PDSE scoring unavailable — skipping artifact scores');
  }

  // Drift detection on source files
  const sourceFiles: string[] = [];
  try {
    const srcDir = path.join(cwd, 'src');
    const entries = await fs.readdir(srcDir, { recursive: true }) as string[];
    for (const entry of entries) {
      if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
        sourceFiles.push(path.join('src', entry));
      }
    }
  } catch {
    // No src directory or can't read — drift detection skipped
  }

  const driftViolations = sourceFiles.length > 0
    ? await detectAIDrift(sourceFiles, cwd)
    : [];

  // Compute composite score
  const pdseValues = Object.values(pdseScores);
  const avgPdse = pdseValues.length > 0
    ? pdseValues.reduce((sum, s) => sum + s.score, 0) / pdseValues.length
    : 0;

  const driftPenalty = driftViolations.reduce((sum, v) => {
    switch (v.severity) {
      case 'BLOCKER': return sum + 20;
      case 'HIGH': return sum + 10;
      case 'MEDIUM': return sum + 5;
      case 'LOW': return sum + 1;
      default: return sum;
    }
  }, 0);

  const score = Math.max(0, Math.round(avgPdse - driftPenalty));

  return {
    score,
    issues: driftViolations,
    pdseScores: pdseScores as Record<string, ScoreResult>,
    projectType: state.projectType ?? 'unknown',
    timestamp: new Date().toISOString(),
  };
}

// --- Report Generation -------------------------------------------------------

export async function standaloneReport(cwd = process.cwd()): Promise<string> {
  const result = await standaloneVerify(cwd);
  const lines: string[] = [
    '# DanteForge Standalone Verification Report',
    '',
    `**Score:** ${result.score}/100`,
    `**Project Type:** ${result.projectType}`,
    `**Timestamp:** ${result.timestamp}`,
    '',
  ];

  // PDSE scores
  const pdseEntries = Object.entries(result.pdseScores);
  if (pdseEntries.length > 0) {
    lines.push('## PDSE Artifact Scores', '');
    for (const [artifact, scoreResult] of pdseEntries) {
      lines.push(`- **${artifact}**: ${scoreResult.score}/100 (${scoreResult.autoforgeDecision})`);
    }
    lines.push('');
  }

  // Drift issues
  if (result.issues.length > 0) {
    lines.push('## Drift Issues', '');
    for (const issue of result.issues) {
      lines.push(`- [${issue.severity}] ${issue.file}${issue.line ? `:${issue.line}` : ''} — ${issue.message}`);
    }
    lines.push('');
  } else {
    lines.push('## Drift Issues', '', 'No drift violations detected.', '');
  }

  return lines.join('\n');
}
