// v090-adversarial.test.ts — adversarial and edge-case tests across v0.9.0 modules
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  stripComments,
  collapseWhitespace,
  summarizeTestBodies,
  truncateFileBlocks,
} from '../src/core/context-compressor.js';

import {
  spawnHeadlessAgent,
  parseStreamJsonOutput,
  resetCliAvailabilityCache,
} from '../src/core/headless-spawner.js';

import type { SpawnerOptions } from '../src/core/headless-spawner.js';

import {
  computeExecutionLevels,
  buildDefaultDAG,
  executeDAG,
} from '../src/core/agent-dag.js';

import type { AgentNode } from '../src/core/agent-dag.js';
import type { AgentRole } from '../src/core/subagent-isolator.js';

import {
  computeComplexityScore,
  mapScoreToPreset,
} from '../src/core/complexity-classifier.js';

import type { ComplexitySignals } from '../src/core/complexity-classifier.js';

import {
  jsonResult,
  errorResult,
} from '../src/core/mcp-server.js';

// ---------------------------------------------------------------------------
// Mock spawn helper (matches SpawnerOptions['_spawnFn'] shape)
// ---------------------------------------------------------------------------

type MockChild = ReturnType<NonNullable<SpawnerOptions['_spawnFn']>>;

function createMockSpawn(stdout: string, stderr: string, exitCode: number, delay = 10) {
  return (_cmd: string, _args: string[], _opts: Record<string, unknown>): MockChild => {
    const stdoutCallbacks: Array<(data: Buffer) => void> = [];
    const stderrCallbacks: Array<(data: Buffer) => void> = [];
    const eventCallbacks: Record<string, Array<(arg: unknown) => void>> = {};

    setTimeout(() => {
      for (const cb of stdoutCallbacks) cb(Buffer.from(stdout));
      for (const cb of stderrCallbacks) cb(Buffer.from(stderr));
      for (const cb of (eventCallbacks['close'] ?? [])) cb(exitCode);
    }, delay);

    return {
      stdout: { on: (_event: string, cb: (data: Buffer) => void) => { stdoutCallbacks.push(cb); } },
      stderr: { on: (_event: string, cb: (data: Buffer) => void) => { stderrCallbacks.push(cb); } },
      on: (event: string, cb: (code: number | null) => void) => {
        if (!eventCallbacks[event]) eventCallbacks[event] = [];
        eventCallbacks[event].push(cb as (arg: unknown) => void);
      },
      kill: () => true,
      pid: 12345,
    };
  };
}

// ---------------------------------------------------------------------------
// Minimal complexity signals factory
// ---------------------------------------------------------------------------

function makeSignals(overrides?: Partial<ComplexitySignals>): ComplexitySignals {
  return {
    fileCount: 0,
    moduleCount: 0,
    hasNewModule: false,
    hasArchitecturalChange: false,
    hasSecurityImplication: false,
    hasTestRequirement: false,
    hasDatabaseChange: false,
    hasAPIChange: false,
    estimatedLinesOfCode: 0,
    dependencyDepth: 0,
    ...overrides,
  };
}

// ===========================================================================
// Group 1: Context Compressor Adversarial
// ===========================================================================

describe('Context Compressor Adversarial', () => {
  it('stripComments handles escaped quotes in strings', () => {
    const input = 'const x = "say \\"hi\\""; // remove me';
    const result = stripComments(input);
    // The string content with escaped quotes should remain intact
    assert.ok(result.includes('say'), 'escaped string content must survive');
    assert.ok(!result.includes('// remove me'), 'trailing comment must be stripped');
  });

  it('stripComments preserves URLs with //', () => {
    const input = 'const url = "https://example.com"; // comment';
    const result = stripComments(input);
    assert.ok(result.includes('https://example.com'), 'URL must survive comment stripping');
    assert.ok(!result.includes('// comment'), 'trailing comment must be removed');
  });

  it('summarizeTestBodies handles test name containing braces', () => {
    const input = "it('handles { edge }', () => {\n  assert.ok(true);\n});\n";
    // Should not crash or miscount braces
    const result = summarizeTestBodies(input);
    assert.ok(typeof result === 'string', 'must return a string without crashing');
  });

  it('truncateFileBlocks handles unclosed code fence without hanging', () => {
    const input = '```typescript\nconst x = 1;\n// no closing fence';
    // Should complete without infinite loop; the regex split will not match
    // an unclosed fence as a fenced block, so it passes through untouched.
    const result = truncateFileBlocks(input, 5);
    assert.ok(typeof result === 'string', 'must return a string');
    assert.ok(result.includes('const x = 1'), 'content must be preserved');
  });

  it('collapseWhitespace returns empty for whitespace-only input', () => {
    const result = collapseWhitespace('   \n\n\t\t  \n   ');
    assert.equal(result.trim(), '', 'whitespace-only input must collapse to empty after trim');
  });
});

