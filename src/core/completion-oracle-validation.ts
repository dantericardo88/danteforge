import { runAdversarialTests } from '../core/adversarial-testing.js';

export async function runCompletionOracleValidation(): Promise<any> {
  const { loadState } = await import('../core/state.js');
  const state = await loadState();

  const testResults = await runAdversarialTests(state);

  return {
    adversarialTestResults: testResults,
    oracleHealth: testResults.summary.passed === testResults.summary.total ? 'healthy' : 'issues'
  };
}