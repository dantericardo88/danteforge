import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_FIXTURES, getDemoFixture, listDemoFixtures } from '../src/core/demo-fixtures.js';
import { demo } from '../src/cli/commands/demo.js';
import { scoreRawPrompt } from '../src/core/proof-engine.js';

describe('demo-fixtures: listDemoFixtures', () => {
  it('returns an array of length 3', () => {
    assert.equal(listDemoFixtures().length, 3);
  });

  it("contains 'task-tracker'", () => {
    assert.ok(listDemoFixtures().includes('task-tracker'));
  });
});

describe('demo-fixtures: getDemoFixture', () => {
  it("returns a non-null object for 'task-tracker'", () => {
    const fixture = getDemoFixture('task-tracker');
    assert.ok(fixture != null);
  });

  it("task-tracker has all required fields", () => {
    const fixture = getDemoFixture('task-tracker');
    assert.ok(fixture != null);
    assert.ok(typeof fixture.name === 'string');
    assert.ok(typeof fixture.description === 'string');
    assert.ok(typeof fixture.rawPrompt === 'string');
    assert.ok(fixture.artifactSet != null);
    assert.ok(typeof fixture.expectedPdseScore === 'number');
    assert.ok(typeof fixture.expectedRawScore === 'number');
  });

  it("returns undefined for an unknown fixture name", () => {
    assert.equal(getDemoFixture('unknown-fixture'), undefined);
  });
});

describe('demo-fixtures: DEMO_FIXTURES', () => {
  it('has length 3', () => {
    assert.equal(DEMO_FIXTURES.length, 3);
  });

  it('all fixtures have expectedRawScore ≤ 25', () => {
    for (const fixture of DEMO_FIXTURES) {
      assert.ok(
        fixture.expectedRawScore <= 25,
        `${fixture.name}: expectedRawScore ${fixture.expectedRawScore} exceeds 25`,
      );
    }
  });

  it('all fixtures have expectedPdseScore ≥ 70', () => {
    for (const fixture of DEMO_FIXTURES) {
      assert.ok(
        fixture.expectedPdseScore >= 70,
        `${fixture.name}: expectedPdseScore ${fixture.expectedPdseScore} is below 70`,
      );
    }
  });

  it('all fixture artifactSets have constitution, spec, plan', () => {
    for (const fixture of DEMO_FIXTURES) {
      assert.ok(typeof fixture.artifactSet.constitution === 'string' && fixture.artifactSet.constitution.length > 0);
      assert.ok(typeof fixture.artifactSet.spec === 'string' && fixture.artifactSet.spec.length > 0);
      assert.ok(typeof fixture.artifactSet.plan === 'string' && fixture.artifactSet.plan.length > 0);
    }
  });
});

describe('demo-fixtures: raw prompt scoring', () => {
  it("scoreRawPrompt(task-tracker.rawPrompt).total ≤ expectedRawScore + 5", () => {
    const fixture = getDemoFixture('task-tracker');
    assert.ok(fixture != null);
    const score = scoreRawPrompt(fixture.rawPrompt);
    assert.ok(
      score.total <= fixture.expectedRawScore + 5,
      `score.total ${score.total} exceeds tolerance of ${fixture.expectedRawScore + 5}`,
    );
  });

  it('scoreRawPrompt(rawPrompt).total ≤ 25 for ALL fixtures', () => {
    for (const fixture of DEMO_FIXTURES) {
      const score = scoreRawPrompt(fixture.rawPrompt);
      assert.ok(
        score.total <= 25,
        `${fixture.name}: scoreRawPrompt returned ${score.total}, expected ≤ 25`,
      );
    }
  });
});

describe('demo command: output capture', () => {
  it('output contains "DanteForge Demo" when run with defaults', async () => {
    const lines: string[] = [];
    await demo({ _stdout: (l) => lines.push(l) });
    assert.ok(
      lines.some((l) => l.includes('DanteForge Demo')),
      'Expected output to contain "DanteForge Demo"',
    );
  });

  it('output contains "IMPROVEMENT" when run with defaults', async () => {
    const lines: string[] = [];
    await demo({ _stdout: (l) => lines.push(l) });
    assert.ok(
      lines.some((l) => l.includes('IMPROVEMENT')),
      'Expected output to contain "IMPROVEMENT"',
    );
  });

  it("runs only one fixture when fixture: 'task-tracker' is specified", async () => {
    const lines: string[] = [];
    await demo({ fixture: 'task-tracker', _stdout: (l) => lines.push(l) });
    const demoHeaders = lines.filter((l) => l.includes('DanteForge Demo:'));
    assert.equal(demoHeaders.length, 1);
  });

  it("falls back to default fixture when unknown fixture name is given", async () => {
    const lines: string[] = [];
    await demo({ fixture: 'unknown', _stdout: (l) => lines.push(l) });
    assert.ok(
      lines.some((l) => l.includes('DanteForge Demo')),
      'Expected fallback to default fixture to still produce output',
    );
  });

  it('all: true runs 3 fixtures (output mentions all 3 descriptions)', async () => {
    const lines: string[] = [];
    await demo({ all: true, _stdout: (l) => lines.push(l) });
    const allText = lines.join('\n');
    for (const fixture of DEMO_FIXTURES) {
      assert.ok(
        allText.includes(fixture.description),
        `Expected output to mention "${fixture.description}"`,
      );
    }
  });

  it('PDSE score in output matches injected _runPdse value', async () => {
    const lines: string[] = [];
    await demo({
      fixture: 'task-tracker',
      _runPdse: async () => 88,
      _stdout: (l) => lines.push(l),
    });
    assert.ok(
      lines.some((l) => l.includes('88/100')),
      'Expected injected PDSE score 88 in output',
    );
  });

  it('raw score in output reflects injected _scoreRawPrompt value', async () => {
    const lines: string[] = [];
    await demo({
      fixture: 'task-tracker',
      _scoreRawPrompt: () => ({
        completeness: 5,
        clarity: 5,
        testability: 0,
        contextDensity: 0,
        specificity: 0,
        freshness: 0,
        total: 10,
        breakdown: {},
      }),
      _stdout: (l) => lines.push(l),
    });
    assert.ok(
      lines.some((l) => l.includes('10/100')),
      'Expected injected raw score 10 in output',
    );
  });

  it('uses fixture.expectedPdseScore as PDSE score when no _runPdse is injected', async () => {
    const fixture = getDemoFixture('task-tracker');
    assert.ok(fixture != null);
    const lines: string[] = [];
    await demo({ fixture: 'task-tracker', _stdout: (l) => lines.push(l) });
    assert.ok(
      lines.some((l) => l.includes(`${fixture.expectedPdseScore}/100`)),
      `Expected expectedPdseScore ${fixture.expectedPdseScore} to appear in output`,
    );
  });

  it("output ends with quickstart suggestion", async () => {
    const lines: string[] = [];
    await demo({ _stdout: (l) => lines.push(l) });
    const lastMeaningfulLines = lines.filter((l) => l.trim().length > 0);
    const last = lastMeaningfulLines[lastMeaningfulLines.length - 1] ?? '';
    assert.ok(
      last.includes('quickstart'),
      `Expected last line to mention quickstart, got: "${last}"`,
    );
  });
});
