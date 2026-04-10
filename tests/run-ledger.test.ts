import { describe, it } from 'node:test';
import assert from 'node:assert';
import { RunLedger } from '../src/core/run-ledger.js';
import { validateCompletion } from '../src/core/completion-oracle.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

describe('RunLedger', () => {
  it('should initialize and log events', async () => {
    const cwd = tmpdir();
    const ledger = new RunLedger('test-command', ['arg1'], cwd);
    await ledger.initialize();

    ledger.logEvent('test_event', { data: 'test' });
    ledger.logFileRead('/path/to/file');
    ledger.logFileWrite('/path/to/file');
    ledger.logCommand('ls', [], 0, 100);

    const runId = await ledger.finalize({}, {}, { status: 'success', completionOracle: true });

    assert(runId.length > 0);

    const bundlePath = path.join(cwd, '.danteforge', 'runs', runId, 'bundle.json');
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));

    assert.strictEqual(bundle.run.command, 'test-command');
    assert.strictEqual(bundle.events.length, 2); // run_start + test_event
    assert.strictEqual(bundle.reads.length, 1);
    assert.strictEqual(bundle.writes.length, 1);
    assert.strictEqual(bundle.commands.length, 1);
  });
});

describe('CompletionOracle', () => {
  it('should validate complete execution', () => {
    const bundle = {
      reads: [{ path: '/file1' }],
      writes: [{ path: '/file2' }],
      commands: [{ exitCode: 0 }],
      tests: [{ status: 'pass' }],
      gates: [{ status: 'pass' }],
      plan: {},
      verdict: { status: 'success' }
    } as any;

    const state = {} as any;

    const result = validateCompletion(bundle, state);

    assert.strictEqual(result.verdict, 'complete');
    assert.strictEqual(result.isComplete, true);
    assert(result.score >= 80);
  });

  it('should detect misleading completion', () => {
    const bundle = {
      reads: [],
      writes: [{ path: '/file' }],
      commands: [],
      tests: [],
      gates: [],
      plan: {},
      verdict: { status: 'success' }
    } as any;

    const state = {} as any;

    const result = validateCompletion(bundle, state);

    assert.strictEqual(result.verdict, 'misleadingly_complete');
    assert.strictEqual(result.isComplete, false);
  });
});