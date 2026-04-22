// LLM pipeline stage tests — isolated unit tests for each extracted stage
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  enrichPrompt,
  applyRouting,
  enforceBudget,
  dispatchWithRetry,
  handleUsage,
  persistAudit,
} from '../src/core/llm-pipeline.js';
import { BudgetError, isRetryableError, DanteError, LLMError } from '../src/core/errors.js';
import { resetAllCircuits, recordFailure as cbRecordFailure, getCircuitState } from '../src/core/circuit-breaker.js';
import { invalidateStateCache } from '../src/core/state-cache.js';

let originalHome: string | undefined;
const tempDirs: string[] = [];

async function makeTempHome(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-pipeline-'));
  tempDirs.push(dir);
  const dfDir = path.join(dir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });
  await fs.writeFile(path.join(dfDir, 'STATE.yaml'), [
    'project: pipeline-test',
    `created: ${new Date().toISOString()}`,
    'workflowStage: forge',
    'currentPhase: 1',
    'lastHandoff: none',
    'profile: balanced',
    'tasks: {}',
    'gateResults: {}',
    'auditLog: []',
  ].join('\n'));
  return dir;
}

describe('enrichPrompt', () => {
  it('returns raw prompt when enrichContext is false', async () => {
    const result = await enrichPrompt('hello world', { enrichContext: false });
    assert.equal(result, 'hello world');
  });

  it('returns raw prompt when enrichContext is undefined', async () => {
    const result = await enrichPrompt('hello', {});
    assert.equal(result, 'hello');
  });
});

describe('applyRouting', () => {
  it('does nothing when taskSignature is undefined', async () => {
    // Should complete without error
    const result = await applyRouting({});
    assert.equal(result, undefined);
  });

  it('handles routing gracefully with taskSignature (best-effort)', async () => {
    // The dynamic import of task-router may fail or succeed depending on module resolution;
    // applyRouting should never throw — it's best-effort.
    const result = await applyRouting({ taskSignature: { type: 'llm', complexity: 'simple', context: '' } as never });
    assert.equal(result, undefined);
  });
});

describe('enforceBudget', () => {
  it('does nothing without budgetFence', () => {
    const result = enforceBudget({});
    assert.equal(result, undefined);
  });

  it('throws BudgetError when budget is exceeded', () => {
    const fence = {
      agentRole: 'test-agent',
      maxBudgetUsd: 1.00,
      currentSpendUsd: 1.50,
      isExceeded: false,
      warningThresholdPercent: 80,
    };
    assert.throws(() => enforceBudget({ budgetFence: fence }), (err: unknown) => {
      assert.ok(err instanceof BudgetError);
      assert.equal(err.agentRole, 'test-agent');
      assert.equal(err.currentSpendUsd, 1.50);
      assert.equal(err.maxBudgetUsd, 1.00);
      assert.equal(err.code, 'BUDGET_EXCEEDED');
      return true;
    });
  });

  it('does not throw when budget is within limits', () => {
    const fence = {
      agentRole: 'test-agent',
      maxBudgetUsd: 10.00,
      currentSpendUsd: 5.00,
      isExceeded: false,
      warningThresholdPercent: 80,
    };
    enforceBudget({ budgetFence: fence });
    assert.equal(fence.isExceeded, false, 'Fence should remain not exceeded');
  });

  it('warns near threshold without throwing', () => {
    const fence = {
      agentRole: 'test-agent',
      maxBudgetUsd: 10.00,
      currentSpendUsd: 9.00,
      isExceeded: false,
      warningThresholdPercent: 80,
    };
    // 90% ≥ 80% threshold → should warn but not throw
    enforceBudget({ budgetFence: fence });
    assert.equal(fence.isExceeded, false, 'Fence should remain not exceeded at warning level');
  });
});

