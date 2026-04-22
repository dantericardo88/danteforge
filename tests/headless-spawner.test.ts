// headless-spawner.test.ts — tests for the headless Claude Code agent spawner
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  isClaudeCliAvailable,
  resetCliAvailabilityCache,
  buildCliArgs,
  parseStreamJsonOutput,
  spawnHeadlessAgent,
  spawnParallelAgents,
} from '../src/core/headless-spawner.js';

import type {
  HeadlessAgentConfig,
  SpawnerOptions,
} from '../src/core/headless-spawner.js';

// ---------------------------------------------------------------------------
// Mock spawn helper
// ---------------------------------------------------------------------------

type MockChild = ReturnType<NonNullable<SpawnerOptions['_spawnFn']>>;

function createMockSpawn(stdout: string, stderr: string, exitCode: number) {
  return (_cmd: string, _args: string[], _opts: Record<string, unknown>): MockChild => {
    const stdoutCallbacks: Array<(data: Buffer) => void> = [];
    const stderrCallbacks: Array<(data: Buffer) => void> = [];
    const closeCallbacks: Array<(code: number | null) => void> = [];

    // Schedule data emission on next tick so callers can register listeners first
    setTimeout(() => {
      for (const cb of stdoutCallbacks) cb(Buffer.from(stdout));
      for (const cb of stderrCallbacks) cb(Buffer.from(stderr));
      for (const cb of closeCallbacks) cb(exitCode);
    }, 10);

    return {
      stdout: { on: (_event: string, cb: (data: Buffer) => void) => { stdoutCallbacks.push(cb); } },
      stderr: { on: (_event: string, cb: (data: Buffer) => void) => { stderrCallbacks.push(cb); } },
      on: (_event: string, cb: (code: number | null) => void) => { closeCallbacks.push(cb); },
      kill: () => true,
      pid: 12345,
    };
  };
}

