// optimizer-validation.test.ts
// Real (no-mock) tests that prove DanteForge improves AI context quality.
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

import { scoreRawPrompt, runProof } from '../src/core/proof-engine.js';
import { DEMO_FIXTURES, getDemoFixture, listDemoFixtures } from '../src/core/demo-fixtures.js';
import { scoreAllArtifacts } from '../src/core/pdse.js';
import type { DanteState } from '../src/core/state.js';

const minimalState: DanteState = {
  project: 'TestProject',
  lastHandoff: '',
  workflowStage: 'tasks',
  currentPhase: 1,
  tasks: {},
  auditLog: [],
  profile: 'default',
};

// ── Group 1: Raw prompt scoring ───────────────────────────────────────────────

describe('Raw prompt scoring', () => {
  it('scoreRawPrompt("Build a task tracker") total < 25 — proves raw prompts score low', () => {
    const result = scoreRawPrompt('Build a task tracker');
    assert.ok(result.total < 25, `Expected total < 25, got ${result.total}`);
  });

  it('DEMO_FIXTURES[0] rawPrompt score ≤ expectedRawScore + 5', () => {
    const fixture = DEMO_FIXTURES[0];
    const result = scoreRawPrompt(fixture.rawPrompt);
    assert.ok(
      result.total <= fixture.expectedRawScore + 5,
      `Expected total ≤ ${fixture.expectedRawScore + 5}, got ${result.total}`,
    );
  });

  it('scoreRawPrompt is deterministic — same input always returns same total', () => {
    const prompt = 'Build a task tracker app with user auth';
    const first = scoreRawPrompt(prompt);
    const second = scoreRawPrompt(prompt);
    assert.equal(first.total, second.total);
  });
});

// ── Group 2: PDSE scoring with real artifacts ─────────────────────────────────

describe('PDSE scoring with real artifacts — empty directory', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-optval-empty-'));
    // No .danteforge/ created — tests empty-directory behavior
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('empty cwd (no .danteforge/) → all artifact scores are 0', async () => {
    const results = await scoreAllArtifacts(tmpDir, minimalState);
    const scores = Object.values(results).map((r) => r.score);
    assert.ok(scores.every((s) => s === 0), `Expected all scores to be 0, got: ${scores.join(', ')}`);
  });
});

describe('PDSE scoring with real artifacts — constitution only', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-optval-const-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
    const fixture = DEMO_FIXTURES[0];
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'CONSTITUTION.md'), fixture.artifactSet.constitution, 'utf8');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('CONSTITUTION.md alone → CONSTITUTION score > 0', async () => {
    const results = await scoreAllArtifacts(tmpDir, minimalState);
    assert.ok(results.CONSTITUTION.score > 0, `Expected CONSTITUTION score > 0, got ${results.CONSTITUTION.score}`);
  });
});

describe('PDSE scoring with real artifacts — full fixture', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-optval-full-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
    const fixture = DEMO_FIXTURES[0];
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'CONSTITUTION.md'), fixture.artifactSet.constitution, 'utf8');
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'SPEC.md'), fixture.artifactSet.spec, 'utf8');
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'PLAN.md'), fixture.artifactSet.plan, 'utf8');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('full fixture → at least one artifact score > 50', async () => {
    const results = await scoreAllArtifacts(tmpDir, minimalState);
    const scores = Object.values(results).map((r) => r.score);
    assert.ok(scores.some((s) => s > 50), `Expected at least one score > 50, got: ${scores.join(', ')}`);
  });

  it('full fixture average PDSE score > raw prompt score (proves improvement)', async () => {
    const results = await scoreAllArtifacts(tmpDir, minimalState);
    const scores = Object.values(results).map((r) => r.score);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const rawTotal = scoreRawPrompt(DEMO_FIXTURES[0].rawPrompt).total;
    assert.ok(avg > rawTotal, `PDSE avg ${avg} should exceed raw prompt score ${rawTotal}`);
  });

  it('full fixture CONSTITUTION score ≤ 100 (sanity check)', async () => {
    const results = await scoreAllArtifacts(tmpDir, minimalState);
    assert.ok(results.CONSTITUTION.score <= 100, `CONSTITUTION score ${results.CONSTITUTION.score} must be ≤ 100`);
  });
});

