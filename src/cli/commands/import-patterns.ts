// Import Patterns — merges an external SharedPatternBundle into the local
// global pattern library. Applies a 0.5x trust discount to external evidence
// since it comes from an unknown project with different quality baselines.
//
// Also absorbs the refused pattern list from the bundle so locally-avoided
// patterns are filtered even when re-encountered from external sources.

import fs from 'node:fs/promises';
import { logger } from '../../core/logger.js';
import {
  loadLibrary,
  saveLibrary,
  type GlobalPatternEntry,
  type PatternLibraryIndex,
} from '../../core/global-pattern-library.js';
import {
  loadRefusedPatterns,
  saveRefusedPatterns,
  isPatternRefused,
  type RefusedPatternsStore,
} from '../../core/refused-patterns.js';
import type { SharedPatternBundle } from './share-patterns.js';
import {
  verifyBundle,
  type BundleTrustOptions,
  type TrustVerificationResult,
} from '../../core/bundle-trust.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ImportPatternsOptions {
  cwd?: string;
  /** Trust multiplier for imported evidence. Default 0.5 (external data is half-trusted). */
  trustFactor?: number;
  /** Bayesian shrinkage / implausibility options forwarded to verifyBundle. */
  bundleTrust?: BundleTrustOptions;
  /** Inject for testing */
  _readBundle?: (filePath: string) => Promise<string>;
  _loadLibrary?: (_fsRead?: (p: string) => Promise<string>) => Promise<PatternLibraryIndex>;
  _saveLibrary?: (lib: PatternLibraryIndex, _fsWrite?: (p: string, d: string) => Promise<void>) => Promise<void>;
  _loadRefused?: (cwd?: string) => Promise<RefusedPatternsStore>;
  _saveRefused?: (store: RefusedPatternsStore, cwd?: string) => Promise<void>;
  _verifyBundle?: (bundle: SharedPatternBundle, library: PatternLibraryIndex, opts?: BundleTrustOptions) => TrustVerificationResult;
}

export interface ImportPatternsResult {
  imported: number;
  updated: number;
  refused: number;
  refusedAbsorbed: number;
  quarantined: number;
  trustScore: number;
}

// ── Main import ───────────────────────────────────────────────────────────────

export async function runImportPatterns(
  bundlePath: string,
  opts: ImportPatternsOptions = {},
): Promise<ImportPatternsResult> {
  const cwd = opts.cwd ?? process.cwd();
  const trustFactor = opts.trustFactor ?? 0.5;

  const readBundle = opts._readBundle ?? ((p: string) => fs.readFile(p, 'utf8'));
  const loadLib = opts._loadLibrary ?? loadLibrary;
  const saveLib = opts._saveLibrary ?? saveLibrary;
  const loadRefused = opts._loadRefused ?? loadRefusedPatterns;
  const saveRefused = opts._saveRefused ?? saveRefusedPatterns;
  const runVerifyBundle = opts._verifyBundle ?? verifyBundle;

  // Parse bundle
  let bundle: SharedPatternBundle;
  try {
    const raw = await readBundle(bundlePath);
    bundle = JSON.parse(raw) as SharedPatternBundle;
  } catch {
    logger.error(`[import-patterns] Cannot read bundle: ${bundlePath}`);
    return { imported: 0, updated: 0, refused: 0, refusedAbsorbed: 0, quarantined: 0, trustScore: 0 };
  }

  const [library, refusedStore] = await Promise.all([
    loadLib(),
    loadRefused(cwd),
  ]);

  // Run Bayesian shrinkage + implausibility quarantine before processing
  const trustResult = runVerifyBundle(bundle, library, opts.bundleTrust);
  if (trustResult.quarantined.length > 0) {
    for (const q of trustResult.quarantined) {
      logger.warn(`[import-patterns] Quarantined: ${q.patternName} (${q.reason}, delta=${q.originalDelta})`);
    }
  }
  logger.info(`[import-patterns] Bundle trust score: ${trustResult.trustScore.toFixed(2)}, shrinkage applied: ${trustResult.shrinkageApplied}`);

  let imported = 0;
  let updated = 0;
  let refused = 0;

  // Only process approved (possibly shrunk) patterns
  for (const pattern of trustResult.approved) {
    // Skip patterns on the refused list
    if (isPatternRefused(pattern.patternName, refusedStore)) {
      refused++;
      logger.info(`[import-patterns] Skipping refused pattern: ${pattern.patternName}`);
      continue;
    }

    // Skip patterns with no positive delta (external evidence of non-value)
    if (pattern.avgScoreDelta <= 0) {
      updated++; // count as "skipped/updated" to keep semantics clear
      continue;
    }

    // Check if pattern already exists in local library
    const existing = library.entries.find(e => e.patternName === pattern.patternName);
    if (existing) {
      // Blend imported evidence: weight by sample count with trust discount
      const importedWeight = pattern.sampleCount * trustFactor;
      const totalWeight = existing.useCount + importedWeight;
      existing.avgRoi = Math.round(
        ((existing.avgRoi * existing.useCount + pattern.avgScoreDelta * importedWeight) / totalWeight) * 1000,
      ) / 1000;
      existing.useCount += Math.max(1, Math.floor(importedWeight));
      updated++;
    } else {
      // New pattern — add with discounted evidence
      const newEntry: GlobalPatternEntry = {
        patternName: pattern.patternName,
        category: deriveCategory(pattern.patternName),
        implementationSnippet: '',
        whyItWorks: `Imported from external bundle (${pattern.sampleCount} sample${pattern.sampleCount !== 1 ? 's' : ''}, avg delta +${pattern.avgScoreDelta.toFixed(2)})`,
        adoptionComplexity: 'medium',
        sourceRepo: pattern.sourceRepo,
        sourceProject: `external:${bundle.sourceProjectHash}`,
        publishedAt: new Date().toISOString(),
        lastValidatedAt: new Date().toISOString(),
        useCount: Math.max(1, Math.floor(pattern.sampleCount * trustFactor)),
        avgRoi: pattern.avgScoreDelta,
        fitness: 'active',
      };
      library.entries.push(newEntry);
      imported++;
    }
  }

  // Absorb refused pattern names from bundle into local refused store
  let refusedAbsorbed = 0;
  for (const refusedName of bundle.refusedPatternNames) {
    if (!isPatternRefused(refusedName, refusedStore)) {
      refusedStore.patterns.push({
        patternName: refusedName,
        sourceRepo: 'imported',
        refusedAt: new Date().toISOString(),
        reason: 'manual',
      });
      refusedAbsorbed++;
    }
  }

  // Persist both stores
  library.updatedAt = new Date().toISOString();
  await Promise.all([
    saveLib(library),
    saveRefused(refusedStore, cwd),
  ]);

  logger.info(`[import-patterns] ${imported} new, ${updated} updated/skipped, ${refused} refused, ${refusedAbsorbed} refused name(s) absorbed, ${trustResult.quarantined.length} quarantined`);

  return { imported, updated, refused, refusedAbsorbed, quarantined: trustResult.quarantined.length, trustScore: trustResult.trustScore };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function deriveCategory(patternName: string): string {
  return patternName.includes('-') ? patternName.split('-')[0] : patternName;
}
