// tests/dossier-rubric.test.ts — Tests for src/dossier/rubric.ts

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getRubric, getDimCriteria, validateFrozenAt, getDimCount } from '../src/dossier/rubric.js';
import type { Rubric } from '../src/dossier/types.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRubric(overrides: Partial<Rubric> = {}): Rubric {
  return {
    version: 1,
    frozenAt: '2026-04-20',
    dimensions: {
      '1': {
        name: 'Ghost text completions',
        scoreCriteria: {
          '9': ['Sub-100ms P50 TTFB'],
          '7': ['Inline completions present'],
          '5': ['Single-token completions only'],
          '3': ['Manual trigger only'],
          '1': ['No inline completion'],
        },
      },
      '2': {
        name: 'Chat interface',
        scoreCriteria: {
          '9': ['Dedicated chat panel'],
          '7': ['Chat present'],
          '5': ['Basic chat'],
          '3': ['CLI only'],
          '1': ['No chat'],
        },
      },
    },
    ...overrides,
  };
}

function makeReadFileFn(content: string) {
  return async (_p: string, _enc: BufferEncoding): Promise<string> => content;
}

function makeFailingReadFile() {
  return async (_p: string, _enc: BufferEncoding): Promise<string> => {
    throw new Error('ENOENT: file not found');
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('getRubric()', () => {
  it('loads and parses valid rubric JSON', async () => {
    const rubric = makeRubric();
    const readFile = makeReadFileFn(JSON.stringify(rubric));
    const result = await getRubric('/fake/cwd', readFile);
    assert.equal(result.version, 1);
    assert.equal(result.frozenAt, '2026-04-20');
    assert.ok(result.dimensions['1']);
  });

  it('throws helpful error when file not found', async () => {
    const readFile = makeFailingReadFile();
    await assert.rejects(
      () => getRubric('/fake/cwd', readFile),
      (err: Error) => {
        assert.ok(err.message.includes('danteforge rubric init'));
        return true;
      },
    );
  });

  it('throws when JSON is malformed', async () => {
    const readFile = makeReadFileFn('{ not valid json }');
    await assert.rejects(
      () => getRubric('/fake/cwd', readFile),
      (err: Error) => {
        assert.ok(err.message.includes('not valid JSON'));
        return true;
      },
    );
  });
});

describe('getDimCriteria()', () => {
  it('returns dim definition for valid key', () => {
    const rubric = makeRubric();
    const dim = getDimCriteria(rubric, 1);
    assert.ok(dim !== undefined);
    assert.equal(dim.name, 'Ghost text completions');
  });

  it('returns undefined for missing dim', () => {
    const rubric = makeRubric();
    const dim = getDimCriteria(rubric, 99);
    assert.equal(dim, undefined);
  });

  it('returns criteria for dim 2', () => {
    const rubric = makeRubric();
    const dim = getDimCriteria(rubric, 2);
    assert.ok(dim !== undefined);
    assert.deepEqual(dim.scoreCriteria['9'], ['Dedicated chat panel']);
  });
});

describe('validateFrozenAt()', () => {
  it('does nothing when no existing rubric', () => {
    const rubric = makeRubric();
    assert.doesNotThrow(() => validateFrozenAt(rubric, undefined));
  });

  it('does nothing when versions differ (version bump allowed)', () => {
    const existing = makeRubric({ version: 1 });
    const updated = makeRubric({ version: 2 });
    assert.doesNotThrow(() => validateFrozenAt(updated, existing));
  });

  it('throws when criteria for existing dim is changed', () => {
    const existing = makeRubric();
    const updated: Rubric = {
      ...existing,
      dimensions: {
        ...existing.dimensions,
        '1': {
          ...existing.dimensions['1']!,
          scoreCriteria: {
            ...existing.dimensions['1']!.scoreCriteria,
            '9': ['CHANGED criteria'], // changed!
          },
        },
      },
    };
    assert.throws(
      () => validateFrozenAt(updated, existing),
      (err: Error) => {
        assert.ok(err.message.includes('frozen'));
        assert.ok(err.message.includes('dim 1'));
        return true;
      },
    );
  });

  it('does not throw when adding a new dim to existing rubric', () => {
    const existing = makeRubric();
    const updated: Rubric = {
      ...existing,
      dimensions: {
        ...existing.dimensions,
        '99': {
          name: 'New dimension',
          scoreCriteria: { '9': ['a'], '7': ['b'], '5': ['c'], '3': ['d'], '1': ['e'] },
        },
      },
    };
    assert.doesNotThrow(() => validateFrozenAt(updated, existing));
  });
});

describe('getDimCount()', () => {
  it('returns correct count', () => {
    const rubric = makeRubric();
    assert.equal(getDimCount(rubric), 2);
  });
});
