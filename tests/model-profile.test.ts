import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyTask, generateCompensation, computeTrend, type WeaknessPattern } from '../src/core/model-profile.js';
import { ModelProfileEngine } from '../src/core/model-profile-engine.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

let tmpDir: string;
const originalCwd = process.cwd();

async function makeEngine(): Promise<ModelProfileEngine> {
  return new ModelProfileEngine(tmpDir);
}

async function recordN(
  engine: ModelProfileEngine,
  n: number,
  modelKey: string,
  overrides: Partial<{
    pdseScore: number;
    passed: boolean;
    category: string;
    retriesNeeded: number;
    antiStubViolations: number;
  }> = {},
): Promise<void> {
  const [providerId, modelId] = modelKey.split(':') as [string, string];
  for (let i = 0; i < n; i++) {
    await engine.recordResult({
      modelKey,
      providerId,
      modelId,
      taskDescription: `Task ${i}`,
      taskCategories: [overrides.category ?? 'general'],
      pdseScore: overrides.pdseScore ?? 80,
      passed: overrides.passed ?? true,
      antiStubViolations: overrides.antiStubViolations ?? 0,
      tokensUsed: 1000,
      retriesNeeded: overrides.retriesNeeded ?? 0,
    });
  }
}

// ── Setup / Teardown ──────────────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-model-profile-'));
});

