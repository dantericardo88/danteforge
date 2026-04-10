// Reliability hardening tests — circuit breaker wired into callLLM, SIGTERM, safeWrite
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';

import { callLLM } from '../src/core/llm.js';
import type { LLMProvider } from '../src/core/config.js';
import { LLMError } from '../src/core/errors.js';
import { resetAllCircuits, getCircuitState } from '../src/core/circuit-breaker.js';
import { safeWrite } from '../src/core/logger.js';
import {
  runAutoforgeLoop,
  AutoforgeLoopState,
  type AutoforgeLoopContext,
  type AutoforgeLoopDeps,
} from '../src/core/autoforge-loop.js';
import { saveState } from '../src/core/state.js';
import type { DanteState } from '../src/core/state.js';
import type { ScoreResult, ScoredArtifact } from '../src/core/pdse.js';
import type { CompletionTracker, ProjectType } from '../src/core/completion-tracker.js';

// ─── Filesystem helpers ────────────────────────────────────────────────────

const tempDirs: string[] = [];
let originalDanteforgeHome: string | undefined;

async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-rel-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  const state = {
    project: 'rel-test',
    created: new Date().toISOString(),
    workflowStage: 'initialized',
    currentPhase: 'phase-1',
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    gateResults: {},
    auditLog: [],
  };
  await saveState(state as DanteState, { cwd: dir });
  return dir;
}

async function createTempConfig(
  provider: string,
  apiKey: string,
  extra?: Record<string, { apiKey: string; model: string; baseUrl: string }>,
): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-rel-cfg-'));
  tempDirs.push(dir);
  await fs.mkdir(path.join(dir, '.danteforge'), { recursive: true });
  const config = {
    defaultProvider: provider,
    ollamaModel: 'llama3',
    providers: {
      [provider]: { apiKey, model: 'test-model', baseUrl: 'http://localhost:9999' },
      ...extra,
    },
  };
  await fs.writeFile(path.join(dir, '.danteforge', 'config.yaml'), yaml.stringify(config));
  return dir;
}

