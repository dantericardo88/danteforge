import { describe, it } from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

describe('Replay Tests', () => {
  it('should replay evidence bundles', async () => {
    const { RunLedger } = await import('../src/core/run-ledger.js');

    // Create a test ledger
    const ledger = new RunLedger('test', ['replay'], process.cwd());
    await ledger.initialize();

    ledger.logFileRead('test-file.txt');
    ledger.logCommand('echo', ['hello'], 0, 100);

    const runId = await ledger.finalize({}, {}, { status: 'success', completionOracle: true });

    // Load and verify replay
    const { loadRunBundle } = await import('../src/core/run-ledger.js');
    const bundle = await loadRunBundle(runId, process.cwd());

    assert(bundle, 'Should load evidence bundle');
    assert(bundle.reads.length === 1, 'Should replay file reads');
    assert(bundle.commands.length === 1, 'Should replay commands');
  });

  it('should validate evidence integrity', async () => {
    const { RunLedger } = await import('../src/core/run-ledger.js');

    const ledger = new RunLedger('test', ['integrity'], process.cwd());
    await ledger.initialize();

    ledger.logFileRead('test.txt');
    ledger.logTest('integrity-test', 'pass', 50);

    const runId = await ledger.finalize({}, {}, { status: 'success', completionOracle: true });

    const { loadRunBundle } = await import('../src/core/run-ledger.js');
    const bundle = await loadRunBundle(runId, process.cwd());

    assert(bundle.verdict.evidenceHash, 'Should have evidence hash');
    assert(bundle.verdict.evidenceHash.length === 64, 'Should have valid hash');
  });
});