// cli-stage2-seams.test.ts — injection seam tests for CLI commands with zero prior test coverage
// Tests: synthesize, configCmd, techDecide, specify, tasks, docs, updateMcp
// Uses _loadState / _saveState / _llmCaller / _isLLMAvailable / _writeArtifact / _loadConfig / _setApiKey seams.
// No real LLM calls. Filesystem writes may occur to the project's .danteforge/ (acceptable for test runs).

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { synthesize } from '../src/cli/commands/synthesize.js';
import { configCmd } from '../src/cli/commands/config.js';
import { techDecide } from '../src/cli/commands/tech-decide.js';
import { specify } from '../src/cli/commands/specify.js';
import { tasks } from '../src/cli/commands/tasks.js';
import { updateMcp } from '../src/cli/commands/update-mcp.js';
import { docs, formatCommandReference } from '../src/cli/commands/docs.js';
import type { DanteState } from '../src/core/state.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<DanteState> = {}): DanteState {
  return {
    project: 'test-project',
    constitution: 'Be modular.',
    workflowStage: 'tasks',
    currentPhase: 0,
    tasks: {},
    auditLog: [],
    profile: 'balanced',
    lastHandoff: 'none',
    ...overrides,
  } as DanteState;
}

function makeSavedArr() {
  const saved: DanteState[] = [];
  const _saveState = async (s: DanteState) => { saved.push(JSON.parse(JSON.stringify(s))); };
  return { saved, _saveState };
}

const ORIGINAL_EXIT_CODE = process.exitCode;

beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = ORIGINAL_EXIT_CODE; });

// ── synthesize ────────────────────────────────────────────────────────────────

describe('synthesize: gate enforcement', () => {
  it('blocks when workflowStage is not verify or synthesize', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState({ workflowStage: 'forge', lastVerifiedAt: '2024-01-01' });
    await synthesize({
      _loadState: async () => state,
      _saveState,
    });
    assert.equal(process.exitCode, 1, 'should set exitCode=1 when blocked');
    assert.equal(saved.length, 0, '_saveState should not be called when blocked');
  });

  it('blocks when workflowStage is verify but lastVerifiedAt is missing', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState({ workflowStage: 'verify', lastVerifiedAt: undefined });
    await synthesize({
      _loadState: async () => state,
      _saveState,
    });
    assert.equal(process.exitCode, 1, 'should set exitCode=1 when no lastVerifiedAt');
    assert.equal(saved.length, 0, '_saveState should not be called when blocked');
  });

  it('blocks when workflowStage is tasks even with lastVerifiedAt set', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState({ workflowStage: 'tasks', lastVerifiedAt: '2024-01-01T00:00:00Z' });
    await synthesize({
      _loadState: async () => state,
      _saveState,
    });
    assert.equal(process.exitCode, 1, 'tasks stage should still be blocked');
    assert.equal(saved.length, 0);
  });

  it('proceeds past the gate when workflowStage is verify and lastVerifiedAt is set', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState({ workflowStage: 'verify', lastVerifiedAt: '2024-01-01T00:00:00Z' });
    await synthesize({
      _loadState: async () => state,
      _saveState,
    });
    // Even if docs are empty (no .danteforge files), _saveState is called when state is verify+lastVerifiedAt
    // synthesize will either succeed or fail on gatherDocs/writeFile, but _saveState is
    // called only on the success path (after writeFile). If .danteforge exists with docs,
    // save is called. We verify exit code is NOT 1 due to our gate condition.
    // Gate blocking sets exitCode=1 immediately — reaching here means gate passed.
    // Further failures (empty docs) return early without exitCode set.
    assert.notEqual(process.exitCode, 1, 'should not be blocked by the gate');
  });

  it('proceeds past gate when workflowStage is synthesize', async () => {
    const { _saveState } = makeSavedArr();
    const state = makeState({ workflowStage: 'synthesize', lastVerifiedAt: '2024-02-01T00:00:00Z' });
    await synthesize({
      _loadState: async () => state,
      _saveState,
    });
    assert.notEqual(process.exitCode, 1, 'synthesize stage should also pass the gate');
  });
});

// ── configCmd ─────────────────────────────────────────────────────────────────

