// src/scoring/evidence.ts — Evidence normalization and helpers

import type { EvidenceRecord, EvidenceStrength, EvidenceStatus } from './types.js';

// ── Normalization helpers ─────────────────────────────────────────────────────

export function isWired(e: EvidenceRecord): boolean {
  return e.mainPathWired && (e.status === 'present' || e.status === 'partial');
}

export function isUserVisible(e: EvidenceRecord): boolean {
  return e.userVisible && e.status !== 'missing';
}

export function hasTested(e: EvidenceRecord): boolean {
  return e.tested && e.status !== 'missing';
}

export function hasEndToEnd(e: EvidenceRecord): boolean {
  return e.endToEndProven && e.status !== 'missing';
}

export function hasBenchmark(e: EvidenceRecord): boolean {
  return e.benchmarkBacked && e.status !== 'missing';
}

export function isPresent(e: EvidenceRecord): boolean {
  return e.status === 'present' || e.status === 'partial';
}

// ── Aggregate assessments for a dimension's evidence set ─────────────────────

export interface EvidenceAssessment {
  hasAnyPresent: boolean;
  hasMainPathWired: boolean;
  hasUserVisible: boolean;
  hasTested: boolean;
  hasEndToEnd: boolean;
  hasBenchmark: boolean;
  strongestStrength: EvidenceStrength | null;
  worstStatus: EvidenceStatus;
  presentCount: number;
  totalCount: number;
  refs: string[];
}

export function assessEvidence(records: EvidenceRecord[]): EvidenceAssessment {
  if (records.length === 0) {
    return {
      hasAnyPresent: false,
      hasMainPathWired: false,
      hasUserVisible: false,
      hasTested: false,
      hasEndToEnd: false,
      hasBenchmark: false,
      strongestStrength: null,
      worstStatus: 'unknown',
      presentCount: 0,
      totalCount: 0,
      refs: [],
    };
  }

  const strengthOrder: EvidenceStrength[] = ['weak', 'moderate', 'strong'];
  const statusOrder: EvidenceStatus[] = ['present', 'partial', 'missing', 'unknown'];

  let strongestStrength: EvidenceStrength = 'weak';
  let worstStatusIndex = 0;

  for (const e of records) {
    const sIdx = strengthOrder.indexOf(e.strength);
    if (sIdx > strengthOrder.indexOf(strongestStrength)) strongestStrength = e.strength;
    const wIdx = statusOrder.indexOf(e.status);
    if (wIdx > worstStatusIndex) worstStatusIndex = wIdx;
  }

  return {
    hasAnyPresent: records.some(isPresent),
    hasMainPathWired: records.some(isWired),
    hasUserVisible: records.some(isUserVisible),
    hasTested: records.some(hasTested),
    hasEndToEnd: records.some(hasEndToEnd),
    hasBenchmark: records.some(hasBenchmark),
    strongestStrength,
    worstStatus: statusOrder[worstStatusIndex] ?? 'unknown',
    presentCount: records.filter(isPresent).length,
    totalCount: records.length,
    refs: records.map((e) => e.sourceRef).filter(Boolean),
  };
}

// ── Evidence record validation ────────────────────────────────────────────────

const VALID_EVIDENCE_TYPES = new Set([
  'code', 'test', 'manual_verification', 'benchmark', 'doc', 'external_source',
]);
const VALID_SOURCE_KINDS = new Set(['file', 'test_file', 'command_output', 'web_source', 'note']);
const VALID_STRENGTHS = new Set(['weak', 'moderate', 'strong']);
const VALID_STATUSES = new Set(['present', 'partial', 'missing', 'unknown']);

export function validateEvidenceRecord(raw: unknown): EvidenceRecord {
  if (!raw || typeof raw !== 'object') throw new Error('Evidence record must be an object');
  const r = raw as Record<string, unknown>;

  if (typeof r['dimensionId'] !== 'string') throw new Error('dimensionId required');
  if (!VALID_EVIDENCE_TYPES.has(r['evidenceType'] as string)) throw new Error(`invalid evidenceType: ${r['evidenceType']}`);
  if (!VALID_SOURCE_KINDS.has(r['sourceKind'] as string)) throw new Error(`invalid sourceKind: ${r['sourceKind']}`);
  if (typeof r['sourceRef'] !== 'string') throw new Error('sourceRef required');
  if (typeof r['summary'] !== 'string') throw new Error('summary required');
  if (!VALID_STRENGTHS.has(r['strength'] as string)) throw new Error(`invalid strength: ${r['strength']}`);
  if (!VALID_STATUSES.has(r['status'] as string)) throw new Error(`invalid status: ${r['status']}`);

  return {
    dimensionId: r['dimensionId'] as string,
    evidenceType: r['evidenceType'] as EvidenceRecord['evidenceType'],
    sourceKind: r['sourceKind'] as EvidenceRecord['sourceKind'],
    sourceRef: r['sourceRef'] as string,
    summary: r['summary'] as string,
    strength: r['strength'] as EvidenceStrength,
    status: r['status'] as EvidenceStatus,
    userVisible: Boolean(r['userVisible']),
    mainPathWired: Boolean(r['mainPathWired']),
    tested: Boolean(r['tested']),
    endToEndProven: Boolean(r['endToEndProven']),
    benchmarkBacked: Boolean(r['benchmarkBacked']),
    notes: typeof r['notes'] === 'string' ? r['notes'] : undefined,
  };
}

export function parseEvidenceFile(json: string): EvidenceRecord[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Evidence file must be a JSON array');
  return parsed.map((item, i) => {
    try {
      return validateEvidenceRecord(item);
    } catch (e) {
      throw new Error(`Evidence record ${i}: ${(e as Error).message}`);
    }
  });
}

// ── Score band helpers (for competitor scoring without exact evidence) ─────────

export type ScoreBand = 'insufficient_evidence' | '1-3' | '3-5' | '5-7' | '7-9' | '9-10';

export function toScoreBand(score: number, confidence: string): ScoreBand {
  if (confidence === 'low' || score === 0) return 'insufficient_evidence';
  if (score <= 3) return '1-3';
  if (score <= 5) return '3-5';
  if (score <= 7) return '5-7';
  if (score <= 9) return '7-9';
  return '9-10';
}
