// tests/scoring-evidence.test.ts — Evidence normalization and validation tests

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assessEvidence,
  validateEvidenceRecord,
  parseEvidenceFile,
  isWired,
  isUserVisible,
  hasTested,
  hasEndToEnd,
  hasBenchmark,
  toScoreBand,
} from '../src/scoring/evidence.js';
import type { EvidenceRecord } from '../src/scoring/types.js';

function makeRecord(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    dimensionId: 'security',
    evidenceType: 'code',
    sourceKind: 'file',
    sourceRef: 'src/core/security.ts',
    summary: 'Security present',
    strength: 'moderate',
    status: 'present',
    userVisible: true,
    mainPathWired: true,
    tested: true,
    endToEndProven: false,
    benchmarkBacked: false,
    ...overrides,
  };
}

// ── assessEvidence() ──────────────────────────────────────────────────────────

describe('assessEvidence()', () => {
  it('returns all-false for empty array', () => {
    const a = assessEvidence([]);
    assert.equal(a.hasAnyPresent, false);
    assert.equal(a.hasMainPathWired, false);
    assert.equal(a.totalCount, 0);
    assert.equal(a.strongestStrength, null);
  });

  it('detects main-path wired', () => {
    const a = assessEvidence([makeRecord({ mainPathWired: true, status: 'present' })]);
    assert.equal(a.hasMainPathWired, true);
  });

  it('does not flag wired when status is missing', () => {
    const a = assessEvidence([makeRecord({ mainPathWired: true, status: 'missing' })]);
    assert.equal(a.hasMainPathWired, false);
  });

  it('detects end-to-end proven', () => {
    const a = assessEvidence([makeRecord({ endToEndProven: true })]);
    assert.equal(a.hasEndToEnd, true);
  });

  it('detects benchmark backed', () => {
    const a = assessEvidence([makeRecord({ benchmarkBacked: true })]);
    assert.equal(a.hasBenchmark, true);
  });

  it('picks strongest strength across records', () => {
    const a = assessEvidence([
      makeRecord({ strength: 'weak' }),
      makeRecord({ strength: 'strong' }),
    ]);
    assert.equal(a.strongestStrength, 'strong');
  });

  it('counts present records correctly', () => {
    const a = assessEvidence([
      makeRecord({ status: 'present' }),
      makeRecord({ status: 'missing' }),
      makeRecord({ status: 'partial' }),
    ]);
    assert.equal(a.presentCount, 2); // present + partial
    assert.equal(a.totalCount, 3);
  });

  it('collects sourceRefs', () => {
    const a = assessEvidence([
      makeRecord({ sourceRef: 'src/a.ts' }),
      makeRecord({ sourceRef: 'src/b.ts' }),
    ]);
    assert.ok(a.refs.includes('src/a.ts'));
    assert.ok(a.refs.includes('src/b.ts'));
  });
});

// ── Helper predicates ─────────────────────────────────────────────────────────

describe('evidence predicates', () => {
  it('isWired returns false when status is missing', () => {
    assert.equal(isWired(makeRecord({ mainPathWired: true, status: 'missing' })), false);
  });

  it('isWired returns true when wired and present', () => {
    assert.equal(isWired(makeRecord({ mainPathWired: true, status: 'present' })), true);
  });

  it('isUserVisible returns false when status missing', () => {
    assert.equal(isUserVisible(makeRecord({ userVisible: true, status: 'missing' })), false);
  });

  it('hasTested returns false when status missing', () => {
    assert.equal(hasTested(makeRecord({ tested: true, status: 'missing' })), false);
  });

  it('hasEndToEnd returns true when proven and not missing', () => {
    assert.equal(hasEndToEnd(makeRecord({ endToEndProven: true, status: 'partial' })), true);
  });

  it('hasBenchmark returns true when backed and present', () => {
    assert.equal(hasBenchmark(makeRecord({ benchmarkBacked: true, status: 'present' })), true);
  });
});

// ── validateEvidenceRecord() ──────────────────────────────────────────────────

describe('validateEvidenceRecord()', () => {
  it('accepts valid record', () => {
    const raw = makeRecord();
    const result = validateEvidenceRecord(raw);
    assert.equal(result.dimensionId, 'security');
    assert.equal(result.evidenceType, 'code');
  });

  it('throws on missing dimensionId', () => {
    assert.throws(
      () => validateEvidenceRecord({ ...makeRecord(), dimensionId: undefined }),
      /dimensionId required/,
    );
  });

  it('throws on invalid evidenceType', () => {
    assert.throws(
      () => validateEvidenceRecord({ ...makeRecord(), evidenceType: 'invalid' }),
      /invalid evidenceType/,
    );
  });

  it('throws on invalid strength', () => {
    assert.throws(
      () => validateEvidenceRecord({ ...makeRecord(), strength: 'very_strong' }),
      /invalid strength/,
    );
  });

  it('throws on invalid status', () => {
    assert.throws(
      () => validateEvidenceRecord({ ...makeRecord(), status: 'maybe' }),
      /invalid status/,
    );
  });

  it('coerces boolean-like values', () => {
    const r = validateEvidenceRecord({ ...makeRecord(), userVisible: 1 as unknown as boolean });
    assert.equal(r.userVisible, true);
  });
});

// ── parseEvidenceFile() ───────────────────────────────────────────────────────

describe('parseEvidenceFile()', () => {
  it('parses a valid JSON array', () => {
    const json = JSON.stringify([makeRecord()]);
    const records = parseEvidenceFile(json);
    assert.equal(records.length, 1);
    assert.equal(records[0]!.dimensionId, 'security');
  });

  it('throws on non-array JSON', () => {
    assert.throws(() => parseEvidenceFile('{"foo":"bar"}'), /JSON array/);
  });

  it('throws with record index on invalid item', () => {
    const json = JSON.stringify([makeRecord(), { bad: true }]);
    assert.throws(() => parseEvidenceFile(json), /Evidence record 1/);
  });

  it('returns empty array for []', () => {
    const records = parseEvidenceFile('[]');
    assert.deepEqual(records, []);
  });
});

// ── toScoreBand() ─────────────────────────────────────────────────────────────

describe('toScoreBand()', () => {
  it('returns insufficient_evidence for low confidence', () => {
    assert.equal(toScoreBand(8, 'low'), 'insufficient_evidence');
  });

  it('returns correct band for score 3.5', () => {
    assert.equal(toScoreBand(3.5, 'high'), '3-5');
  });

  it('returns 9-10 for score 10', () => {
    assert.equal(toScoreBand(10, 'high'), '9-10');
  });

  it('returns insufficient_evidence for score 0', () => {
    assert.equal(toScoreBand(0, 'high'), 'insufficient_evidence');
  });
});