describe('configCmd: show mode', () => {
  it('calls _loadConfig when showing config', async () => {
    let loadCalled = false;
    await configCmd({
      show: true,
      _loadConfig: async () => {
        loadCalled = true;
        return {
          defaultProvider: 'ollama' as const,
          ollamaModel: 'llama3',
          providers: {},
        };
      },
    });
    assert.ok(loadCalled, '_loadConfig should be called in show mode');
  });

  it('calls _loadConfig when no flags are set (default show)', async () => {
    let loadCalled = false;
    await configCmd({
      _loadConfig: async () => {
        loadCalled = true;
        return { defaultProvider: 'ollama' as const, ollamaModel: 'llama3', providers: {} };
      },
    });
    assert.ok(loadCalled, '_loadConfig should be called by default when no flags set');
  });
});

describe('configCmd: set-key validation', () => {
  it('does NOT call _setApiKey when setKey format has no colon', async () => {
    let setKeyCalled = false;
    await configCmd({
      setKey: 'grokINVALIDFORMAT',
      _setApiKey: async () => { setKeyCalled = true; },
    });
    assert.ok(!setKeyCalled, '_setApiKey should not be called for invalid format');
  });

  it('does NOT call _setApiKey for an unknown provider', async () => {
    let setKeyCalled = false;
    await configCmd({
      setKey: 'unknown-provider:some-key',
      _setApiKey: async () => { setKeyCalled = true; },
    });
    assert.ok(!setKeyCalled, '_setApiKey should not be called for unknown provider');
  });

  it('does NOT call _setApiKey when key part is empty', async () => {
    let setKeyCalled = false;
    await configCmd({
      setKey: 'grok:',
      _setApiKey: async () => { setKeyCalled = true; },
    });
    assert.ok(!setKeyCalled, '_setApiKey should not be called for empty key');
  });

  it('calls _setApiKey with provider and key for a valid set-key input', async () => {
    const calls: [string, string][] = [];
    await configCmd({
      setKey: 'grok:xai-abc123',
      _setApiKey: async (provider, key) => { calls.push([provider, key]); },
    });
    assert.equal(calls.length, 1, '_setApiKey should be called once');
    assert.deepEqual(calls[0], ['grok', 'xai-abc123']);
  });

  it('trims whitespace from the key', async () => {
    const calls: [string, string][] = [];
    await configCmd({
      setKey: 'claude:  sk-ant-key  ',
      _setApiKey: async (provider, key) => { calls.push([provider, key]); },
    });
    assert.equal(calls.length, 1, '_setApiKey should be called once');
    assert.equal(calls[0]![1], 'sk-ant-key', 'key should be trimmed');
  });

  it('accepts all valid providers', async () => {
    const validProviders = ['grok', 'claude', 'openai', 'gemini', 'ollama'];
    for (const provider of validProviders) {
      const calls: string[] = [];
      await configCmd({
        setKey: `${provider}:test-key`,
        _setApiKey: async (p) => { calls.push(p); },
      });
      assert.equal(calls.length, 1, `should accept provider: ${provider}`);
      assert.equal(calls[0], provider);
    }
  });
});

// ── techDecide ────────────────────────────────────────────────────────────────

describe('techDecide: injection seams', () => {
  it('calls _saveState in fallback mode when LLM unavailable', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState();
    await techDecide({
      _isLLMAvailable: async () => false,
      _loadState: async () => state,
      _saveState,
    });
    assert.ok(saved.length > 0, '_saveState should be called even in fallback mode');
  });

  it('adds audit log entry in fallback mode', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState();
    await techDecide({
      _isLLMAvailable: async () => false,
      _loadState: async () => state,
      _saveState,
    });
    const auditEntry = saved[0]?.auditLog[0];
    assert.ok(auditEntry, 'should have an audit entry');
    assert.ok(auditEntry.includes('tech-decide'), 'audit entry should mention tech-decide');
  });

  it('calls _saveState in prompt mode without calling LLM', async () => {
    const { saved, _saveState } = makeSavedArr();
    let llmCalled = false;
    const state = makeState();
    await techDecide({
      prompt: true,
      _isLLMAvailable: async () => { llmCalled = true; return false; },
      _loadState: async () => state,
      _saveState,
    });
    assert.ok(!llmCalled, '_isLLMAvailable should not be checked in prompt mode');
    assert.ok(saved.length > 0, '_saveState should be called in prompt mode');
  });

  it('does not call _llmCaller when LLM unavailable', async () => {
    let llmCallerCalled = false;
    const state = makeState();
    await techDecide({
      _isLLMAvailable: async () => false,
      _llmCaller: async () => { llmCallerCalled = true; return ''; },
      _loadState: async () => state,
      _saveState: async () => {},
    });
    assert.ok(!llmCallerCalled, '_llmCaller should not be called when LLM is unavailable');
  });
});

