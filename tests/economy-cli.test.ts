import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runTsxCli } from './helpers/cli-runner.ts';
import type { LedgerRecord } from '../src/core/context-economy/types.js';

describe('economy CLI', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'economy-cli-'));
    await writeContextEconomyFiles(cwd);
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('--json includes score, subscores, and recordsInWindow filtered by timestamp', async () => {
    await writeLedger(cwd, [
      makeRecord({ timestamp: '2026-04-20T10:00:00.000Z' }),
      makeRecord({ timestamp: '2026-04-26T10:00:00.000Z' }),
    ]);

    const result = runTsxCli(['economy', '--json', '--since', '2026-04-26'], { cwd });
    assert.equal(result.status, 0, result.stderr);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.recordsInWindow, 1);
    assert.equal(parsed.summary.totalRecords, 1);
    assert.equal(typeof parsed.score, 'number');
    assert.equal(typeof parsed.subscores.telemetry, 'number');
  });

  it('--fail-below compares against Context Economy score instead of average savings percent', async () => {
    await writeLedger(cwd, [
      makeRecord({
        timestamp: '2026-04-26T10:00:00.000Z',
        inputTokens: 1000,
        outputTokens: 0,
        savedTokens: 1000,
      }),
    ]);

    const result = runTsxCli(['economy', '--json', '--fail-below', '99'], { cwd });
    assert.equal(result.status, 1);

    const parsed = JSON.parse(result.stdout);
    assert.equal(parsed.summary.averageSavingsPercent, 100);
    assert.ok(parsed.score < 99);
  });
});

async function writeContextEconomyFiles(cwd: string): Promise<void> {
  const base = path.join(cwd, 'src', 'core', 'context-economy');
  const filtersDir = path.join(base, 'filters');
  await fs.mkdir(filtersDir, { recursive: true });
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
    await fs.writeFile(path.join(filtersDir, `${filterName}.ts`), '', 'utf8');
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

function makeRecord(overrides: Partial<LedgerRecord>): LedgerRecord {
  const inputTokens = overrides.inputTokens ?? 100;
  const outputTokens = overrides.outputTokens ?? inputTokens;
  const savedTokens = overrides.savedTokens ?? Math.max(0, inputTokens - outputTokens);
  const savingsPercent = inputTokens > 0 ? Math.round((savedTokens / inputTokens) * 100) : 0;
  return {
    timestamp: '2026-04-26T10:00:00.000Z',
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
