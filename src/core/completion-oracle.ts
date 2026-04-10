import type { EvidenceBundle, Verdict } from './run-ledger.js';
import type { DanteState } from './state.js';

export interface CompletionOracleResult {
  isComplete: boolean;
  score: number;
  reasons: string[];
  recommendations: string[];
}

export function validateCompletion(bundle: EvidenceBundle, state: DanteState): CompletionOracleResult {
  const reasons: string[] = [];
  const recommendations: string[] = [];
  let score = 0;

  // Check for minimum evidence requirements
  if (bundle.reads.length === 0) {
    reasons.push('No file reads recorded - system did not inspect project state');
  } else {
    score += 20;
  }

  if (bundle.writes.length === 0) {
    reasons.push('No file writes recorded - no changes were made');
    recommendations.push('Verify that the task actually required file modifications');
  } else {
    score += 20;
  }

  if (bundle.commands.length === 0) {
    reasons.push('No commands executed - system did not perform any operations');
  } else {
    score += 10;
  }

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
      score += 20;
    }
  }

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
      score += 20;
    }
  }

  // Check for expected artifacts based on workflow stage
  const expectedArtifacts = getExpectedArtifacts(state);
  const missingArtifacts = expectedArtifacts.filter(artifact => {
    return !bundle.writes.some(write => write.path.includes(artifact));
  });

  if (missingArtifacts.length > 0) {
    reasons.push(`Missing expected artifacts: ${missingArtifacts.join(', ')}`);
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

  // Final determination
  const isComplete = reasons.length === 0 && score >= 80;

  if (isComplete) {
    reasons.push('All completion criteria met');
  } else if (score < 50) {
    recommendations.unshift('This appears to be a failed or incomplete execution');
  }

  return {
    isComplete,
    score,
    reasons,
    recommendations,
  };
}

function getExpectedArtifacts(state: DanteState): string[] {
  const artifacts: string[] = [];

  // Planning phase artifacts
  if (state.workflowStage === 'constitution' || state.workflowStage === 'specify' ||
      state.workflowStage === 'clarify' || state.workflowStage === 'plan' || state.workflowStage === 'tasks') {
    if (!state.constitution) artifacts.push('CONSTITUTION.md');
    if (!state.spec) artifacts.push('SPEC.md');
    if (!state.clarify) artifacts.push('CLARIFY.md');
    if (!state.plan) artifacts.push('PLAN.md');
    if (!state.tasks) artifacts.push('TASKS.md');
  }

  // Execution phase artifacts
  if (state.workflowStage === 'forge' || state.workflowStage === 'verify') {
    // Implementation files would be project-specific
    artifacts.push('.danteforge/state.json'); // State updates
  }

  // Verification artifacts
  if (state.workflowStage === 'verify') {
    artifacts.push('.danteforge/verify-results.json');
  }

  return artifacts;
}

export function generateVerdict(bundle: EvidenceBundle, oracle: CompletionOracleResult): Verdict {
  return {
    timestamp: new Date().toISOString(),
    status: oracle.isComplete ? 'success' : 'failure',
    completionOracle: oracle.isComplete,
    reason: oracle.reasons.join('; '),
    evidenceHash: '', // Will be set by RunLedger
  };
}