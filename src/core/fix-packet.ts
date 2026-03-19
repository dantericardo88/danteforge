// Fix Packets — structured JSON remediation instructions
// Harvested from: Rigour (rigour-labs) — machine-readable fix instructions, not just PASS/FAIL
// Upgrades DanteForge from blocking gates to actionable remediation.

import { logger } from './logger.js';
import type { ReflectionVerdict } from './reflection-engine.js';
import type { LoopDetectionResult } from './loop-detector.js';

// --- Types -------------------------------------------------------------------

export type ViolationType =
  | 'test-missing'
  | 'build-fail'
  | 'lint-fail'
  | 'ai-drift'
  | 'loop-detected'
  | 'stub-detected'
  | 'security';

export type ViolationSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'BLOCKER';

export interface Violation {
  type: ViolationType;
  severity: ViolationSeverity;
  file?: string;
  line?: number;
  message: string;
  evidence?: string;
}

export interface RemediationStep {
  action: string;
  priority: number; // 1 = highest
  automated: boolean;
  command?: string;
}

export interface FixPacket {
  taskName: string;
  violations: Violation[];
  score: number; // 0–100 (higher = better, fewer violations)
  remediation: RemediationStep[];
  timestamp: string;
}

// --- Severity Ordering -------------------------------------------------------

const SEVERITY_ORDER: Record<ViolationSeverity, number> = {
  BLOCKER: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

function sortViolations(violations: Violation[]): Violation[] {
  return [...violations].sort((a, b) => SEVERITY_ORDER[b.severity] - SEVERITY_ORDER[a.severity]);
}

// --- Violation Generators ----------------------------------------------------

function verdictToViolations(verdict: ReflectionVerdict): Violation[] {
  const violations: Violation[] = [];

  if (!verdict.evidence.tests.ran) {
    violations.push({
      type: 'test-missing',
      severity: 'HIGH',
      message: 'Tests were not run after code changes',
    });
  } else if (!verdict.evidence.tests.passed) {
    violations.push({
      type: 'test-missing',
      severity: 'BLOCKER',
      message: 'Tests failed',
      evidence: 'Test execution returned failures',
    });
  }

  if (verdict.evidence.build.ran && !verdict.evidence.build.passed) {
    violations.push({
      type: 'build-fail',
      severity: 'BLOCKER',
      message: 'Build failed',
    });
  }

  if (verdict.evidence.lint.ran && !verdict.evidence.lint.passed) {
    violations.push({
      type: 'lint-fail',
      severity: 'MEDIUM',
      message: 'Lint errors detected',
    });
  }

  if (verdict.stuck) {
    violations.push({
      type: 'ai-drift',
      severity: 'HIGH',
      message: 'Agent reported being stuck — possible context drift',
    });
  }

  return violations;
}

function loopToViolations(loopResult: LoopDetectionResult): Violation[] {
  if (!loopResult.detected) return [];

  return [{
    type: 'loop-detected',
    severity: loopResult.severity === 'HIGH' ? 'BLOCKER' : loopResult.severity,
    message: `${loopResult.type} loop detected`,
    evidence: loopResult.evidence,
  }];
}

// --- Remediation Generation --------------------------------------------------

function generateRemediation(violations: Violation[]): RemediationStep[] {
  const steps: RemediationStep[] = [];
  let priority = 1;

  for (const v of violations) {
    switch (v.type) {
      case 'test-missing':
        if (!v.evidence?.includes('failed')) {
          steps.push({
            action: 'Run the test suite',
            priority: priority++,
            automated: true,
            command: 'npm test',
          });
        } else {
          steps.push({
            action: 'Fix failing tests, then re-run',
            priority: priority++,
            automated: false,
          });
        }
        break;

      case 'build-fail':
        steps.push({
          action: 'Fix build errors and rebuild',
          priority: priority++,
          automated: true,
          command: 'npm run build',
        });
        break;

      case 'lint-fail':
        steps.push({
          action: 'Fix lint errors',
          priority: priority++,
          automated: true,
          command: 'npm run lint:fix',
        });
        break;

      case 'loop-detected':
        steps.push({
          action: v.evidence?.includes('planning')
            ? 'STOP reading files. START writing code immediately.'
            : 'STOP repeating commands. Try a different approach or ask for help.',
          priority: priority++,
          automated: false,
        });
        break;

      case 'ai-drift':
        steps.push({
          action: 'Review recent changes for hallucinated imports or phantom APIs',
          priority: priority++,
          automated: false,
        });
        break;

      case 'stub-detected':
        steps.push({
          action: `Replace stub/placeholder in ${v.file ?? 'affected file'}`,
          priority: priority++,
          automated: false,
        });
        break;

      case 'security':
        steps.push({
          action: `Fix security issue: ${v.message}`,
          priority: priority++,
          automated: false,
        });
        break;
    }
  }

  return steps;
}

// --- Score Calculation -------------------------------------------------------

function calculateScore(violations: Violation[]): number {
  if (violations.length === 0) return 100;

  let deduction = 0;
  for (const v of violations) {
    switch (v.severity) {
      case 'BLOCKER': deduction += 40; break;
      case 'HIGH': deduction += 25; break;
      case 'MEDIUM': deduction += 10; break;
      case 'LOW': deduction += 3; break;
    }
  }

  return Math.max(0, 100 - deduction);
}

// --- Public API --------------------------------------------------------------

export function generateFixPacket(
  verdict: ReflectionVerdict,
  loopResult: LoopDetectionResult = { detected: false, type: 'none', evidence: '', severity: 'LOW' },
): FixPacket {
  const verdictViolations = verdictToViolations(verdict);
  const loopViolations = loopToViolations(loopResult);
  const allViolations = sortViolations([...verdictViolations, ...loopViolations]);
  const remediation = generateRemediation(allViolations);
  const score = calculateScore(allViolations);

  const packet: FixPacket = {
    taskName: verdict.taskName,
    violations: allViolations,
    score,
    remediation,
    timestamp: new Date().toISOString(),
  };

  if (allViolations.length > 0) {
    logger.info(`Fix Packet: ${allViolations.length} violation(s), score: ${score}/100`);
  }

  return packet;
}

export function hasBlockers(packet: FixPacket): boolean {
  return packet.violations.some(v => v.severity === 'BLOCKER');
}

export function getAutomatedSteps(packet: FixPacket): RemediationStep[] {
  return packet.remediation.filter(step => step.automated);
}
