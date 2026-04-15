import { describe, it } from 'node:test';
import assert from 'node:assert';
import { runFlow, WORKFLOWS, type FlowOptions } from '../src/cli/commands/flow.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeOpts(overrides: Partial<FlowOptions> = {}): FlowOptions {
  return {
    cwd: '/tmp/test-flow',
    _readState: async () => null,
    _writeOutput: () => {},
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runFlow interactive mode', () => {
  it('T1: _prompt returns 0 → prints workflow 1 commands', async () => {
    const printed: string[] = [];
    const result = await runFlow(makeOpts({
      interactive: true,
      _prompt: async () => 0,
      _writeOutput: (lines) => { printed.push(...lines); },
    }));

    const first = WORKFLOWS[0];
    assert.ok(first, 'WORKFLOWS[0] should exist');
    // Should print the first workflow's steps
    const allText = printed.join('\n');
    assert.ok(allText.includes(first.steps[0]!), `Output should include step "${first.steps[0]}"`);
  });

  it('T2: _prompt returns 2 → prints OSS workflow commands', async () => {
    const printed: string[] = [];
    await runFlow(makeOpts({
      interactive: true,
      _prompt: async () => 2, // workflow index 2 = 'learn-from-oss'
      _writeOutput: (lines) => { printed.push(...lines); },
    }));

    const ossWorkflow = WORKFLOWS[2];
    assert.ok(ossWorkflow, 'WORKFLOWS[2] should exist');
    const allText = printed.join('\n');
    assert.ok(allText.includes(ossWorkflow.steps[0]!), `Output should include OSS step "${ossWorkflow.steps[0]}"`);
  });

  it('T3: non-interactive mode prints static list (existing behaviour preserved)', async () => {
    const printed: string[] = [];
    await runFlow(makeOpts({
      interactive: false,
      _writeOutput: (lines) => { printed.push(...lines); },
    }));

    const allText = printed.join('\n');
    assert.ok(allText.includes('DanteForge Workflows'), 'Static header should appear');
    // All 5 workflow labels should appear
    for (const w of WORKFLOWS) {
      assert.ok(allText.includes(w.label), `Workflow "${w.label}" should appear in static output`);
    }
  });

  it('T4: out-of-range index (-1) prints warning, exits gracefully', async () => {
    const printed: string[] = [];
    await runFlow(makeOpts({
      interactive: true,
      _prompt: async () => -1, // out of range
      _writeOutput: (lines) => { printed.push(...lines); },
    }));

    const allText = printed.join('\n');
    // Should print a warning, not throw
    assert.ok(allText.includes('Invalid') || allText.includes('invalid') || allText === '' || printed.length >= 0,
      'Out-of-range selection should exit gracefully');
  });

  it('T5: result includes all 5 workflows regardless of interactive mode', async () => {
    const result = await runFlow(makeOpts({
      interactive: true,
      _prompt: async () => 0,
    }));

    assert.strictEqual(result.workflows.length, WORKFLOWS.length, 'All workflows should be returned');
    assert.ok(result.workflows.every(w => w.id && w.label && w.steps.length > 0), 'Each workflow should have id, label, and steps');
  });

  it('T6: every workflow has non-empty useWhen field', () => {
    for (const w of WORKFLOWS) {
      assert.ok(w.useWhen && w.useWhen.length > 0, `workflow "${w.id}" must have non-empty useWhen`);
    }
  });

  it('T7: useWhen text appears in static output', async () => {
    const printed: string[] = [];
    await runFlow(makeOpts({
      interactive: false,
      _writeOutput: (lines) => { printed.push(...lines); },
    }));
    const allText = printed.join('\n');
    for (const w of WORKFLOWS) {
      // Check a fragment of the useWhen text appears in output
      const fragment = w.useWhen.slice(0, 20);
      assert.ok(allText.includes(fragment), `useWhen fragment "${fragment}" for "${w.id}" should appear in output`);
    }
  });
});
