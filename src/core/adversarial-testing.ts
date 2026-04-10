import { validateCompletion, type CompletionOracleResult } from '../core/completion-oracle.js';

export interface AdversarialTestCase {
  name: string;
  description: string;
  bundle: any; // Mock evidence bundle
  expectedVerdict: string;
  shouldDetectFalseCompletion: boolean;
}

export const adversarialTestCases: AdversarialTestCase[] = [
  {
    name: 'files-written-no-commands',
    description: 'Files written without any commands executed',
    bundle: {
      reads: [],
      writes: [{ path: '/file1', operation: 'write' }],
      commands: [],
      tests: [],
      gates: [],
      plan: {}
    },
    expectedVerdict: 'misleadingly_complete',
    shouldDetectFalseCompletion: true
  },
  {
    name: 'no-evidence-whatsoever',
    description: 'Completely empty evidence bundle',
    bundle: {
      reads: [],
      writes: [],
      commands: [],
      tests: [],
      gates: [],
      plan: {}
    },
    expectedVerdict: 'regressed',
    shouldDetectFalseCompletion: true
  },
  {
    name: 'failing-tests',
    description: 'All tests failing despite claims of completion',
    bundle: {
      reads: [{ path: '/file1' }],
      writes: [{ path: '/file2' }],
      commands: [{ exitCode: 0 }],
      tests: [{ status: 'fail' }, { status: 'fail' }],
      gates: [{ status: 'pass' }],
      plan: { tasks: ['task1'] }
    },
    expectedVerdict: 'inconclusive',
    shouldDetectFalseCompletion: true
  },
  {
    name: 'genuine-completion',
    description: 'Properly completed work with all evidence',
    bundle: {
      reads: [{ path: '/file1' }],
      writes: [{ path: '/file2' }],
      commands: [{ exitCode: 0 }],
      tests: [{ status: 'pass' }],
      gates: [{ status: 'pass' }],
      plan: { tasks: ['task1'] }
    },
    expectedVerdict: 'complete',
    shouldDetectFalseCompletion: false
  }
];

export async function runAdversarialTests(state: any): Promise<{
  results: Array<{ test: AdversarialTestCase; result: CompletionOracleResult; passed: boolean }>;
  summary: { total: number; passed: number; detectionRate: number };
}> {
  const results = [];

  for (const testCase of adversarialTestCases) {
    const result = validateCompletion(testCase.bundle, state);
    const passed = result.verdict === testCase.expectedVerdict;
    results.push({ test: testCase, result, passed });
  }

  const total = results.length;
  const passed = results.filter(r => r.passed).length;
  const detectionRate = results.filter(r => r.test.shouldDetectFalseCompletion && r.result.verdict !== 'complete').length /
                       results.filter(r => r.test.shouldDetectFalseCompletion).length;

  return {
    results,
    summary: {
      total,
      passed,
      detectionRate: detectionRate * 100
    }
  };
}