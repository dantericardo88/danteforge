// MCP handler integration tests — exercises handler logic with filesystem fixtures
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { jsonResult, errorResult, TOOL_HANDLERS, TOOL_DEFINITIONS, resolveCwd } from '../src/core/mcp-server.js';
import { loadState, saveState } from '../src/core/state.js';
import { assessComplexity, recordComplexityOutcome, mapScoreToPreset } from '../src/core/complexity-classifier.js';
import { classifyTaskSignature, routeTask } from '../src/core/task-router.js';
import type { DanteState } from '../src/core/state.js';

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function createTempProject(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-mcp-test-'));
  tempDirs.push(dir);
  const stateDir = path.join(dir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.mkdir(path.join(stateDir, 'reports'), { recursive: true });
  return dir;
}

function makeState(overrides?: Partial<DanteState>): DanteState {
  return {
    project: 'test-project',
    created: new Date().toISOString(),
    workflowStage: 'planned' as DanteState['workflowStage'],
    currentPhase: 'phase-1',
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {
      'phase-1': [
        { name: 'Add user auth module', files: ['src/auth.ts', 'src/middleware.ts', 'src/routes/login.ts'], verify: 'npm test' },
        { name: 'Create database schema migration', files: ['prisma/schema.prisma'], verify: 'prisma migrate dev' },
      ],
    },
    gateResults: {},
    auditLog: [],
    ...overrides,
  } as DanteState;
}

after(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
});

// ---------------------------------------------------------------------------
// jsonResult / errorResult formatting
// ---------------------------------------------------------------------------

describe('MCP result helpers', () => {
  it('jsonResult wraps data in text content block', () => {
    const result = jsonResult({ score: 42, preset: 'magic' });
    assert.equal(result.content.length, 1);
    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.equal(parsed.score, 42);
    assert.equal(parsed.preset, 'magic');
  });

  it('errorResult includes isError flag', () => {
    const result = errorResult('Missing parameter: taskName');
    assert.equal(result.isError, true);
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.equal(parsed.error, 'Missing parameter: taskName');
  });

  it('jsonResult handles arrays', () => {
    const result = jsonResult([1, 2, 3]);
    const parsed = JSON.parse((result.content[0] as { type: string; text: string }).text);
    assert.deepEqual(parsed, [1, 2, 3]);
  });

  it('jsonResult handles null', () => {
    const result = jsonResult(null);
    const text = (result.content[0] as { type: string; text: string }).text;
    assert.equal(text, 'null');
  });
});

// ---------------------------------------------------------------------------
// Complexity handler logic (with state fixtures)
// ---------------------------------------------------------------------------

describe('MCP complexity handler logic', () => {
  it('assessComplexity returns valid assessment for multi-file task', () => {
    const state = makeState();
    const tasks = state.tasks['phase-1']!;
    const assessment = assessComplexity(tasks, state);
    assert.ok(assessment.score > 0);
    assert.ok(['spark', 'ember', 'magic', 'blaze', 'inferno'].includes(assessment.recommendedPreset));
    assert.ok(typeof assessment.reasoning === 'string');
    assert.ok(assessment.reasoning.length > 0);
    assert.ok(typeof assessment.estimatedDurationMinutes === 'number');
    assert.ok(typeof assessment.estimatedCostUsd === 'number');
  });

  it('assessComplexity detects database and API signals', () => {
    const state = makeState();
    const tasks = state.tasks['phase-1']!;
    const assessment = assessComplexity(tasks, state);
    assert.ok(assessment.signals.hasDatabaseChange);
    assert.ok(assessment.signals.hasTestRequirement);
  });

  it('complexity + outcome recording closes feedback loop', () => {
    const state = makeState();
    const tasks = state.tasks['phase-1']!;
    const assessment = assessComplexity(tasks, state);
    // Simulate significant overestimation: predicted high but actual was spark
    const lesson = recordComplexityOutcome(assessment, 'spark', 0.001);
    // Only logs if drift >= 2 levels
    if (assessment.score >= 36) {
      assert.ok(lesson !== null);
      assert.ok(lesson!.includes('overestimated'));
    }
  });

  it('outcome recording returns null when prediction is close', () => {
    const state = makeState();
    const tasks = state.tasks['phase-1']!;
    const assessment = assessComplexity(tasks, state);
    // Use the predicted preset as actual — drift should be 0
    const lesson = recordComplexityOutcome(assessment, assessment.recommendedPreset, assessment.estimatedCostUsd);
    assert.equal(lesson, null);
  });
});

