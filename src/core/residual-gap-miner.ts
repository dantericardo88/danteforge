import type { EvidenceBundle } from './run-ledger.js';
import type { DanteState } from './state.js';
import fs from 'fs/promises';
import path from 'path';

export interface GapAnalysis {
  confirmedGaps: string[];
  suspectedHiddenGaps: string[];
  regressions: string[];
  staleTruthSurfaces: string[];
  missingTests: string[];
  missingWiring: string[];
  score: number;
}

export interface ResidualGapReport {
  timestamp: string;
  analysis: GapAnalysis;
  recommendations: string[];
  nextWavePriority: string[];
}

interface GapComputationResult {
  confirmedGaps: string[];
  suspectedHiddenGaps: string[];
  regressions: string[];
  staleTruthSurfaces: string[];
  missingTests: string[];
  missingWiring: string[];
  recommendations: string[];
  score: number;
}

function computeGapAnalysis(bundle: EvidenceBundle): GapComputationResult {
  const confirmedGaps: string[] = [];
  const suspectedHiddenGaps: string[] = [];
  const regressions: string[] = [];
  const staleTruthSurfaces: string[] = [];
  const missingTests: string[] = [];
  const missingWiring: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  if (bundle.reads.length === 0) {
    confirmedGaps.push('No file reads recorded - system did not inspect project state');
    recommendations.push('Ensure all operations log file reads');
  } else { score += 10; }

  if (bundle.writes.length === 0) {
    confirmedGaps.push('No file writes recorded - no changes were made');
    recommendations.push('Verify that operations actually modify files');
  } else { score += 10; }

  if (bundle.commands.length === 0) {
    confirmedGaps.push('No commands executed - system did not perform operations');
  } else { score += 10; }

  if (bundle.tests.length === 0) {
    missingTests.push('No tests recorded in evidence bundle');
    recommendations.push('Add test execution logging to all operations');
  } else {
    const passedTests = bundle.tests.filter(t => t.status === 'pass').length;
    const testCoverage = passedTests / bundle.tests.length;
    if (testCoverage < 0.8) {
      confirmedGaps.push(`Low test pass rate: ${passedTests}/${bundle.tests.length} (${Math.round(testCoverage * 100)}%)`);
      recommendations.push('Fix failing tests before claiming completion');
    } else { score += 20; }
  }

  if (bundle.gates.length === 0) {
    missingWiring.push('No gate checks recorded - quality gates not enforced');
    recommendations.push('Ensure all operations check required gates');
  } else {
    const passedGates = bundle.gates.filter(g => g.status === 'pass').length;
    if (passedGates < bundle.gates.length) {
      confirmedGaps.push(`Failed gates: ${bundle.gates.length - passedGates}/${bundle.gates.length}`);
      recommendations.push('Address failing gate checks');
    } else { score += 20; }
  }

  if (!bundle.plan || Object.keys(bundle.plan).length === 0) {
    confirmedGaps.push('No execution plan recorded');
    recommendations.push('Ensure all operations follow defined plans');
  } else { score += 10; }

  const failedCommands = bundle.commands.filter(c => c.exitCode !== 0);
  if (failedCommands.length > 0) {
    regressions.push(`${failedCommands.length} commands failed execution`);
    recommendations.push('Review and fix command failures');
  } else if (bundle.commands.length > 0) { score += 10; }

  return { confirmedGaps, suspectedHiddenGaps, regressions, staleTruthSurfaces, missingTests, missingWiring, recommendations, score };
}

/**
 * Analyze evidence bundle for residual gaps after completion
 */
export function analyzeResidualGaps(bundle: EvidenceBundle, state: DanteState): ResidualGapReport {
  const { confirmedGaps, suspectedHiddenGaps, regressions, staleTruthSurfaces, missingTests, missingWiring, recommendations, score } = computeGapAnalysis(bundle);
  const nextWavePriority: string[] = [];

  if (confirmedGaps.length > 0) nextWavePriority.push('Fix confirmed gaps in evidence collection and validation');
  if (missingWiring.length > 0) nextWavePriority.push('Complete audit logging and gate wiring across all operations');
  if (missingTests.length > 0) nextWavePriority.push('Add comprehensive test coverage for new foundations');
  if (staleTruthSurfaces.length > 0) nextWavePriority.push('Fix truth surface inconsistencies');

  return {
    timestamp: new Date().toISOString(),
    analysis: { confirmedGaps, suspectedHiddenGaps, regressions, staleTruthSurfaces, missingTests, missingWiring, score },
    recommendations,
    nextWavePriority,
  };
}

/**
 * Generate comprehensive residual gap report after any operation
 */
export async function generateGapReport(bundle: EvidenceBundle, state: DanteState, outputPath?: string): Promise<ResidualGapReport> {
  const report = analyzeResidualGaps(bundle, state);

  if (outputPath) {
    const reportJson = JSON.stringify(report, null, 2);
    await fs.writeFile(outputPath, reportJson, 'utf8');
  }

  return report;
}