// debug-command.test.ts — command-level tests for debug() via injection seams
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { DanteState } from '../src/core/state.js';
import { debug } from '../src/cli/commands/debug.js';

function makeState(): DanteState {
  return {
    project: 'test', workflowStage: 'tasks', currentPhase: 0,
    profile: 'budget', lastHandoff: 'none', auditLog: [], tasks: {},
  } as unknown as DanteState;
}

function makeBaseOpts(overrides: Record<string, unknown> = {}) {
  const state = makeState();
  const saved: DanteState[] = [];
  return {
    _loadState: async () => ({ ...state, auditLog: [...state.auditLog] } as DanteState),
    _saveState: async (s: DanteState) => { saved.push(s); },
    _resolveSkill: async (_name: string) => ({ content: 'Phase 1: Root Cause...' }),
    _isLLMAvailable: async () => false,
    _callLLM: async (_prompt: string) => 'LLM analysis result',
    _savePrompt: async (_name: string, _template: string) => '/tmp/debug.md',
    saved,
    ...overrides,
  };
}

describe('debug command: prompt mode', () => {
  it('returns without calling _isLLMAvailable in prompt mode', async () => {
    let llmChecked = false;
    const opts = makeBaseOpts({ _isLLMAvailable: async () => { llmChecked = true; return false; } });
    await debug('weird crash', { prompt: true }, opts);
    assert.strictEqual(llmChecked, false, '_isLLMAvailable should not be called in prompt mode');
  });

  it('calls _savePrompt with name "debug" and template containing the issue', async () => {
    const calls: Array<[string, string]> = [];
    const opts = makeBaseOpts({ _savePrompt: async (name, template) => { calls.push([name, template]); return '/tmp/debug.md'; } });
    await debug('null pointer exception', { prompt: true }, opts);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0]![0], 'debug');
    assert.ok(calls[0]![1].includes('null pointer exception'), 'template should contain the issue');
  });

  it('audit log entry written in prompt mode', async () => {
    const opts = makeBaseOpts();
    await debug('memory leak', { prompt: true }, opts);
    assert.ok(opts.saved.length > 0, 'state should be saved');
    const entry = opts.saved[0]!.auditLog[0]!;
    assert.match(entry, /debug:.*prompt generated/);
    assert.ok(entry.includes('memory leak'), 'audit entry should reference the issue');
  });
});

describe('debug command: LLM mode', () => {
  it('calls _callLLM with a prompt containing the issue string', async () => {
    const calls: string[] = [];
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async (prompt: string) => { calls.push(prompt); return 'analysis'; },
    });
    await debug('race condition', {}, opts);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0]!.includes('race condition'), 'LLM prompt should reference the issue');
  });

  it('audit log entry written after LLM response', async () => {
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => 'analysis result that is 26 chars',
    });
    await debug('timeout error', {}, opts);
    const entry = opts.saved[0]!.auditLog[0]!;
    assert.match(entry, /debug:.*LLM analysis/);
    assert.ok(entry.includes('timeout error'));
  });

  it('LLM unavailable → falls back to skill content without crash', async () => {
    const opts = makeBaseOpts({ _isLLMAvailable: async () => false });
    await assert.doesNotReject(async () => {
      await debug('some issue', {}, opts);
    });
    // audit entry for framework displayed
    const entry = opts.saved[0]!.auditLog[0]!;
    assert.match(entry, /debug:.*framework displayed/);
  });

  it('LLM throws → swallowed, falls back to skill display without crash', async () => {
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => true,
      _callLLM: async () => { throw new Error('API timeout'); },
    });
    await assert.doesNotReject(async () => {
      await debug('crash on load', {}, opts);
    });
    // Should still write a fallback audit entry
    assert.ok(opts.saved.length > 0, 'state should still be saved after LLM error');
  });

  it('no skill available → uses generic fallback text without crash', async () => {
    const opts = makeBaseOpts({
      _isLLMAvailable: async () => false,
      _resolveSkill: async () => null,
    });
    await assert.doesNotReject(async () => {
      await debug('segfault', {}, opts);
    });
  });
});