// ── Group 3: Proof engine integration ─────────────────────────────────────────

describe('Proof engine integration — empty dir', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-optval-proof-empty-'));
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('runProof with empty cwd → pdseScore === 0', async () => {
    const report = await runProof('Build a task tracker', { cwd: tmpDir });
    assert.equal(report.pdseScore, 0);
  });
});

describe('Proof engine integration — with constitution', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-optval-proof-const-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
    const fixture = DEMO_FIXTURES[0];
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'CONSTITUTION.md'), fixture.artifactSet.constitution, 'utf8');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('runProof with CONSTITUTION.md present → pdseScore > 0', async () => {
    const report = await runProof('Build a task tracker', { cwd: tmpDir });
    assert.ok(report.pdseScore > 0, `Expected pdseScore > 0, got ${report.pdseScore}`);
  });
});

describe('Proof engine integration — full fixture', () => {
  let tmpDir: string;

  before(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-optval-proof-full-'));
    await fs.mkdir(path.join(tmpDir, '.danteforge'), { recursive: true });
    const fixture = DEMO_FIXTURES[0];
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'CONSTITUTION.md'), fixture.artifactSet.constitution, 'utf8');
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'SPEC.md'), fixture.artifactSet.spec, 'utf8');
    await fs.writeFile(path.join(tmpDir, '.danteforge', 'PLAN.md'), fixture.artifactSet.plan, 'utf8');
  });

  after(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('runProof with full fixture → improvementPercent > 0', async () => {
    const report = await runProof('Build a task tracker', { cwd: tmpDir });
    assert.ok(report.improvementPercent > 0, `Expected improvementPercent > 0, got ${report.improvementPercent}`);
  });

  it('runProof verdict is one of: strong | moderate | weak', async () => {
    const report = await runProof('Build a task tracker', { cwd: tmpDir });
    const validVerdicts = new Set<string>(['strong', 'moderate', 'weak']);
    assert.ok(validVerdicts.has(report.verdict), `Expected valid verdict, got "${report.verdict}"`);
  });
});

// ── Group 4: Demo fixtures consistency ────────────────────────────────────────

describe('Demo fixtures consistency', () => {
  it('all 3 demo fixtures have expectedRawScore ≤ 25', () => {
    assert.equal(DEMO_FIXTURES.length, 3, 'Expected exactly 3 demo fixtures');
    for (const fixture of DEMO_FIXTURES) {
      assert.ok(
        fixture.expectedRawScore <= 25,
        `Fixture "${fixture.name}" expectedRawScore ${fixture.expectedRawScore} should be ≤ 25`,
      );
    }
  });

  it('all 3 demo fixtures have expectedPdseScore ≥ 70', () => {
    for (const fixture of DEMO_FIXTURES) {
      assert.ok(
        fixture.expectedPdseScore >= 70,
        `Fixture "${fixture.name}" expectedPdseScore ${fixture.expectedPdseScore} should be ≥ 70`,
      );
    }
  });

  it('scoreRawPrompt(f.rawPrompt).total ≤ 30 for all three fixtures (tolerance = 5 above max)', () => {
    for (const fixture of DEMO_FIXTURES) {
      const result = scoreRawPrompt(fixture.rawPrompt);
      assert.ok(
        result.total <= 30,
        `Fixture "${fixture.name}" raw score ${result.total} should be ≤ 30`,
      );
    }
  });

  it('getDemoFixture returns undefined for unknown names and non-null for known names', () => {
    assert.equal(getDemoFixture('nonexistent-fixture-xyz'), undefined);
    assert.notEqual(getDemoFixture('task-tracker'), undefined);
    assert.notEqual(getDemoFixture('auth-system'), undefined);
    assert.notEqual(getDemoFixture('data-pipeline'), undefined);
  });
});
