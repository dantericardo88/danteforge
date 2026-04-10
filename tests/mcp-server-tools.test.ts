// MCP Server Tools — unit tests for createMcpServer / TOOL_HANDLERS
// Tests use McpServerDeps injection so no real LLM or FS calls are made.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOOL_DEFINITIONS,
  TOOL_HANDLERS,
  type McpServerDeps,
  type ToolName,
} from '../src/core/mcp-server.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const TOOL_NAMES = TOOL_DEFINITIONS.map((t) => t.name);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('MCP server tool registry', () => {
  it('exports a non-empty TOOL_DEFINITIONS array', () => {
    assert.ok(Array.isArray(TOOL_DEFINITIONS));
    assert.ok(TOOL_DEFINITIONS.length >= 15);
  });

  it('registers all expected tool names', () => {
    const expected = [
      'danteforge_assess',
      'danteforge_forge',
      'danteforge_verify',
      'danteforge_autoforge',
      'danteforge_plan',
      'danteforge_tasks',
      'danteforge_synthesize',
      'danteforge_retro',
      'danteforge_maturity',
      'danteforge_specify',
      'danteforge_constitution',
      'danteforge_state_read',
      'danteforge_masterplan',
      'danteforge_competitors',
      'danteforge_lessons_add',
      'danteforge_workflow',
    ];
    for (const name of expected) {
      assert.ok(
        TOOL_NAMES.includes(name),
        `Expected tool "${name}" to be registered`,
      );
    }
  });

  it('every tool definition has a name, description, and inputSchema', () => {
    for (const tool of TOOL_DEFINITIONS) {
      assert.equal(typeof tool.name, 'string', `${tool.name}: name must be string`);
      assert.equal(typeof tool.description, 'string', `${tool.name}: description must be string`);
      assert.ok(tool.inputSchema, `${tool.name}: inputSchema must exist`);
    }
  });
});

describe('danteforge_assess handler', () => {
  it('calls injected _assess with resolved cwd', async () => {
    let receivedOpts: Record<string, unknown> | undefined;
    const deps: McpServerDeps = {
      _assess: async (opts) => {
        receivedOpts = opts as Record<string, unknown>;
        return { overallScore: 7.5, passesThreshold: false };
      },
    };

    const result = await TOOL_HANDLERS.danteforge_assess(
      { cwd: '/tmp/myproject' },
      { ...deps, _sanitize: (raw: string) => raw },
    );

    assert.ok(receivedOpts !== undefined);
    assert.equal(receivedOpts.cwd, '/tmp/myproject');
    const parsed = JSON.parse(result);
    assert.equal(parsed.overallScore, 7.5);
  });

  it('defaults cwd to process.cwd() when not provided', async () => {
    let receivedCwd: string | undefined;
    const deps: McpServerDeps = {
      _assess: async (opts) => {
        receivedCwd = (opts as Record<string, unknown>).cwd as string;
        return { overallScore: 5.0, passesThreshold: false };
      },
    };

    await TOOL_HANDLERS.danteforge_assess({}, deps);

    assert.equal(receivedCwd, process.cwd());
  });
});

describe('danteforge_state_read handler', () => {
  it('calls injected _loadState with correct cwd', async () => {
    let receivedOpts: Record<string, unknown> | undefined;
    const fakeState = {
      project: 'my-project',
      workflowStage: 'forge',
      lastHandoff: 'plan',
      currentPhase: 2,
      auditLog: [],
      tasks: {},
      profile: 'balanced',
    };

    const deps: McpServerDeps = {
      _loadState: async (opts) => {
        receivedOpts = opts as Record<string, unknown>;
        return fakeState;
      },
    };

    const result = await TOOL_HANDLERS.danteforge_state_read(
      { cwd: '/tmp/testproject' },
      { ...deps, _sanitize: (raw: string) => raw },
    );

    assert.ok(receivedOpts !== undefined);
    assert.equal(receivedOpts.cwd, '/tmp/testproject');
    const parsed = JSON.parse(result);
    assert.equal(parsed.workflowStage, 'forge');
  });
});

describe('danteforge_workflow handler', () => {
  it('returns workflowStage from state', async () => {
    const fakeState = {
      workflowStage: 'verify',
      currentPhase: 3,
      lastHandoff: 'forge',
      lastVerifyStatus: 'pass',
    };

    const deps: McpServerDeps = {
      _workflow: async (_opts) => fakeState,
    };

    const result = await TOOL_HANDLERS.danteforge_workflow(
      { cwd: '/tmp/proj' },
      deps,
    );

    const parsed = JSON.parse(result);
    assert.equal(parsed.workflowStage, 'verify');
    assert.equal(parsed.currentPhase, 3);
    assert.equal(parsed.lastVerifyStatus, 'pass');
  });
});

describe('error handling in tool handlers', () => {
  it('danteforge_assess wraps errors as JSON error content via TOOL_HANDLERS', async () => {
    // The handler itself does NOT catch errors — the MCP dispatcher does.
    // Verify the handler throws (not swallows) on injected error.
    const deps: McpServerDeps = {
      _assess: async () => {
        throw new Error('LLM unavailable');
      },
    };

    await assert.rejects(
      () => TOOL_HANDLERS.danteforge_assess({ cwd: '/tmp/x' }, deps),
      /LLM unavailable/,
    );
  });
});

describe('danteforge_lessons_add handler', () => {
  it('calls injected _appendLesson with lesson text', async () => {
    const captured: string[] = [];
    const deps: McpServerDeps = {
      _appendLesson: async (entry) => {
        captured.push(entry);
      },
    };

    const result = await TOOL_HANDLERS.danteforge_lessons_add(
      { cwd: '/tmp/proj', lesson: 'Always write tests before code.' },
      deps,
    );

    assert.equal(captured.length, 1);
    assert.equal(captured[0], 'Always write tests before code.');
    const parsed = JSON.parse(result);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.lesson, 'Always write tests before code.');
  });
});
