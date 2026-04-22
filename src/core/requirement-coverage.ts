import type { EvidenceBundle } from './run-ledger.js';
import type { DanteState } from './state.js';

export interface RequirementCoverage {
  totalRequirements: number;
  coveredRequirements: number;
  coveragePercent: number;
  missingRequirements: string[];
  coverageMap: Record<string, boolean>;
}

export interface CoverageAnalysis {
  requirements: RequirementCoverage;
  tests: {
    total: number;
    passing: number;
    coverage: number;
  };
  artifacts: {
    expected: string[];
    present: string[];
    missing: string[];
  };
}

/**
 * Analyze requirement coverage from evidence bundle
 */
export function analyzeRequirementCoverage(bundle: EvidenceBundle, state: DanteState): CoverageAnalysis {
  // Extract requirements from state/spec
  const requirements = extractRequirements(state);

  // Check coverage
  const coverageMap: Record<string, boolean> = {};
  const coveredRequirements: string[] = [];
  const missingRequirements: string[] = [];

  for (const req of requirements) {
    const covered = checkRequirementCovered(req, bundle, state);
    coverageMap[req] = covered;
    if (covered) {
      coveredRequirements.push(req);
    } else {
      missingRequirements.push(req);
    }
  }

  // Test coverage
  const totalTests = bundle.tests.length;
  const passingTests = bundle.tests.filter(t => t.status === 'pass').length;

  // Artifact coverage
  const expectedArtifacts = getExpectedArtifacts(state);
  const presentArtifacts = expectedArtifacts.filter(artifact => {
    return bundle.writes.some(write => write.path && write.path.includes(artifact));
  });

  return {
    requirements: {
      totalRequirements: requirements.length,
      coveredRequirements: coveredRequirements.length,
      coveragePercent: requirements.length > 0 ? (coveredRequirements.length / requirements.length) * 100 : 0,
      missingRequirements,
      coverageMap
    },
    tests: {
      total: totalTests,
      passing: passingTests,
      coverage: totalTests > 0 ? (passingTests / totalTests) * 100 : 0
    },
    artifacts: {
      expected: expectedArtifacts,
      present: presentArtifacts,
      missing: expectedArtifacts.filter(a => !presentArtifacts.includes(a))
    }
  };
}

function hasCompletedStage(state: DanteState, stage: string): boolean {
  return (state.auditLog ?? []).some((entry) => entry.includes(`| ${stage}:`));
}

function extractRequirements(state: DanteState): string[] {
  const requirements: string[] = [];

  // From constitution
  if (state.constitution) {
    requirements.push(...state.constitution.split('\n').filter(line => line.trim().length > 0));
  }

  // From spec
  if (hasCompletedStage(state, 'specify')) {
    requirements.push('Specification defined');
  }

  // From plan
  if (hasCompletedStage(state, 'plan')) {
    requirements.push('Implementation plan created');
  }

  // Default requirements
  requirements.push(
    'Project structure created',
    'Code implemented',
    'Tests written',
    'Documentation updated'
  );

  return [...new Set(requirements)]; // Remove duplicates
}

function checkRequirementCovered(requirement: string, bundle: EvidenceBundle, state: DanteState): boolean {
  // Check if requirement is evidenced in the bundle
  const lowerReq = requirement.toLowerCase();

  // Check for file operations
  if (lowerReq.includes('code') || lowerReq.includes('implement')) {
    return bundle.writes.length > 0;
  }

  // Check for tests
  if (lowerReq.includes('test')) {
    return bundle.tests.length > 0;
  }

  // Check for documentation
  if (lowerReq.includes('doc')) {
    return bundle.writes.some(w => w.path && (w.path.endsWith('.md') || w.path.includes('doc')));
  }

  // Check for plan
  if (lowerReq.includes('plan')) {
    return bundle.plan && Object.keys(bundle.plan).length > 0;
  }

  // Default: check if any evidence exists
  return bundle.reads.length > 0 || bundle.writes.length > 0 || bundle.commands.length > 0;
}

function getExpectedArtifacts(state: DanteState): string[] {
  const artifacts: string[] = [];

  // Planning phase artifacts
  if (state.workflowStage === 'constitution' || state.workflowStage === 'specify' ||
      state.workflowStage === 'clarify' || state.workflowStage === 'plan' || state.workflowStage === 'tasks') {
    if (!hasCompletedStage(state, 'constitution')) artifacts.push('CONSTITUTION.md');
    if (!hasCompletedStage(state, 'specify')) artifacts.push('SPEC.md');
    if (!hasCompletedStage(state, 'clarify')) artifacts.push('CLARIFY.md');
    if (!hasCompletedStage(state, 'plan')) artifacts.push('PLAN.md');
    if (!hasCompletedStage(state, 'tasks')) artifacts.push('TASKS.md');
  }

  // Execution phase artifacts
  if (state.workflowStage === 'forge' || state.workflowStage === 'verify') {
    artifacts.push('.danteforge/state.json');
  }

  // Verification artifacts
  if (state.workflowStage === 'verify') {
    artifacts.push('.danteforge/verify-results.json');
  }

  return artifacts;
}