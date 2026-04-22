import { describe, it } from 'node:test';
import assert from 'node:assert';
import { harvestPattern } from '../src/cli/commands/harvest-pattern.js';
import type { HarvestPatternOptions, OSSRepo, PatternGap } from '../src/cli/commands/harvest-pattern.js';

function makeRepo(name: string): OSSRepo {
  return { name, url: `https://github.com/test/${name}`, stars: 1000, language: 'TypeScript' };
}

function makeGap(overrides: Partial<PatternGap> = {}): PatternGap {
  return {
    description: 'Add error boundary pattern',
    sourceRepo: 'test/repo',
    sourceFile: 'src/error-boundary.ts',
    estimatedDimension: 'errorHandling',
    estimatedGain: 0.8,
    ...overrides,
  };
}

function makeOpts(overrides: Partial<HarvestPatternOptions> = {}): HarvestPatternOptions {
  return {
    pattern: 'error boundary',
    cwd: '/tmp/harvest-test',
    _searchRepos: async () => [makeRepo('test-repo')],
    _extractGaps: async () => [makeGap()],
    _implementPattern: async () => ({ success: true, filesChanged: ['src/index.ts'] }),
    _harshScore: async () => ({
      rawScore: 72, harshScore: 72, displayScore: 7.5,
      dimensions: {} as any, displayDimensions: {} as any,
      penalties: [], stubsDetected: [], fakeCompletionRisk: 'low',
      verdict: 'needs-work', maturityAssessment: {} as any, timestamp: new Date().toISOString(),
    }),
    _appendLesson: async () => {},
    _confirm: async () => true,
    _stdout: () => {},
    ...overrides,
  };
}

describe('harvestPattern', () => {
  it('_searchRepos called with pattern text', async () => {
    let capturedQuery = '';
    await harvestPattern(makeOpts({
      pattern: 'circuit breaker',
      _searchRepos: async (query, _max) => { capturedQuery = query; return [makeRepo('r1')]; },
    }));
    assert.strictEqual(capturedQuery, 'circuit breaker');
  });

  it('gaps sorted by estimatedGain descending', async () => {
    const order: number[] = [];
    await harvestPattern(makeOpts({
      _extractGaps: async () => [
        makeGap({ estimatedGain: 0.3, description: 'low' }),
        makeGap({ estimatedGain: 0.9, description: 'high' }),
        makeGap({ estimatedGain: 0.6, description: 'mid' }),
      ],
      _confirm: async () => false,  // skip all — just check order via description
      _stdout: (line) => {
        const m = line.match(/Est\. gain: \+(\d+\.\d+)/);
        if (m) order.push(parseFloat(m[1]));
      },
    }));
    // gains output in descending order
    assert.ok(order.length > 0, 'should have emitted gain lines');
    for (let i = 1; i < order.length; i++) {
      assert.ok(order[i] <= order[i - 1], `order should be descending: ${order}`);
    }
  });

  it('_confirm called once per gap', async () => {
    let confirmCalls = 0;
    await harvestPattern(makeOpts({
      _extractGaps: async () => [makeGap(), makeGap({ description: 'second pattern' })],
      _confirm: async () => { confirmCalls++; return false; },
    }));
    assert.strictEqual(confirmCalls, 2);
  });

  it('_implementPattern NOT called when _confirm returns false', async () => {
    let implementCalled = false;
    await harvestPattern(makeOpts({
      _confirm: async () => false,
      _implementPattern: async () => { implementCalled = true; return { success: true, filesChanged: [] }; },
    }));
    assert.ok(!implementCalled, '_implementPattern should not be called when confirm is false');
  });

  it('_appendLesson called after successful implementation', async () => {
    let lessonCaptured = '';
    await harvestPattern(makeOpts({
      _confirm: async () => true,
      _appendLesson: async (entry) => { lessonCaptured = entry; },
    }));
    assert.ok(lessonCaptured.length > 0, '_appendLesson should be called');
    assert.ok(lessonCaptured.includes('harvest'), 'lesson should contain harvest tag');
  });

  it('score delta output shown after implementation', async () => {
    const lines: string[] = [];
    await harvestPattern(makeOpts({
      _confirm: async () => true,
      _harshScore: async () => ({
        rawScore: 75, harshScore: 75, displayScore: 7.8,
        dimensions: {} as any, displayDimensions: {} as any,
        penalties: [], stubsDetected: [], fakeCompletionRisk: 'low',
        verdict: 'needs-work', maturityAssessment: {} as any, timestamp: new Date().toISOString(),
      }),
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('7.8'), 'score should appear in output');
  });

  it('loop stops cleanly when user skips all — no crash', async () => {
    let confirmCalls = 0;
    await harvestPattern(makeOpts({
      _extractGaps: async () => [makeGap(), makeGap({ description: 'gap2' }), makeGap({ description: 'gap3' })],
      _confirm: async () => { confirmCalls++; return false; },
    }));
    assert.strictEqual(confirmCalls, 3, 'confirm should be called for each gap');
  });

  it('T8: zero repos returned → emits "No actionable gaps found" and exits cleanly', async () => {
    const lines: string[] = [];
    await harvestPattern(makeOpts({
      _searchRepos: async () => [],
      _stdout: (l) => lines.push(l),
    }));
    const combined = lines.join('\n');
    assert.ok(combined.includes('No actionable gaps'), 'should report no gaps when repos empty');
  });

  it('T9: implementation succeeds → _appendLesson always called (happy path does not short-circuit)', async () => {
    let lessonCalls = 0;
    await harvestPattern(makeOpts({
      _confirm: async () => true,
      _implementPattern: async () => ({ success: true, filesChanged: ['src/x.ts', 'src/y.ts'] }),
      _appendLesson: async () => { lessonCalls++; },
    }));
    assert.strictEqual(lessonCalls, 1, '_appendLesson should be called exactly once for one successful gap');
  });
});
