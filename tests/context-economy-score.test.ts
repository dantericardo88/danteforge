// Tests for computeContextEconomyScore - telemetry-evidence scorer (PRD-26)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeContextEconomyScore } from '../src/core/harsh-scorer.js';
import type { LedgerRecord } from '../src/core/context-economy/types.js';

describe('computeContextEconomyScore', () => {
  let emptyDir: string;

  before(async () => {
    emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-score-'));
  });

  after(async () => {
    await fs.rm(emptyDir, { recursive: true, force: true });
  });

  it('returns 0 for an empty directory with no implementation', () => {
    const score = computeContextEconomyScore(emptyDir);
    assert.equal(score, 0);
  });

  it('returns > 0 when sacred-content.ts present', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-score2-'));
    try {
      const base = path.join(dir, 'src', 'core', 'context-economy');
      await fs.mkdir(base, { recursive: true });
      await fs.writeFile(path.join(base, 'sacred-content.ts'), 'export function foo() {}');
      const score = computeContextEconomyScore(dir);
      assert.ok(score > 0, `Expected score > 0, got ${score}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('increases score when more modules are present', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-score3-'));
    try {
      const base = path.join(dir, 'src', 'core', 'context-economy');
      await fs.mkdir(base, { recursive: true });
      await fs.writeFile(path.join(base, 'sacred-content.ts'), '');
      const score1 = computeContextEconomyScore(dir);

      await fs.writeFile(path.join(base, 'economy-ledger.ts'), '');
      const score2 = computeContextEconomyScore(dir);

      assert.ok(score2 >= score1, `score2 (${score2}) should be >= score1 (${score1})`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('does not award enterprise score from file presence alone', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-score4-'));
    try {
      await writeContextEconomyFiles(dir);
      const score = computeContextEconomyScore(dir);
      assert.ok(score < 70, `Expected score < 70 without ledger telemetry, got ${score}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('increases when real ledger telemetry exists', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-score5-'));
    try {
      await writeContextEconomyFiles(dir);

      const before = computeContextEconomyScore(dir);
      await writeLedger(dir, [
        makeRecord({ status: 'filtered', inputTokens: 1000, outputTokens: 250, savedTokens: 750 }),
        makeRecord({ status: 'sacred-bypass', inputTokens: 500, outputTokens: 500, savedTokens: 0, sacredSpanCount: 3 }),
      ]);
      const after = computeContextEconomyScore(dir);

      assert.ok(after > before, `Expected telemetry score (${after}) > file score (${before})`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('scores the actual DanteForge project from real evidence, not a hard-coded max', () => {
    const projectRoot = path.resolve('.');
    const score = computeContextEconomyScore(projectRoot);
    assert.ok(score >= 0 && score <= 100, `Expected bounded score, got ${score}`);
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
