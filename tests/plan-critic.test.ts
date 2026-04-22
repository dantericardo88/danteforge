import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import {
  runDeterministicChecks,
  parseCritiqueResponse,
  buildCritiquePrompt,
  critiquePlan,
  recordCritiqueMiss,
  loadCritiqueMisses,
  CRITIQUE_PROMPT_VERSION,
  type CritiqueGap,
  type CritiqueMiss,
} from '../src/core/plan-critic.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

async function withTmpDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'plan-critic-test-'));
  try {
    await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

const noLLM = { _isLLMAvailable: async () => false };
const stubLLM = (response: string) => ({
  _isLLMAvailable: async () => true,
  _llmCaller: async (_: string) => response,
});

// ── T1-T4: Deterministic checks ───────────────────────────────────────────────

describe('runDeterministicChecks', () => {
  it('T1: catches ~/  path string → platform blocking gap', () => {
    const gaps = runDeterministicChecks("Path: '~/danteforge/lib'", '');
    const platform = gaps.find(g => g.category === 'platform');
    assert.ok(platform, 'should find a platform gap');
    assert.equal(platform.severity, 'blocking');
  });

  it('T2: catches assert.ok(true) → test-discipline high gap', () => {
    const gaps = runDeterministicChecks('assert.ok(true)', '');
    const td = gaps.find(g => g.category === 'test-discipline' && g.description.includes('Vacuous'));
    assert.ok(td, 'should find test-discipline gap for assert.ok(true)');
    assert.equal(td.severity, 'high');
  });

  it('T3: catches direct callLLM call → test-discipline blocking gap', () => {
    const gaps = runDeterministicChecks('const result = callLLM(prompt)', '');
    const td = gaps.find(g => g.category === 'test-discipline' && g.description.includes('_llmCaller'));
    assert.ok(td, 'should find test-discipline gap for direct callLLM');
    assert.equal(td.severity, 'blocking');
  });

  it('T4: catches process.chdir() → test-discipline high gap', () => {
    const gaps = runDeterministicChecks('process.chdir(tmpDir)', '');
    const td = gaps.find(g => g.category === 'test-discipline' && g.description.includes('chdir'));
    assert.ok(td, 'should find test-discipline gap for process.chdir');
    assert.equal(td.severity, 'high');
  });

  it('returns empty array when plan has no known issues', () => {
    const gaps = runDeterministicChecks('This plan has no known issues.', '');
    // vagueness check won't trigger with < 3 signals
    const blocking = gaps.filter(g => g.severity === 'blocking');
    assert.equal(blocking.length, 0);
  });
});

// ── T5-T6: parseCritiqueResponse ─────────────────────────────────────────────

describe('parseCritiqueResponse', () => {
  it('T5: parses valid JSON gaps array correctly', () => {
    const raw = JSON.stringify([
      {
        category: 'platform',
        severity: 'blocking',
        description: 'Uses ~ path',
        specificFix: 'Use os.homedir()',
        relatedFiles: ['src/core/lib.ts'],
      },
    ]);
    const gaps = parseCritiqueResponse(raw);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.category, 'platform');
    assert.equal(gaps[0]!.severity, 'blocking');
    assert.deepEqual(gaps[0]!.relatedFiles, ['src/core/lib.ts']);
  });

  it('T6: returns empty array on malformed JSON (safe fallback)', () => {
    const gaps = parseCritiqueResponse('not json at all { broken');
    assert.deepEqual(gaps, []);
  });

  it('strips markdown code fences before parsing', () => {
    const raw = '```json\n[{"category":"platform","severity":"high","description":"x","specificFix":"y"}]\n```';
    const gaps = parseCritiqueResponse(raw);
    assert.equal(gaps.length, 1);
  });

  it('filters out items with missing required fields', () => {
    const raw = JSON.stringify([
      { severity: 'blocking' }, // missing category + description
      { category: 'platform', severity: 'high', description: 'valid', specificFix: 'fix it' },
    ]);
    const gaps = parseCritiqueResponse(raw);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0]!.category, 'platform');
  });

  it('normalises unknown category to honesty', () => {
    const raw = JSON.stringify([
      { category: 'made-up-category', severity: 'medium', description: 'x', specificFix: 'y' },
    ]);
    const gaps = parseCritiqueResponse(raw);
    assert.equal(gaps[0]!.category, 'honesty');
  });

  it('normalises unknown severity to medium', () => {
    const raw = JSON.stringify([
      { category: 'platform', severity: 'catastrophic', description: 'x', specificFix: 'y' },
    ]);
    const gaps = parseCritiqueResponse(raw);
    assert.equal(gaps[0]!.severity, 'medium');
  });
});

