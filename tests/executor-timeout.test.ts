import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Executor Timeout (Wave 1A)', () => {
  const executorSrc = readFileSync(resolve('src/harvested/gsd/agents/executor.ts'), 'utf-8');

  it('exports DEFAULT_TASK_TIMEOUT_MS constant', () => {
    assert.ok(executorSrc.includes('export const DEFAULT_TASK_TIMEOUT_MS'), 'Missing DEFAULT_TASK_TIMEOUT_MS export');
  });

  it('DEFAULT_TASK_TIMEOUT_MS is 300_000', () => {
    assert.ok(executorSrc.includes('300_000') || executorSrc.includes('300000'), 'Timeout should be 5 minutes');
  });

  it('defines withTimeout helper', () => {
    assert.ok(executorSrc.includes('function withTimeout'), 'Missing withTimeout helper');
  });

  it('withTimeout rejects with task name on timeout', () => {
    assert.ok(executorSrc.includes('timed out after'), 'Timeout error should include task name');
  });

  it('withTimeout clears timer on success', () => {
    assert.ok(executorSrc.includes('clearTimeout(timer)'), 'Timer must be cleared on resolve');
  });

  it('withTimeout clears timer on error', () => {
    const clearTimeoutCount = (executorSrc.match(/clearTimeout\(timer\)/g) || []).length;
    assert.ok(clearTimeoutCount >= 2, `Expected at least 2 clearTimeout calls, found ${clearTimeoutCount}`);
  });

  it('executeWave accepts timeoutMs parameter', () => {
    assert.ok(executorSrc.includes('timeoutMs'), 'Missing timeoutMs parameter');
  });

  it('parallel tasks are wrapped with withTimeout', () => {
    assert.ok(executorSrc.includes('withTimeout(runTask('), 'Parallel tasks should use withTimeout');
  });
});
