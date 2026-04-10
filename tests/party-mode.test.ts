import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../src/core/logger.js';
import {
  determineScale,
  runDanteParty,
  dispatchAgentWithRetry,
  computeQualityScore,
  AGENT_MAX_RETRIES,
  AGENT_RETRY_DELAYS_MS,
  type AgentResult,
} from '../src/harvested/dante-agents/party-mode.js';
import type { ReflectionVerdict } from '../src/core/reflection-engine.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('determineScale', () => {
  it('returns light for small projects', () => {
    assert.strictEqual(determineScale('small'), 'light');
    assert.strictEqual(determineScale('lite'), 'light');
    assert.strictEqual(determineScale('light'), 'light');
    assert.strictEqual(determineScale('mini'), 'light');
  });

  it('returns deep for large projects', () => {
    assert.strictEqual(determineScale('large'), 'deep');
    assert.strictEqual(determineScale('enterprise'), 'deep');
    assert.strictEqual(determineScale('complex'), 'deep');
    assert.strictEqual(determineScale('deep'), 'deep');
  });

  it('returns standard for medium projects', () => {
    assert.strictEqual(determineScale('medium'), 'standard');
    assert.strictEqual(determineScale('normal'), 'standard');
    assert.strictEqual(determineScale(''), 'standard');
  });

  it('is case insensitive', () => {
    assert.strictEqual(determineScale('SMALL'), 'light');
    assert.strictEqual(determineScale('LARGE'), 'deep');
    assert.strictEqual(determineScale('Medium'), 'standard');
  });

  it('handles whitespace', () => {
    assert.strictEqual(determineScale('  small  '), 'light');
  });

  it('fails closed when requested worktree isolation cannot be created', async () => {
    const originalCwd = process.cwd();
    const originalHome = process.env.DANTEFORGE_HOME;
    const originalExitCode = process.exitCode;
    const originalInfo = logger.info;
    const originalWarn = logger.warn;
    const originalError = logger.error;
    const originalSuccess = logger.success;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-party-worktree-'));
    const logLines: string[] = [];

    process.env.DANTEFORGE_HOME = tempRoot;
    await fs.mkdir(path.join(tempRoot, '.danteforge'), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, '.danteforge', 'config.yaml'),
      [
        'defaultProvider: openai',
        'providers:',
        '  openai:',
        '    apiKey: fake-key',
      ].join('\n'),
      'utf8',
    );

    logger.info = (msg: string) => { logLines.push(`[INFO] ${msg}`); };
    logger.warn = (msg: string) => { logLines.push(`[WARN] ${msg}`); };
    logger.error = (msg: string) => { logLines.push(`[ERR] ${msg}`); };
    logger.success = (msg: string) => { logLines.push(`[OK] ${msg}`); };
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: 'gpt-4o' }],
      }),
    }) as Response;

    process.chdir(tempRoot);
    process.exitCode = 0;

    try {
      const result = await runDanteParty(['agent?bad'], true);
      const combined = logLines.join('\n');
      assert.strictEqual(result.success, false, 'runDanteParty should return { success: false } on worktree failure');
      assert.strictEqual(process.exitCode, 0, 'Library code must not mutate process.exitCode');
      assert.match(combined, /worktree setup failed/i);
      assert.doesNotMatch(combined, /non-isolated/i);
      assert.doesNotMatch(combined, /dispatching agents/i);
    } finally {
      process.chdir(originalCwd);
      process.exitCode = originalExitCode;
      logger.info = originalInfo;
      logger.warn = originalWarn;
      logger.error = originalError;
      logger.success = originalSuccess;
      if (originalHome === undefined) {
        delete process.env.DANTEFORGE_HOME;
      } else {
        process.env.DANTEFORGE_HOME = originalHome;
      }
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('wires isolated execution through the subagent isolator', async () => {
    const source = await fs.readFile('src/harvested/dante-agents/party-mode.ts', 'utf8');
    assert.match(source, /runIsolatedAgent/);
    assert.match(source, /isolation\??:/);
  });
});

