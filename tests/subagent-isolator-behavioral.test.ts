// subagent-isolator behavioral tests — runIsolatedAgent with injection seams
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  runIsolatedAgent,
  buildSubagentContext,
  type SubagentContext,
  type IsolatedAgentResult,
  type IsolatorOptions,
} from '../src/core/subagent-isolator.js';
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

function makeCtx(): SubagentContext {
  return buildSubagentContext('test-agent', { spec: 'test spec', plan: 'test plan' }, 'dev');
}

function passExecutor(output = 'generated code here'): (prompt: string) => Promise<string> {
  return async (_prompt: string) => output;
}

describe('runIsolatedAgent — behavioral tests', () => {
  it('both review stages PASS → flagged=false, 2 reviews', async () => {
    const ctx = makeCtx();
    const options: IsolatorOptions = {
      _llmCaller: async () => 'PASS: looks good',
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(), options);

    assert.equal(result.flagged, false);
    assert.equal(result.reviews.length, 2);
    assert.equal(result.reviews[0].passed, true);
    assert.equal(result.reviews[1].passed, true);
    assert.equal(result.reviews[0].flagged, false);
    assert.equal(result.reviews[1].flagged, false);
  });

  it('both review stages FAIL → flagged=true, 2 reviews', async () => {
    const ctx = makeCtx();
    const options: IsolatorOptions = {
      _llmCaller: async () => 'FAIL: issues found',
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(), options);

    assert.equal(result.flagged, true);
    assert.equal(result.reviews.length, 2);
    assert.equal(result.reviews[0].passed, false);
    assert.equal(result.reviews[1].passed, false);
  });

  it('one PASS + one FAIL → flagged=true', async () => {
    const ctx = makeCtx();
    let callCount = 0;
    const options: IsolatorOptions = {
      _llmCaller: async () => {
        callCount++;
        return callCount === 1 ? 'PASS: looks good' : 'FAIL: issues found';
      },
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(), options);

    assert.equal(result.flagged, true);
    assert.equal(result.reviews[0].passed, true);
    assert.equal(result.reviews[1].passed, false);
  });

  it('LLM unavailable → both flagged for manual review', async () => {
    const ctx = makeCtx();
    const options: IsolatorOptions = {
      _isLLMAvailable: async () => false,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(), options);

    assert.equal(result.flagged, true);
    assert.equal(result.reviews.length, 2);
    for (const review of result.reviews) {
      assert.equal(review.passed, false);
      assert.equal(review.flagged, true);
      assert.ok(review.feedback.includes('manual review'), `expected manual review mention, got: ${review.feedback}`);
    }
  });

  it('LLM throws → review marked as failed, flagged', async () => {
    const ctx = makeCtx();
    const options: IsolatorOptions = {
      _llmCaller: async () => { throw new Error('LLM exploded'); },
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(), options);

    assert.equal(result.flagged, true);
    assert.equal(result.reviews.length, 2);
    for (const review of result.reviews) {
      assert.equal(review.passed, false);
      assert.equal(review.flagged, true);
      assert.ok(review.feedback.includes('LLM exploded'), `expected error message, got: ${review.feedback}`);
    }
  });

  it('agent executor failure → early return, flagged, empty reviews', async () => {
    const ctx = makeCtx();
    const failingExecutor = async () => { throw new Error('agent crashed'); };
    const options: IsolatorOptions = {
      _llmCaller: async () => 'PASS: looks good',
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, failingExecutor, options);

    assert.equal(result.flagged, true);
    assert.equal(result.reviews.length, 0);
    assert.ok(result.output.includes('agent crashed'));
  });

  it('agent executor success + all PASS → output matches', async () => {
    const ctx = makeCtx();
    const expectedOutput = 'function hello() { return "world"; }';
    const options: IsolatorOptions = {
      _llmCaller: async () => 'PASS: looks good',
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(expectedOutput), options);

    assert.equal(result.output, expectedOutput);
    assert.equal(result.agent, 'test-agent');
    assert.equal(result.flagged, false);
  });

  it('_llmCaller receives correct review prompt format containing AGENT OUTPUT', async () => {
    const ctx = makeCtx();
    const capturedPrompts: string[] = [];
    const options: IsolatorOptions = {
      _llmCaller: async (prompt: string) => {
        capturedPrompts.push(prompt);
        return 'PASS: ok';
      },
      _isLLMAvailable: async () => true,
    };

    await runIsolatedAgent(ctx, passExecutor('my agent output'), options);

    assert.equal(capturedPrompts.length, 2);
    for (const prompt of capturedPrompts) {
      assert.ok(prompt.includes('AGENT OUTPUT'), `expected AGENT OUTPUT in prompt, got: ${prompt.slice(0, 200)}`);
      assert.ok(prompt.includes('my agent output'), `expected actual output in prompt`);
      assert.ok(prompt.includes('test-agent'), `expected agent name in prompt`);
    }
  });

  it('context compression does not block (best-effort)', async () => {
    // buildSubagentContext applies compression — verify it still produces a valid context
    const ctx = buildSubagentContext('compress-agent', {
      plan: 'A'.repeat(5000),
      tasks: 'task1\ntask2\ntask3',
      relevantFiles: 'src/index.ts',
    }, 'dev');

    const options: IsolatorOptions = {
      _llmCaller: async () => 'PASS: ok',
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(), options);

    // Should complete without throwing, regardless of compression
    assert.equal(result.flagged, false);
    assert.ok(result.durationMs >= 0);
  });

  it('mixed: first PASS, second throws → flagged=true', async () => {
    const ctx = makeCtx();
    let callCount = 0;
    const options: IsolatorOptions = {
      _llmCaller: async () => {
        callCount++;
        if (callCount === 1) return 'PASS: looks good';
        throw new Error('second review exploded');
      },
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(), options);

    assert.equal(result.flagged, true);
    assert.equal(result.reviews.length, 2);
    assert.equal(result.reviews[0].passed, true);
    assert.equal(result.reviews[0].flagged, false);
    assert.equal(result.reviews[1].passed, false);
    assert.equal(result.reviews[1].flagged, true);
    assert.ok(result.reviews[1].feedback.includes('second review exploded'));
  });

  it('empty output still reviewed', async () => {
    const ctx = makeCtx();
    const options: IsolatorOptions = {
      _llmCaller: async () => 'PASS: acceptable',
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(''), options);

    // Even empty string output goes through review
    assert.equal(result.output, '');
    assert.equal(result.reviews.length, 2);
    assert.equal(result.flagged, false);
  });

  it('review feedback contains the LLM response text', async () => {
    const ctx = makeCtx();
    const options: IsolatorOptions = {
      _llmCaller: async () => 'PASS: the code is clean and well-structured',
      _isLLMAvailable: async () => true,
    };

    const result = await runIsolatedAgent(ctx, passExecutor(), options);

    for (const review of result.reviews) {
      assert.ok(
        review.feedback.includes('clean and well-structured'),
        `expected LLM response in feedback, got: ${review.feedback}`,
      );
    }
  });
});
