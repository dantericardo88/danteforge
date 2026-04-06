import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTaskSummary,
  buildContextFromState,
  isSyntheticAgentResult,
  computeQualityScore,
  dispatchAgentWithRetry,
  runDanteParty,
  cleanupWorktrees,
  AGENT_MAX_RETRIES,
  AGENT_RETRY_DELAYS_MS,
  type PartyState,
  type AgentResult,
  type PartyModeOptions,
} from '../src/harvested/dante-agents/party-mode.js';
import { logger } from '../src/core/logger.js';

/* ---------- logger suppression ---------- */
let savedInfo: typeof logger.info;
let savedWarn: typeof logger.warn;
let savedError: typeof logger.error;
let savedSuccess: typeof logger.success;
let savedVerbose: typeof logger.verbose;

before(() => {
  savedInfo = logger.info;
  savedWarn = logger.warn;
  savedError = logger.error;
  savedSuccess = logger.success;
  savedVerbose = logger.verbose;
  logger.info = () => {};
  logger.warn = () => {};
  logger.error = () => {};
  logger.success = () => {};
  logger.verbose = () => {};
});

after(() => {
  logger.info = savedInfo;
  logger.warn = savedWarn;
  logger.error = savedError;
  logger.success = savedSuccess;
  logger.verbose = savedVerbose;
});

/* ---------- helpers ---------- */

function makeState(overrides: Partial<PartyState> = {}): PartyState {
  return {
    project: 'TestProject',
    currentPhase: 1,
    tasks: {},
    lastHandoff: 'architect',
    profile: 'balanced',
    ...overrides,
  };
}

function makeAgentResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agent: 'dev',
    result: '# Good output\n- item\n- item 2',
    durationMs: 100,
    success: true,
    ...overrides,
  };
}

function makePartyOptions(overrides: Partial<PartyModeOptions> = {}): PartyModeOptions {
  return {
    _loadState: async () => makeState(),
    _isLLMAvailable: async () => true,
    _readArtifact: async () => '',
    _dispatchAgent: async (name) => ({ agent: name, result: '# Good output\n- item', durationMs: 100, success: true }),
    _createWorktree: async (name) => `/tmp/worktrees/${name}`,
    _removeWorktree: async () => {},
    _listWorktrees: async () => [],
    _reflect: async () => 'PASS: looks good',
    _recordMemory: async () => {},
    _sleep: async () => {},
    ...overrides,
  };
}

/* ==========================================================
   buildTaskSummary
   ========================================================== */

describe('buildTaskSummary', () => {
  it('returns "No tasks defined yet." when tasks is empty', () => {
    const state = makeState({ tasks: {} });
    const summary = buildTaskSummary(state);
    assert.ok(summary.includes('No tasks defined yet.'));
  });

  it('includes "## Task Summary" and "### Phase" headers for multi-phase tasks', () => {
    const state = makeState({
      tasks: {
        1: [{ name: 'setup' }],
        2: [{ name: 'implement' }, { name: 'test' }],
      },
    });
    const summary = buildTaskSummary(state);
    assert.ok(summary.includes('## Task Summary'));
    assert.ok(summary.includes('### Phase 1'));
    assert.ok(summary.includes('### Phase 2'));
  });

  it('renders correct file counts per task', () => {
    const state = makeState({
      tasks: {
        1: [
          { name: 'alpha', files: ['a.ts', 'b.ts', 'c.ts'] },
          { name: 'beta' },
        ],
      },
    });
    const summary = buildTaskSummary(state);
    assert.ok(summary.includes('3 files'), 'alpha should show 3 files');
    assert.ok(summary.includes('0 files'), 'beta should show 0 files');
  });

  it('shows verification status per task', () => {
    const state = makeState({
      tasks: {
        1: [
          { name: 'with-verify', verify: 'npm test' },
          { name: 'no-verify' },
        ],
      },
    });
    const summary = buildTaskSummary(state);
    assert.ok(summary.includes('has verification'));
    assert.ok(summary.includes('no verification defined'));
  });

  it('sorts phases numerically (phase 2 before phase 10)', () => {
    const state = makeState({
      tasks: {
        10: [{ name: 'late' }],
        2: [{ name: 'early' }],
      },
    });
    const summary = buildTaskSummary(state);
    const idx2 = summary.indexOf('### Phase 2');
    const idx10 = summary.indexOf('### Phase 10');
    assert.ok(idx2 < idx10, 'Phase 2 should appear before Phase 10');
  });
});

/* ==========================================================
   buildContextFromState
   ========================================================== */