function makeSuccessFetch(text = 'ok'): typeof globalThis.fetch {
  return async (input) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    let body: unknown;
    if (url.includes('chat/completions') || url.includes('openai')) {
      body = { choices: [{ message: { content: text } }] };
    } else if (url.includes('messages') || url.includes('claude')) {
      body = { content: [{ type: 'text', text }] };
    } else {
      body = { choices: [{ message: { content: text } }] };
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
}

function makeAlwaysFailFetch(msg = 'rate limit exceeded'): typeof globalThis.fetch {
  return async () => { throw new Error(msg); };
}

// ─── SIGTERM / loop helpers ────────────────────────────────────────────────

function makeCtx(overrides: Partial<AutoforgeLoopContext> = {}): AutoforgeLoopContext {
  const state: DanteState = {
    project: 'sig-test',
    workflowStage: 'forge',
    currentPhase: 1,
    tasks: {},
    lastHandoff: 'none',
    profile: 'balanced',
    auditLog: [],
  } as DanteState;
  return {
    goal: 'test',
    cwd: os.tmpdir(),
    state,
    loopState: AutoforgeLoopState.IDLE,
    cycleCount: 0,
    startedAt: new Date().toISOString(),
    retryCounters: {},
    blockedArtifacts: [],
    lastGuidance: null,
    isWebProject: false,
    force: false,
    maxRetries: 3,
    ...overrides,
  };
}

function makeScore(artifact: ScoredArtifact, score: number): ScoreResult {
  return {
    artifact,
    score,
    dimensions: {
      completeness: score, clarity: score, testability: score,
      constitutionAlignment: score, integrationFitness: score, freshness: score,
    },
    issues: [],
    remediationSuggestions: [],
    timestamp: new Date().toISOString(),
    autoforgeDecision: 'advance',
    hasCEOReviewBonus: false,
  };
}

function makePassingScores(): Record<ScoredArtifact, ScoreResult> {
  return {
    CONSTITUTION: makeScore('CONSTITUTION', 90),
    SPEC: makeScore('SPEC', 85),
    CLARIFY: makeScore('CLARIFY', 80),
    PLAN: makeScore('PLAN', 80),
    TASKS: makeScore('TASKS', 75),
  };
}

function makeTrackerAt(overall: number): CompletionTracker {
  return {
    overall,
    phases: {
      planning: {
        score: 90,
        complete: true,
        artifacts: {
          CONSTITUTION: { score: 90, complete: true },
          SPEC: { score: 85, complete: true },
          CLARIFY: { score: 80, complete: true },
          PLAN: { score: 80, complete: true },
          TASKS: { score: 75, complete: true },
        },
      },
      execution: { score: 50, complete: false, currentPhase: 1, wavesComplete: 1, totalWaves: 3 },
      verification: { score: 0, complete: false, qaScore: 0, testsPassing: false },
      synthesis: { score: 0, complete: false, retroDelta: null },
    },
    lastUpdated: new Date().toISOString(),
    projectedCompletion: 'done',
  } as CompletionTracker;
}

function makeStubDeps(overrides: Partial<AutoforgeLoopDeps> = {}): AutoforgeLoopDeps {
  return {
    scoreAllArtifacts: async () => makePassingScores(),
    persistScoreResult: async () => '',
    detectProjectType: async () => 'cli' as ProjectType,
    computeCompletionTracker: () => makeTrackerAt(96),
    recordMemory: async () => {},
    loadState: async () => makeCtx().state,
    saveState: async () => {},
    setTimeout: (fn) => { fn(); return 0 as unknown as ReturnType<typeof globalThis.setTimeout>; },
    _executeCommand: async () => ({ success: true }),
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Group 1: Circuit breaker wired into callLLM
// ═══════════════════════════════════════════════════════════════════════════

describe('Reliability: circuit breaker wired into callLLM', () => {
  let projectDir: string;
  let configDir: string;

  before(async () => {
    resetAllCircuits();
    projectDir = await createTempProject();
    configDir = await createTempConfig('openai', 'TEST_PLACEHOLDER_NOT_REAL');
    originalDanteforgeHome = process.env.DANTEFORGE_HOME;
    process.env.DANTEFORGE_HOME = configDir;
  });

  beforeEach(() => { resetAllCircuits(); });

  after(async () => {
    resetAllCircuits();
    if (originalDanteforgeHome !== undefined) {
      process.env.DANTEFORGE_HOME = originalDanteforgeHome;
    } else {
      delete process.env.DANTEFORGE_HOME;
    }
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('open circuit throws LLM_CIRCUIT_OPEN with correct code', async () => {
    await assert.rejects(
      () => callLLM('hello', 'openai', {
        cwd: projectDir,
        noCache: true,
        _sleep: async () => {},
        _retryDelays: [0, 0],
        _getCircuit: () => ({
          isOpen: () => true,
          recordSuccess: () => {},
          recordFailure: () => {},
        }),
      }),
      (err: unknown) => {
        assert.ok(err instanceof LLMError, `expected LLMError, got ${String(err)}`);
        assert.strictEqual((err as LLMError).code, 'LLM_CIRCUIT_OPEN');
        return true;
      },
    );
  });

  it('open circuit never calls _fetch', async () => {
    let fetchCallCount = 0;
    await assert.rejects(
      () => callLLM('hello', 'openai', {
        cwd: projectDir,
        noCache: true,
        _sleep: async () => {},
        _retryDelays: [0, 0],
        _fetch: async () => { fetchCallCount++; return new Response('{}'); },
        _getCircuit: () => ({
          isOpen: () => true,
          recordSuccess: () => {},
          recordFailure: () => {},
        }),
      }),
    );
    assert.strictEqual(fetchCallCount, 0, 'open circuit should not call _fetch');
  });

  it('recordSuccess called exactly once after successful call', async () => {
    let successCount = 0;
    const result = await callLLM('hello', 'openai', {
      cwd: projectDir,
      noCache: true,
      _sleep: async () => {},
      _retryDelays: [0, 0],
      _fetch: makeSuccessFetch('hello'),
      _getCircuit: () => ({
        isOpen: () => false,
        recordSuccess: () => { successCount++; },
        recordFailure: () => {},
      }),
    });
    assert.strictEqual(result, 'hello');
    assert.strictEqual(successCount, 1, 'recordSuccess must be called once on success');
  });

  it('recordFailure called exactly once when all retries exhausted (not once per attempt)', async () => {
    let failureCount = 0;
    await assert.rejects(
      () => callLLM('hello', 'openai', {
        cwd: projectDir,
        noCache: true,
        _sleep: async () => {},
        _retryDelays: [0, 0],
        _fetch: makeAlwaysFailFetch('rate limit exceeded'),
        _getCircuit: () => ({
          isOpen: () => false,
          recordSuccess: () => {},
          recordFailure: () => { failureCount++; },
        }),
      }),
    );
    assert.strictEqual(failureCount, 1, 'recordFailure must be called exactly once on exhaustion, not once per attempt');
  });

  it('recordFailure NOT called when retry succeeds on second attempt', async () => {
    let failureCount = 0;
    let attemptCount = 0;
    const failOnceFetch: typeof globalThis.fetch = async (input) => {
      attemptCount++;
      if (attemptCount === 1) throw new Error('rate limit exceeded');
      const url = typeof input === 'string' ? input : (input as Request).url;
      const body = url.includes('v1/messages')
        ? { content: [{ type: 'text', text: 'retry success' }] }
        : { choices: [{ message: { content: 'retry success' } }] };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    await callLLM('hello', 'openai', {
      cwd: projectDir,
      noCache: true,
      _sleep: async () => {},
      _retryDelays: [0, 0],
      _fetch: failOnceFetch,
      _getCircuit: () => ({
        isOpen: () => false,
        recordSuccess: () => {},
        recordFailure: () => { failureCount++; },
      }),
    });
    assert.strictEqual(failureCount, 0, 'recordFailure should not be called when retry succeeds');
    assert.strictEqual(attemptCount, 2, 'should have retried once');
  });

  it('_getCircuit receives the correct provider name as argument', async () => {
    const receivedProviders: string[] = [];
    await assert.rejects(
      () => callLLM('hello', 'openai', {
        cwd: projectDir,
        noCache: true,
        _sleep: async () => {},
        _retryDelays: [0, 0],
        _fetch: makeAlwaysFailFetch('rate limit exceeded'),
        _getCircuit: (provider: string) => {
          receivedProviders.push(provider);
          return { isOpen: () => false, recordSuccess: () => {}, recordFailure: () => {} };
        },
      }),
    );
    assert.ok(receivedProviders.length > 0, '_getCircuit should be called');
    assert.ok(receivedProviders.every(p => p === 'openai'), `expected openai, got ${receivedProviders.join(',')}`);
  });

  it('real circuit opens after 3 exhaustion events (failureThreshold=3)', async () => {
    // No _getCircuit injection — uses real circuit breaker
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        () => callLLM('hello', 'openai', {
          cwd: projectDir,
          noCache: true,
          _sleep: async () => {},
          _retryDelays: [0, 0],
          _fetch: makeAlwaysFailFetch('rate limit exceeded'),
        }),
      );
    }
    assert.strictEqual(
      getCircuitState('openai'),
      'open',
      'circuit should be open after 3 exhaustion events',
    );
  });

  it('open real circuit throws LLM_CIRCUIT_OPEN on next call', async () => {
    for (let i = 0; i < 3; i++) {
      await assert.rejects(
        () => callLLM('hello', 'openai', {
          cwd: projectDir,
          noCache: true,
          _sleep: async () => {},
          _retryDelays: [0, 0],
          _fetch: makeAlwaysFailFetch('rate limit exceeded'),
        }),
      );
    }
    assert.strictEqual(getCircuitState('openai'), 'open');

    await assert.rejects(
      () => callLLM('hello', 'openai', { cwd: projectDir, noCache: true, _sleep: async () => {} }),
      (err: unknown) => {
        assert.ok(err instanceof LLMError);
        assert.strictEqual((err as LLMError).code, 'LLM_CIRCUIT_OPEN');
        return true;
      },
    );
  });

  it('no fallbackProviders → primary error re-thrown', async () => {
    const primaryError = new Error('rate limit exceeded');
    await assert.rejects(
      () => callLLM('hello', 'openai', {
        cwd: projectDir,
        noCache: true,
        _sleep: async () => {},
        _retryDelays: [0, 0],
        _fetch: async () => { throw primaryError; },
        _getCircuit: () => ({ isOpen: () => false, recordSuccess: () => {}, recordFailure: () => {} }),
      }),
      (err: unknown) => {
        assert.strictEqual(err, primaryError, 'should re-throw primary error when no fallbacks');
        return true;
      },
    );
  });

  it('fallback provider succeeds when primary fails all retries', async () => {
    // Config with openai (primary, will fail) + claude (fallback, will succeed)
    const twoProviderConfig = await createTempConfig('openai', 'TEST_PLACEHOLDER_NOT_REAL', {
      claude: { apiKey: 'TEST_PLACEHOLDER_NOT_REAL', model: 'claude-3', baseUrl: 'http://localhost:9999' },
    });
    const savedHome = process.env.DANTEFORGE_HOME;
    process.env.DANTEFORGE_HOME = twoProviderConfig;

    let claudeCalled = false;
    const dispatchFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('v1/chat/completions')) {
        throw new Error('rate limit exceeded');  // openai fails (retryable)
      }
      // Claude endpoint: success
      claudeCalled = true;
      return new Response(
        JSON.stringify({ content: [{ type: 'text', text: 'from fallback claude' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const result = await callLLM('hello', 'openai', {
      cwd: projectDir,
      noCache: true,
      _sleep: async () => {},
      _retryDelays: [0, 0],
      _fetch: dispatchFetch,
      _getCircuit: () => ({ isOpen: () => false, recordSuccess: () => {}, recordFailure: () => {} }),
      fallbackProviders: ['claude' as LLMProvider],
    });

    process.env.DANTEFORGE_HOME = savedHome;

    assert.ok(claudeCalled, 'fallback (claude) should have been called');
    assert.strictEqual(result, 'from fallback claude');
  });

  it('fallback also fails → an error is thrown and fallback endpoint was attempted', async () => {
    const twoProviderConfig = await createTempConfig('openai', 'TEST_PLACEHOLDER_NOT_REAL', {
      claude: { apiKey: 'TEST_PLACEHOLDER_NOT_REAL', model: 'claude-3', baseUrl: 'http://localhost:9999' },
    });
    const savedHome = process.env.DANTEFORGE_HOME;
    process.env.DANTEFORGE_HOME = twoProviderConfig;

    let claudeEndpointHit = false;
    const alwaysFailFetch: typeof globalThis.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.includes('v1/messages')) claudeEndpointHit = true;
      throw new Error('rate limit exceeded');  // retryable — exhausts primary retries
    };

    await assert.rejects(
      () => callLLM('hello', 'openai', {
        cwd: projectDir,
        noCache: true,
        _sleep: async () => {},
        _retryDelays: [0, 0],
        _fetch: alwaysFailFetch,
        _getCircuit: () => ({ isOpen: () => false, recordSuccess: () => {}, recordFailure: () => {} }),
        fallbackProviders: ['claude' as LLMProvider],
      }),
      (err: unknown) => {
        assert.ok(err instanceof Error, 'should throw an error when all providers fail');
        return true;
      },
    );

    process.env.DANTEFORGE_HOME = savedHome;
    assert.ok(claudeEndpointHit, 'claude fallback endpoint (/v1/messages) should have been called');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 2: SIGTERM handler in autoforge-loop
// ═══════════════════════════════════════════════════════════════════════════

describe('Reliability: SIGTERM handler in autoforge-loop', () => {
  it('SIGINT always registered via _addSignalListener', async () => {
    const registered: string[] = [];
    await runAutoforgeLoop(makeCtx(), makeStubDeps({
      _addSignalListener: (signal, fn) => { registered.push(signal); fn(); },
      _removeSignalListener: () => {},
    }));
    assert.ok(registered.includes('SIGINT'), 'SIGINT must always be registered');
  });

  it('SIGTERM registered on non-win32, not on win32', async () => {
    const registered: string[] = [];
    await runAutoforgeLoop(makeCtx(), makeStubDeps({
      _addSignalListener: (signal, fn) => { registered.push(signal); fn(); },
      _removeSignalListener: () => {},
    }));
    if (process.platform !== 'win32') {
      assert.ok(registered.includes('SIGTERM'), 'SIGTERM must be registered on non-win32');
    } else {
      assert.ok(!registered.includes('SIGTERM'), 'SIGTERM must NOT be registered on win32');
    }
  });

  it('SIGINT and SIGTERM both deregistered via _removeSignalListener when loop exits', async () => {
    const deregistered: string[] = [];
    await runAutoforgeLoop(makeCtx(), makeStubDeps({
      _addSignalListener: (_signal, fn) => { fn(); },  // interrupt immediately
      _removeSignalListener: (signal) => { deregistered.push(signal); },
    }));
    assert.ok(deregistered.includes('SIGINT'), 'SIGINT must be deregistered on exit');
    if (process.platform !== 'win32') {
      assert.ok(deregistered.includes('SIGTERM'), 'SIGTERM must be deregistered on non-win32 exit');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Group 3: safeWrite logger hardening
// ═══════════════════════════════════════════════════════════════════════════

describe('Reliability: safeWrite logger hardening', () => {
  it('does not throw when stream.write() throws', () => {
    const throwingStream = { write: (_s: string) => { throw new Error('broken pipe'); } };
    assert.doesNotThrow(() => safeWrite(throwingStream, 'test message'));
  });

  it('calls write with the exact text on a healthy stream', () => {
    let writtenText = '';
    const capturingStream = { write: (s: string) => { writtenText = s; } };
    safeWrite(capturingStream, 'hello world\n');
    assert.strictEqual(writtenText, 'hello world\n');
  });

  it('write is called exactly once per safeWrite call', () => {
    let writeCount = 0;
    const countingStream = { write: (_s: string) => { writeCount++; } };
    safeWrite(countingStream, 'abc');
    assert.strictEqual(writeCount, 1);
  });

  it('swallows errors without propagating — return is always undefined', () => {
    const throwingStream = { write: (_s: string) => { throw new TypeError('EPIPE write after end'); } };
    const result = safeWrite(throwingStream, 'msg');
    assert.strictEqual(result, undefined, 'safeWrite always returns undefined');
  });
});