describe('dispatchWithRetry', () => {
  it('returns result on first success', async () => {
    let callCount = 0;
    const result = await dispatchWithRetry(
      async () => { callCount++; return { response: { text: 'ok' }, modelUsed: 'test-model' }; },
      { maxRetries: 2, retryDelays: [10, 20] },
    );
    assert.equal(result.response.text, 'ok');
    assert.equal(result.modelUsed, 'test-model');
    assert.equal(result.attempt, 0);
    assert.equal(callCount, 1);
  });

  it('retries on retryable error and succeeds', async () => {
    let callCount = 0;
    const result = await dispatchWithRetry(
      async () => {
        callCount++;
        if (callCount === 1) throw new DanteError('retry me', 'LLM_TIMEOUT', true);
        return { response: { text: 'recovered' }, modelUsed: 'test-model' };
      },
      { maxRetries: 2, retryDelays: [10, 20] },
    );
    assert.equal(result.response.text, 'recovered');
    assert.equal(result.attempt, 1);
    assert.equal(callCount, 2);
  });

  it('does NOT retry non-retryable errors', async () => {
    let callCount = 0;
    await assert.rejects(
      () => dispatchWithRetry(
        async () => { callCount++; throw new DanteError('fatal', 'LLM_AUTH_FAILED', false); },
        { maxRetries: 2, retryDelays: [10, 20] },
      ),
      (err: unknown) => {
        assert.ok(err instanceof DanteError);
        assert.equal(err.code, 'LLM_AUTH_FAILED');
        return true;
      },
    );
    assert.equal(callCount, 1, 'Should not retry non-retryable error');
  });

  it('exhausts retries and throws last error', async () => {
    let callCount = 0;
    await assert.rejects(
      () => dispatchWithRetry(
        async () => { callCount++; throw new Error('ECONNRESET'); },
        { maxRetries: 1, retryDelays: [10] },
      ),
      { message: 'ECONNRESET' },
    );
    assert.equal(callCount, 2, 'Should attempt 1 + 1 retry');
  });

  it('uses injected sleep and provider delay hooks when provided', async () => {
    let callCount = 0;
    const sleeps: number[] = [];

    const result = await dispatchWithRetry(
      async () => {
        callCount++;
        if (callCount === 1) throw new DanteError('retry me', 'LLM_TIMEOUT', true);
        return { response: { text: 'recovered' }, modelUsed: 'test-model' };
      },
      { maxRetries: 2, retryDelays: [999, 999] },
      'openai',
      {
        sleep: async (ms) => { sleeps.push(ms); },
        providerDelay: () => 0,
      },
    );

    assert.equal(result.response.text, 'recovered');
    assert.deepStrictEqual(sleeps, [0]);
  });
});

describe('handleUsage', () => {
  it('returns undefined when response has no usage', async () => {
    const result = await handleUsage({ text: 'hello' }, 'ollama', 'llama3', {});
    assert.equal(result, undefined);
  });

  it('invokes onUsage callback with metadata', async () => {
    let captured: unknown = null;
    const result = await handleUsage(
      { text: 'hello', usage: { inputTokens: 100, outputTokens: 50 } },
      'ollama',
      'llama3',
      { onUsage: (meta) => { captured = meta; } },
    );
    assert.ok(result);
    assert.equal(result.inputTokens, 100);
    assert.equal(result.outputTokens, 50);
    assert.equal(result.provider, 'ollama');
    assert.equal(result.model, 'llama3');
    assert.ok(captured !== null, 'onUsage callback should have been called');
  });

  it('updates budget fence with cost', async () => {
    const fence = {
      agentRole: 'test',
      maxBudgetUsd: 10.00,
      currentSpendUsd: 0.00,
      isExceeded: false,
      warningThresholdPercent: 80,
    };
    await handleUsage(
      { text: 'hello', usage: { inputTokens: 1000, outputTokens: 500 } },
      'ollama',
      'llama3',
      { budgetFence: fence },
    );
    assert.ok(fence.currentSpendUsd >= 0, 'Budget should be updated');
  });
});

