import { describe, it } from 'node:test';
import assert from 'node:assert';
import { prime, buildPrimeMarkdown } from '../src/cli/commands/prime.js';
import type { PrimeOptions } from '../src/cli/commands/prime.js';
import type { HarshScoreResult } from '../src/core/harsh-scorer.js';
import type { StructuredLesson } from '../src/core/lessons-index.js';
import type { DanteState } from '../src/core/state.js';

function makeHarshResult(): HarshScoreResult {
  const displayDimensions = {
    functionality: 9.0, testing: 7.8, errorHandling: 9.5,
    security: 3.0, uxPolish: 10.0, documentation: 9.9,
    performance: 2.5, maintainability: 8.4, developerExperience: 9.7,
    autonomy: 4.0, planningQuality: 9.4, selfImprovement: 6.5,
    specDrivenPipeline: 9.5, convergenceSelfHealing: 8.0, tokenEconomy: 7.0,
    ecosystemMcp: 6.0, enterpriseReadiness: 7.5, communityAdoption: 1.5,
  };
  return {
    rawScore: 72, harshScore: 72, displayScore: 7.2,
    dimensions: {} as any, displayDimensions: displayDimensions as any,
    penalties: [], stubsDetected: [], fakeCompletionRisk: 'low',
    verdict: 'needs-work', maturityAssessment: {} as any, timestamp: new Date().toISOString(),
  };
}

function makeState(): DanteState {
  return {
    project: 'danteforge', lastHandoff: new Date().toISOString(),
    workflowStage: 'initialized', currentPhase: 0, tasks: {}, auditLog: [], profile: 'default',
  };
}

function makeLessons(critical = 2): StructuredLesson[] {
  return Array.from({ length: critical }, (_, i) => ({
    id: `L${i}`, timestamp: new Date().toISOString(),
    category: 'code' as const, severity: 'critical' as const,
    rule: `Do not use pattern-${i}`, context: 'test context', tags: [],
  }));
}

function makeOpts(overrides: Partial<PrimeOptions> = {}): PrimeOptions {
  const lines: string[] = [];
  let writtenContent = '';
  return {
    cwd: '/tmp/prime-test',
    _harshScore: async () => makeHarshResult(),
    _loadState: async () => makeState(),
    _indexLessons: async () => makeLessons(2),
    _writeFile: async (_, content) => { writtenContent = content; },
    _stdout: (l) => lines.push(l),
    ...overrides,
    get _capturedContent() { return writtenContent; },
    get _capturedLines() { return lines; },
  } as PrimeOptions;
}

describe('buildPrimeMarkdown', () => {
  it('returns string containing project name and score', () => {
    const md = buildPrimeMarkdown(
      'my-project', 7.4, 'needs-work',
      ['security (3.0)', 'performance (2.5)'],
      ['Do not use as any'],
      'ESM-only TypeScript.',
      '2026-04-13',
    );
    assert.ok(md.includes('my-project'), 'should include project name');
    assert.ok(md.includes('7.4'), 'should include score');
  });

  it('anti-patterns appear in output when provided', () => {
    const md = buildPrimeMarkdown(
      'proj', 8.0, 'acceptable',
      ['security (3.0)'],
      ['Do not use readline — use @inquirer/prompts', 'Do not skip injection seams'],
      'ESM-only.',
      '2026-04-13',
    );
    assert.ok(md.includes('Do not use readline'), 'anti-pattern 1 should appear');
    assert.ok(md.includes('Do not skip injection seams'), 'anti-pattern 2 should appear');
  });

  it('contains Anti-Patterns section header', () => {
    const md = buildPrimeMarkdown('proj', 7.0, 'needs-work', [], [], 'ESM.', '2026-04-13');
    assert.ok(md.includes('## Anti-Patterns'), 'Anti-Patterns header required');
  });

  it('session date appears in first line', () => {
    const md = buildPrimeMarkdown('proj', 7.0, 'needs-work', [], [], 'ESM.', '2026-04-13');
    const firstLine = md.split('\n')[0];
    assert.ok(firstLine.includes('2026-04-13'), 'date should appear in first line');
  });
});

describe('prime command', () => {
  it('_writeFile captures PRIME.md path and content', async () => {
    let capturedPath = '';
    let capturedContent = '';
    await prime({
      cwd: '/tmp/prime-test',
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => makeState(),
      _indexLessons: async () => makeLessons(),
      _writeFile: async (p, c) => { capturedPath = p; capturedContent = c; },
      _stdout: () => {},
    });
    assert.ok(capturedPath.endsWith('PRIME.md'), `path should end with PRIME.md, got: ${capturedPath}`);
    assert.ok(capturedContent.length > 50, 'content should be non-trivial');
    assert.ok(capturedContent.includes('## Anti-Patterns'), 'content should have Anti-Patterns section');
  });

  it('_indexLessons injection avoids disk read', async () => {
    let indexCalled = false;
    await prime({
      cwd: '/tmp/prime-test',
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => makeState(),
      _indexLessons: async () => { indexCalled = true; return makeLessons(); },
      _writeFile: async () => {},
      _stdout: () => {},
    });
    assert.ok(indexCalled, '_indexLessons should be called');
  });

  it('anti-patterns derived from critical-severity lessons', async () => {
    let capturedContent = '';
    await prime({
      cwd: '/tmp/prime-test',
      _harshScore: async () => makeHarshResult(),
      _loadState: async () => makeState(),
      _indexLessons: async () => [
        { id: 'L1', timestamp: '', category: 'code', severity: 'critical', rule: 'Do not use as any', context: '', tags: [] },
        { id: 'L2', timestamp: '', category: 'code', severity: 'nice-to-know', rule: 'Should use prettier', context: '', tags: [] },
      ],
      _writeFile: async (_, c) => { capturedContent = c; },
      _stdout: () => {},
    });
    assert.ok(capturedContent.includes('Do not use as any'), 'critical lesson rule should appear');
    assert.ok(!capturedContent.includes('Should use prettier'), 'nice-to-know should NOT appear');
  });
});