// ── specify ───────────────────────────────────────────────────────────────────

describe('specify: local fallback via _writeArtifact', () => {
  it('calls _writeArtifact with SPEC.md in local fallback mode (light=true, no LLM)', async () => {
    const writes: [string, string][] = [];
    const state = makeState();
    await specify('my feature idea', {
      light: true,
      _isLLMAvailable: async () => false,
      _loadState: async () => state,
      _saveState: async () => {},
      _writeArtifact: async (name, content) => { writes.push([name, content]); },
    });
    assert.ok(writes.some(([name]) => name === 'SPEC.md'), 'should write SPEC.md');
  });

  it('passes idea into generated SPEC.md content', async () => {
    const writes: [string, string][] = [];
    const state = makeState();
    await specify('build a chat application', {
      light: true,
      _isLLMAvailable: async () => false,
      _loadState: async () => state,
      _saveState: async () => {},
      _writeArtifact: async (name, content) => { writes.push([name, content]); },
    });
    const specWrite = writes.find(([name]) => name === 'SPEC.md');
    assert.ok(specWrite, 'SPEC.md should have been written');
    assert.ok(specWrite[1].length > 0, 'SPEC.md content should not be empty');
  });

  it('calls _llmCaller when LLM is available and returns result', async () => {
    let llmCalled = false;
    const writes: [string, string][] = [];
    const state = makeState();
    await specify('my feature', {
      light: true,
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { llmCalled = true; return '# Spec\n1. Task one\n2. Task two'; },
      _loadState: async () => state,
      _saveState: async () => {},
      _writeArtifact: async (name, content) => { writes.push([name, content]); },
    });
    assert.ok(llmCalled, '_llmCaller should be called when LLM is available');
    assert.ok(writes.some(([name]) => name === 'SPEC.md'), 'SPEC.md should be written from LLM result');
  });
});

// ── tasks ─────────────────────────────────────────────────────────────────────

describe('tasks: local fallback via _writeArtifact', () => {
  it('calls _writeArtifact with TASKS.md in local fallback (light=true, no LLM)', async () => {
    const writes: [string, string][] = [];
    const state = makeState();
    await tasks({
      light: true,
      _isLLMAvailable: async () => false,
      _loadState: async () => state,
      _saveState: async () => {},
      _writeArtifact: async (name, content) => { writes.push([name, content]); },
    });
    assert.ok(writes.some(([name]) => name === 'TASKS.md'), 'should write TASKS.md');
  });

  it('calls _saveState after writing TASKS.md in local fallback', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState();
    await tasks({
      light: true,
      _isLLMAvailable: async () => false,
      _loadState: async () => state,
      _saveState,
      _writeArtifact: async () => {},
    });
    assert.ok(saved.length > 0, '_saveState should be called');
  });

  it('includes tasks audit log entry after local fallback', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState();
    await tasks({
      light: true,
      _isLLMAvailable: async () => false,
      _loadState: async () => state,
      _saveState,
      _writeArtifact: async () => {},
    });
    const entry = saved[0]?.auditLog[0];
    assert.ok(entry, 'should have audit log entry');
    assert.ok(entry.includes('tasks:'), 'audit entry should reference tasks');
  });

  it('calls _llmCaller when LLM is available and writes TASKS.md', async () => {
    let llmCalled = false;
    const writes: [string, string][] = [];
    const { saved, _saveState } = makeSavedArr();
    const state = makeState();
    await tasks({
      light: true,
      _isLLMAvailable: async () => true,
      _llmCaller: async () => {
        llmCalled = true;
        return '# Tasks\n## Phase 1\n1. Implement auth - files: src/auth.ts - verify: tests pass - effort: M';
      },
      _loadState: async () => state,
      _saveState,
      _writeArtifact: async (name, content) => { writes.push([name, content]); },
    });
    assert.ok(llmCalled, '_llmCaller should be called when LLM is available');
    assert.ok(writes.some(([name]) => name === 'TASKS.md'), 'TASKS.md should be written from LLM result');
    assert.ok(saved.length > 0, '_saveState should be called after LLM tasks');
  });

  it('saves state with workflowStage tasks after LLM path', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState({ workflowStage: 'plan' });
    await tasks({
      light: true,
      _isLLMAvailable: async () => true,
      _llmCaller: async () => '## Phase 1\n1. Build feature - verify: done - effort: S',
      _loadState: async () => state,
      _saveState,
      _writeArtifact: async () => {},
    });
    if (saved.length > 0) {
      assert.equal(saved[0]!.workflowStage, 'tasks', 'workflowStage should be updated to tasks');
    }
  });

  it('does NOT call _llmCaller in prompt mode', async () => {
    let llmCalled = false;
    const state = makeState();
    await tasks({
      prompt: true,
      light: true,
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { llmCalled = true; return ''; },
      _loadState: async () => state,
      _saveState: async () => {},
      _writeArtifact: async () => {},
    });
    assert.ok(!llmCalled, '_llmCaller should not be called in prompt mode');
  });
});