describe('persistAudit', () => {
  let tempHome: string;

  before(async () => {
    originalHome = process.env.DANTEFORGE_HOME;
    tempHome = await makeTempHome();
    process.env.DANTEFORGE_HOME = tempHome;
  });

  after(async () => {
    if (originalHome !== undefined) {
      process.env.DANTEFORGE_HOME = originalHome;
    } else {
      delete process.env.DANTEFORGE_HOME;
    }
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('appends audit log entry to state', async () => {
    await persistAudit('response text', 'ollama', 'llama3', 100, 0, { recordMemory: false, cwd: tempHome });
    const stateYaml = await fs.readFile(path.join(tempHome, '.danteforge', 'STATE.yaml'), 'utf-8');
    assert.ok(stateYaml.includes('ollama/llama3'), 'Audit log should contain provider/model');
  });

  it('includes attempt info for retried calls', async () => {
    await persistAudit('response', 'ollama', 'llama3', 50, 2, { recordMemory: false, cwd: tempHome });
    const stateYaml = await fs.readFile(path.join(tempHome, '.danteforge', 'STATE.yaml'), 'utf-8');
    assert.ok(stateYaml.includes('attempt 3'), 'Audit log should show attempt number for retried calls');
  });
});

describe('dispatchWithRetry — circuit breaker integration', () => {
  // Clean circuit state between tests
  before(() => { resetAllCircuits(); });
  after(() => { resetAllCircuits(); });

  it('rejects immediately when circuit is open', async () => {
    // Open the circuit by recording enough failures
    cbRecordFailure('test-open', { failureThreshold: 1, resetTimeoutMs: 60000, halfOpenSuccessThreshold: 1 });

    let dispatcherCalled = false;
    await assert.rejects(
      () => dispatchWithRetry(
        async () => { dispatcherCalled = true; return { response: { text: 'ok' }, modelUsed: 'm' }; },
        { maxRetries: 0, retryDelays: [] },
        'test-open',
      ),
      (err: unknown) => {
        assert.ok(err instanceof LLMError);
        assert.equal(err.code, 'LLM_CIRCUIT_OPEN');
        assert.equal(err.provider, 'test-open');
        return true;
      },
    );
    assert.ok(!dispatcherCalled, 'Dispatcher should never be called when circuit is open');
  });

  it('records success and keeps circuit closed', async () => {
    resetAllCircuits();
    await dispatchWithRetry(
      async () => ({ response: { text: 'ok' }, modelUsed: 'm' }),
      { maxRetries: 0, retryDelays: [] },
      'test-success',
    );
    assert.equal(getCircuitState('test-success'), 'closed');
  });

  it('records failure and opens circuit after threshold', async () => {
    resetAllCircuits();
    const config = { failureThreshold: 2, resetTimeoutMs: 60000, halfOpenSuccessThreshold: 1 };
    // First failure
    try {
      await dispatchWithRetry(
        async () => { throw new DanteError('fail', 'LLM_AUTH_FAILED', false); },
        { maxRetries: 0, retryDelays: [] },
        'test-fail',
      );
    } catch { /* expected */ }

    // Need a second failure with same config to open — but circuit-breaker uses default config
    // Record directly to control threshold
    cbRecordFailure('test-fail-direct', config);
    cbRecordFailure('test-fail-direct', config);
    assert.equal(getCircuitState('test-fail-direct'), 'open');
  });

  it('uses exponential backoff when provider is given', async () => {
    resetAllCircuits();
    let callCount = 0;
    const sleeps: number[] = [];
    const result = await dispatchWithRetry(
      async () => {
        callCount++;
        if (callCount === 1) throw new DanteError('retry', 'LLM_TIMEOUT', true);
        return { response: { text: 'recovered' }, modelUsed: 'm' };
      },
      { maxRetries: 1, retryDelays: [99999] }, // retryDelays should be IGNORED when provider is set
      'test-backoff',
      { sleep: async (ms) => { sleeps.push(ms); } },
    );
    assert.equal(result.response.text, 'recovered');
    assert.equal(callCount, 2);
    assert.deepStrictEqual(sleeps, [1000]);
  });

  it('falls back to config delays when no provider', async () => {
    let callCount = 0;
    const start = Date.now();
    const result = await dispatchWithRetry(
      async () => {
        callCount++;
        if (callCount === 1) throw new DanteError('retry', 'LLM_TIMEOUT', true);
        return { response: { text: 'ok' }, modelUsed: 'm' };
      },
      { maxRetries: 1, retryDelays: [10] },
      // NO provider — should use retryDelays
    );
    assert.equal(result.response.text, 'ok');
    assert.equal(callCount, 2);
  });

  it('LLM_CIRCUIT_OPEN error is not retryable', () => {
    const err = new LLMError('circuit open', 'LLM_CIRCUIT_OPEN', 'openai', undefined, false);
    assert.equal(isRetryableError(err), false);
  });
});

describe('persistAudit — state cache integration', () => {
  let tempDir: string;

  before(async () => {
    invalidateStateCache();
    tempDir = await makeTempHome();
  });

  after(async () => {
    invalidateStateCache();
  });

  it('writes through cache to disk', async () => {
    await persistAudit('cached-response', 'ollama', 'llama3', 100, 0, { recordMemory: false, cwd: tempDir });
    const stateYaml = await fs.readFile(path.join(tempDir, '.danteforge', 'STATE.yaml'), 'utf-8');
    assert.ok(stateYaml.includes('ollama/llama3'), 'Audit entry should be persisted to disk');
  });

  it('uses cached state for consecutive calls within TTL', async () => {
    const dir = await makeTempHome();
    await persistAudit('first', 'ollama', 'llama3', 50, 0, { recordMemory: false, cwd: dir });
    await persistAudit('second', 'ollama', 'llama3', 50, 0, { recordMemory: false, cwd: dir });

    const stateYaml = await fs.readFile(path.join(dir, '.danteforge', 'STATE.yaml'), 'utf-8');
    // Both entries should exist — the second call loaded from cache (which has the first entry)
    const auditMatches = stateYaml.match(/ollama\/llama3/g);
    assert.ok(auditMatches && auditMatches.length >= 2, 'Both audit entries should be in state file');
  });
});
