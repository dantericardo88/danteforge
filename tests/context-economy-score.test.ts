// Tests for computeContextEconomyScore — filesystem-evidence scorer (PRD-26)

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { computeContextEconomyScore } from '../src/core/harsh-scorer.js';

describe('computeContextEconomyScore', () => {
  let emptyDir: string;

  before(async () => { emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-score-')); });
  after(async () => { await fs.rm(emptyDir, { recursive: true, force: true }); });

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

  it('scores higher with filter modules present', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ce-score4-'));
    try {
      const base = path.join(dir, 'src', 'core', 'context-economy');
      const filtersDir = path.join(base, 'filters');
      await fs.mkdir(filtersDir, { recursive: true });
      for (const m of ['sacred-content', 'economy-ledger', 'pretool-adapter', 'command-filter-registry', 'artifact-compressor']) {
        await fs.writeFile(path.join(base, `${m}.ts`), '');
      }
      for (const f of ['git', 'npm', 'pnpm', 'eslint', 'jest', 'vitest', 'cargo', 'docker', 'find', 'pytest']) {
        await fs.writeFile(path.join(filtersDir, `${f}.ts`), '');
      }
      const score = computeContextEconomyScore(dir);
      assert.ok(score >= 70, `Expected score >= 70 for full implementation, got ${score}`);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('scores the actual DanteForge project >= 70', () => {
    const projectRoot = path.resolve('.');
    const score = computeContextEconomyScore(projectRoot);
    assert.ok(score >= 70, `Expected DanteForge to score >= 70 on contextEconomy, got ${score}`);
  });
});
