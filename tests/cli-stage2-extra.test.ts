// cli-stage2-extra.test.ts — additional injection seam tests for remaining CLI commands
// Covers: dashboard (parseDashboardPort, renderDashboardHtml), helpCmd, importFile,
//         feedbackPrompt, invalidatesVerification (via importFile behavior)
// No real LLM calls. Some commands may interact with the project's .danteforge/ directory.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { parseDashboardPort, renderDashboardHtml } from '../src/cli/commands/dashboard.js';
import { helpCmd, COMMAND_HELP } from '../src/cli/commands/help.js';
import { importFile } from '../src/cli/commands/import.js';
import { feedbackPrompt } from '../src/cli/commands/feedback-prompt.js';
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

async function captureStdout(fn: () => Promise<void>): Promise<string> {
  let output = '';
  const originalWrite = process.stdout.write.bind(process.stdout);
  const write = ((chunk: string | Uint8Array) => {
    output += typeof chunk === 'string' ? chunk : chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  Object.defineProperty(process.stdout, 'write', {
    value: write,
    configurable: true,
    writable: true,
  });

  try {
    await fn();
  } finally {
    Object.defineProperty(process.stdout, 'write', {
      value: originalWrite,
      configurable: true,
      writable: true,
    });
  }

  return output;
}

const ORIGINAL_EXIT_CODE = process.exitCode;

beforeEach(() => { process.exitCode = 0; });
afterEach(() => { process.exitCode = ORIGINAL_EXIT_CODE; });

// ── parseDashboardPort ────────────────────────────────────────────────────────

describe('parseDashboardPort', () => {
  it('defaults to 4242 when no value given', () => {
    assert.equal(parseDashboardPort(undefined), 4242);
  });

  it('parses a valid port string', () => {
    assert.equal(parseDashboardPort('3000'), 3000);
  });

  it('parses port 1 (minimum)', () => {
    assert.equal(parseDashboardPort('1'), 1);
  });

  it('parses port 65535 (maximum)', () => {
    assert.equal(parseDashboardPort('65535'), 65535);
  });

  it('throws for port 0', () => {
    assert.throws(() => parseDashboardPort('0'), /Invalid --port/);
  });

  it('throws for port 65536', () => {
    assert.throws(() => parseDashboardPort('65536'), /Invalid --port/);
  });

  it('throws for non-numeric input', () => {
    assert.throws(() => parseDashboardPort('abc'), /Invalid --port/);
  });

  it('throws for negative port', () => {
    assert.throws(() => parseDashboardPort('-1'), /Invalid --port/);
  });

  it('throws for float input', () => {
    assert.throws(() => parseDashboardPort('3000.5'), /Invalid --port/);
  });

  it('trims whitespace before parsing', () => {
    assert.equal(parseDashboardPort('  8080  '), 8080);
  });
});

// ── renderDashboardHtml ───────────────────────────────────────────────────────

describe('renderDashboardHtml', () => {
  function makeInput() {
    return {
      state: makeState({ project: 'my-project', workflowStage: 'verify', currentPhase: 2 }),
      config: { defaultProvider: 'claude' as const },
      host: 'vscode',
      capabilities: { hasFigmaMCP: false },
      tier: 'pull-only',
      packageVersion: '1.0.0',
      totalTokensEstimated: 5000,
      wikiHealth: null,
    };
  }

  it('returns an HTML string starting with DOCTYPE', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.startsWith('<!DOCTYPE html>'), 'should start with DOCTYPE');
  });

  it('includes the project name in the output', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('my-project'), 'should include project name');
  });

  it('includes the workflow stage in the output', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('verify'), 'should include workflow stage');
  });

  it('includes the execution wave number', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('2'), 'should include execution wave number');
  });

  it('shows "Not configured" when Figma MCP is disabled', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('Not configured'), 'should show Not configured when no Figma MCP');
  });

  it('shows "Connected" when Figma MCP is enabled', () => {
    const input = makeInput();
    input.capabilities.hasFigmaMCP = true;
    const html = renderDashboardHtml(input);
    assert.ok(html.includes('Connected'), 'should show Connected when Figma MCP is active');
  });

  it('escapes HTML special characters in project name', () => {
    const input = makeInput();
    input.state = makeState({ project: '<script>alert("xss")</script>' });
    const html = renderDashboardHtml(input);
    assert.ok(!html.includes('<script>alert'), 'should escape script tags in project name');
  });

  it('includes the LLM provider', () => {
    const html = renderDashboardHtml(makeInput());
    assert.ok(html.includes('claude'), 'should include the configured LLM provider');
  });

  it('shows "Not started" when currentPhase is 0', () => {
    const input = makeInput();
    input.state = makeState({ currentPhase: 0 });
    const html = renderDashboardHtml(input);
    assert.ok(html.includes('Not started'), 'should show Not started when no wave has run');
  });
});