describe('Party Mode Agent Retry (behavioral)', () => {
  function makeSuccessResult(agent: string): AgentResult {
    return { agent, result: '# Success\nAll good', durationMs: 100, success: true };
  }

  function makeFailureResult(agent: string, msg: string): AgentResult {
    return { agent, result: `# ${agent} Agent Error\n\n${msg}`, durationMs: 50, success: false, error: new Error(msg) };
  }

  it('returns first success immediately with no retries', async () => {
    let callCount = 0;
    const _dispatchAgent = async (agentName: string) => {
      callCount++;
      return makeSuccessResult(agentName);
    };
    const sleepCalls: number[] = [];
    const _sleep = async (ms: number) => { sleepCalls.push(ms); };

    const result = await dispatchAgentWithRetry('dev', '', 'medium', 'balanced', {}, false, { _dispatchAgent, _sleep });

    assert.equal(result.success, true);
    assert.equal(callCount, 1, 'Should only call dispatch once on first success');
    assert.equal(sleepCalls.length, 0, 'Should not sleep when first attempt succeeds');
  });

  it('retries on failure and returns success on subsequent attempt', async () => {
    let callCount = 0;
    const _dispatchAgent = async (agentName: string) => {
      callCount++;
      if (callCount <= 1) return makeFailureResult(agentName, 'transient error');
      return makeSuccessResult(agentName);
    };
    const sleepCalls: number[] = [];
    const _sleep = async (ms: number) => { sleepCalls.push(ms); };

    const result = await dispatchAgentWithRetry('architect', '', 'medium', 'balanced', {}, false, { _dispatchAgent, _sleep });

    assert.equal(result.success, true);
    assert.equal(callCount, 2, 'Should call dispatch twice (1 fail + 1 success)');
    assert.equal(sleepCalls.length, 1, 'Should sleep once between attempts');
  });

  it('exhausts retries and returns last failure result', async () => {
    let callCount = 0;
    const _dispatchAgent = async (agentName: string) => {
      callCount++;
      return makeFailureResult(agentName, `failure attempt ${callCount}`);
    };
    const sleepCalls: number[] = [];
    const _sleep = async (ms: number) => { sleepCalls.push(ms); };

    const result = await dispatchAgentWithRetry('pm', '', 'medium', 'balanced', {}, false, { _dispatchAgent, _sleep });

    assert.equal(result.success, false);
    assert.equal(callCount, AGENT_MAX_RETRIES + 1, `Should attempt ${AGENT_MAX_RETRIES + 1} times total`);
    assert.ok(result.result.includes(`failure attempt ${AGENT_MAX_RETRIES + 1}`), 'Should return the last failure result');
  });

  it('uses correct delay values (2000, 5000) between retries', async () => {
    const _dispatchAgent = async (agentName: string) => makeFailureResult(agentName, 'always fails');
    const sleepCalls: number[] = [];
    const _sleep = async (ms: number) => { sleepCalls.push(ms); };

    await dispatchAgentWithRetry('dev', '', 'medium', 'balanced', {}, false, { _dispatchAgent, _sleep });

    assert.deepStrictEqual(sleepCalls, [2000, 5000], 'Sleep delays should match AGENT_RETRY_DELAYS_MS');
  });

  it('detects synthetic "offline mode" output as failure and retries', async () => {
    let callCount = 0;
    const _dispatchAgent = async (agentName: string): Promise<AgentResult> => {
      callCount++;
      if (callCount === 1) {
        // Simulate agent returning synthetic offline output — dispatch marks this as failure
        return {
          agent: agentName,
          result: 'offline mode — no llm available',
          durationMs: 10,
          success: false,
          error: new Error('produced offline/template output'),
        };
      }
      return makeSuccessResult(agentName);
    };
    const sleepCalls: number[] = [];
    const _sleep = async (ms: number) => { sleepCalls.push(ms); };

    const result = await dispatchAgentWithRetry('ux', '', 'medium', 'balanced', {}, false, { _dispatchAgent, _sleep });

    assert.equal(result.success, true);
    assert.equal(callCount, 2, 'Should retry after synthetic offline output');
  });

  it('calls _sleep with AGENT_RETRY_DELAYS_MS values in order', async () => {
    const _dispatchAgent = async (agentName: string) => makeFailureResult(agentName, 'keep failing');
    const sleepCalls: number[] = [];
    const _sleep = async (ms: number) => { sleepCalls.push(ms); };

    await dispatchAgentWithRetry('design', '', 'medium', 'balanced', {}, false, { _dispatchAgent, _sleep });

    assert.equal(sleepCalls.length, AGENT_MAX_RETRIES, `Should sleep ${AGENT_MAX_RETRIES} times`);
    for (let i = 0; i < sleepCalls.length; i++) {
      assert.equal(sleepCalls[i], AGENT_RETRY_DELAYS_MS[i], `Sleep call ${i} should be ${AGENT_RETRY_DELAYS_MS[i]}ms`);
    }
  });
});

// ---------------------------------------------------------------------------
// computeQualityScore — direct tests
// ---------------------------------------------------------------------------
describe('computeQualityScore', () => {
  it('returns 0 for very short output (single char)', () => {
    const score = computeQualityScore('x');
    assert.strictEqual(score, 0, `Expected score 0 for single char, got ${score}`);
  });

  it('returns 0 for empty string', () => {
    const score = computeQualityScore('');
    assert.strictEqual(score, 0, `Expected score 0 for empty string, got ${score}`);
  });

  it('returns > 0 for output with headings and bullet points', () => {
    const richOutput = [
      '# Implementation Plan',
      '',
      '## Phase 1: Setup',
      '- Install dependencies',
      '- Configure environment',
      '',
      '## Phase 2: Build',
      '- Write core logic',
      '- Add error handling',
      '',
      'This implementation covers all required cases for the authentication module.',
      'The solution is robust and handles edge cases properly.',
    ].join('\n');
    const score = computeQualityScore(richOutput);
    assert.ok(score > 0, `Expected score > 0 for rich output, got ${score}`);
  });

  it('score is < 50 for minimal output (triggers quality warning path)', () => {
    // Just one line of text — not enough length/headings/bullets to exceed 50
    const score = computeQualityScore('minimal output here');
    assert.ok(score < 50, `Expected score < 50 for minimal output, got ${score}`);
  });
});

