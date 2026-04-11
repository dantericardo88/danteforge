// MCP Server tests — tool definitions, handlers, and underlying core function integration
import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import yaml from 'yaml';

// ---------------------------------------------------------------------------
// Shared temp-dir setup — creates .danteforge/STATE.yaml for handler tests
// ---------------------------------------------------------------------------

let tmpDir: string;
const originalCwd = process.cwd();

function makeStateYaml(overrides: Record<string, unknown> = {}): string {
  return yaml.stringify({
    project: 'test-project',
    workflowStage: 'initialized',
    currentPhase: 0,
    tasks: { 0: [{ name: 'test task', files: ['src/test.ts'] }] },
    auditLog: ['2026-01-01T00:00:00Z | init: test'],
    profile: 'balanced',
    lastHandoff: 'none',
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// 1. Module import tests
// ---------------------------------------------------------------------------

describe('mcp-server module import', () => {
  it('can be dynamically imported without errors', async () => {
    const mod = await import('../src/core/mcp-server.js');
    assert.ok(mod, 'Module should be importable');
  });

  it('exports TOOL_DEFINITIONS array', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-server.js');
    assert.ok(Array.isArray(TOOL_DEFINITIONS), 'TOOL_DEFINITIONS should be an array');
  });

  it('exports TOOL_HANDLERS record', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    assert.ok(typeof TOOL_HANDLERS === 'object' && TOOL_HANDLERS !== null);
  });

  it('exports createAndStartMCPServer function', async () => {
    const { createAndStartMCPServer } = await import('../src/core/mcp-server.js');
    assert.strictEqual(typeof createAndStartMCPServer, 'function');
  });

  it('exports jsonResult and errorResult helpers', async () => {
    const { jsonResult, errorResult } = await import('../src/core/mcp-server.js');
    assert.strictEqual(typeof jsonResult, 'function');
    assert.strictEqual(typeof errorResult, 'function');
  });
});

// ---------------------------------------------------------------------------
// 2. Tool definitions structure
// ---------------------------------------------------------------------------

describe('TOOL_DEFINITIONS', () => {
  it('registers exactly 15 tools', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-server.js');
    assert.strictEqual(TOOL_DEFINITIONS.length, 15, `Expected 15 tools, got ${TOOL_DEFINITIONS.length}`);
  });

  it('each tool has name, description, and inputSchema', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-server.js');
    for (const tool of TOOL_DEFINITIONS) {
      assert.strictEqual(typeof tool.name, 'string', `Tool name should be a string`);
      assert.ok(tool.name.length > 0, `Tool name should not be empty`);
      assert.strictEqual(typeof tool.description, 'string', `Tool "${tool.name}" description should be a string`);
      assert.ok(tool.description.length > 0, `Tool "${tool.name}" description should not be empty`);
      assert.strictEqual(typeof tool.inputSchema, 'object', `Tool "${tool.name}" inputSchema should be an object`);
    }
  });

  it('all tool names are prefixed with danteforge_', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-server.js');
    for (const tool of TOOL_DEFINITIONS) {
      assert.ok(tool.name.startsWith('danteforge_'), `Tool "${tool.name}" should start with "danteforge_"`);
    }
  });

  it('tool names are unique', async () => {
    const { TOOL_DEFINITIONS } = await import('../src/core/mcp-server.js');
    const names = TOOL_DEFINITIONS.map((t: { name: string }) => t.name);
    const uniqueNames = new Set(names);
    assert.strictEqual(uniqueNames.size, names.length, 'Tool names should be unique');
  });

  it('every tool definition has a matching handler', async () => {
    const { TOOL_DEFINITIONS, TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    for (const tool of TOOL_DEFINITIONS) {
      assert.ok(
        tool.name in TOOL_HANDLERS,
        `Tool "${tool.name}" has no matching handler in TOOL_HANDLERS`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. TOOL_HANDLERS structure
// ---------------------------------------------------------------------------

describe('TOOL_HANDLERS', () => {
  it('has exactly 15 handlers', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const count = Object.keys(TOOL_HANDLERS).length;
    assert.strictEqual(count, 15, `Expected 15 handlers, got ${count}`);
  });

  it('all handlers are functions', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    for (const [name, handler] of Object.entries(TOOL_HANDLERS)) {
      assert.strictEqual(typeof handler, 'function', `Handler "${name}" should be a function`);
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Helper function tests
// ---------------------------------------------------------------------------

describe('jsonResult helper', () => {
  it('wraps data in MCP text content format', async () => {
    const { jsonResult } = await import('../src/core/mcp-server.js');
    const result = jsonResult({ foo: 'bar' });
    assert.ok(Array.isArray(result.content), 'result.content should be an array');
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.foo, 'bar');
  });

  it('does not set isError', async () => {
    const { jsonResult } = await import('../src/core/mcp-server.js');
    const result = jsonResult({ ok: true });
    assert.strictEqual(result.isError, undefined);
  });
});

describe('errorResult helper', () => {
  it('wraps error message in MCP text content format', async () => {
    const { errorResult } = await import('../src/core/mcp-server.js');
    const result = errorResult('something broke');
    assert.ok(Array.isArray(result.content));
    assert.strictEqual(result.content.length, 1);
    assert.strictEqual(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);
    assert.strictEqual(parsed.error, 'something broke');
  });

  it('sets isError to true', async () => {
    const { errorResult } = await import('../src/core/mcp-server.js');
    const result = errorResult('fail');
    assert.strictEqual(result.isError, true);
  });
});

// ---------------------------------------------------------------------------
// 5. Handler integration tests (require temp dir with STATE.yaml)
// ---------------------------------------------------------------------------

describe('MCP tool handlers (with temp workspace)', () => {
  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-mcp-test-'));
    const dfDir = path.join(tmpDir, '.danteforge');
    await fs.mkdir(dfDir, { recursive: true });
    await fs.writeFile(
      path.join(dfDir, 'STATE.yaml'),
      makeStateYaml(),
    );
    process.chdir(tmpDir);
  });

  after(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('danteforge_state handler returns project state', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_state']({});
    assert.ok(result.content, 'Result should have content');
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.project, 'test-project');
    assert.strictEqual(data.workflowStage, 'initialized');
    assert.strictEqual(typeof data.currentPhase, 'number');
    assert.strictEqual(typeof data.profile, 'string');
  });

  it('danteforge_task_list handler returns tasks for current phase', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_task_list']({});
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.currentPhase, 0);
    assert.strictEqual(data.taskCount, 1);
    assert.ok(Array.isArray(data.tasks));
    assert.strictEqual(data.tasks[0].name, 'test task');
  });

  it('danteforge_audit_log handler returns audit entries', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_audit_log']({});
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(typeof data.total, 'number');
    assert.ok(Array.isArray(data.entries));
    // At least the original seed entry
    assert.ok(data.total >= 1, `Expected at least 1 audit entry, got ${data.total}`);
  });

  it('danteforge_gate_check handler fails for missing constitution', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_gate_check']({ gate: 'requireConstitution' });
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.status, 'FAIL');
    assert.ok(data.message, 'Should have a failure message');
  });

  it('danteforge_gate_check handler passes when constitution exists', async () => {
    // Create CONSTITUTION.md in the .danteforge dir
    const constitutionPath = path.join(tmpDir, '.danteforge', 'CONSTITUTION.md');
    await fs.writeFile(constitutionPath, '# Constitution\nTest principles');

    // Also set the constitution field in state
    const stateFilePath = path.join(tmpDir, '.danteforge', 'STATE.yaml');
    await fs.writeFile(stateFilePath, makeStateYaml({
      constitution: '# Constitution\nTest principles',
      workflowStage: 'constitution',
    }));

    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_gate_check']({ gate: 'requireConstitution' });
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.status, 'PASS');

    // Clean up
    await fs.unlink(constitutionPath);
    await fs.writeFile(stateFilePath, makeStateYaml());
  });

  it('danteforge_gate_check handler returns error for unknown gate', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_gate_check']({ gate: 'requireMagic' });
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.error, 'Should return an error for unknown gate');
    assert.ok(data.error.includes('Unknown gate'), `Error should mention unknown gate, got: ${data.error}`);
  });

  it('danteforge_artifact_read handler returns error for missing artifact', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_artifact_read']({ name: 'NONEXISTENT.md' });
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.error, 'Should return an error for missing artifact');
    assert.ok(data.error.includes('not found'));
  });

  it('danteforge_artifact_read handler returns artifact content when it exists', async () => {
    const specPath = path.join(tmpDir, '.danteforge', 'SPEC.md');
    await fs.writeFile(specPath, '# Spec\nTest specification content');

    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_artifact_read']({ name: 'SPEC.md' });
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(data.name, 'SPEC.md');
    assert.ok(data.content.includes('Test specification content'));

    await fs.unlink(specPath);
  });

  it('danteforge_lessons handler returns graceful message when no lessons exist', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_lessons']({});
    const data = JSON.parse(result.content[0].text);
    // Should not be an error — just an empty/message result
    assert.strictEqual(result.isError, undefined);
    assert.ok(data.content !== undefined || data.message !== undefined);
  });

  it('danteforge_lessons handler reads lessons.md when it exists', async () => {
    const lessonsPath = path.join(tmpDir, '.danteforge', 'lessons.md');
    await fs.writeFile(lessonsPath, '## Lesson 1\nAlways run tests before commit.\n');

    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_lessons']({});
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.content.includes('Always run tests before commit'));

    await fs.unlink(lessonsPath);
  });

  it('danteforge_budget_status handler returns graceful message when no reports dir exists', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_budget_status']({});
    const data = JSON.parse(result.content[0].text);
    assert.strictEqual(result.isError, undefined);
    assert.ok(data.message, 'Should have a message about no reports');
  });

  it('danteforge_route_task handler routes a simple rename task to local tier', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_route_task']({ taskName: 'rename variable foo to bar' });
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.routing, 'Should have a routing decision');
    assert.strictEqual(data.routing.tier, 'local', `Expected local tier, got ${data.routing.tier}`);
  });

  it('danteforge_route_task handler returns error for empty task name', async () => {
    const { TOOL_HANDLERS } = await import('../src/core/mcp-server.js');
    const result = await TOOL_HANDLERS['danteforge_route_task']({ taskName: '' });
    const data = JSON.parse(result.content[0].text);
    assert.ok(data.error, 'Should return an error for empty task name');
  });
});

