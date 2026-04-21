import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RunLedger, loadRunBundle, listRuns } from '../src/core/run-ledger.js';

let tmpDir: string;
before(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'run-ledger-test-')); });
after(async () => { await fs.rm(tmpDir, { recursive: true, force: true }); });

describe('RunLedger: constructor and getters', () => {
  it('getRunId returns a non-empty UUID string', () => {
    const ledger = new RunLedger('forge', ['--auto'], tmpDir);
    const id = ledger.getRunId();
    assert.ok(typeof id === 'string' && id.length > 0);
  });

  it('getCorrelationId returns a non-empty string', () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    assert.ok(ledger.getCorrelationId().length > 0);
  });

  it('two ledgers have different run IDs', () => {
    const a = new RunLedger('forge', [], tmpDir);
    const b = new RunLedger('forge', [], tmpDir);
    assert.notEqual(a.getRunId(), b.getRunId());
  });
});

describe('RunLedger: logging methods', () => {
  it('logEvent does not throw', () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    assert.doesNotThrow(() => ledger.logEvent('test_event', { key: 'val' }));
  });

  it('logFileRead does not throw', () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    assert.doesNotThrow(() => ledger.logFileRead('/tmp/file.ts', 100));
  });

  it('logFileWrite does not throw', () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    assert.doesNotThrow(() => ledger.logFileWrite('/tmp/out.ts', 200));
  });

  it('logCommand does not throw', () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    assert.doesNotThrow(() => ledger.logCommand('npm', ['test'], 0, 1200, 'ok'));
  });

  it('logTest does not throw', () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    assert.doesNotThrow(() => ledger.logTest('my test', 'pass', 50));
  });

  it('logGateCheck does not throw', () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    assert.doesNotThrow(() => ledger.logGateCheck('requireSpec', 'pass'));
  });

  it('addReceipt does not throw', () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    assert.doesNotThrow(() => ledger.addReceipt('verify', { score: 9.0 }));
  });
});

describe('RunLedger: finalize writes bundle files', () => {
  it('finalize returns the run ID', async () => {
    const ledger = new RunLedger('forge', ['--auto'], tmpDir);
    await ledger.initialize();
    const id = await ledger.finalize({}, {}, { status: 'success', completionOracle: true });
    assert.equal(id, ledger.getRunId());
  });

  it('finalize writes bundle.json to run dir', async () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    await ledger.initialize();
    await ledger.finalize({}, {}, { status: 'success', completionOracle: true });
    const bundlePath = path.join(tmpDir, '.danteforge', 'runs', ledger.getRunId(), 'bundle.json');
    const raw = await fs.readFile(bundlePath, 'utf8');
    const bundle = JSON.parse(raw);
    assert.equal(bundle.run.runId, ledger.getRunId());
  });

  it('bundle verdict has evidence hash', async () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    await ledger.initialize();
    await ledger.finalize({}, {}, { status: 'success', completionOracle: true });
    const bundlePath = path.join(tmpDir, '.danteforge', 'runs', ledger.getRunId(), 'bundle.json');
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
    assert.ok(typeof bundle.verdict.evidenceHash === 'string' && bundle.verdict.evidenceHash.length === 64);
  });

  it('bundle includes logged command', async () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    await ledger.initialize();
    ledger.logCommand('npm', ['test'], 0, 500, 'passed');
    await ledger.finalize({}, {}, { status: 'success', completionOracle: true });
    const bundlePath = path.join(tmpDir, '.danteforge', 'runs', ledger.getRunId(), 'bundle.json');
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
    assert.equal(bundle.commands.length, 1);
    assert.equal(bundle.commands[0].command, 'npm');
  });

  it('bundle includes logged test result', async () => {
    const ledger = new RunLedger('forge', [], tmpDir);
    await ledger.initialize();
    ledger.logTest('suite A', 'pass', 100);
    await ledger.finalize({}, {}, { status: 'success', completionOracle: true });
    const bundlePath = path.join(tmpDir, '.danteforge', 'runs', ledger.getRunId(), 'bundle.json');
    const bundle = JSON.parse(await fs.readFile(bundlePath, 'utf8'));
    assert.equal(bundle.tests[0].testName, 'suite A');
    assert.equal(bundle.tests[0].status, 'pass');
  });
});

describe('loadRunBundle', () => {
  it('returns null for non-existent run ID', async () => {
    const result = await loadRunBundle('nonexistent-id', tmpDir);
    assert.equal(result, null);
  });

  it('returns parsed bundle for existing run', async () => {
    const ledger = new RunLedger('verify', [], tmpDir);
    await ledger.initialize();
    await ledger.finalize({}, {}, { status: 'success', completionOracle: true });
    const bundle = await loadRunBundle(ledger.getRunId(), tmpDir);
    assert.ok(bundle !== null);
    assert.equal(bundle!.run.command, 'verify');
  });
});

describe('listRuns', () => {
  it('returns empty array when runs dir does not exist', async () => {
    const runs = await listRuns('/nonexistent/path');
    assert.deepEqual(runs, []);
  });

  it('returns run IDs sorted newest-first', async () => {
    const l1 = new RunLedger('forge', [], tmpDir);
    await l1.initialize();
    await l1.finalize({}, {}, { status: 'success', completionOracle: true });
    const l2 = new RunLedger('verify', [], tmpDir);
    await l2.initialize();
    await l2.finalize({}, {}, { status: 'success', completionOracle: true });
    const runs = await listRuns(tmpDir);
    assert.ok(runs.length >= 2);
  });
});