/** Helper to build a minimal config for a given role + prompt. */
function makeConfig(overrides?: Partial<HeadlessAgentConfig>): HeadlessAgentConfig {
  return {
    role: 'dev',
    prompt: 'Hello agent',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('headless-spawner', () => {
  beforeEach(() => {
    resetCliAvailabilityCache();
  });

  // -----------------------------------------------------------------------
  // isClaudeCliAvailable
  // -----------------------------------------------------------------------

  describe('isClaudeCliAvailable', () => {
    it('returns a boolean', async () => {
      const mock = createMockSpawn('', '', 0);
      const result = await isClaudeCliAvailable({ _spawnFn: mock });
      assert.strictEqual(typeof result, 'boolean');
    });

    it('returns true when CLI is found (exit code 0)', async () => {
      const mock = createMockSpawn('/usr/local/bin/claude\n', '', 0);
      const result = await isClaudeCliAvailable({ _spawnFn: mock });
      assert.strictEqual(result, true);
    });

    it('returns false when CLI is not found (exit code 1)', async () => {
      const mock = createMockSpawn('', 'not found', 1);
      const result = await isClaudeCliAvailable({ _spawnFn: mock });
      assert.strictEqual(result, false);
    });

    it('caches result after first call', async () => {
      let callCount = 0;
      const countingSpawn = (cmd: string, args: string[], opts: Record<string, unknown>) => {
        callCount++;
        return createMockSpawn('', '', 0)(cmd, args, opts);
      };

      // First call should invoke spawn
      const first = await isClaudeCliAvailable({ _spawnFn: countingSpawn });
      assert.strictEqual(first, true);
      assert.strictEqual(callCount, 1);

      // Second call should hit the cache — spawn must NOT be called again
      const second = await isClaudeCliAvailable({ _spawnFn: countingSpawn });
      assert.strictEqual(second, true);
      assert.strictEqual(callCount, 1, 'spawn should not be called a second time due to caching');
    });
  });

  // -----------------------------------------------------------------------
  // buildCliArgs
  // -----------------------------------------------------------------------

  describe('buildCliArgs', () => {
    it('includes -p and --output-format stream-json', () => {
      const args = buildCliArgs(makeConfig());
      assert.ok(args.includes('-p'), 'should include -p flag');
      assert.ok(args.includes('--output-format'), 'should include --output-format');
      const fmtIdx = args.indexOf('--output-format');
      assert.strictEqual(args[fmtIdx + 1], 'stream-json');
    });

    it('includes --model flag when specified', () => {
      const args = buildCliArgs(makeConfig({ model: 'claude-opus-4-6' }));
      assert.ok(args.includes('--model'), 'should include --model flag');
      const modelIdx = args.indexOf('--model');
      assert.strictEqual(args[modelIdx + 1], 'claude-opus-4-6');
    });

    it('includes --max-budget-usd flag when specified', () => {
      const args = buildCliArgs(makeConfig({ maxBudgetUsd: 5.0 }));
      assert.ok(args.includes('--max-budget-usd'), 'should include --max-budget-usd flag');
      const budgetIdx = args.indexOf('--max-budget-usd');
      assert.strictEqual(args[budgetIdx + 1], '5');
    });

    it('includes prompt as the last argument', () => {
      const prompt = 'Implement the feature as described';
      const args = buildCliArgs(makeConfig({ prompt }));
      assert.strictEqual(args[args.length - 1], prompt);
    });

    it('omits optional flags when not specified', () => {
      const args = buildCliArgs(makeConfig({ model: undefined, maxBudgetUsd: undefined }));
      assert.ok(!args.includes('--model'), 'should not include --model');
      assert.ok(!args.includes('--max-budget-usd'), 'should not include --max-budget-usd');
      assert.ok(!args.includes('--allowedTools'), 'should not include --allowedTools');
    });

    it('includes --allowedTools for each tool when specified', () => {
      const args = buildCliArgs(makeConfig({ allowedTools: ['Read', 'Write', 'Bash'] }));
      const toolFlags = args.filter((a) => a === '--allowedTools');
      assert.strictEqual(toolFlags.length, 3, 'should have one --allowedTools per tool');
      // Values should follow each flag
      const firstIdx = args.indexOf('--allowedTools');
      assert.strictEqual(args[firstIdx + 1], 'Read');
    });
  });

  // -----------------------------------------------------------------------
  // parseStreamJsonOutput
  // -----------------------------------------------------------------------

  describe('parseStreamJsonOutput', () => {
    it('extracts text from result type (result key)', () => {
      const stdout = JSON.stringify({ type: 'result', result: 'The answer is 42.' });
      const parsed = parseStreamJsonOutput(stdout);
      assert.strictEqual(parsed.text, 'The answer is 42.');
    });

    it('extracts text from result type (text key)', () => {
      const stdout = JSON.stringify({ type: 'result', text: 'Fallback text here.' });
      const parsed = parseStreamJsonOutput(stdout);
      assert.strictEqual(parsed.text, 'Fallback text here.');
    });

    it('extracts token usage when available', () => {
      const stdout = JSON.stringify({
        type: 'result',
        result: 'Done.',
        usage: { input_tokens: 100, output_tokens: 50, cost: 0.005 },
      });
      const parsed = parseStreamJsonOutput(stdout);
      assert.ok(parsed.tokenUsage, 'tokenUsage should be defined');
      assert.strictEqual(parsed.tokenUsage!.input, 100);
      assert.strictEqual(parsed.tokenUsage!.output, 50);
      assert.strictEqual(parsed.tokenUsage!.cost, 0.005);
    });

    it('handles empty/invalid JSON lines gracefully', () => {
      const stdout = [
        '',
        'This is not JSON',
        '  ',
        '{invalid-json',
        JSON.stringify({ type: 'result', result: 'still works' }),
      ].join('\n');

      const parsed = parseStreamJsonOutput(stdout);
      assert.strictEqual(parsed.text, 'still works');
    });

    it('accumulates content_block_delta text fragments', () => {
      const stdout = [
        JSON.stringify({ type: 'content_block_delta', delta: { text: 'Hello ' } }),
        JSON.stringify({ type: 'content_block_delta', delta: { text: 'World' } }),
      ].join('\n');

      const parsed = parseStreamJsonOutput(stdout);
      assert.strictEqual(parsed.text, 'Hello World');
    });

    it('handles assistant message content array', () => {
      const stdout = JSON.stringify({
        type: 'message',
        content: [
          { type: 'text', text: 'Part 1. ' },
          { type: 'text', text: 'Part 2.' },
        ],
      });
      const parsed = parseStreamJsonOutput(stdout);
      assert.strictEqual(parsed.text, 'Part 1. Part 2.');
    });

    it('returns empty text and undefined tokenUsage for blank input', () => {
      const parsed = parseStreamJsonOutput('');
      assert.strictEqual(parsed.text, '');
      assert.strictEqual(parsed.tokenUsage, undefined);
    });

    it('extracts token usage from cost_info key', () => {
      const stdout = JSON.stringify({
        type: 'result',
        result: 'Ok.',
        cost_info: { input: 200, output: 80, total_cost: 0.01 },
      });
      const parsed = parseStreamJsonOutput(stdout);
      assert.ok(parsed.tokenUsage, 'tokenUsage should be populated from cost_info');
      assert.strictEqual(parsed.tokenUsage!.input, 200);
      assert.strictEqual(parsed.tokenUsage!.output, 80);
      assert.strictEqual(parsed.tokenUsage!.cost, 0.01);
    });
  });

  // -----------------------------------------------------------------------
  // spawnHeadlessAgent
  // -----------------------------------------------------------------------

  describe('spawnHeadlessAgent', () => {
    it('returns correct structure with mock spawn', async () => {
      const resultJson = JSON.stringify({ type: 'result', result: 'Agent output here.' });
      const mock = createMockSpawn(resultJson, '', 0);

      const result = await spawnHeadlessAgent(makeConfig({ role: 'architect' }), { _spawnFn: mock });

      assert.strictEqual(result.role, 'architect');
      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, 'Agent output here.');
      assert.strictEqual(result.stderr, '');
      assert.ok(typeof result.durationMs === 'number');
      assert.ok(result.durationMs >= 0);
    });

    it('captures stderr on non-zero exit', async () => {
      const mock = createMockSpawn('', 'Something went wrong', 1);

      const result = await spawnHeadlessAgent(makeConfig({ role: 'pm' }), { _spawnFn: mock });

      assert.strictEqual(result.role, 'pm');
      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('Something went wrong'));
    });

    it('includes tokenUsage when stream-json contains usage data', async () => {
      const resultJson = JSON.stringify({
        type: 'result',
        result: 'Done.',
        usage: { input_tokens: 300, output_tokens: 150, cost: 0.015 },
      });
      const mock = createMockSpawn(resultJson, '', 0);

      const result = await spawnHeadlessAgent(makeConfig(), { _spawnFn: mock });

      assert.ok(result.tokenUsage, 'tokenUsage should be present');
      assert.strictEqual(result.tokenUsage!.input, 300);
      assert.strictEqual(result.tokenUsage!.output, 150);
      assert.strictEqual(result.tokenUsage!.cost, 0.015);
    });

    it('passes cwd to spawn when config specifies cwd', async () => {
      let capturedOpts: Record<string, unknown> | undefined;
      const capturingSpawn = (cmd: string, args: string[], opts: Record<string, unknown>) => {
        capturedOpts = opts;
        return createMockSpawn('', '', 0)(cmd, args, opts);
      };

      await spawnHeadlessAgent(makeConfig({ cwd: '/tmp/workdir' }), { _spawnFn: capturingSpawn });

      assert.ok(capturedOpts, 'opts should have been captured');
      assert.strictEqual(capturedOpts!.cwd, '/tmp/workdir');
    });
  });

  // -----------------------------------------------------------------------
  // spawnParallelAgents
  // -----------------------------------------------------------------------

  describe('spawnParallelAgents', () => {
    it('returns empty array for empty configs', async () => {
      const results = await spawnParallelAgents([]);
      assert.deepStrictEqual(results, []);
    });

    it('respects maxParallel limit (mock spawn to verify chunk behavior)', async () => {
      // Track how many agents are running concurrently
      let currentConcurrency = 0;
      let peakConcurrency = 0;

      const concurrencyTrackingSpawn = (_cmd: string, _args: string[], _opts: Record<string, unknown>): MockChild => {
        currentConcurrency++;
        if (currentConcurrency > peakConcurrency) {
          peakConcurrency = currentConcurrency;
        }

        const stdoutCallbacks: Array<(data: Buffer) => void> = [];
        const stderrCallbacks: Array<(data: Buffer) => void> = [];
        const closeCallbacks: Array<(code: number | null) => void> = [];

        setTimeout(() => {
          for (const cb of stdoutCallbacks) cb(Buffer.from(''));
          for (const cb of stderrCallbacks) cb(Buffer.from(''));
          currentConcurrency--;
          for (const cb of closeCallbacks) cb(0);
        }, 20);

        return {
          stdout: { on: (_e: string, cb: (data: Buffer) => void) => { stdoutCallbacks.push(cb); } },
          stderr: { on: (_e: string, cb: (data: Buffer) => void) => { stderrCallbacks.push(cb); } },
          on: (_e: string, cb: (code: number | null) => void) => { closeCallbacks.push(cb); },
          kill: () => true,
          pid: 99999,
        };
      };

      // Create 5 configs with maxParallel=2 so we should see batches of 2,2,1
      const configs: HeadlessAgentConfig[] = Array.from({ length: 5 }, (_, i) =>
        makeConfig({ role: 'dev', prompt: `Task ${i}` }),
      );

      const results = await spawnParallelAgents(configs, {
        maxParallel: 2,
        _spawnFn: concurrencyTrackingSpawn,
      });

      assert.strictEqual(results.length, 5, 'should return all 5 results');
      assert.ok(peakConcurrency <= 2, `peak concurrency (${peakConcurrency}) should not exceed maxParallel=2`);
    });

    it('returns results for all configs in order', async () => {
      const configs: HeadlessAgentConfig[] = [
        makeConfig({ role: 'pm', prompt: 'Task A' }),
        makeConfig({ role: 'architect', prompt: 'Task B' }),
        makeConfig({ role: 'ux', prompt: 'Task C' }),
      ];

      const mock = createMockSpawn('', '', 0);
      const results = await spawnParallelAgents(configs, { maxParallel: 4, _spawnFn: mock });

      assert.strictEqual(results.length, 3);
      assert.strictEqual(results[0]!.role, 'pm');
      assert.strictEqual(results[1]!.role, 'architect');
      assert.strictEqual(results[2]!.role, 'ux');
    });
  });

  // -----------------------------------------------------------------------
  // fallbackToApi
  // -----------------------------------------------------------------------

  describe('fallbackToApi', () => {
    it('fallbackToApi triggers on spawn failure', async () => {
      const failSpawn = createMockSpawn('', 'spawn error', 1);
      const apiResponse = 'API fallback success';

      const result = await spawnHeadlessAgent(makeConfig(), {
        _spawnFn: failSpawn,
        fallbackToApi: true,
        _apiCaller: async () => apiResponse,
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(result.stdout, apiResponse);
    });

    it('fallbackToApi returns original error when API also fails', async () => {
      const failSpawn = createMockSpawn('', 'spawn error', 1);

      const result = await spawnHeadlessAgent(makeConfig(), {
        _spawnFn: failSpawn,
        fallbackToApi: true,
        _apiCaller: async () => { throw new Error('API also down'); },
      });

      assert.strictEqual(result.exitCode, 1);
      assert.ok(result.stderr.includes('spawn error'));
    });

    it('fallbackToApi not triggered when spawn succeeds', async () => {
      const successSpawn = createMockSpawn(
        JSON.stringify({ type: 'result', result: 'ok' }),
        '',
        0,
      );
      let apiCalled = false;

      const result = await spawnHeadlessAgent(makeConfig(), {
        _spawnFn: successSpawn,
        fallbackToApi: true,
        _apiCaller: async () => { apiCalled = true; return 'should not reach'; },
      });

      assert.strictEqual(result.exitCode, 0);
      assert.strictEqual(apiCalled, false, '_apiCaller should not be called when spawn succeeds');
    });

    it('fallbackToApi not triggered when disabled', async () => {
      const failSpawn = createMockSpawn('', 'spawn error', 1);
      let apiCalled = false;

      const result = await spawnHeadlessAgent(makeConfig(), {
        _spawnFn: failSpawn,
        fallbackToApi: false,
        _apiCaller: async () => { apiCalled = true; return 'should not reach'; },
      });

      assert.strictEqual(result.exitCode, 1);
      assert.strictEqual(apiCalled, false, '_apiCaller should not be called when fallbackToApi is disabled');
    });
  });
});