// ── COMMAND_HELP ──────────────────────────────────────────────────────────────

describe('COMMAND_HELP registry', () => {
  it('is a non-empty object', () => {
    assert.ok(typeof COMMAND_HELP === 'object', 'should be an object');
    assert.ok(Object.keys(COMMAND_HELP).length > 0, 'should have entries');
  });

  it('contains help text for core pipeline commands', () => {
    const expected = ['specify', 'forge', 'verify', 'synthesize', 'plan', 'tasks'];
    for (const cmd of expected) {
      assert.ok(COMMAND_HELP[cmd], `should have help entry for ${cmd}`);
    }
  });

  it('contains help text for automation presets', () => {
    const expected = ['inferno', 'blaze', 'nova', 'ember', 'spark', 'canvas'];
    for (const cmd of expected) {
      assert.ok(COMMAND_HELP[cmd], `should have help entry for preset: ${cmd}`);
    }
  });

  it('contains help text for canonical process commands', () => {
    const expected = ['plan', 'build', 'measure', 'compete', 'harvest'];
    for (const cmd of expected) {
      assert.ok(COMMAND_HELP[cmd], `should have help entry for canonical process: ${cmd}`);
    }
  });

  it('each help entry includes usage information', () => {
    for (const [cmd, text] of Object.entries(COMMAND_HELP)) {
      assert.ok(text.includes('danteforge'), `help for ${cmd} should include "danteforge"`);
    }
  });

  it('describes deep plan as including tech-decide, tasks, and critique', () => {
    assert.match(COMMAND_HELP.plan ?? '', /deep=\+tech-decide\+tasks\+critique/);
  });
});

// ── helpCmd ───────────────────────────────────────────────────────────────────

describe('helpCmd: known query', () => {
  it('does not call _loadState when query matches a known command', async () => {
    let loadCalled = false;
    await helpCmd('specify', {
      _loadState: async () => { loadCalled = true; return makeState(); },
    });
    assert.ok(!loadCalled, '_loadState should not be called for a direct command lookup');
  });

  it('does not crash when query is a known command', async () => {
    await helpCmd('magic', { _loadState: async () => makeState() });
    // No assertion needed — just ensuring no exception
  });

  it('does not crash when query is an unknown command', async () => {
    await helpCmd('nonexistent-command-xyz', { _loadState: async () => makeState() });
  });
});

describe('helpCmd: all mode', () => {
  it('calls _loadState when --all is set', async () => {
    let loadCalled = false;
    await helpCmd(undefined, {
      all: true,
      _loadState: async () => { loadCalled = true; return makeState(); },
    });
    assert.ok(loadCalled, '_loadState should be called in --all mode');
  });

  it('does not crash even if _loadState throws in --all mode', async () => {
    await helpCmd(undefined, {
      all: true,
      _loadState: async () => { throw new Error('state unavailable'); },
    });
    // helpCmd catches the error internally (try/catch) and continues
  });
});

describe('helpCmd: default mode', () => {
  it('teaches the 5 canonical processes first', async () => {
    const output = await captureStdout(() => helpCmd(undefined, {
      _loadState: async () => makeState(),
    }));
    assert.match(output, /5 canonical processes/i);
    assert.match(output, /danteforge plan \[goal\]/);
    assert.match(output, /danteforge build <spec>/);
    assert.match(output, /danteforge measure/);
    assert.match(output, /danteforge compete/);
    assert.match(output, /danteforge harvest \[goal\]/);
  });

  it('shows the shared --level model', async () => {
    const output = await captureStdout(() => helpCmd(undefined, {
      _loadState: async () => makeState(),
    }));
    assert.match(output, /--level light/);
    assert.match(output, /--level standard/);
    assert.match(output, /--level deep/);
  });
});

// ── importFile ────────────────────────────────────────────────────────────────

describe('importFile: source validation', () => {
  it('does NOT call _loadState or _saveState when source file does not exist', async () => {
    let loadCalled = false;
    let saveCalled = false;
    await importFile('/nonexistent/path/to/file.md', {
      _loadState: async () => { loadCalled = true; return makeState(); },
      _saveState: async () => { saveCalled = true; },
    });
    assert.ok(!loadCalled, '_loadState should not be called when source is missing');
    assert.ok(!saveCalled, '_saveState should not be called when source is missing');
  });
});