// ---------------------------------------------------------------------------
// Route task handler logic (with state fixtures)
// ---------------------------------------------------------------------------

describe('MCP route task handler logic', () => {
  it('routes simple transform task to local tier', () => {
    const state = makeState();
    const taskObj = { name: 'Fix typo in readme', files: ['README.md'] as string[], verify: '' };
    const signature = classifyTaskSignature(taskObj, state);
    const decision = routeTask(signature);
    assert.ok(['local', 'light', 'heavy'].includes(decision.tier));
    assert.ok(typeof decision.reason === 'string');
    assert.ok(typeof decision.estimatedCostUsd === 'number');
  });

  it('routes complex architectural task higher', () => {
    const state = makeState();
    const taskObj = { name: 'Refactor authentication module with new architecture', files: ['src/auth.ts', 'src/middleware.ts', 'src/routes.ts', 'src/db.ts', 'src/api.ts'] as string[], verify: 'npm test' };
    const signature = classifyTaskSignature(taskObj, state);
    const decision = routeTask(signature);
    // Architectural task with many files should be light or heavy
    assert.ok(['light', 'heavy'].includes(decision.tier));
  });

  it('classifyTaskSignature extracts correct signals from task', () => {
    const state = makeState();
    const taskObj = { name: 'Add security encryption for credentials', files: ['src/crypto.ts'] as string[], verify: 'npm test' };
    const signature = classifyTaskSignature(taskObj, state);
    assert.ok(signature.hasSecurityImplication);
    assert.ok(signature.hasTestRequirement);
  });
});

// ---------------------------------------------------------------------------
// Budget status handler logic (with filesystem fixtures)
// ---------------------------------------------------------------------------

describe('MCP budget status handler logic', () => {
  it('reads cost report from fixtures directory', async () => {
    const dir = await createTempProject();
    const report = {
      sessionId: 'test-session',
      timestamp: new Date().toISOString(),
      totalInputTokens: 5000,
      totalOutputTokens: 1200,
      totalCostUsd: 0.05,
      byAgent: {},
      byTier: {},
      byModel: {},
      savedByLocalTransforms: 100,
      savedByCompression: 50,
      savedByGates: 10,
    };
    const reportPath = path.join(dir, '.danteforge', 'reports', 'cost-2026-03-23T10-00-00Z.json');
    await fs.writeFile(reportPath, JSON.stringify(report));

    // Read it back (simulating what handleBudgetStatus does)
    const reportsDir = path.join(dir, '.danteforge', 'reports');
    const entries = await fs.readdir(reportsDir);
    const costFiles = entries.filter(e => e.startsWith('cost-') && e.endsWith('.json')).sort();
    assert.equal(costFiles.length, 1);
    const latest = JSON.parse(await fs.readFile(path.join(reportsDir, costFiles[0]), 'utf8'));
    assert.equal(latest.totalCostUsd, 0.05);
    assert.equal(latest.totalInputTokens, 5000);
  });

  it('handles multiple cost reports and picks latest', async () => {
    const dir = await createTempProject();
    const reportsDir = path.join(dir, '.danteforge', 'reports');
    // Write two reports
    await fs.writeFile(path.join(reportsDir, 'cost-2026-03-22T10-00-00Z.json'), JSON.stringify({ totalCostUsd: 0.02 }));
    await fs.writeFile(path.join(reportsDir, 'cost-2026-03-23T10-00-00Z.json'), JSON.stringify({ totalCostUsd: 0.08 }));

    const entries = await fs.readdir(reportsDir);
    const costFiles = entries.filter(e => e.startsWith('cost-') && e.endsWith('.json')).sort();
    assert.equal(costFiles.length, 2);
    const latest = JSON.parse(await fs.readFile(path.join(reportsDir, costFiles[costFiles.length - 1]), 'utf8'));
    assert.equal(latest.totalCostUsd, 0.08);
  });

  it('handles empty reports directory gracefully', async () => {
    const dir = await createTempProject();
    const reportsDir = path.join(dir, '.danteforge', 'reports');
    const entries = await fs.readdir(reportsDir);
    const costFiles = entries.filter(e => e.startsWith('cost-') && e.endsWith('.json'));
    assert.equal(costFiles.length, 0);
  });
});

