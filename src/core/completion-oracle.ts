import type { EvidenceBundle, Verdict } from './run-ledger.js';
import type { DanteState } from './state.js';
import { analyzeRequirementCoverage, type CoverageAnalysis } from './requirement-coverage.js';

export type CompletionVerdict = 'complete' | 'partially_complete' | 'misleadingly_complete' | 'inconclusive' | 'regressed';

export interface CompletionOracleResult {
  verdict: CompletionVerdict;
  isComplete: boolean;
  score: number;
  reasons: string[];
  recommendations: string[];
  coverageAnalysis?: CoverageAnalysis;
}

export function validateCompletion(bundle: EvidenceBundle, state: DanteState): CompletionOracleResult {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // Run coverage analysis
  const coverageAnalysis = analyzeRequirementCoverage(bundle, state);

  // Check requirement coverage
  if (coverageAnalysis.requirements.coveragePercent < 80) {
    reasons.push(`Low requirement coverage: ${Math.round(coverageAnalysis.requirements.coveragePercent)}%`);
    recommendations.push('Address missing requirements');
  } else {
    score += 15;
  }

  // Check for minimum evidence requirements
  if (bundle.reads.length === 0) {
    reasons.push('No file reads recorded - system did not inspect project state');
  } else {
    score += 15;
  }

  if (bundle.writes.length === 0) {
    reasons.push('No file writes recorded - no changes were made');
    recommendations.push('Verify that the task actually required file modifications');
  } else {
    score += 15;
  }

  if (bundle.commands.length === 0) {
    reasons.push('No commands executed - system did not perform operations');
  } else {
    score += 10;
  }

  // Check test coverage
  if (bundle.tests.length === 0) {
    reasons.push('No tests recorded - completion not verified');
    recommendations.push('Run tests to verify functionality');
  } else {
    const passedTests = bundle.tests.filter(t => t.status === 'pass').length;
    const testPassRate = passedTests / bundle.tests.length;
    if (testPassRate < 0.8) {
      reasons.push(`Low test pass rate: ${passedTests}/${bundle.tests.length} (${Math.round(testPassRate * 100)}%)`);
      recommendations.push('Fix failing tests before considering complete');
    } else {
      score += 15;
    }
  }

  // Check gate enforcement
  if (bundle.gates.length === 0) {
    reasons.push('No gate checks recorded - quality gates not enforced');
    recommendations.push('Ensure all required gates are checked');
  } else {
    const passedGates = bundle.gates.filter(g => g.status === 'pass').length;
    const gatePassRate = passedGates / bundle.gates.length;
    if (gatePassRate < 1.0) {
      reasons.push(`Failed gates: ${bundle.gates.length - passedGates}/${bundle.gates.length}`);
      recommendations.push('Address failing gate checks');
    } else {
      score += 15;
    }
  }

  // Check artifact coverage
  if (coverageAnalysis.artifacts.missing.length > 0) {
    reasons.push(`Missing expected artifacts: ${coverageAnalysis.artifacts.missing.join(', ')}`);
    recommendations.push('Ensure all phase artifacts are created');
  } else {
    score += 10;
  }

  // Check for plan adherence
  if (!bundle.plan || Object.keys(bundle.plan).length === 0) {
    reasons.push('No execution plan recorded');
    recommendations.push('Ensure tasks follow a defined plan');
  } else {
    score += 10;
  }

  // Check for error-free execution
  const failedCommands = bundle.commands.filter(c => c.exitCode !== 0);
  if (failedCommands.length > 0) {
    reasons.push(`${failedCommands.length} commands failed execution`);
    recommendations.push('Review and fix command failures');
  } else if (bundle.commands.length > 0) {
    score += 10;
  }

  // Determine verdict type
  let verdict: CompletionVerdict;
  if (reasons.length === 0 && score >= 80) {
    verdict = 'complete';
  } else if (score >= 60 && reasons.length <= 2) {
    verdict = 'partially_complete';
  } else if (score < 50) {
    verdict = 'regressed';
  } else if (bundle.commands.length === 0 && bundle.writes.length > 0) {
    verdict = 'misleadingly_complete'; // Wrote files without commands
  } else {
    verdict = 'inconclusive';
  }

  const isComplete = verdict === 'complete';

  if (isComplete) {
    reasons.push('All completion criteria met');
  } else if (verdict === 'regressed') {
    recommendations.unshift('This appears to be a failed or incomplete execution');
  }

  return {
    verdict,
    isComplete,
    score,
    reasons,
    recommendations,
    coverageAnalysis,
  };
}

// getExpectedArtifacts moved to requirement-coverage.ts

export function generateVerdict(bundle: EvidenceBundle, oracle: CompletionOracleResult): Verdict {
  return {
    timestamp: new Date().toISOString(),
    status: oracle.isComplete ? 'success' : 'failure',
    completionOracle: oracle.isComplete,
    reason: oracle.reasons.join('; '),
    evidenceHash: '', // Will be set by RunLedger
  };
}