describe('buildContextFromState', () => {
  it('includes project metadata lines', () => {
    const state = makeState({ project: 'MyApp', currentPhase: 3, lastHandoff: 'pm', profile: 'senior' });
    const context = buildContextFromState(state, {});
    assert.ok(context.includes('## Project: MyApp'));
    assert.ok(context.includes('## Current Phase: 3'));
    assert.ok(context.includes('## Last Handoff: pm'));
    assert.ok(context.includes('## Developer Profile: senior'));
  });

  it('includes constitution when present', () => {
    const state = makeState({ constitution: 'Do no harm' });
    const context = buildContextFromState(state, {});
    assert.ok(context.includes('## Constitution:'));
    assert.ok(context.includes('Do no harm'));
  });

  it('shows TDD and light mode flags when enabled', () => {
    const state = makeState({ tddEnabled: true, lightMode: true });
    const context = buildContextFromState(state, {});
    assert.ok(context.includes('## TDD Mode: Enabled'));
    assert.ok(context.includes('## Light Mode: Enabled'));
  });

  it('skips empty/whitespace-only context values', () => {
    const state = makeState();
    const context = buildContextFromState(state, {
      spec: 'real content',
      plan: '   ',
      empty: '',
    });
    assert.ok(context.includes('## spec'));
    assert.ok(!context.includes('## plan'), 'whitespace-only value should be skipped');
    assert.ok(!context.includes('## empty'), 'empty value should be skipped');
  });

  it('produces valid output when all optional fields are absent', () => {
    const state: PartyState = {
      project: 'Bare',
      currentPhase: 0,
      tasks: {},
      lastHandoff: '',
      profile: 'default',
    };
    const context = buildContextFromState(state, {});
    assert.ok(context.includes('## Project: Bare'));
    assert.ok(context.includes('## Workflow Stage: unknown'));
    assert.ok(!context.includes('Constitution'));
    assert.ok(!context.includes('TDD Mode'));
    assert.ok(!context.includes('Light Mode'));
  });
});

/* ==========================================================
   isSyntheticAgentResult
   ========================================================== */

describe('isSyntheticAgentResult', () => {
  it('detects "offline mode" as synthetic', () => {
    assert.ok(isSyntheticAgentResult('Running in offline mode — skipping LLM call'));
  });

  it('detects "no llm available" as synthetic', () => {
    assert.ok(isSyntheticAgentResult('No LLM available, returning template'));
  });

  it('detects "manual review required" as synthetic', () => {
    assert.ok(isSyntheticAgentResult('Manual review required before proceeding'));
  });

  it('returns false for genuine LLM output', () => {
    assert.ok(!isSyntheticAgentResult('# Architecture Decision\n\nWe should use a microservices pattern because...'));
  });
});

/* ==========================================================
   computeQualityScore
   ========================================================== */

describe('computeQualityScore', () => {
  it('returns 0 for empty string', () => {
    assert.equal(computeQualityScore(''), 0);
  });

  it('returns low score for short unstructured text', () => {
    const short = 'Hello world. This is a test.';
    const score = computeQualityScore(short);
    assert.ok(score < 30, `Expected < 30 but got ${score}`);
  });

  it('returns at least 40 for text longer than 500 chars', () => {
    const longText = 'a'.repeat(501);
    const score = computeQualityScore(longText);
    assert.ok(score >= 40, `Expected >= 40 but got ${score}`);
  });

  it('awards +30 for headings', () => {
    const withHeading = '# My Heading\nSome content';
    const withoutHeading = 'My Heading\nSome content';
    const diff = computeQualityScore(withHeading) - computeQualityScore(withoutHeading);
    assert.equal(diff, 30, 'Heading bonus should be exactly 30');
  });

  it('awards +30 for action items', () => {
    // Use padded strings so both have the same length, isolating the action item bonus
    const withItems = '- action item one';
    const withoutItems = 'xxaction item one';
    assert.equal(withItems.length, withoutItems.length, 'precondition: strings same length');
    const diff = computeQualityScore(withItems) - computeQualityScore(withoutItems);
    assert.equal(diff, 30, 'Action items bonus should be exactly 30');
  });

  it('caps at 100 when all three dimensions are present', () => {
    const fullOutput = 'a'.repeat(600) + '\n# Heading\n- Action item';
    const score = computeQualityScore(fullOutput);
    assert.equal(score, 100, 'Score should be capped at 100');
  });

  it('handles exactly 500 chars boundary (no length bonus beyond rounding)', () => {
    // 500 chars / 12.5 = 40, same as the >500 floor
    const boundary = 'x'.repeat(500);
    const score = computeQualityScore(boundary);
    assert.equal(score, 40, '500 chars should produce 500/12.5 = 40 length points');
  });
});

