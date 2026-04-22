// verifier behavioral tests — verifyTask with injection seams
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { verifyTask, parseVerdict, type VerifyOptions } from '../src/core/verifier.js';
import { logger } from '../src/core/logger.js';

// Suppress logger output during tests
const origInfo = logger.info;
const origWarn = logger.warn;
const origError = logger.error;
const origSuccess = logger.success;
const origVerbose = logger.verbose;

before(() => {
  logger.info = () => {};
  logger.warn = () => {};
  logger.error = () => {};
  logger.success = () => {};
  logger.verbose = () => {};
});

after(() => {
  logger.info = origInfo;
  logger.warn = origWarn;
  logger.error = origError;
  logger.success = origSuccess;
  logger.verbose = origVerbose;
});

function makeState() {
  return {
    project: 'test',
    created: new Date().toISOString(),
    workflowStage: 'verify',
    currentPhase: 1,
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    gateResults: {},
    auditLog: [] as string[],
  };
}

function makeOptions(overrides: Partial<VerifyOptions> = {}): VerifyOptions {
  const state = makeState();
  return {
    _loadState: async () => state,
    _saveState: async () => {},
    _isLLMAvailable: async () => true,
    _llmCaller: async () => 'PASS\nAll good',
    ...overrides,
  };
}

describe('verifyTask — behavioral tests', () => {
  it('PASS response → returns true', async () => {
    const opts = makeOptions({
      _llmCaller: async () => 'PASS\nAll criteria met.',
    });

    const result = await verifyTask(
      { name: 'Build auth', verify: 'Returns 200' },
      'function handler() { return 200; }',
      opts,
    );

    assert.equal(result, true);
  });

  it('FAIL response → returns false', async () => {
    const opts = makeOptions({
      _llmCaller: async () => 'FAIL\nMissing error handling.',
    });

    const result = await verifyTask(
      { name: 'Build auth', verify: 'Returns 200' },
      'function handler() { return 200; }',
      opts,
    );

    assert.equal(result, false);
  });

  it('LLM throws → returns false, audit log has ERROR entry', async () => {
    const state = makeState();
    const opts = makeOptions({
      _loadState: async () => state,
      _saveState: async (s) => { Object.assign(state, s); },
      _llmCaller: async () => { throw new Error('connection timeout'); },
    });

    const result = await verifyTask(
      { name: 'Deploy service', verify: 'Service is live' },
      'deploy script output here',
      opts,
    );

    assert.equal(result, false);
    const errorEntry = state.auditLog.find((e: string) => e.includes('ERROR'));
    assert.ok(errorEntry, `expected ERROR in audit log, got: ${JSON.stringify(state.auditLog)}`);
    assert.ok(errorEntry.includes('connection timeout'));
  });

  it('empty taskOutput → returns false without calling LLM', async () => {
    let llmCalled = false;
    const opts = makeOptions({
      _llmCaller: async () => { llmCalled = true; return 'PASS'; },
    });

    const result = await verifyTask(
      { name: 'Check output', verify: 'Has content' },
      '',
      opts,
    );

    assert.equal(result, false);
    assert.equal(llmCalled, false, 'LLM should not be called when taskOutput is empty');
  });

  it('LLM unavailable → returns false', async () => {
    let llmCalled = false;
    const opts = makeOptions({
      _isLLMAvailable: async () => false,
      _llmCaller: async () => { llmCalled = true; return 'PASS'; },
    });

    const result = await verifyTask(
      { name: 'Verify feature', verify: 'Feature works' },
      'some output',
      opts,
    );

    assert.equal(result, false);
    assert.equal(llmCalled, false, 'LLM should not be called when unavailable');
  });

  it('audit log written with PASS entry on success', async () => {
    const state = makeState();
    const opts = makeOptions({
      _loadState: async () => state,
      _saveState: async (s) => { Object.assign(state, s); },
      _llmCaller: async () => 'PASS\nAll checks passed',
    });

    await verifyTask(
      { name: 'Auth endpoint', verify: 'Returns 200' },
      'function handler() { return 200; }',
      opts,
    );

    const passEntry = state.auditLog.find((e: string) => e.includes('PASS'));
    assert.ok(passEntry, `expected PASS in audit log, got: ${JSON.stringify(state.auditLog)}`);
    assert.ok(passEntry.includes('Auth endpoint'));
  });

  it('audit log written with FAIL entry on failure', async () => {
    const state = makeState();
    const opts = makeOptions({
      _loadState: async () => state,
      _saveState: async (s) => { Object.assign(state, s); },
      _llmCaller: async () => 'FAIL\nBroken implementation',
    });

    await verifyTask(
      { name: 'Payment flow', verify: 'Processes payments' },
      'incomplete code',
      opts,
    );

    const failEntry = state.auditLog.find((e: string) => e.includes('FAIL'));
    assert.ok(failEntry, `expected FAIL in audit log, got: ${JSON.stringify(state.auditLog)}`);
    assert.ok(failEntry.includes('Payment flow'));
  });

  it('audit log written with BLOCKED entry when no output', async () => {
    const state = makeState();
    const opts = makeOptions({
      _loadState: async () => state,
      _saveState: async (s) => { Object.assign(state, s); },
    });

    await verifyTask(
      { name: 'Missing task', verify: 'Should exist' },
      undefined,
      opts,
    );

    const blockedEntry = state.auditLog.find((e: string) => e.includes('BLOCKED'));
    assert.ok(blockedEntry, `expected BLOCKED in audit log, got: ${JSON.stringify(state.auditLog)}`);
    assert.ok(blockedEntry.includes('Missing task'));
  });

  it('custom verify criteria passed to prompt (check _llmCaller receives it)', async () => {
    let capturedPrompt = '';
    const opts = makeOptions({
      _llmCaller: async (prompt: string) => {
        capturedPrompt = prompt;
        return 'PASS\nCriteria met';
      },
    });

    await verifyTask(
      { name: 'Rate limiter', verify: 'Blocks more than 100 requests per minute' },
      'const limiter = rateLimit({ max: 100 });',
      opts,
    );

    assert.ok(
      capturedPrompt.includes('Blocks more than 100 requests per minute'),
      `expected custom criteria in prompt, got: ${capturedPrompt.slice(0, 300)}`,
    );
    assert.ok(
      capturedPrompt.includes('Rate limiter'),
      `expected task name in prompt`,
    );
  });

  it('state saved after each verification', async () => {
    let saveCount = 0;
    const state = makeState();
    const opts = makeOptions({
      _loadState: async () => state,
      _saveState: async (s) => {
        saveCount++;
        Object.assign(state, s);
      },
      _llmCaller: async () => 'PASS\nOK',
    });

    await verifyTask(
      { name: 'Save check', verify: 'State persisted' },
      'output here',
      opts,
    );

    assert.ok(saveCount >= 1, `expected state to be saved at least once, saveCount=${saveCount}`);
  });
});
