// research-history.test.ts — Phase Q read-only history scanner.
// Verifies safe-empty behavior + populated-state correctness on fixtures.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  appendResearchLesson,
  buildPriorResearchSummary,
  getPriorResearch,
  getStructuralCaps,
  getResearchSummary,
} from '../src/matrix/research/research-history.js';

async function mkCwd(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'research-history-'));
}

async function seedWave(
  cwd: string,
  waveId: string,
  manifest: { dimensionId: string; startedAt: string; outcome: string; reason?: string },
): Promise<void> {
  const dir = path.join(cwd, '.danteforge', 'research', waveId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'manifest.json'), JSON.stringify({ waveId, ...manifest }, null, 2));
}

describe('research-history — empty state', () => {
  it('getPriorResearch returns [] when .danteforge/research/ does not exist', async () => {
    const cwd = await mkCwd();
    try {
      const waves = await getPriorResearch(cwd, 'testing');
      assert.equal(waves.length, 0);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('getStructuralCaps returns [] in empty state', async () => {
    const cwd = await mkCwd();
    try {
      const caps = await getStructuralCaps(cwd);
      assert.equal(caps.length, 0);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('getResearchSummary returns zero totals in empty state', async () => {
    const cwd = await mkCwd();
    try {
      const summary = await getResearchSummary(cwd);
      assert.equal(summary.totalWaves, 0);
      assert.equal(summary.byOutcome.promote, 0);
      assert.equal(summary.byOutcome.cap, 0);
      assert.equal(summary.capDims.length, 0);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});

describe('research-history — populated state', () => {
  it('getPriorResearch returns waves for the requested dim in chronological order', async () => {
    const cwd = await mkCwd();
    try {
      await seedWave(cwd, 'wave-2026-05-15', { dimensionId: 'testing', startedAt: '2026-05-15T00:00:00Z', outcome: 'promote' });
      await seedWave(cwd, 'wave-2026-05-18', { dimensionId: 'testing', startedAt: '2026-05-18T00:00:00Z', outcome: 'cap', reason: 'requires real users' });
      await seedWave(cwd, 'wave-2026-05-17', { dimensionId: 'security', startedAt: '2026-05-17T00:00:00Z', outcome: 'promote' });
      const waves = await getPriorResearch(cwd, 'testing');
      assert.equal(waves.length, 2);
      assert.equal(waves[0]!.waveId, 'wave-2026-05-15');
      assert.equal(waves[1]!.waveId, 'wave-2026-05-18');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('getStructuralCaps surfaces cap reasons', async () => {
    const cwd = await mkCwd();
    try {
      await seedWave(cwd, 'wave-cap', {
        dimensionId: 'community_adoption',
        startedAt: '2026-05-18T00:00:00Z',
        outcome: 'cap',
        reason: 'requires external users — cannot be automated',
      });
      const caps = await getStructuralCaps(cwd);
      assert.equal(caps.length, 1);
      assert.equal(caps[0]!.dimensionId, 'community_adoption');
      assert.match(caps[0]!.reason, /external users/);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('appendResearchLesson writes to .danteforge/lessons.md with [Research] prefix', async () => {
    const cwd = await mkCwd();
    try {
      await appendResearchLesson(cwd, 'w1', 'testing', 'cap', 'Cannot reach T4 without exchange-licensed feeds.');
      const lessonsPath = path.join(cwd, '.danteforge', 'lessons.md');
      const content = await fs.readFile(lessonsPath, 'utf8');
      assert.match(content, /\[Research\] /);
      assert.match(content, /testing/);
      assert.match(content, /wave w1/);
      assert.match(content, /\(cap\)/);
      assert.match(content, /Cannot reach T4/);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('appendResearchLesson is append-only (does not overwrite)', async () => {
    const cwd = await mkCwd();
    try {
      await appendResearchLesson(cwd, 'w1', 'testing', 'cap', 'First lesson.');
      await appendResearchLesson(cwd, 'w2', 'testing', 'promote', 'Second lesson.');
      const content = await fs.readFile(path.join(cwd, '.danteforge', 'lessons.md'), 'utf8');
      assert.match(content, /First lesson/);
      assert.match(content, /Second lesson/);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('buildPriorResearchSummary returns safe-empty when no waves exist', async () => {
    const cwd = await mkCwd();
    try {
      const md = await buildPriorResearchSummary(cwd, 'testing');
      assert.match(md, /no prior research waves/);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('buildPriorResearchSummary surfaces wave history when waves exist', async () => {
    const cwd = await mkCwd();
    try {
      await seedWave(cwd, 'wave-prior', {
        dimensionId: 'testing',
        startedAt: '2026-05-18T00:00:00Z',
        outcome: 'cap',
        reason: 'requires real users',
      });
      const md = await buildPriorResearchSummary(cwd, 'testing');
      assert.match(md, /wave-prior/);
      assert.match(md, /requires real users/);
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });

  it('getResearchSummary counts by outcome', async () => {
    const cwd = await mkCwd();
    try {
      await seedWave(cwd, 'w1', { dimensionId: 'a', startedAt: '2026-05-15T00:00:00Z', outcome: 'promote' });
      await seedWave(cwd, 'w2', { dimensionId: 'b', startedAt: '2026-05-16T00:00:00Z', outcome: 'cap', reason: 'r' });
      await seedWave(cwd, 'w3', { dimensionId: 'c', startedAt: '2026-05-17T00:00:00Z', outcome: 'conflict' });
      const summary = await getResearchSummary(cwd);
      assert.equal(summary.totalWaves, 3);
      assert.equal(summary.byOutcome.promote, 1);
      assert.equal(summary.byOutcome.cap, 1);
      assert.equal(summary.byOutcome.conflict, 1);
      assert.equal(summary.capDims.length, 1);
      assert.equal(summary.pendingConflicts[0], 'c');
    } finally {
      await fs.rm(cwd, { recursive: true, force: true });
    }
  });
});