/* ==========================================================
   dispatchAgentWithRetry
   ========================================================== */

describe('dispatchAgentWithRetry', () => {
  it('returns immediately on first success, no sleep called', async () => {
    let sleepCount = 0;
    const result = await dispatchAgentWithRetry(
      'dev', 'ctx', 'medium', 'balanced', {}, false,
      {
        _dispatchAgent: async (name) => makeAgentResult({ agent: name }),
        _sleep: async () => { sleepCount++; },
      },
    );
    assert.ok(result.success);
    assert.equal(sleepCount, 0, 'No sleep should be called on first success');
  });

  it('retries on failure and calls _sleep with correct delays', async () => {
    const delays: number[] = [];
    let attempt = 0;
    await dispatchAgentWithRetry(
      'pm', 'ctx', 'medium', 'balanced', {}, false,
      {
        _dispatchAgent: async (name) => {
          attempt++;
          return makeAgentResult({ agent: name, success: false, error: new Error('fail') });
        },
        _sleep: async (ms) => { delays.push(ms); },
      },
    );
    assert.deepEqual(delays, AGENT_RETRY_DELAYS_MS, 'Should sleep with configured delays');
  });

  it('returns last failure after exhausting retries', async () => {
    let callCount = 0;
    const result = await dispatchAgentWithRetry(
      'architect', 'ctx', 'medium', 'balanced', {}, false,
      {
        _dispatchAgent: async (name) => {
          callCount++;
          return makeAgentResult({ agent: name, success: false, result: `failure #${callCount}` });
        },
        _sleep: async () => {},
      },
    );
    assert.ok(!result.success);
    assert.equal(callCount, AGENT_MAX_RETRIES + 1, 'Should call dispatch 1 + AGENT_MAX_RETRIES times');
    assert.ok(result.result.includes(`failure #${AGENT_MAX_RETRIES + 1}`), 'Should return the last failure');
  });

  it('calls _sleep exactly AGENT_MAX_RETRIES times with [2000, 5000]', async () => {
    const sleepCalls: number[] = [];
    await dispatchAgentWithRetry(
      'ux', 'ctx', 'medium', 'balanced', {}, false,
      {
        _dispatchAgent: async (name) => makeAgentResult({ agent: name, success: false }),
        _sleep: async (ms) => { sleepCalls.push(ms); },
      },
    );
    assert.equal(sleepCalls.length, AGENT_MAX_RETRIES);
    assert.equal(sleepCalls[0], 2000);
    assert.equal(sleepCalls[1], 5000);
  });

  it('retries when synthetic result is detected (via _dispatchAgent returning success:false)', async () => {
    let calls = 0;
    const result = await dispatchAgentWithRetry(
      'dev', 'ctx', 'medium', 'balanced', {}, false,
      {
        _dispatchAgent: async (name) => {
          calls++;
          if (calls === 1) {
            return makeAgentResult({ agent: name, success: false, result: 'offline mode — no LLM' });
          }
          return makeAgentResult({ agent: name, success: true, result: '# Real output\n- item' });
        },
        _sleep: async () => {},
      },
    );
    assert.ok(result.success);
    assert.equal(calls, 2, 'Should have retried once');
  });

  it('custom _dispatchAgent injection works end to end', async () => {
    const injectedAgent = async (name: string): Promise<AgentResult> => ({
      agent: name,
      result: 'custom-injected-response',
      durationMs: 42,
      success: true,
    });
    const result = await dispatchAgentWithRetry(
      'design', 'ctx', 'medium', 'balanced', {}, false,
      { _dispatchAgent: injectedAgent, _sleep: async () => {} },
    );
    assert.equal(result.result, 'custom-injected-response');
    assert.equal(result.durationMs, 42);
  });

  it('returns correct result on success at second attempt', async () => {
    let attempt = 0;
    const result = await dispatchAgentWithRetry(
      'pm', 'ctx', 'medium', 'balanced', {}, false,
      {
        _dispatchAgent: async (name) => {
          attempt++;
          if (attempt === 1) {
            return makeAgentResult({ agent: name, success: false, result: 'fail first' });
          }
          return makeAgentResult({ agent: name, success: true, result: 'success second' });
        },
        _sleep: async () => {},
      },
    );
    assert.ok(result.success);
    assert.equal(result.result, 'success second');
    assert.equal(attempt, 2);
  });

  it('AGENT_MAX_RETRIES is 2 and AGENT_RETRY_DELAYS_MS is [2000, 5000]', () => {
    assert.equal(AGENT_MAX_RETRIES, 2);
    assert.deepEqual(AGENT_RETRY_DELAYS_MS, [2000, 5000]);
  });
});

