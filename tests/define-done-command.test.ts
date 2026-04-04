// define-done command — tests for existing target display, reset flow, prompt + save.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  defineDone,
  type DefineDoneOptions,
} from '../src/cli/commands/define-done.js';
import type { CompletionTarget, CompletionTargetOptions } from '../src/core/completion-target.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeTarget(overrides: Partial<CompletionTarget> = {}): CompletionTarget {
  return {
    mode: 'feature-universe',
    minScore: 9.0,
    featureCoverage: 90,
    description: 'Feature universe: 9/10 on 90%',
    definedAt: '2026-04-04T00:00:00Z',
    definedBy: 'user-prompted',
    ...overrides,
  };
}

function makeOptions(overrides: Partial<DefineDoneOptions> = {}): DefineDoneOptions {
  return {
    cwd: '/fake/project',
    _loadTarget: async () => null,
    _saveTarget: async () => {},
    _promptTarget: async () => makeTarget(),
    _now: () => '2026-04-04T00:00:00Z',
    ...overrides,
  };
}

// ── defineDone ────────────────────────────────────────────────────────────────

describe('defineDone', () => {
  it('returns existing target without prompting when target exists and no --reset', async () => {
    let promptCalled = false;
    const existing = makeTarget({ mode: 'dimension-based', minScore: 8.5 });

    const result = await defineDone(makeOptions({
      _loadTarget: async () => existing,
      _promptTarget: async () => { promptCalled = true; return makeTarget(); },
    }));

    assert.equal(promptCalled, false, 'Should not prompt when target exists');
    assert.equal(result.mode, 'dimension-based');
    assert.equal(result.minScore, 8.5);
  });

  it('prompts user when no target exists', async () => {
    let promptCalled = false;
    const newTarget = makeTarget({ mode: 'feature-universe', minScore: 9.0 });

    const result = await defineDone(makeOptions({
      _loadTarget: async () => null,
      _promptTarget: async () => { promptCalled = true; return newTarget; },
    }));

    assert.ok(promptCalled, 'Should prompt when no target exists');
    assert.equal(result.mode, 'feature-universe');
  });

  it('re-prompts when --reset even if target exists', async () => {
    let promptCalled = false;
    const existing = makeTarget({ mode: 'dimension-based' });
    const newTarget = makeTarget({ mode: 'custom', customCriteria: ['Tests pass'] });

    const result = await defineDone(makeOptions({
      reset: true,
      _loadTarget: async () => existing,
      _promptTarget: async () => { promptCalled = true; return newTarget; },
    }));

    assert.ok(promptCalled, 'Should re-prompt on --reset');
    assert.equal(result.mode, 'custom');
  });

  it('saves the prompted target', async () => {
    let savedTarget: CompletionTarget | undefined;
    const newTarget = makeTarget({ minScore: 9.5 });

    await defineDone(makeOptions({
      _loadTarget: async () => null,
      _promptTarget: async () => newTarget,
      _saveTarget: async (t) => { savedTarget = t; },
    }));

    assert.ok(savedTarget !== undefined, 'Target should be saved');
    assert.equal(savedTarget!.minScore, 9.5);
  });

  it('saves the re-prompted target when --reset', async () => {
    let savedTarget: CompletionTarget | undefined;
    const existing = makeTarget({ mode: 'dimension-based' });
    const newTarget = makeTarget({ minScore: 8.0 });

    await defineDone(makeOptions({
      reset: true,
      _loadTarget: async () => existing,
      _promptTarget: async () => newTarget,
      _saveTarget: async (t) => { savedTarget = t; },
    }));

    assert.ok(savedTarget !== undefined);
    assert.equal(savedTarget!.minScore, 8.0);
  });
});