// ===========================================================================
// Group 2: Headless Spawner Adversarial
// ===========================================================================

describe('Headless Spawner Adversarial', () => {
  beforeEach(() => {
    resetCliAvailabilityCache();
  });

  it('handles partial JSON output then crash', async () => {
    // First line is valid stream-json, second line is broken JSON
    const stdout = '{"type":"result","result":"partial output"}\n{"invalid';
    const mock = createMockSpawn(stdout, 'crash', 1);
    const result = await spawnHeadlessAgent(
      { role: 'dev', prompt: 'test' },
      { _spawnFn: mock },
    );
    // parseStreamJsonOutput skips invalid lines; the valid result line should parse
    assert.equal(result.exitCode, 1);
    assert.ok(result.stdout.includes('partial output'), 'parsed text from valid JSON line must be present');
  });

  it('timeout kills process and reports timed out', async () => {
    // Spawn that never fires close — the timeout in spawnHeadlessAgent should kill it.
    // After kill, the process should eventually fire close; we simulate that.
    const neverCloseSpawn = (_cmd: string, _args: string[], _opts: Record<string, unknown>): MockChild => {
      const stdoutCbs: Array<(data: Buffer) => void> = [];
      const stderrCbs: Array<(data: Buffer) => void> = [];
      const eventCbs: Record<string, Array<(arg: unknown) => void>> = {};

      return {
        stdout: { on: (_: string, cb: (data: Buffer) => void) => { stdoutCbs.push(cb); } },
        stderr: { on: (_: string, cb: (data: Buffer) => void) => { stderrCbs.push(cb); } },
        on: (event: string, cb: (code: number | null) => void) => {
          if (!eventCbs[event]) eventCbs[event] = [];
          eventCbs[event].push(cb as (arg: unknown) => void);
        },
        kill: () => {
          // Simulate the OS closing the process after SIGTERM
          setTimeout(() => {
            for (const cb of (eventCbs['close'] ?? [])) cb(137);
          }, 5);
          return true;
        },
        pid: 99999,
      };
    };

    const result = await spawnHeadlessAgent(
      { role: 'dev', prompt: 'test', timeoutMs: 50 },
      { _spawnFn: neverCloseSpawn },
    );
    assert.ok(
      result.stderr.includes('timed out') || result.durationMs >= 50,
      'must indicate timeout in stderr or exceed timeout duration',
    );
  });

  it('fallbackToApi: spawn fails, API succeeds', async () => {
    const mock = createMockSpawn('', 'spawn error', 1);
    const result = await spawnHeadlessAgent(
      { role: 'dev', prompt: 'test prompt' },
      {
        _spawnFn: mock,
        fallbackToApi: true,
        _apiCaller: async (prompt: string) => `API response for: ${prompt}`,
      },
    );
    assert.equal(result.exitCode, 0, 'API fallback should yield exit code 0');
    assert.ok(result.stdout.includes('API response'), 'stdout should contain API response');
  });

  it('fallbackToApi: both spawn and API fail', async () => {
    const mock = createMockSpawn('', 'spawn error', 1);
    const result = await spawnHeadlessAgent(
      { role: 'dev', prompt: 'test' },
      {
        _spawnFn: mock,
        fallbackToApi: true,
        _apiCaller: async () => { throw new Error('API also down'); },
      },
    );
    // Should return original spawn error when API fallback also fails
    assert.equal(result.exitCode, 1, 'exit code must reflect original spawn failure');
  });

  it('fallbackToApi disabled does not attempt API on failure', async () => {
    const mock = createMockSpawn('', 'spawn failed', 1);
    let apiCalled = false;
    const result = await spawnHeadlessAgent(
      { role: 'dev', prompt: 'test' },
      {
        _spawnFn: mock,
        fallbackToApi: false,
        _apiCaller: async () => { apiCalled = true; return 'should not reach'; },
      },
    );
    assert.equal(result.exitCode, 1);
    assert.ok(!apiCalled, 'API caller should not have been invoked when fallbackToApi is false');
  });
});