// ---------------------------------------------------------------------------
// 6. Underlying core function tests (used by MCP handlers)
// ---------------------------------------------------------------------------

describe('core functions used by MCP handlers', () => {
  let coreTmpDir: string;

  before(async () => {
    coreTmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-mcp-core-'));
    const dfDir = path.join(coreTmpDir, '.danteforge');
    await fs.mkdir(dfDir, { recursive: true });
    await fs.writeFile(
      path.join(dfDir, 'STATE.yaml'),
      makeStateYaml({
        tasks: {
          0: [
            { name: 'architect new authentication module', files: ['src/auth.ts', 'src/users.ts', 'src/tokens.ts'], verify: 'npm test' },
            { name: 'rename import path', files: ['src/index.ts'] },
          ],
        },
        auditLog: ['entry-1', 'entry-2', 'entry-3'],
      }),
    );
    process.chdir(coreTmpDir);
  });

  after(async () => {
    process.chdir(originalCwd);
    await fs.rm(coreTmpDir, { recursive: true, force: true });
  });

  it('loadState returns valid state with auditLog as array', async () => {
    const { loadState } = await import('../src/core/state.js');
    const state = await loadState();
    assert.ok(Array.isArray(state.auditLog), 'auditLog should be an array');
    assert.strictEqual(state.auditLog.length, 3);
  });

  it('loadState returns tasks accessible by phase for task_list tool', async () => {
    const { loadState } = await import('../src/core/state.js');
    const state = await loadState();
    assert.ok(state.tasks[0], 'Phase 0 tasks should exist');
    assert.strictEqual(state.tasks[0].length, 2);
    assert.strictEqual(state.tasks[0][0].name, 'architect new authentication module');
  });

  it('assessComplexity produces valid assessment via complexity classifier', async () => {
    const { loadState } = await import('../src/core/state.js');
    const { assessComplexity } = await import('../src/core/complexity-classifier.js');
    const state = await loadState();
    const tasks = state.tasks[0] ?? [];
    const assessment = assessComplexity(tasks, state);
    assert.strictEqual(typeof assessment.score, 'number');
    assert.ok(assessment.score >= 0 && assessment.score <= 100);
    assert.strictEqual(typeof assessment.recommendedPreset, 'string');
    assert.strictEqual(typeof assessment.shouldUseParty, 'boolean');
    assert.strictEqual(typeof assessment.reasoning, 'string');
  });

  it('classifyTaskSignature + routeTask produce valid routing decision', async () => {
    const { loadState } = await import('../src/core/state.js');
    const { classifyTaskSignature, routeTask } = await import('../src/core/task-router.js');
    const state = await loadState();
    const task = { name: 'architect new authentication module', files: ['src/auth.ts', 'src/users.ts', 'src/tokens.ts'], verify: 'npm test' };
    const signature = classifyTaskSignature(task, state);
    const decision = routeTask(signature);
    assert.ok(['local', 'light', 'heavy'].includes(decision.tier));
    assert.strictEqual(typeof decision.reason, 'string');
    assert.strictEqual(typeof decision.estimatedCostUsd, 'number');
  });
});