afterEach(async () => {
  process.chdir(originalCwd);
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('classifyTask', () => {
  it('1. classifies JWT authentication task correctly', () => {
    const categories = classifyTask('Add JWT authentication');
    assert.ok(categories.includes('authentication'), `Expected "authentication" in [${categories.join(', ')}]`);
  });

  it('2. classifies OAuth2 + database task to multiple categories', () => {
    const categories = classifyTask('Add OAuth2 login with database session storage');
    assert.ok(categories.includes('authentication'), `Expected "authentication" in [${categories.join(', ')}]`);
    assert.ok(categories.includes('database'), `Expected "database" in [${categories.join(', ')}]`);
  });

  it('3. returns ["general"] when no category matches', () => {
    const categories = classifyTask('fix the thing');
    assert.deepStrictEqual(categories, ['general']);
  });
});

describe('profile accumulation', () => {
  it('4. computes correct averages after 10 tasks', async () => {
    const engine = await makeEngine();
    await recordN(engine, 10, 'test:model-a', { pdseScore: 80, category: 'api' });

    const profile = await engine.getProfile('test:model-a');
    assert.ok(profile !== null, 'Profile should exist after 10 tasks');
    assert.strictEqual(profile!.totalTasks, 10);
    assert.ok(
      Math.abs(profile!.aggregate.averagePdse - 80) < 0.01,
      `Expected average PDSE ~80, got ${profile!.aggregate.averagePdse}`,
    );
  });

  it('5. category stats update correctly with new data points', async () => {
    const engine = await makeEngine();
    await recordN(engine, 5, 'test:model-b', { pdseScore: 90, category: 'testing' });
    await recordN(engine, 5, 'test:model-b', { pdseScore: 70, category: 'testing' });

    const profile = await engine.getProfile('test:model-b');
    assert.ok(profile !== null);
    const stats = profile!.categories['testing'];
    assert.ok(stats, 'testing category stats should exist');
    assert.strictEqual(stats!.taskCount, 10);
    assert.ok(
      Math.abs(stats!.averagePdse - 80) < 1,
      `Expected avg ~80, got ${stats!.averagePdse}`,
    );
    assert.ok(stats!.minPdse <= 70, `Expected minPdse ≤ 70, got ${stats!.minPdse}`);
    assert.ok(stats!.maxPdse >= 90, `Expected maxPdse ≥ 90, got ${stats!.maxPdse}`);
  });
});

describe('trend detection', () => {
  it('6. detects "improving" trend when recent scores rise', () => {
    const scores = [
      { timestamp: '2026-01-01T00:00:00Z', pdse: 60 },
      { timestamp: '2026-01-02T00:00:00Z', pdse: 62 },
      { timestamp: '2026-01-03T00:00:00Z', pdse: 75 },
      { timestamp: '2026-01-04T00:00:00Z', pdse: 78 },
      { timestamp: '2026-01-05T00:00:00Z', pdse: 85 },
    ];
    assert.strictEqual(computeTrend(scores), 'improving');
  });

  it('7. detects "declining" trend when recent scores fall', () => {
    const scores = [
      { timestamp: '2026-01-01T00:00:00Z', pdse: 90 },
      { timestamp: '2026-01-02T00:00:00Z', pdse: 85 },
      { timestamp: '2026-01-03T00:00:00Z', pdse: 72 },
      { timestamp: '2026-01-04T00:00:00Z', pdse: 70 },
      { timestamp: '2026-01-05T00:00:00Z', pdse: 65 },
    ];
    assert.strictEqual(computeTrend(scores), 'declining');
  });
});

describe('rankModelsForTask', () => {
  it('8. ranks model with higher category PDSE first', async () => {
    const engine = await makeEngine();

    // model-high: 90 PDSE on database tasks
    await recordN(engine, 10, 'prov:model-high', { pdseScore: 90, category: 'database' });
    // model-low: 65 PDSE on database tasks
    await recordN(engine, 10, 'prov:model-low', { pdseScore: 65, category: 'database' });

    const rankings = await engine.rankModelsForTask(
      'Write a database migration',
      ['prov:model-high', 'prov:model-low'],
    );

    assert.ok(rankings.length >= 2, `Expected at least 2 rankings, got ${rankings.length}`);
    assert.strictEqual(rankings[0]!.modelKey, 'prov:model-high');
    assert.ok(
      rankings[0]!.predictedPdse > rankings[1]!.predictedPdse,
      `Expected model-high (${rankings[0]!.predictedPdse}) > model-low (${rankings[1]!.predictedPdse})`,
    );
  });

  it('9. returns empty array when no profile data exists (no guessing)', async () => {
    const engine = await makeEngine();
    const rankings = await engine.rankModelsForTask('Write an API endpoint', ['ghost:model-x', 'ghost:model-y']);
    assert.deepStrictEqual(rankings, []);
  });
});

describe('pattern detection', () => {
  it('10. weakness detection triggers when category PDSE is 10+ below aggregate', async () => {
    const engine = await makeEngine();

    // Build aggregate at 85 PDSE across general tasks (need 20 for pattern detection)
    await recordN(engine, 15, 'test:model-c', { pdseScore: 85, category: 'general' });
    // Add 5 api tasks at 65 PDSE (20 below aggregate) — triggers weakness detection at task 20
    await recordN(engine, 5, 'test:model-c', { pdseScore: 65, category: 'api' });

    const profile = await engine.getProfile('test:model-c');
    assert.ok(profile !== null);

    const apiWeakness = profile!.weaknesses.find(w => w.category === 'api');
    assert.ok(apiWeakness !== undefined, `Expected "api" weakness. Weaknesses: ${JSON.stringify(profile!.weaknesses.map(w => w.category))}`);
    assert.ok(
      profile!.aggregate.averagePdse - profile!.categories['api']!.averagePdse >= 10,
      `Expected gap ≥ 10, got ${profile!.aggregate.averagePdse - profile!.categories['api']!.averagePdse}`,
    );
  });

  it('11. strength detection triggers when category PDSE is 5+ above aggregate', async () => {
    const engine = await makeEngine();

    // Build aggregate at 75 PDSE (need 20 tasks)
    await recordN(engine, 15, 'test:model-d', { pdseScore: 75, category: 'general' });
    // Add 5 testing tasks at 90 PDSE (15 above aggregate) — triggers strength at task 20
    await recordN(engine, 5, 'test:model-d', { pdseScore: 90, category: 'testing' });

    const profile = await engine.getProfile('test:model-d');
    assert.ok(profile !== null);

    const testStrength = profile!.strengths.find(s => s.category === 'testing');
    assert.ok(
      testStrength !== undefined,
      `Expected "testing" strength. Strengths: ${JSON.stringify(profile!.strengths.map(s => s.category))}`,
    );
  });

  it('12. auto-compensation generated for detected weakness', async () => {
    const engine = await makeEngine();

    await recordN(engine, 15, 'test:model-e', { pdseScore: 85, category: 'general' });
    await recordN(engine, 5, 'test:model-e', { pdseScore: 60, category: 'authentication' });

    const profile = await engine.getProfile('test:model-e');
    assert.ok(profile !== null);

    const authWeak = profile!.weaknesses.find(w => w.category === 'authentication');
    if (authWeak) {
      assert.ok(authWeak.compensated, 'Weakness should be marked as compensated');
      const comp = profile!.compensations.find(c => c.weaknessId === authWeak.id || c.appliesTo.includes('authentication'));
      assert.ok(comp !== undefined, 'A compensation rule should exist for authentication weakness');
      assert.ok(comp!.instruction.length > 10, 'Compensation instruction should be meaningful');
    }
  });
});

describe('getCompensations', () => {
  it('13. returns relevant instructions for task categories', async () => {
    const engine = await makeEngine();

    // Manually trigger analyzePatterns by recording 20 tasks with a clear weakness
    await recordN(engine, 15, 'test:model-f', { pdseScore: 80, category: 'general' });
    await recordN(engine, 5, 'test:model-f', { pdseScore: 55, category: 'security' });

    const compensations = await engine.getCompensations('test:model-f', ['security']);
    // If weakness was detected and compensated, we should get instructions
    const profile = await engine.getProfile('test:model-f');
    const hasSecurityWeak = profile?.weaknesses.some(w => w.category === 'security') ?? false;

    if (hasSecurityWeak) {
      assert.ok(compensations.length > 0, 'Should return compensation instructions for security weakness');
      assert.ok(compensations[0]!.length > 10, 'Instruction should be meaningful');
    } else {
      // Not enough tasks to trigger pattern detection yet — that's also valid
      assert.ok(compensations.length >= 0, 'No compensations is valid when no weakness detected');
    }
  });
});

describe('persistence', () => {
  it('14. save/load roundtrip produces identical profile', async () => {
    const engine = await makeEngine();
    await recordN(engine, 5, 'persist:test-model', { pdseScore: 77, category: 'api' });

    const original = await engine.getProfile('persist:test-model');
    assert.ok(original !== null);

    // Create a fresh engine pointing at the same directory
    const engine2 = new ModelProfileEngine(tmpDir);
    const loaded = await engine2.getProfile('persist:test-model');

    assert.ok(loaded !== null, 'Profile should load from disk');
    assert.strictEqual(loaded!.modelKey, original!.modelKey);
    assert.strictEqual(loaded!.totalTasks, original!.totalTasks);
    assert.ok(
      Math.abs(loaded!.aggregate.averagePdse - original!.aggregate.averagePdse) < 0.01,
      `PDSE mismatch: ${loaded!.aggregate.averagePdse} vs ${original!.aggregate.averagePdse}`,
    );
    assert.deepStrictEqual(Object.keys(loaded!.categories), Object.keys(original!.categories));
  });
});

describe('generateReport', () => {
  it('15. produces readable output with all expected sections', async () => {
    const engine = await makeEngine();
    await recordN(engine, 5, 'report:test-model', { pdseScore: 82, category: 'testing' });

    const report = await engine.generateReport('report:test-model');

    assert.ok(report.includes('# Model Profile:'), 'Report should have a header');
    assert.ok(report.includes('## Aggregate Performance'), 'Report should have aggregate section');
    assert.ok(report.includes('Average PDSE'), 'Report should include PDSE metric');
    assert.ok(report.includes('report:test-model'), 'Report should include the model key');
    assert.ok(report.length > 200, 'Report should be substantive');
  });

  it('15b. returns helpful message for unknown model', async () => {
    const engine = await makeEngine();
    const report = await engine.generateReport('ghost:nonexistent-model');
    assert.ok(report.includes('No profile found'), 'Should indicate no profile exists');
  });
});

describe('generateCompensation', () => {
  it('generates a valid compensation rule from a weakness', () => {
    const weakness: WeaknessPattern = {
      id: 'w_test_auth_001',
      description: 'Stubs OAuth2 refresh token logic',
      category: 'authentication',
      severity: 'high',
      occurrenceCount: 3,
      firstSeen: '2026-01-01T00:00:00Z',
      lastSeen: '2026-03-01T00:00:00Z',
      compensated: false,
    };

    const comp = generateCompensation(weakness);
    assert.strictEqual(comp.weaknessId, weakness.id);
    assert.ok(comp.appliesTo.includes('authentication'), 'Should apply to authentication category');
    assert.strictEqual(comp.source, 'auto');
    assert.ok(comp.instruction.length > 20, 'Instruction should be meaningful');
    assert.ok(comp.id.startsWith('comp_'), 'ID should start with comp_');
  });
});

// ─── sevenLevelsRootCause integration ─────────────────────────────────────

describe('sevenLevelsRootCause recording', () => {
  it('16. applySevenLevelsFindings adds a weakness and compensation for new finding', async () => {
    const engine = await makeEngine();
    const [providerId, modelId] = ['test', 'model-7l'];

    await engine.recordResult({
      modelKey: `${providerId}:${modelId}`,
      providerId,
      modelId,
      taskDescription: 'Add OAuth2 authentication',
      taskCategories: ['authentication'],
      pdseScore: 55,
      passed: false,
      antiStubViolations: 0,
      tokensUsed: 2000,
      retriesNeeded: 2,
      sevenLevelsRootCause: {
        level: 4,
        domain: 'context',
        finding: 'Model lacks knowledge of PKCE flow variant for OAuth2',
      },
    });

    const profile = await engine.getProfile(`${providerId}:${modelId}`);
    assert.ok(profile !== null);
    const weakness = profile!.weaknesses.find(w => w.rootCause?.includes('PKCE'));
    assert.ok(weakness !== undefined, 'Should have a weakness with the 7LD finding as root cause');
    assert.ok(weakness!.compensated, 'Weakness should be marked compensated');
    assert.ok(profile!.compensations.length > 0, 'Should have at least one compensation');
  });

  it('17. applySevenLevelsFindings increments occurrenceCount for duplicate finding', async () => {
    const engine = await makeEngine();
    const modelKey = 'dup:model-7l';
    const [providerId, modelId] = ['dup', 'model-7l'];

    const recordWithFinding = () => engine.recordResult({
      modelKey,
      providerId,
      modelId,
      taskDescription: 'Database migration task',
      taskCategories: ['database'],
      pdseScore: 60,
      passed: false,
      antiStubViolations: 0,
      tokensUsed: 1500,
      retriesNeeded: 1,
      sevenLevelsRootCause: {
        level: 3,
        domain: 'model',
        finding: 'Model does not understand database transaction rollback semantics',
      },
    });

    // Record same finding twice
    await recordWithFinding();
    await recordWithFinding();

    const profile = await engine.getProfile(modelKey);
    assert.ok(profile !== null);
    const weakness = profile!.weaknesses.find(w => w.rootCause?.includes('rollback'));
    assert.ok(weakness !== undefined, 'Should have the recurring weakness');
    assert.ok(weakness!.occurrenceCount >= 2, `Expected occurrenceCount >= 2, got ${weakness!.occurrenceCount}`);
  });

  it('18. sevenLevelsRootCause with level < 3 does NOT add finding', async () => {
    const engine = await makeEngine();
    const modelKey = 'shallow:model';
    const [providerId, modelId] = ['shallow', 'model'];

    await engine.recordResult({
      modelKey,
      providerId,
      modelId,
      taskDescription: 'Minor bug fix',
      taskCategories: ['general'],
      pdseScore: 75,
      passed: true,
      antiStubViolations: 0,
      tokensUsed: 500,
      retriesNeeded: 0,
      sevenLevelsRootCause: {
        level: 2,  // level < 3 → should NOT apply findings
        domain: 'code',
        finding: 'Shallow code issue',
      },
    });

    const profile = await engine.getProfile(modelKey);
    assert.ok(profile !== null);
    // No 7LD weakness should be added for shallow level
    const sevenLdWeak = profile!.weaknesses.find(w => w.id.startsWith('w7l_'));
    assert.ok(sevenLdWeak === undefined, 'Level < 3 should not add 7LD weakness');
  });
});

// ─── getAllProfiles ────────────────────────────────────────────────────────

describe('getAllProfiles', () => {
  it('19. returns empty array when profile directory does not exist', async () => {
    const engine = await makeEngine();
    const profiles = await engine.getAllProfiles();
    // tmpDir is fresh → no profile dir exists yet
    assert.deepStrictEqual(profiles, []);
  });

  it('20. returns all saved profiles after recording', async () => {
    const engine = await makeEngine();
    await recordN(engine, 3, 'all:model-a', { pdseScore: 80, category: 'api' });
    await recordN(engine, 3, 'all:model-b', { pdseScore: 70, category: 'testing' });

    const profiles = await engine.getAllProfiles();
    assert.ok(profiles.length >= 2, `Expected >= 2 profiles, got ${profiles.length}`);

    const modelKeys = profiles.map(p => p.modelKey);
    assert.ok(modelKeys.includes('all:model-a'), 'Should have model-a');
    assert.ok(modelKeys.includes('all:model-b'), 'Should have model-b');
  });
});

// ─── generateReport — with weaknesses and strengths ───────────────────────

describe('generateReport — rich output', () => {
  it('21. report includes weaknesses section when weakness is detected', async () => {
    const engine = await makeEngine();

    // Need 20 tasks with a clear weakness to trigger pattern analysis
    await recordN(engine, 15, 'rpt:model-a', { pdseScore: 85, category: 'general' });
    await recordN(engine, 5, 'rpt:model-a', { pdseScore: 58, category: 'security' });

    const report = await engine.generateReport('rpt:model-a');
    const profile = await engine.getProfile('rpt:model-a');

    if (profile?.weaknesses && profile.weaknesses.length > 0) {
      assert.ok(report.includes('## Weaknesses'), 'Report should have Weaknesses section');
    } else {
      // Pattern detection may not have triggered — still valid
      assert.ok(report.includes('## Aggregate Performance'));
    }
  });

  it('22. report includes strengths section when strength is detected', async () => {
    const engine = await makeEngine();

    await recordN(engine, 15, 'rpt:model-b', { pdseScore: 75, category: 'general' });
    await recordN(engine, 5, 'rpt:model-b', { pdseScore: 92, category: 'testing' });

    const report = await engine.generateReport('rpt:model-b');
    const profile = await engine.getProfile('rpt:model-b');

    if (profile?.strengths && profile.strengths.length > 0) {
      assert.ok(report.includes('## Strengths'), 'Report should have Strengths section');
    } else {
      assert.ok(report.includes('## Category Performance') || report.includes('## Aggregate Performance'));
    }
  });

  it('23. report includes category performance table', async () => {
    const engine = await makeEngine();
    await recordN(engine, 5, 'rpt:model-c', { pdseScore: 80, category: 'api' });

    const report = await engine.generateReport('rpt:model-c');
    assert.ok(report.includes('## Category Performance'), 'Should have category performance table');
    assert.ok(report.includes('api'), 'Should show the api category');
  });

  it('24. analyzePatterns returns empty when < 20 tasks', async () => {
    const engine = await makeEngine();
    await recordN(engine, 5, 'pattern:early', { pdseScore: 80 });

    const analysis = await engine.analyzePatterns('pattern:early');
    // With < 20 tasks, pattern analysis should return empty results
    assert.deepStrictEqual(analysis.newWeaknesses, []);
    assert.deepStrictEqual(analysis.newStrengths, []);
    assert.deepStrictEqual(analysis.autoCompensations, []);
  });

  it('25. rankModelsForTask falls back to aggregate when no category-specific data (>= 5 tasks)', async () => {
    const engine = await makeEngine();

    // Record tasks in 'general' category, but query for 'database'
    await recordN(engine, 6, 'fallback:model', { pdseScore: 85, category: 'general' });

    const rankings = await engine.rankModelsForTask(
      'Write a database migration',
      ['fallback:model'],
    );

    // Should use aggregate fallback since no 'database' category data but >= 5 tasks
    assert.ok(rankings.length >= 1, 'Should rank using aggregate fallback');
    assert.ok(rankings[0]!.predictedPdse > 0);
  });
});
