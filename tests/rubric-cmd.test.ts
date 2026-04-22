import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { rubricShow, rubricValidate, rubricInit, rubricAddDim } from '../src/cli/commands/rubric-cmd.js';
import type { Rubric } from '../src/dossier/types.js';

function makeRubric(overrides: Partial<Rubric> = {}): Rubric {
  return {
    version: 1,
    frozenAt: '2026-01-01T00:00:00.000Z',
    dimensions: {
      '1': { name: 'Functionality', description: 'Core functionality', criteria: [], weight: 1.0 },
      '2': { name: 'Testing', description: 'Test coverage', criteria: [], weight: 1.0 },
    },
    ...overrides,
  };
}

const fakeDossier = {
  competitor: 'test',
  displayName: 'Test Tool',
  type: 'open-source' as const,
  lastBuilt: '2026-01-01T00:00:00.000Z',
  sources: [],
  dimensions: {
    '1': { score: 8, scoreJustification: 'good', evidence: [], humanOverride: null, humanOverrideReason: null, unverified: false },
    '2': { score: 7, scoreJustification: 'ok', evidence: [], humanOverride: null, humanOverrideReason: null, unverified: false },
  },
  composite: 7.5,
  compositeMethod: 'mean_28_dims',
  rubricVersion: 1,
};

describe('rubricShow', () => {
  it('does not throw when rubric exists', async () => {
    await assert.doesNotReject(() =>
      rubricShow({ _getRubric: async () => makeRubric() })
    );
  });

  it('does not throw for unknown dimension', async () => {
    await assert.doesNotReject(() =>
      rubricShow({ dim: '999', _getRubric: async () => makeRubric() })
    );
  });

  it('does not throw for valid dimension', async () => {
    await assert.doesNotReject(() =>
      rubricShow({ dim: '1', _getRubric: async () => makeRubric() })
    );
  });
});

describe('rubricValidate', () => {
  it('does not throw when no dossiers found', async () => {
    await assert.doesNotReject(() =>
      rubricValidate({
        _getRubric: async () => makeRubric(),
        _listDossiers: async () => [],
      })
    );
  });

  it('does not throw when dossiers fully verified', async () => {
    await assert.doesNotReject(() =>
      rubricValidate({
        _getRubric: async () => makeRubric(),
        _listDossiers: async () => [fakeDossier as any],
      })
    );
  });

  it('does not throw when dossier has unverified dimensions', async () => {
    const unverifiedDossier = {
      ...fakeDossier,
      dimensions: {
        ...fakeDossier.dimensions,
        '1': { ...fakeDossier.dimensions['1'], unverified: true },
      },
    };
    await assert.doesNotReject(() =>
      rubricValidate({
        _getRubric: async () => makeRubric(),
        _listDossiers: async () => [unverifiedDossier as any],
      })
    );
  });
});

describe('rubricInit', () => {
  it('does not throw when rubric already exists', async () => {
    await assert.doesNotReject(() =>
      rubricInit({
        _getRubric: async () => makeRubric(),
        _ensureRubricScaffold: async () => {},
      })
    );
  });

  it('does not throw when rubric does not exist (scaffold created)', async () => {
    await assert.doesNotReject(() =>
      rubricInit({
        _getRubric: async () => { throw new Error('not found'); },
        _ensureRubricScaffold: async () => {},
      })
    );
  });
});

describe('rubricAddDim', () => {
  it('does not throw when adding a new dimension', async () => {
    let savedRubric: Rubric | null = null;
    await assert.doesNotReject(() =>
      rubricAddDim({
        name: 'New Dimension',
        _getRubric: async () => makeRubric(),
        _saveRubric: async (_cwd, rubric) => { savedRubric = rubric; },
      })
    );
  });

  it('does not throw when no name provided', async () => {
    await assert.doesNotReject(() =>
      rubricAddDim({
        _getRubric: async () => makeRubric(),
        _saveRubric: async () => {},
      })
    );
  });
});