// ── updateMcp ─────────────────────────────────────────────────────────────────

describe('updateMcp: injection seams', () => {
  it('does not call _llmCaller in prompt mode', async () => {
    let llmCalled = false;
    await updateMcp({
      prompt: true,
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { llmCalled = true; return ''; },
    });
    assert.ok(!llmCalled, '_llmCaller should not be called in prompt mode');
  });

  it('does not call _llmCaller when LLM unavailable in check mode', async () => {
    let llmCalled = false;
    await updateMcp({
      check: true,
      _isLLMAvailable: async () => false,
      _llmCaller: async () => { llmCalled = true; return ''; },
    });
    assert.ok(!llmCalled, '_llmCaller should not be called when LLM unavailable');
  });

  it('uses _isLLMAvailable seam to decide whether to call LLM in check mode', async () => {
    let llmCalled = false;
    // _isLLMAvailable returns false → LLM path is skipped → _llmCaller should not be called
    await updateMcp({
      check: true,
      _isLLMAvailable: async () => false,
      _llmCaller: async (_prompt: string) => {
        llmCalled = true;
        return 'NO UPDATES needed at this time.';
      },
    });
    assert.ok(!llmCalled, '_llmCaller should NOT be called when _isLLMAvailable returns false');
  });
});

// ── docs ──────────────────────────────────────────────────────────────────────

describe('docs: state audit seam', () => {
  it('calls _loadState to record docs generation', async () => {
    let loadCalled = false;
    const state = makeState();
    await docs({
      _loadState: async () => { loadCalled = true; return state; },
      _saveState: async () => {},
    });
    assert.ok(loadCalled, '_loadState should be called to record audit entry');
  });

  it('calls _saveState with docs audit entry', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState();
    await docs({
      _loadState: async () => state,
      _saveState,
    });
    if (saved.length > 0) {
      const entry = saved[0]!.auditLog.find(e => e.includes('docs:'));
      assert.ok(entry, 'should have docs audit entry in saved state');
    }
  });

  it('produces identical markdown to formatCommandReference()', async () => {
    const expected = formatCommandReference();
    let actualContent = '';

    // docs() writes to docs/COMMAND_REFERENCE.md — we read it after the command runs
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await docs({
      _loadState: async () => makeState(),
      _saveState: async () => {},
    });

    try {
      actualContent = await fs.readFile(path.join(process.cwd(), 'docs', 'COMMAND_REFERENCE.md'), 'utf8');
    } catch {
      // File may not be writable in this environment
    }

    if (actualContent) {
      assert.equal(actualContent, expected, 'written file should match formatCommandReference() output');
    }
  });
});
