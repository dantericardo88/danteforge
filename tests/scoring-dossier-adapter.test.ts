// tests/scoring-dossier-adapter.test.ts — Dossier → EvidenceRecord adapter tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dossierToEvidence,
  dossiersToEvidence,
  dimKeyToId,
  inferStrength,
  inferStatus,
} from '../src/scoring/dossier-adapter.js';
import type { Dossier, DossierDimension, EvidenceItem } from '../src/dossier/types.js';

function makeDim(overrides: Partial<DossierDimension> = {}): DossierDimension {
  return {
    score: 7,
    scoreJustification: 'Strong evidence of feature',
    evidence: [],
    humanOverride: null,
    humanOverrideReason: null,
    unverified: false,
    ...overrides,
  };
}

function makeItem(overrides: Partial<EvidenceItem> = {}): EvidenceItem {
  return {
    claim: 'Feature X is implemented',
    quote: 'Here is the verbatim quote from the source',
    source: 'https://example.com/docs',
    dim: 1,
    ...overrides,
  };
}

function makeDossier(overrides: Partial<Dossier> = {}): Dossier {
  return {
    competitor: 'cursor',
    displayName: 'Cursor',
    type: 'closed-source',
    lastBuilt: '2026-04-20T00:00:00Z',
    sources: [],
    dimensions: {
      '1': makeDim({ score: 8, evidence: [makeItem({ dim: 1 })] }),
      '2': makeDim({ score: 3, evidence: [] }),
    },
    composite: 5.5,
    compositeMethod: 'mean_28_dims',
    rubricVersion: 1,
    ...overrides,
  };
}

// ── dimKeyToId() ──────────────────────────────────────────────────────────────

describe('dimKeyToId()', () => {
  it('maps "1" to ghost_text_fim', () => {
    assert.equal(dimKeyToId('1'), 'ghost_text_fim');
  });

  it('maps "2" to chat_ux', () => {
    assert.equal(dimKeyToId('2'), 'chat_ux');
  });

  it('maps "28" to reliability (last dimension)', () => {
    assert.equal(dimKeyToId('28'), 'reliability');
  });

  it('returns undefined for out-of-range key', () => {
    assert.equal(dimKeyToId('99'), undefined);
  });

  it('returns undefined for "0"', () => {
    assert.equal(dimKeyToId('0'), undefined);
  });
});

// ── inferStrength() ───────────────────────────────────────────────────────────

describe('inferStrength()', () => {
  it('returns strong for score >= 7', () => {
    assert.equal(inferStrength(makeDim({ score: 7 })), 'strong');
    assert.equal(inferStrength(makeDim({ score: 10 })), 'strong');
  });

  it('returns moderate for score 4-6', () => {
    assert.equal(inferStrength(makeDim({ score: 4 })), 'moderate');
    assert.equal(inferStrength(makeDim({ score: 6 })), 'moderate');
  });

  it('returns weak for score < 4', () => {
    assert.equal(inferStrength(makeDim({ score: 1 })), 'weak');
    assert.equal(inferStrength(makeDim({ score: 3 })), 'weak');
  });

  it('uses humanOverride when set', () => {
    const dim = makeDim({ score: 2, humanOverride: 9 });
    assert.equal(inferStrength(dim), 'strong');
  });
});

// ── inferStatus() ─────────────────────────────────────────────────────────────

describe('inferStatus()', () => {
  it('returns present when item has quote', () => {
    const item = makeItem({ quote: 'verbatim' });
    assert.equal(inferStatus(makeDim(), item), 'present');
  });

  it('returns partial when item has empty quote', () => {
    const item = makeItem({ quote: '' });
    assert.equal(inferStatus(makeDim(), item), 'partial');
  });

  it('returns partial when dim is unverified', () => {
    assert.equal(inferStatus(makeDim({ unverified: true })), 'partial');
  });

  it('returns present for verified dim with no item arg', () => {
    assert.equal(inferStatus(makeDim({ unverified: false })), 'present');
  });
});

// ── dossierToEvidence() ───────────────────────────────────────────────────────