// ===========================================================================
// Group 3: Agent DAG Adversarial
// ===========================================================================

describe('Agent DAG Adversarial', () => {
  it('detects cycles in DAG', () => {
    const nodes: AgentNode[] = [
      { role: 'pm', dependsOn: ['architect'], priority: 0 },
      { role: 'architect', dependsOn: ['pm'], priority: 1 },
    ];
    assert.throws(() => computeExecutionLevels(nodes), /cycle/i);
  });

  it('handles single-node DAG', () => {
    const nodes: AgentNode[] = [{ role: 'dev', dependsOn: [], priority: 0 }];
    const plan = computeExecutionLevels(nodes);
    assert.equal(plan.levels.length, 1);
    assert.deepStrictEqual(plan.levels[0].agents, ['dev']);
  });

  it('all agents fail marks all dependents as blocked', async () => {
    const dag = buildDefaultDAG();
    const plan = computeExecutionLevels(dag);
    // Executor that returns an empty map for every level (all agents fail)
    const executor = async (_agents: AgentRole[]) => new Map<AgentRole, string>();
    const result = await executeDAG(plan, executor);
    // pm fails at level 0, so everything downstream should be blocked
    assert.ok(result.blockedAgents.length > 0, 'at least some agents must be blocked');
    // Specifically, architect, dev, ux, design, scrum-master should all be blocked
    const blocked = new Set(result.blockedAgents);
    assert.ok(blocked.has('architect'), 'architect must be blocked when pm fails');
    assert.ok(blocked.has('dev'), 'dev must be blocked');
    assert.ok(blocked.has('scrum-master'), 'scrum-master must be blocked');
  });

  it('three independent roots all appear in level 0', () => {
    // All three agents have no dependencies: they should all appear in level 0
    const nodes: AgentNode[] = [
      { role: 'pm', dependsOn: [], priority: 0 },
      { role: 'dev', dependsOn: [], priority: 1 },
      { role: 'ux', dependsOn: [], priority: 2 },
    ];
    const plan = computeExecutionLevels(nodes);
    assert.equal(plan.levels.length, 1, 'all independent nodes go in a single level');
    assert.equal(plan.levels[0].agents.length, 3);
    assert.ok(plan.levels[0].agents.includes('pm'));
    assert.ok(plan.levels[0].agents.includes('dev'));
    assert.ok(plan.levels[0].agents.includes('ux'));
  });
});

// ===========================================================================
// Group 4: Complexity Classifier Boundaries
// ===========================================================================

describe('Complexity Classifier Boundaries', () => {
  it('score 15 maps to spark', () => {
    assert.equal(mapScoreToPreset(15), 'spark');
  });

  it('score 16 maps to ember', () => {
    assert.equal(mapScoreToPreset(16), 'ember');
  });

  it('score 55 maps to magic', () => {
    assert.equal(mapScoreToPreset(55), 'magic');
  });

  it('score 56 maps to blaze', () => {
    assert.equal(mapScoreToPreset(56), 'blaze');
  });

  it('all-zero signals yield score 0', () => {
    const score = computeComplexityScore(makeSignals());
    assert.equal(score, 0, 'zero signals must produce zero score');
  });

  it('maxed-out signals do not exceed 100', () => {
    const score = computeComplexityScore(makeSignals({
      fileCount: 100,
      moduleCount: 20,
      hasNewModule: true,
      hasArchitecturalChange: true,
      hasSecurityImplication: true,
      hasTestRequirement: true,
      hasDatabaseChange: true,
      hasAPIChange: true,
      estimatedLinesOfCode: 10000,
      dependencyDepth: 10,
    }));
    assert.ok(score <= 100, `score must be clamped to 100, got ${score}`);
    assert.ok(score >= 76, 'fully loaded signals should reach inferno range');
  });
});

// ===========================================================================
// Group 5: MCP Server Adversarial
// ===========================================================================

describe('MCP Server Adversarial', () => {
  it('jsonResult wraps data correctly', () => {
    const result = jsonResult({ key: 'value' });
    assert.ok(Array.isArray(result.content), 'content must be an array');
    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse((result.content[0] as { text: string }).text);
    assert.equal(parsed.key, 'value');
  });

  it('errorResult wraps error message and sets isError', () => {
    const result = errorResult('something broke');
    assert.ok(result.isError, 'isError must be true');
    assert.ok(
      (result.content[0] as { text: string }).text.includes('something broke'),
      'error message must appear in content',
    );
  });
});
