// src/scoring/dossier-adapter.ts — Converts Dossier evidence → EvidenceRecord[]

import { DIMENSIONS_28 } from './dimensions.js';
import type { EvidenceRecord, EvidenceStrength, EvidenceStatus } from './types.js';
import type { Dossier, DossierDimension, EvidenceItem } from '../dossier/types.js';

// Dimension number (1-based) → scoring dimension id
// DIMENSIONS_28 is ordered 1-28; dim key "1" maps to index 0.
function dimKeyToId(dimKey: string): string | undefined {
  const idx = parseInt(dimKey, 10) - 1;
  return DIMENSIONS_28[idx]?.id;
}

function inferStrength(dim: DossierDimension): EvidenceStrength {
  const score = dim.humanOverride ?? dim.score;
  if (score >= 7) return 'strong';
  if (score >= 4) return 'moderate';
  return 'weak';
}

function inferStatus(dim: DossierDimension, item?: EvidenceItem): EvidenceStatus {
  if (item && (!item.quote || item.quote.trim() === '')) return 'partial';
  if (dim.unverified) return 'partial';
  return 'present';
}

function itemToRecord(
  item: EvidenceItem,
  dimId: string,
  dim: DossierDimension,
): EvidenceRecord {
  const score = dim.humanOverride ?? dim.score;
  return {
    dimensionId: dimId,
    evidenceType: 'external_source',
    sourceKind: item.source.startsWith('http') ? 'web_source' : 'file',
    sourceRef: item.source,
    summary: item.claim,
    strength: inferStrength(dim),
    status: inferStatus(dim, item),
    userVisible: true,
    mainPathWired: score >= 5,
    tested: false,
    endToEndProven: score >= 8,
    benchmarkBacked: false,
    notes: item.quote || undefined,
  };
}

function dimToRecord(dimId: string, dim: DossierDimension): EvidenceRecord {
  const score = dim.humanOverride ?? dim.score;
  return {
    dimensionId: dimId,
    evidenceType: 'external_source',
    sourceKind: 'note',
    sourceRef: `dossier:${dimId}`,
    summary: dim.scoreJustification,
    strength: inferStrength(dim),
    status: dim.unverified ? 'partial' : 'present',
    userVisible: true,
    mainPathWired: score >= 5,
    tested: false,
    endToEndProven: score >= 8,
    benchmarkBacked: false,
  };
}

/**
 * Convert a single Dossier into EvidenceRecord[] for use in rubric scoring.
 * Each EvidenceItem becomes one record; dimensions without items emit one
 * summary record derived from scoreJustification.
 */
export function dossierToEvidence(dossier: Dossier): EvidenceRecord[] {
  const records: EvidenceRecord[] = [];

  for (const [dimKey, dim] of Object.entries(dossier.dimensions)) {
    const dimId = dimKeyToId(dimKey);
    if (!dimId) continue; // skip unknown dim keys

    if (dim.evidence.length > 0) {
      for (const item of dim.evidence) {
        records.push(itemToRecord(item, dimId, dim));
      }
    } else {
      // Emit a single summary record when no verbatim evidence items exist
      records.push(dimToRecord(dimId, dim));
    }
  }

  return records;
}

/**
 * Convert multiple dossiers into a combined EvidenceRecord[].
 * Records from different competitors share dimensionId — the rubric engine
 * will aggregate across all of them to produce the strongest assessment.
 */
export function dossiersToEvidence(dossiers: Dossier[]): EvidenceRecord[] {
  return dossiers.flatMap(dossierToEvidence);
}

// Exported for testing
export { dimKeyToId, inferStrength, inferStatus };