describe('dossierToEvidence()', () => {
  it('produces one record per evidence item when items exist', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ score: 8, evidence: [makeItem(), makeItem({ claim: 'Another claim' })] }),
      },
    });
    const records = dossierToEvidence(dossier);
    assert.equal(records.length, 2);
    assert.equal(records[0]!.dimensionId, 'ghost_text_fim');
    assert.equal(records[1]!.dimensionId, 'ghost_text_fim');
  });

  it('produces one summary record when no evidence items', () => {
    const dossier = makeDossier({
      dimensions: {
        '2': makeDim({ score: 5, evidence: [], scoreJustification: 'Chat UX is basic' }),
      },
    });
    const records = dossierToEvidence(dossier);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.dimensionId, 'chat_ux');
    assert.equal(records[0]!.summary, 'Chat UX is basic');
    assert.equal(records[0]!.sourceRef, 'dossier:chat_ux');
  });

  it('sets mainPathWired true for score >= 5', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ score: 5, evidence: [makeItem()] }),
      },
    });
    const [rec] = dossierToEvidence(dossier);
    assert.equal(rec!.mainPathWired, true);
  });

  it('sets mainPathWired false for score < 5', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ score: 4, evidence: [makeItem()] }),
      },
    });
    const [rec] = dossierToEvidence(dossier);
    assert.equal(rec!.mainPathWired, false);
  });

  it('sets endToEndProven true for score >= 8', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ score: 8, evidence: [makeItem()] }),
      },
    });
    const [rec] = dossierToEvidence(dossier);
    assert.equal(rec!.endToEndProven, true);
  });

  it('sets endToEndProven false for score < 8', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ score: 7, evidence: [makeItem()] }),
      },
    });
    const [rec] = dossierToEvidence(dossier);
    assert.equal(rec!.endToEndProven, false);
  });

  it('skips unknown dim keys', () => {
    const dossier = makeDossier({
      dimensions: {
        '99': makeDim({ evidence: [makeItem()] }),
      },
    });
    const records = dossierToEvidence(dossier);
    assert.equal(records.length, 0);
  });

  it('uses web_source for http sources', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ evidence: [makeItem({ source: 'https://cursor.sh/features' })] }),
      },
    });
    const [rec] = dossierToEvidence(dossier);
    assert.equal(rec!.sourceKind, 'web_source');
  });

  it('uses file for non-http sources', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ evidence: [makeItem({ source: 'src/core/index.ts#setup' })] }),
      },
    });
    const [rec] = dossierToEvidence(dossier);
    assert.equal(rec!.sourceKind, 'file');
  });

  it('sets notes to quote when quote is non-empty', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ evidence: [makeItem({ quote: 'verbatim text here' })] }),
      },
    });
    const [rec] = dossierToEvidence(dossier);
    assert.equal(rec!.notes, 'verbatim text here');
  });

  it('sets evidenceType to external_source', () => {
    const dossier = makeDossier({
      dimensions: {
        '1': makeDim({ evidence: [makeItem()] }),
      },
    });
    const [rec] = dossierToEvidence(dossier);
    assert.equal(rec!.evidenceType, 'external_source');
  });

  it('handles all 28 dimensions when present', () => {
    const dimensions: Record<string, DossierDimension> = {};
    for (let i = 1; i <= 28; i++) {
      dimensions[String(i)] = makeDim({ score: 5, evidence: [makeItem({ dim: i })] });
    }
    const dossier = makeDossier({ dimensions });
    const records = dossierToEvidence(dossier);
    assert.equal(records.length, 28);
    const dimIds = new Set(records.map((r) => r.dimensionId));
    assert.equal(dimIds.size, 28);
  });
});

// ── dossiersToEvidence() ──────────────────────────────────────────────────────

describe('dossiersToEvidence()', () => {
  it('combines records from multiple dossiers', () => {
    const d1 = makeDossier({
      competitor: 'cursor',
      dimensions: { '1': makeDim({ evidence: [makeItem()] }) },
    });
    const d2 = makeDossier({
      competitor: 'copilot',
      dimensions: { '1': makeDim({ evidence: [makeItem({ claim: 'Copilot evidence' })] }) },
    });
    const records = dossiersToEvidence([d1, d2]);
    assert.equal(records.length, 2);
    assert.equal(records.every((r) => r.dimensionId === 'ghost_text_fim'), true);
  });

  it('returns empty array for empty dossier list', () => {
    assert.deepEqual(dossiersToEvidence([]), []);
  });
});

// ── Auto-bootstrap integration via rubricScore ────────────────────────────────

describe('rubricScore() auto-bootstrap', () => {
  it('uses dossier evidence when no --evidence flag and dossiers exist', async () => {
    const { rubricScore } = await import('../src/cli/commands/score-rubric.js');

    const fakeDossier = makeDossier({
      dimensions: {
        '1': makeDim({ score: 8, evidence: [makeItem()] }),
      },
    });

    const emitted: string[] = [];
    const written: Record<string, string> = {};

    await rubricScore({
      subject: 'AutoBootstrapTest',
      _loadDossiers: async () => [fakeDossier],
      _readFile: async () => { throw new Error('no file'); },
      _writeFile: async (p, d) => { written[p] = d; },
      _mkdir: async () => {},
      _emit: (msg) => emitted.push(msg),
    });

    assert.ok(emitted.some((m) => m.includes('Auto-bootstrapped')));
    assert.ok(emitted.some((m) => m.includes('cursor')));
  });

  it('emits no-dossier warning when dossier list is empty', async () => {
    const { rubricScore } = await import('../src/cli/commands/score-rubric.js');

    const emitted: string[] = [];

    await rubricScore({
      subject: 'EmptyBootstrapTest',
      _loadDossiers: async () => [],
      _readFile: async () => { throw new Error('no file'); },
      _writeFile: async () => {},
      _mkdir: async () => {},
      _emit: (msg) => emitted.push(msg),
    });

    assert.ok(emitted.some((m) => m.includes('No dossiers found')));
  });

  it('falls back gracefully when dossier loader throws', async () => {
    const { rubricScore } = await import('../src/cli/commands/score-rubric.js');

    const emitted: string[] = [];

    await rubricScore({
      subject: 'FailedBootstrapTest',
      _loadDossiers: async () => { throw new Error('registry missing'); },
      _readFile: async () => { throw new Error('no file'); },
      _writeFile: async () => {},
      _mkdir: async () => {},
      _emit: (msg) => emitted.push(msg),
    });

    assert.ok(emitted.some((m) => m.toLowerCase().includes('warning')));
  });
});