// ---------------------------------------------------------------------------
// State persistence with fixtures
// ---------------------------------------------------------------------------

describe('MCP state handler logic', () => {
  it('loadState creates default state when file missing', async () => {
    const dir = await createTempProject();
    const state = await loadState({ cwd: dir });
    assert.ok(state);
    assert.ok(typeof state.workflowStage === 'string');
  });

  it('saveState + loadState round-trips correctly', async () => {
    const dir = await createTempProject();
    const state = makeState({ project: 'round-trip-test' } as Partial<DanteState>);
    await saveState(state, { cwd: dir });
    const loaded = await loadState({ cwd: dir });
    assert.equal(loaded.project, 'round-trip-test');
  });

  it('loadState preserves tasks with complex structure', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });
    const loaded = await loadState({ cwd: dir });
    assert.ok(loaded.tasks['phase-1']);
    assert.equal(loaded.tasks['phase-1']!.length, 2);
  });

  it('audit log accumulates across saves', async () => {
    const dir = await createTempProject();
    const state = makeState();
    state.auditLog.push('entry-1');
    await saveState(state, { cwd: dir });
    const loaded = await loadState({ cwd: dir });
    loaded.auditLog.push('entry-2');
    await saveState(loaded, { cwd: dir });
    const final = await loadState({ cwd: dir });
    assert.ok(final.auditLog.includes('entry-1'));
    assert.ok(final.auditLog.includes('entry-2'));
  });
});

// ---------------------------------------------------------------------------
// resolveCwd helper
// ---------------------------------------------------------------------------

describe('resolveCwd', () => {
  it('returns _cwd when provided as string', () => {
    assert.equal(resolveCwd({ _cwd: '/tmp/test' }), '/tmp/test');
  });

  it('falls back to process.cwd() when _cwd not provided', () => {
    assert.equal(resolveCwd({}), process.cwd());
  });
});

// ---------------------------------------------------------------------------
// TOOL_HANDLERS through public interface with _cwd injection
// ---------------------------------------------------------------------------

function parseHandlerResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