// ── T7-T9: critiquePlan ───────────────────────────────────────────────────────

describe('critiquePlan', () => {
  it('T7: LLM unavailable → uses deterministic checks only', async () => {
    const report = await critiquePlan({
      planContent: "Store at '~/my-dir/data.json'",
      ...noLLM,
    });
    assert.ok(report.gapsFound.some(g => g.category === 'platform'));
    assert.equal(report.critiquePromptVersion, CRITIQUE_PROMPT_VERSION);
    assert.ok(report.durationMs >= 0);
  });

  it('T8: LLM available → calls LLM and merges with deterministic gaps', async () => {
    const llmGap: CritiqueGap = {
      category: 'schema',
      severity: 'high',
      description: 'Missing version field',
      specificFix: "Add version: '1.0.0'",
    };
    let called = false;
    const report = await critiquePlan({
      planContent: "callLLM(prompt) will be called here",
      ...stubLLM(JSON.stringify([llmGap])),
      _llmCaller: async (_: string) => { called = true; return JSON.stringify([llmGap]); },
    });
    assert.ok(called, 'LLM should have been called');
    assert.ok(report.gapsFound.some(g => g.category === 'schema'), 'should include LLM gap');
    assert.ok(report.gapsFound.some(g => g.category === 'test-discipline'), 'should include deterministic gap');
  });

  it('T9: deduplicates overlapping gaps from parallel personas', async () => {
    const dupGap: CritiqueGap = {
      category: 'platform',
      severity: 'blocking',
      description: 'Hard-coded home directory path',
      specificFix: 'Use os.homedir()',
    };
    // Both LLM and deterministic find platform gap — should dedup
    const report = await critiquePlan({
      planContent: "'~/lib/data.json'",
      ...stubLLM(JSON.stringify([dupGap, dupGap])),
    });
    const platformGaps = report.gapsFound.filter(g => g.category === 'platform');
    // should not have more than 2 platform gaps (1 deterministic + at most 1 LLM)
    assert.ok(platformGaps.length <= 2, `Too many duplicate platform gaps: ${platformGaps.length}`);
  });

  it('T10: approved: false when any blocking gap exists', async () => {
    const report = await critiquePlan({
      planContent: "Use callLLM(prompt) directly",
      ...noLLM,
    });
    assert.equal(report.approved, false);
    assert.ok(report.blockingCount > 0);
  });

  it('T11: approved: true only when 0 blocking gaps (high gaps allowed)', async () => {
    const highGap: CritiqueGap = {
      category: 'schema',
      severity: 'high',
      description: 'Missing version field',
      specificFix: "Add version: '1.0.0'",
    };
    const report = await critiquePlan({
      planContent: 'Clean plan with no blocking issues.',
      _isLLMAvailable: async () => true,
      _llmCaller: async () => JSON.stringify([highGap]),
      enablePremortem: false,
    });
    assert.equal(report.blockingCount, 0);
    assert.ok(report.highCount >= 1);
    assert.equal(report.approved, true);
  });

  it('T12: stakes low → skips security persona (fewer LLM calls)', async () => {
    const callLog: string[] = [];
    await critiquePlan({
      planContent: 'Simple read-only plan',
      _isLLMAvailable: async () => true,
      _llmCaller: async (p: string) => { callLog.push(p); return '[]'; },
      stakes: 'low',
      enablePremortem: false,
    });
    const hasSecurityPersona = callLog.some(p => p.includes('security'));
    assert.equal(hasSecurityPersona, false, 'security persona should not run at low stakes');
  });

  it('T13: stakes critical → runs all 4 personas', async () => {
    const personasSeen = new Set<string>();
    await critiquePlan({
      planContent: 'Full-stack plan touching mcp-server and auth',
      _isLLMAvailable: async () => true,
      _llmCaller: async (p: string) => {
        if (p.includes('PLATFORM')) personasSeen.add('platform');
        if (p.includes('TEST-DISCIPLINE')) personasSeen.add('test-discipline');
        if (p.includes('SECURITY')) personasSeen.add('security');
        if (p.includes('GENERAL')) personasSeen.add('general');
        return '[]';
      },
      stakes: 'critical',
      enablePremortem: false,
    });
    assert.ok(personasSeen.has('platform'), 'platform persona should run');
    assert.ok(personasSeen.has('security'), 'security persona should run');
  });

  it('T14: enablePremortem: true adds premortemHypotheses to report', async () => {
    const hypotheses = ['Missing error handling', 'Windows path issue', 'Circular dependency'];
    const report = await critiquePlan({
      planContent: 'Plan with unknown failure modes',
      _isLLMAvailable: async () => true,
      _llmCaller: async (p: string) => {
        if (p.includes('most likely reasons')) return JSON.stringify(hypotheses);
        return '[]';
      },
      enablePremortem: true,
    });
    assert.ok(report.premortemHypotheses.length > 0, 'should have pre-mortem hypotheses');
  });
});

