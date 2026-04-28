import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  filterShellResult,
  getEconomizedArtifactForContext,
  scoreContextEconomy,
  scoreContextEconomySync,
  filterLedgerRecords,
} from '../src/core/context-economy/runtime.js';
import { loadAllLedgerRecords } from '../src/core/context-economy/economy-ledger.js';
import type { LedgerRecord } from '../src/core/context-economy/types.js';

describe('Context Economy runtime facade', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-runtime-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('filters stdout and stderr independently and writes ledger evidence', async () => {
    const result = await filterShellResult({
      command: 'jest --runInBand',
      cwd,
      organ: 'forge',
      stdout: [
        'PASS tests/alpha.test.ts',
        'Test Suites: 1 passed, 1 total',
        'Tests:       1 passed, 1 total',
        'Time:        1.1 s',
        'Ran all test suites.',
      ].join('\n'),
      stderr: 'Error: database unavailable\n    at Object.<anonymous> (src/db.ts:10:1)',
    });

    assert.ok(!result.stdout.includes('PASS tests/alpha.test.ts'));
    assert.equal(result.stderr, 'Error: database unavailable\n    at Object.<anonymous> (src/db.ts:10:1)');
    assert.ok(result.statuses.includes('sacred-bypass'));

    const records = await loadAllLedgerRecords(cwd);
    assert.equal(records.length, 2);
    assert.ok(records.some((record) => record.status === 'filtered' || record.status === 'low-yield'));
    assert.ok(records.some((record) => record.status === 'sacred-bypass'));
  });

  it('fails closed when filtering throws', async () => {
    const result = await filterShellResult({
      command: 'npm test',
      cwd,
      stdout: 'raw output',
      stderr: '',
      writeLedger: false,
      _filterOutput: async () => { throw new Error('adapter exploded'); },
    });

    assert.equal(result.stdout, 'raw output');
    assert.equal(result.stderr, '');
    assert.deepEqual(result.statuses, ['filter-failed']);
  });

  it('returns compressed artifact context without mutating the canonical raw artifact', async () => {
    const raw = Array.from({ length: 600 }, (_, i) => `passing receipt line ${i}`).join('\n');
    const receiptPath = path.join(cwd, '.danteforge', 'receipts', 'verify.log');
    await fs.mkdir(path.dirname(receiptPath), { recursive: true });
    await fs.writeFile(receiptPath, raw, 'utf8');

    const context = await getEconomizedArtifactForContext({
      path: receiptPath,
      type: 'verify-output',
      cwd,
    });

    const onDisk = await fs.readFile(receiptPath, 'utf8');
    const expectedHash = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 16);

    assert.equal(onDisk, raw);
    assert.equal(context.rawHash, expectedHash);
    assert.ok(context.content.length < raw.length);
    assert.ok(context.savingsPercent > 0);
  });

  it('scores low without live ledger records and rises with telemetry', async () => {
    await writeContextEconomyFiles(cwd);

    const noTelemetry = scoreContextEconomySync(cwd);
    assert.ok(noTelemetry.score < 70, `file presence alone scored too high: ${noTelemetry.score}`);
    assert.equal(noTelemetry.recordsInWindow, 0);

    await writeLedger(cwd, [
      record({ timestamp: '2026-04-26T10:00:00.000Z', status: 'filtered', savedTokens: 900, inputTokens: 1200, outputTokens: 300 }),
      record({ timestamp: '2026-04-26T10:01:00.000Z', status: 'sacred-bypass', sacredSpanCount: 2 }),
    ]);

    const withTelemetry = await scoreContextEconomy(cwd);
    assert.ok(withTelemetry.score > noTelemetry.score);
    assert.equal(withTelemetry.recordsInWindow, 2);
    assert.ok(withTelemetry.subscores.telemetry > 0);
    assert.ok(withTelemetry.subscores.sacredSafety > 0);
  });

  it('filters ledger records by timestamp for --since semantics', () => {
    const records = [
      record({ timestamp: '2026-04-20T23:59:59.000Z' }),
      record({ timestamp: '2026-04-26T00:00:00.000Z' }),
    ];

    const filtered = filterLedgerRecords(records, { since: '2026-04-26' });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0]?.timestamp, '2026-04-26T00:00:00.000Z');
  });
});

async function writeContextEconomyFiles(cwd: string): Promise<void> {
  const base = path.join(cwd, 'src', 'core', 'context-economy');
  const filters = path.join(base, 'filters');
  await fs.mkdir(filters, { recursive: true });
  for (const moduleName of [
    'sacred-content',
    'economy-ledger',
    'pretool-adapter',
    'command-filter-registry',
    'artifact-compressor',
    'runtime',
  ]) {
    await fs.writeFile(path.join(base, `${moduleName}.ts`), '', 'utf8');
  }
  for (const filterName of ['git', 'npm', 'pnpm', 'eslint', 'jest', 'vitest', 'cargo', 'docker', 'find', 'pytest']) {
    await fs.writeFile(path.join(filters, `${filterName}.ts`), '', 'utf8');
  }
}

async function writeLedger(cwd: string, records: LedgerRecord[]): Promise<void> {
  const dir = path.join(cwd, '.danteforge', 'evidence', 'context-economy');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, '2026-04-26.jsonl'),
    records.map((entry) => JSON.stringify(entry)).join('\n') + '\n',
    'utf8',
  );
}

function record(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  const inputTokens = overrides.inputTokens ?? 100;
  const outputTokens = overrides.outputTokens ?? inputTokens;
  const savedTokens = overrides.savedTokens ?? Math.max(0, inputTokens - outputTokens);
  const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
  return {
    timestamp: '2026-04-26T00:00:00.000Z',
    organ: 'forge',
    command: 'npm test',
    filterId: 'npm',
    inputTokens,
    outputTokens,
    savedTokens,
    savingsPercent,
    sacredSpanCount: 0,
    status: 'filtered',
    ruleSource: 'built-in',
    ...overrides,
  };
}