describe('TOOL_HANDLERS via _cwd injection', () => {
  it('exports all 15 handlers', () => {
    const expected = TOOL_DEFINITIONS.map(d => d.name);
    const actual = Object.keys(TOOL_HANDLERS);
    for (const name of expected) {
      assert.ok(actual.includes(name), `Missing handler: ${name}`);
    }
    assert.equal(actual.length, expected.length);
  });

  it('danteforge_state returns state via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState({ project: 'mcp-state-test' } as Partial<DanteState>);
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_state({ _cwd: dir });
    const data = parseHandlerResult(result) as Record<string, unknown>;
    assert.equal(data.project, 'mcp-state-test');
    assert.equal(data.workflowStage, 'plan');
  });

  it('danteforge_task_list returns tasks via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_task_list({ _cwd: dir });
    const data = parseHandlerResult(result) as { taskCount: number; tasks: unknown[] };
    assert.equal(data.taskCount, 2);
    assert.equal(data.tasks.length, 2);
  });

  it('danteforge_complexity returns assessment via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_complexity({ _cwd: dir });
    const data = parseHandlerResult(result) as { score: number; recommendedPreset: string };
    assert.ok(typeof data.score === 'number');
    assert.ok(data.score > 0);
    assert.ok(['spark', 'ember', 'magic', 'blaze', 'inferno'].includes(data.recommendedPreset));
  });

  it('danteforge_route_task returns routing decision via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_route_task({ _cwd: dir, taskName: 'Fix typo' });
    const data = parseHandlerResult(result) as { taskName: string; routing: { tier: string } };
    assert.equal(data.taskName, 'Fix typo');
    assert.ok(['local', 'light', 'heavy'].includes(data.routing.tier));
  });

  it('danteforge_route_task errors on missing taskName', async () => {
    const result = await TOOL_HANDLERS.danteforge_route_task({});
    assert.equal(result.isError, true);
    const data = parseHandlerResult(result) as { error: string };
    assert.ok(data.error.includes('taskName'));
  });

  it('danteforge_budget_status reads reports via _cwd', async () => {
    const dir = await createTempProject();
    const report = { totalCostUsd: 0.12, totalInputTokens: 3000 };
    await fs.writeFile(
      path.join(dir, '.danteforge', 'reports', 'cost-2026-03-24T10-00-00Z.json'),
      JSON.stringify(report),
    );

    const result = await TOOL_HANDLERS.danteforge_budget_status({ _cwd: dir });
    const data = parseHandlerResult(result) as { totalReports: number; data: { totalCostUsd: number } };
    assert.equal(data.totalReports, 1);
    assert.equal(data.data.totalCostUsd, 0.12);
  });

  it('danteforge_budget_status handles empty reports', async () => {
    const dir = await createTempProject();
    const result = await TOOL_HANDLERS.danteforge_budget_status({ _cwd: dir });
    const data = parseHandlerResult(result) as { message: string };
    assert.ok(data.message.includes('No cost reports'));
  });

  it('danteforge_audit_log returns recent entries via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState();
    state.auditLog = ['entry-alpha', 'entry-beta', 'entry-gamma'];
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_audit_log({ _cwd: dir, count: 2 });
    const data = parseHandlerResult(result) as { total: number; returned: number; entries: string[] };
    assert.equal(data.total, 3);
    assert.equal(data.returned, 2);
    assert.ok(data.entries.includes('entry-beta'));
    assert.ok(data.entries.includes('entry-gamma'));
  });

  it('danteforge_artifact_read reads files via _cwd', async () => {
    const dir = await createTempProject();
    await fs.writeFile(path.join(dir, '.danteforge', 'SPEC.md'), '# Test Spec\nContent here.');

    const result = await TOOL_HANDLERS.danteforge_artifact_read({ _cwd: dir, name: 'SPEC.md' });
    const data = parseHandlerResult(result) as { name: string; content: string; contextEconomy: { rawHash: string } };
    assert.equal(data.name, 'SPEC.md');
    assert.ok(data.content.includes('# Test Spec'));
    assert.ok(data.contextEconomy.rawHash);
  });

  it('danteforge_artifact_read economizes large artifact context without changing raw file', async () => {
    const dir = await createTempProject();
    const raw = Array.from({ length: 900 }, (_, i) => `acceptance detail ${i}`).join('\n');
    const filePath = path.join(dir, '.danteforge', 'PLAN.md');
    await fs.writeFile(filePath, raw);

    const result = await TOOL_HANDLERS.danteforge_artifact_read({ _cwd: dir, name: 'PLAN.md' });
    const data = parseHandlerResult(result) as {
      name: string;
      content: string;
      contextEconomy: { originalSize: number; compressedSize: number; savingsPercent: number };
    };

    assert.equal(data.name, 'PLAN.md');
    assert.ok(data.contextEconomy.savingsPercent > 0);
    assert.ok(data.contextEconomy.compressedSize < data.contextEconomy.originalSize);
    assert.equal(await fs.readFile(filePath, 'utf8'), raw);
  });

  it('danteforge_artifact_read returns error for missing artifact', async () => {
    const dir = await createTempProject();
    const result = await TOOL_HANDLERS.danteforge_artifact_read({ _cwd: dir, name: 'NONEXISTENT.md' });
    const data = parseHandlerResult(result) as { error: string };
    assert.ok(data.error.includes('not found'));
  });

  it('danteforge_lessons returns empty when no lessons.md', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_lessons({ _cwd: dir });
    const data = parseHandlerResult(result) as { content: string; message?: string };
    assert.equal(data.content, '');
  });

  it('danteforge_next_steps returns workflow suggestions via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_next_steps({ _cwd: dir });
    const data = parseHandlerResult(result) as { currentStage: string; nextSteps: unknown[] };
    assert.ok(typeof data.currentStage === 'string');
    assert.ok(Array.isArray(data.nextSteps));
  });

  // --- Wave H: gate_check + handoff + memory_query cwd tests ---

  it('danteforge_gate_check returns FAIL via _cwd for missing constitution', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_gate_check({ _cwd: dir, gate: 'requireConstitution' });
    const data = parseHandlerResult(result) as { gate: string; status: string; remedy?: string };
    assert.equal(data.gate, 'requireConstitution');
    assert.equal(data.status, 'FAIL');
    assert.ok(data.remedy, 'should include remedy');
  });

  it('danteforge_gate_check returns PASS via _cwd for present constitution', async () => {
    const dir = await createTempProject();
    const state = makeState({ constitution: 'test constitution' } as Partial<DanteState>);
    await saveState(state, { cwd: dir });
    await fs.writeFile(path.join(dir, '.danteforge', 'CONSTITUTION.md'), '# Constitution');

    const result = await TOOL_HANDLERS.danteforge_gate_check({ _cwd: dir, gate: 'requireConstitution' });
    const data = parseHandlerResult(result) as { gate: string; status: string };
    assert.equal(data.gate, 'requireConstitution');
    assert.equal(data.status, 'PASS');
  });

  it('danteforge_gate_check returns FAIL for missing SPEC.md via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_gate_check({ _cwd: dir, gate: 'requireSpec' });
    const data = parseHandlerResult(result) as { gate: string; status: string };
    assert.equal(data.status, 'FAIL');
  });

  it('danteforge_gate_check returns PASS for present SPEC.md via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });
    await fs.writeFile(path.join(dir, '.danteforge', 'SPEC.md'), '# Spec');

    const result = await TOOL_HANDLERS.danteforge_gate_check({ _cwd: dir, gate: 'requireSpec' });
    const data = parseHandlerResult(result) as { gate: string; status: string };
    assert.equal(data.status, 'PASS');
  });

  it('danteforge_verify rejects without confirm: true', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });

    const result = await TOOL_HANDLERS.danteforge_verify({ _cwd: dir });
    assert.ok(result.isError);
  });

  it('danteforge_memory_query returns results via _cwd', async () => {
    const dir = await createTempProject();
    const state = makeState();
    await saveState(state, { cwd: dir });
    // Create a memory store file
    const memoryStore = JSON.stringify({ entries: [] });
    await fs.writeFile(path.join(dir, '.danteforge', 'MEMORY.json'), memoryStore);

    const result = await TOOL_HANDLERS.danteforge_memory_query({ _cwd: dir, query: 'test query' });
    const data = parseHandlerResult(result) as { query: string; resultCount: number; results: unknown[] };
    assert.equal(data.query, 'test query');
    assert.equal(data.resultCount, 0);
    assert.ok(Array.isArray(data.results));
  });
});