/* ==========================================================
   runDanteParty — full injection
   ========================================================== */

describe('runDanteParty with full injection', () => {
  it('returns { success: false } when LLM is unavailable', async () => {
    const opts = makePartyOptions({
      _isLLMAvailable: async () => false,
    });
    const result = await runDanteParty(['dev'], false, false, opts);
    assert.equal(result.success, false);
  });

  it('returns { success: true } when all agents pass', async () => {
    const opts = makePartyOptions();
    const result = await runDanteParty(['dev', 'pm'], false, false, opts);
    assert.equal(result.success, true);
  });

  it('returns { success: false } when some agents fail', async () => {
    const opts = makePartyOptions({
      _dispatchAgent: async (name) => {
        if (name === 'dev') {
          return makeAgentResult({ agent: name, success: false, error: new Error('dev broke') });
        }
        return makeAgentResult({ agent: name });
      },
    });
    const result = await runDanteParty(['dev', 'pm'], false, false, opts);
    assert.equal(result.success, false);
  });

  it('calls _recordMemory for each failed agent', async () => {
    const memoryEntries: Array<{ summary: string }> = [];
    const opts = makePartyOptions({
      _dispatchAgent: async (name) =>
        makeAgentResult({ agent: name, success: false, error: new Error(`${name} broke`) }),
      _recordMemory: async (entry) => {
        memoryEntries.push({ summary: (entry as { summary: string }).summary });
      },
    });
    await runDanteParty(['dev', 'architect'], false, false, opts);
    assert.equal(memoryEntries.length, 2, 'Should record memory for each failed agent');
    assert.ok(memoryEntries.some(e => e.summary.includes('dev')));
    assert.ok(memoryEntries.some(e => e.summary.includes('architect')));
  });

  it('returns { success: false } and calls cleanup when worktree creation fails', async () => {
    const cleanedUp: string[] = [];
    let createCount = 0;
    const opts = makePartyOptions({
      _createWorktree: async (name) => {
        createCount++;
        if (createCount === 2) throw new Error('disk full');
        return `/tmp/wt/${name}`;
      },
      _removeWorktree: async (name) => { cleanedUp.push(name); },
    });
    const result = await runDanteParty(['agent-a', 'agent-b'], true, false, opts);
    assert.equal(result.success, false, 'Should fail when worktree creation fails');
    // Cleanup should have been called for the one worktree that was successfully created
    assert.ok(cleanedUp.length > 0, 'Cleanup should be called for created worktrees');
  });

  it('calls _reflect for each successful agent', async () => {
    const reflectedAgents: string[] = [];
    const opts = makePartyOptions({
      _reflect: async (taskName) => {
        reflectedAgents.push(taskName as string);
        return 'PASS: looks good';
      },
    });
    await runDanteParty(['dev', 'pm'], false, false, opts);
    assert.ok(reflectedAgents.includes('dev'), 'dev should be reflected');
    assert.ok(reflectedAgents.includes('pm'), 'pm should be reflected');
  });

  it('uses custom _readArtifact for context building', async () => {
    const readFiles: string[] = [];
    const opts = makePartyOptions({
      _readArtifact: async (filename) => {
        readFiles.push(filename);
        if (filename === 'SPEC.md') return '# Spec\nBuild the thing';
        return '';
      },
    });
    await runDanteParty(['dev'], false, false, opts);
    assert.ok(readFiles.includes('SPEC.md'), 'Should have read SPEC.md');
    assert.ok(readFiles.includes('PLAN.md'), 'Should have read PLAN.md');
    assert.ok(readFiles.includes('lessons.md'), 'Should have read lessons.md');
  });
});

/* ==========================================================
   cleanupWorktrees
   ========================================================== */

describe('cleanupWorktrees', () => {
  it('calls _removeWorktree for each agent (lowercased/sanitized)', async () => {
    const removed: string[] = [];
    await cleanupWorktrees(['Dev', 'PM Agent'], async (name) => { removed.push(name); });
    assert.deepEqual(removed, ['dev', 'pm-agent']);
  });

  it('continues cleanup even if one removal fails', async () => {
    const removed: string[] = [];
    await cleanupWorktrees(['first', 'second', 'third'], async (name) => {
      if (name === 'second') throw new Error('cannot remove');
      removed.push(name);
    });
    assert.deepEqual(removed, ['first', 'third'], 'Should skip failing removal and continue');
  });
});