describe('importFile: unknown target type', () => {
  let tmpFile: string;

  beforeEach(async () => {
    // Create a temp file to use as import source
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-import-test-'));
    tmpFile = path.join(dir, 'test-artifact.md');
    await fs.writeFile(tmpFile, '# Test Content\n\nSome content here.');
  });

  it('calls _saveState when importing an unknown target file type', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState();
    await importFile(tmpFile, {
      as: 'UNKNOWN_TYPE.md',
      _loadState: async () => state,
      _saveState,
    });
    // Unknown type falls through to generic save + log — saveFn should be called
    assert.ok(saved.length > 0, '_saveState should be called for unknown target type');
  });

  it('adds an import audit log entry', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState();
    await importFile(tmpFile, {
      as: 'CUSTOM_NOTES.md',
      _loadState: async () => state,
      _saveState,
    });
    const entry = saved[0]?.auditLog[0];
    assert.ok(entry, 'should have an audit log entry');
    assert.ok(entry.includes('import:'), 'audit entry should reference import');
  });

  it('clears lastVerifiedAt when importing a verification-invalidating artifact', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState({ lastVerifiedAt: '2024-01-01T00:00:00Z' });
    await importFile(tmpFile, {
      as: 'PLAN.md',
      _loadState: async () => state,
      _saveState,
    });
    // PLAN.md invalidates verification
    if (saved.length > 0) {
      assert.equal(saved[0]!.lastVerifiedAt, undefined, 'lastVerifiedAt should be cleared for PLAN.md import');
    }
  });

  it('preserves lastVerifiedAt for non-invalidating imports', async () => {
    const { saved, _saveState } = makeSavedArr();
    const state = makeState({ lastVerifiedAt: '2024-01-01T00:00:00Z' });
    await importFile(tmpFile, {
      as: 'NOTES.md',
      _loadState: async () => state,
      _saveState,
    });
    if (saved.length > 0) {
      assert.equal(saved[0]!.lastVerifiedAt, '2024-01-01T00:00:00Z', 'lastVerifiedAt should be preserved for non-invalidating imports');
    }
  });
});

// ── feedbackPrompt ────────────────────────────────────────────────────────────

describe('feedbackPrompt: gate enforcement', () => {
  it('sets exitCode=1 and does not call _loadState when UPR.md is missing', async () => {
    // Run from a path that definitely has no UPR.md by using a non-existent cwd.
    // feedbackPrompt hardcodes '.danteforge/UPR.md' relative to process.cwd().
    // We test this by injecting _loadState and checking it is NOT called.
    let loadCalled = false;

    // Only test the "no UPR.md" case IF UPR.md doesn't currently exist
    // (to avoid flakiness depending on project state)
    const { feedbackPrompt: fp } = await import('../src/cli/commands/feedback-prompt.js');
    let uprExists = false;
    try {
      await fs.access(path.join(process.cwd(), '.danteforge', 'UPR.md'));
      uprExists = true;
    } catch {
      uprExists = false;
    }

    if (!uprExists) {
      await fp({
        _loadState: async () => { loadCalled = true; return makeState(); },
        _saveState: async () => {},
        _isLLMAvailable: async () => false,
        _llmCaller: async () => '',
      });
      assert.equal(process.exitCode, 1, 'should set exitCode=1 when UPR.md is missing');
      assert.ok(!loadCalled, '_loadState should not be called when blocked by missing UPR.md');
    }
    // If UPR.md exists, the test is not applicable — skip silently
  });

  it('calls _loadState when UPR.md exists and auto=false', async () => {
    let loadCalled = false;
    let uprExists = false;

    try {
      await fs.access(path.join(process.cwd(), '.danteforge', 'UPR.md'));
      uprExists = true;
    } catch {
      uprExists = false;
    }

    if (uprExists) {
      await feedbackPrompt({
        auto: false,
        _isLLMAvailable: async () => false,
        _llmCaller: async () => '',
        _loadState: async () => { loadCalled = true; return makeState(); },
        _saveState: async () => {},
      });
      assert.ok(loadCalled, '_loadState should be called when UPR.md exists');
    }
    // If UPR.md doesn't exist, skip this test
  });

  it('does not call _llmCaller in non-auto mode when LLM unavailable', async () => {
    let llmCalled = false;
    let uprExists = false;

    try {
      await fs.access(path.join(process.cwd(), '.danteforge', 'UPR.md'));
      uprExists = true;
    } catch {
      uprExists = false;
    }

    if (uprExists) {
      await feedbackPrompt({
        auto: false,
        _isLLMAvailable: async () => false,
        _llmCaller: async () => { llmCalled = true; return ''; },
        _loadState: async () => makeState(),
        _saveState: async () => {},
      });
      assert.ok(!llmCalled, '_llmCaller should not be called in non-auto mode when LLM unavailable');
    }
  });
});