// ── T15: recordCritiqueMiss ───────────────────────────────────────────────────

describe('recordCritiqueMiss', () => {
  it('T15: writes to critique-misses.json and loads back', async () => {
    await withTmpDir(async (dir) => {
      const miss: CritiqueMiss = {
        category: 'platform',
        description: 'Windows path was not caught',
        buildFailureEvidence: 'ENOENT ~/lib/data.json',
        timestamp: new Date().toISOString(),
      };
      await recordCritiqueMiss(miss, dir);
      const misses = await loadCritiqueMisses(dir);
      assert.equal(misses.length, 1);
      assert.equal(misses[0]!.category, 'platform');
    });
  });

  it('accumulates miss count per category', async () => {
    await withTmpDir(async (dir) => {
      const miss: CritiqueMiss = {
        category: 'schema',
        description: 'Missing version field',
        buildFailureEvidence: 'TypeError reading version',
        timestamp: new Date().toISOString(),
      };
      await recordCritiqueMiss(miss, dir);
      await recordCritiqueMiss(miss, dir);
      const misses = await loadCritiqueMisses(dir);
      assert.equal(misses.length, 2);
    });
  });
});

// ── T16: Bootstrap — critique finds gap in its own spec ───────────────────────

describe('bootstrap self-test', () => {
  it('T16: critique finds platform gap in fixture containing ~/  path', async () => {
    const fixtureWithBug = [
      '## Global Pattern Library',
      'Stored at: ~/.danteforge/pattern-library.json',
      'Use path.join to access.',
    ].join('\n');

    const report = await critiquePlan({
      planContent: fixtureWithBug,
      ...noLLM,
    });

    const platformGap = report.gapsFound.find(g => g.category === 'platform' && g.severity === 'blocking');
    assert.ok(platformGap, 'critique must find the platform gap in its own fixture');
    assert.equal(report.approved, false);
  });
});

// ── T17: buildCritiquePrompt ──────────────────────────────────────────────────

describe('buildCritiquePrompt', () => {
  it('T17: includes lessons content in the prompt', () => {
    const prompt = buildCritiquePrompt(
      'general',
      'My plan content',
      '',
      'Prior lesson: always use os.homedir()',
      'medium',
    );
    assert.ok(prompt.includes('Prior lesson: always use os.homedir()'));
    assert.ok(prompt.includes(CRITIQUE_PROMPT_VERSION));
  });

  it('includes diff content when provided', () => {
    const prompt = buildCritiquePrompt(
      'platform',
      'Plan content',
      '',
      '',
      'high',
      '+const p = "~/lib"',
    );
    assert.ok(prompt.includes('+const p = "~/lib"'), 'diff content should appear in prompt');
  });
});

// ── T18: diff mode ────────────────────────────────────────────────────────────

describe('critiquePlan diff mode', () => {
  it('T18: includes diffContent in LLM prompts when provided', async () => {
    let receivedPrompt = '';
    await critiquePlan({
      planContent: 'Plan that adds injection seam',
      diffContent: '+const result = callLLM(prompt) // no seam',
      _isLLMAvailable: async () => true,
      _llmCaller: async (p: string) => { receivedPrompt = p; return '[]'; },
      enablePremortem: false,
      stakes: 'low',
    });
    assert.ok(receivedPrompt.includes('callLLM'), 'diff should appear in LLM prompt');
  });
});
