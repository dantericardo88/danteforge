// executor-state.ts tests — executeWave with _stateCaller/_memorizer injection seams
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { executeWave } from '../src/harvested/gsd/agents/executor.js';

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    project: 'test',
    workflowStage: 'forge' as const,
    currentPhase: 1,
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: { 1: [{ name: 'test-task', files: ['a.ts'], verify: 'echo ok' }] } as Record<number, { name: string; files?: string[]; verify?: string }[]>,
    auditLog: [] as string[],
    ...overrides,
  };
}

function makeStateCaller(state: ReturnType<typeof makeState>) {
  let loadCount = 0;
  let saveCount = 0;
  let lastSavedState: ReturnType<typeof makeState> | undefined;
  return {
    calls: { get loadCount() { return loadCount; }, get saveCount() { return saveCount; }, get lastSavedState() { return lastSavedState; } },
    load: async () => { loadCount++; return state; },
    save: async (s: ReturnType<typeof makeState>) => { saveCount++; lastSavedState = s; },
  };
}

describe('executeWave — _stateCaller injection', () => {
  it('state loaded and saved via injected _stateCaller', async () => {
    const state = makeState();
    const sc = makeStateCaller(state);

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'done',
      _verifier: async () => true,
      _reflector: async () => { throw new Error('skip'); },
      _stateCaller: sc,
    });

    assert.ok(sc.calls.loadCount >= 1, 'load should have been called at least once');
    assert.ok(sc.calls.saveCount >= 1, 'save should have been called at least once');
    assert.ok(sc.calls.lastSavedState!.auditLog.length > 0, 'audit log should have been appended');
  });

  it('phase incremented on all-pass', async () => {
    const state = makeState({ currentPhase: 1 });
    const sc = makeStateCaller(state);

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'done',
      _verifier: async () => true,
      _reflector: async () => { throw new Error('skip'); },
      _stateCaller: sc,
    });

    assert.strictEqual(sc.calls.lastSavedState!.currentPhase, 2, 'phase should advance from 1 to 2');
  });

  it('phase NOT incremented on failure', async () => {
    const state = makeState({ currentPhase: 1 });
    const sc = makeStateCaller(state);

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'done',
      _verifier: async () => false,
      _reflector: async () => { throw new Error('skip'); },
      _stateCaller: sc,
    });

    assert.strictEqual(sc.calls.lastSavedState!.currentPhase, 1, 'phase should remain at 1 when task fails verification');
  });

  it('audit log records pass/fail counts', async () => {
    const state = makeState({
      tasks: {
        1: [
          { name: 'pass-task', files: ['a.ts'], verify: 'ok' },
          { name: 'fail-task', files: ['b.ts'], verify: 'nope' },
        ],
      },
    });
    const sc = makeStateCaller(state);
    let callNum = 0;

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'done',
      _verifier: async () => { callNum++; return callNum === 1; },
      _reflector: async () => { throw new Error('skip'); },
      _stateCaller: sc,
    });

    const lastLog = sc.calls.lastSavedState!.auditLog.at(-1)!;
    assert.ok(lastLog.includes('1/2 passed'), `audit log should contain "1/2 passed", got: ${lastLog}`);
  });
});

describe('executeWave — _memorizer injection', () => {
  it('memory recording on LLM failure', async () => {
    const state = makeState();
    const sc = makeStateCaller(state);
    let memoryCalled = false;
    let memoryCategory = '';

    await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => { throw new Error('LLM down'); },
      _verifier: async () => true,
      _reflector: async () => { throw new Error('skip'); },
      _stateCaller: sc,
      _memorizer: async (entry) => { memoryCalled = true; memoryCategory = entry.category; },
    });

    assert.ok(memoryCalled, '_memorizer should have been called on LLM failure');
    assert.strictEqual(memoryCategory, 'error', 'memory entry category should be "error"');
  });

  it('memory recording failure does not block execution', async () => {
    const state = makeState();
    const sc = makeStateCaller(state);

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => { throw new Error('LLM down'); },
      _verifier: async () => true,
      _reflector: async () => { throw new Error('skip'); },
      _stateCaller: sc,
      _memorizer: async () => { throw new Error('Memory write failed'); },
    });

    // Should still complete (success=false because LLM threw, but did not crash)
    assert.strictEqual(result.mode, 'executed');
    assert.strictEqual(result.success, false);
  });
});

describe('executeWave — prompt mode with _stateCaller', () => {
  it('prompt mode generates prompts and saves state', async () => {
    const state = makeState();
    const sc = makeStateCaller(state);

    const result = await executeWave(1, 'balanced', false, true, false, 30000, {
      _stateCaller: sc,
    });

    assert.strictEqual(result.mode, 'prompt');
    assert.strictEqual(result.success, true);
    assert.ok(sc.calls.saveCount >= 1, 'save should be called in prompt mode');
  });
});

describe('executeWave — edge cases with _stateCaller', () => {
  it('no tasks returns blocked', async () => {
    const state = makeState({ tasks: { 1: [] } });
    const sc = makeStateCaller(state);

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'done',
      _verifier: async () => true,
      _stateCaller: sc,
    });

    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });

  it('LLM unavailable without prompt mode returns blocked', async () => {
    const state = makeState();
    const sc = makeStateCaller(state);

    // No _llmCaller and no live LLM → blocked
    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _stateCaller: sc,
    });

    assert.strictEqual(result.mode, 'blocked');
    assert.strictEqual(result.success, false);
  });

  it('reflection failure does not block execution', async () => {
    const state = makeState();
    const sc = makeStateCaller(state);

    const result = await executeWave(1, 'balanced', false, false, false, 30000, {
      _llmCaller: async () => 'done',
      _verifier: async () => true,
      _reflector: async () => { throw new Error('Reflection engine crash'); },
      _stateCaller: sc,
    });

    assert.strictEqual(result.mode, 'executed');
    assert.strictEqual(result.success, true, 'reflection failure should not block success');
  });
});
