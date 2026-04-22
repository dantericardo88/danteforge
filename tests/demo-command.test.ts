import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { demo } from '../src/cli/commands/demo.js';
import type { DemoCommandOptions } from '../src/cli/commands/demo.js';
import { DEMO_FIXTURES } from '../src/core/demo-fixtures.js';

function makeOpts(overrides: Partial<DemoCommandOptions> = {}): DemoCommandOptions {
  return {
    _scoreRawPrompt: (p) => ({ total: 20, breakdown: { clarity: 5, specificity: 5, context: 5, constraints: 5 } } as any),
    _runPdse: async () => 75,
    _stdout: () => {},
    ...overrides,
  };
}

describe('demo', () => {
  it('completes without throwing when no fixture specified', async () => {
    await assert.doesNotReject(() => demo(makeOpts()));
  });

  it('runs a specific fixture by name', async () => {
    if (DEMO_FIXTURES.length === 0) return;
    const fixtureName = DEMO_FIXTURES[0]!.name;
    await assert.doesNotReject(() => demo(makeOpts({ fixture: fixtureName })));
  });

  it('runs all fixtures when all flag set', async () => {
    let printCount = 0;
    await demo(makeOpts({
      all: true,
      _stdout: () => { printCount++; },
    }));
    assert.ok(printCount > 0);
  });

  it('calls _scoreRawPrompt for each fixture run', async () => {
    let scoreCalled = 0;
    if (DEMO_FIXTURES.length === 0) return;
    await demo(makeOpts({
      fixture: DEMO_FIXTURES[0]!.name,
      _scoreRawPrompt: (p) => { scoreCalled++; return { total: 15, breakdown: {} } as any; },
    }));
    assert.ok(scoreCalled > 0);
  });

  it('calls _runPdse when provided', async () => {
    if (DEMO_FIXTURES.length === 0) return;
    let pdseCalled = false;
    await demo(makeOpts({
      fixture: DEMO_FIXTURES[0]!.name,
      _runPdse: async () => { pdseCalled = true; return 80; },
    }));
    assert.ok(pdseCalled);
  });

  it('outputs improvement line to _stdout', async () => {
    if (DEMO_FIXTURES.length === 0) return;
    const lines: string[] = [];
    await demo(makeOpts({
      fixture: DEMO_FIXTURES[0]!.name,
      _stdout: (line) => lines.push(line),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('IMPROVEMENT') || combined.includes('Score'));
  });

  it('does not throw for unknown fixture name', async () => {
    await assert.doesNotReject(() =>
      demo(makeOpts({ fixture: 'nonexistent-fixture-xyz' }))
    );
  });
});