// ---------------------------------------------------------------------------
// runDanteParty — quality score warning path (score < 50)
// ---------------------------------------------------------------------------
describe('runDanteParty quality score paths', () => {
  it('quality score < 50 triggers warning log for agent output', async () => {
    const warnLines: string[] = [];
    const origWarn = logger.warn;
    logger.warn = (msg: string) => { warnLines.push(msg); };

    try {
      await runDanteParty(['dev'], false, false, {
        _loadState: async () => ({ profile: 'balanced', lightMode: false, tasks: {}, auditLog: [] } as never),
        _isLLMAvailable: async () => true, // must pass LLM check to reach quality scoring
        _readArtifact: async () => '',     // avoid real file reads
        _dispatchAgent: async (agentName) => ({
          agent: agentName,
          result: 'x', // single char → quality score 0 → triggers < 50 warning
          durationMs: 10,
          success: true,
        }),
        _reflect: async () => ({
          sessionId: 's1',
          taskName: 'dev',
          status: 'complete' as never,
          confidence: 1,
          evidence: {
            tests: { ran: true, passed: true, ranAfterChanges: true },
            build: { ran: true, passed: true, ranAfterChanges: true },
            lint: { ran: true, passed: true, ranAfterChanges: true },
          },
          remainingWork: [],
          needsHumanAction: [],
          stuck: false,
        } as ReflectionVerdict),
        _recordMemory: async () => {},
      });

      assert.ok(
        warnLines.some(l => l.includes('quality score') || l.includes('below threshold')),
        `Expected quality score warning, got warnings: ${JSON.stringify(warnLines)}`,
      );
    } finally {
      logger.warn = origWarn;
    }
  });

  it('reflection verdict score < 50 triggers reflection warning', async () => {
    const warnLines: string[] = [];
    const origWarn = logger.warn;
    logger.warn = (msg: string) => { warnLines.push(msg); };

    try {
      // Build a failing verdict: evaluateVerdict({all gates false}) → score 0
      const failingVerdict: ReflectionVerdict = {
        sessionId: 's2',
        taskName: 'dev',
        status: 'in_progress' as never,
        confidence: 0,
        evidence: {
          tests: { ran: false, passed: false, ranAfterChanges: false },
          build: { ran: false, passed: false, ranAfterChanges: false },
          lint: { ran: false, passed: false, ranAfterChanges: false },
        },
        remainingWork: [],
        needsHumanAction: [],
        stuck: false,
      };

      await runDanteParty(['dev'], false, false, {
        _loadState: async () => ({ profile: 'balanced', lightMode: false, tasks: {}, auditLog: [] } as never),
        _isLLMAvailable: async () => true, // must pass LLM check to reach reflection
        _readArtifact: async () => '',     // avoid real file reads
        _dispatchAgent: async (agentName) => ({
          agent: agentName,
          result: '# Good Output\n- point 1\n- point 2\n'.repeat(20), // long enough for qualityScore >= 50
          durationMs: 10,
          success: true,
        }),
        _reflect: async () => failingVerdict,
        _recordMemory: async () => {},
      });

      assert.ok(
        warnLines.some(l => l.includes('Reflection') || l.includes('scored') || l.includes('100')),
        `Expected reflection warning, got warnings: ${JSON.stringify(warnLines)}`,
      );
    } finally {
      logger.warn = origWarn;
    }
  });

  it('worktree cleanup is called when _listWorktrees returns entries', async () => {
    let listWtCalled = false;
    let removeWtCalled = false;

    await runDanteParty(['dev'], true, false, {
      _loadState: async () => ({ profile: 'balanced', lightMode: false, tasks: {}, auditLog: [] } as never),
      _isLLMAvailable: async () => true, // must pass LLM check for worktrees to be created/cleaned
      _readArtifact: async () => '',     // avoid real file reads
      _createWorktree: async (name) => `/tmp/wt-test/${name}`,
      _removeWorktree: async () => { removeWtCalled = true; },
      _listWorktrees: async () => { listWtCalled = true; return [{ path: '/tmp/wt-test/dev', branch: 'df-dev' }]; },
      _dispatchAgent: async (agentName) => ({
        agent: agentName,
        result: '# Good Output\n- point 1\n'.repeat(10),
        durationMs: 10,
        success: true,
      }),
      _reflect: async () => ({
        sessionId: 's3',
        taskName: 'dev',
        status: 'complete' as never,
        confidence: 1,
        evidence: {
          tests: { ran: true, passed: true, ranAfterChanges: true },
          build: { ran: true, passed: true, ranAfterChanges: true },
          lint: { ran: true, passed: true, ranAfterChanges: true },
        },
        remainingWork: [],
        needsHumanAction: [],
        stuck: false,
      } as ReflectionVerdict),
      _recordMemory: async () => {},
    });

    assert.ok(listWtCalled, '_listWorktrees should be called during worktree cleanup');
    assert.ok(removeWtCalled, '_removeWorktree should be called to clean up worktrees');
  });
});
