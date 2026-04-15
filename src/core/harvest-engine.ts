// Harvest Engine — Titan Harvest V2 track runner for DanteForge
// Implements the 5-step constitutional harvest framework (Discovery → Constitution → Wiring → Evidence → Ratification)
import crypto from 'node:crypto';
import fs from 'fs/promises';
import path from 'path';
import { logger } from './logger.js';

const HARVEST_DIR = '.danteforge/harvest';

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface HarvestDonor {
  name: string;
  why: string;
  superpowers: string[];
}

export interface HarvestOrgan {
  name: string;
  mandate: string[];
  prohibitions: string[];
  boundaryNote: string;
}

export interface HarvestTrack {
  trackId: string;
  system: string;
  mode: 'full' | 'sep-lite';

  step1Discovery: {
    objective: string;
    donors: HarvestDonor[];
    superpowerClusters: string[];
    organs: HarvestOrgan[];
  };

  step2Constitution: {
    organBehaviors: Record<string, {
      mandates: string[];
      prohibitions: string[];
      states: string[];
      operations: string[];
    }>;
    globalMandates: string[];
    globalProhibitions: string[];
  };

  step3Wiring: {
    signals: { name: string; schema: string; invariants: string }[];
    wiringMap: string;
    dependencyGraph: string;
    spineCompliance: Record<string, boolean>;
  };

  step4Evidence?: {
    evidenceRules: string[];
    testCharters: string[];
    goldenFlows: string[];
  };

  step5Ratification: {
    metacodeCatalog: { patterns: string[]; antiPatterns: string[] };
    gateSheet: Record<string, boolean>;
    expansionReadiness: number;
    reflection: string;
    hash: string;
  };

  summary: {
    trackId: string;
    organs: string[];
    goldenFlows: string[];
    expansionReadiness: number;
  };
}

// ─── Track ID Generation ─────────────────────────────────────────────────────

/**
 * Generate a deterministic, human-readable track ID.
 * Format: "TH-{system-slug}-{YYYYMMDD}-{short-random}"
 */
export function generateTrackId(system: string): string {
  const slug = system
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  const now = new Date();
  const datePart = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');

  const randomPart = crypto.randomBytes(3).toString('hex');

  return `TH-${slug}-${datePart}-${randomPart}`;
}

// ─── Hash Computation ─────────────────────────────────────────────────────────

/**
 * Compute a SHA-256 of the full track document, excluding the hash field inside
 * step5Ratification so that the hash is stable and deterministic.
 */
export function computeTrackHash(track: HarvestTrack): string {
  const hashable: Omit<HarvestTrack, 'step5Ratification'> & {
    step5Ratification: Omit<HarvestTrack['step5Ratification'], 'hash'>;
  } = {
    ...track,
    step5Ratification: {
      metacodeCatalog: track.step5Ratification.metacodeCatalog,
      gateSheet: track.step5Ratification.gateSheet,
      expansionReadiness: track.step5Ratification.expansionReadiness,
      reflection: track.step5Ratification.reflection,
    },
  };

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(hashable), 'utf8')
    .digest('hex');
}

// ─── File I/O ─────────────────────────────────────────────────────────────────

/**
 * Write track.json and summary.json into .danteforge/harvest/{trackId}/.
 * Creates the directory if it does not exist.
 * Returns the absolute paths of both files.
 */
export async function writeTrackFiles(
  track: HarvestTrack,
  cwd?: string,
): Promise<{ trackPath: string; summaryPath: string }> {
  const base = cwd ?? process.cwd();
  const trackDir = path.join(base, HARVEST_DIR, track.trackId);

  const trackPath = path.join(trackDir, 'track.json');
  const summaryPath = path.join(trackDir, 'summary.json');

  try {
    await fs.mkdir(trackDir, { recursive: true });
    await fs.writeFile(trackPath, JSON.stringify(track, null, 2), 'utf8');
    await fs.writeFile(summaryPath, JSON.stringify(track.summary, null, 2), 'utf8');
  } catch (err) {
    throw new Error(
      `Failed to write track files to "${trackDir}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  logger.success(`Track written: ${trackDir}`);
  return { trackPath, summaryPath };
}

/**
 * Count the number of completed track directories in .danteforge/harvest/.
 * Returns 0 if the harvest directory does not yet exist.
 */
export async function loadTrackCount(cwd?: string): Promise<number> {
  const base = cwd ?? process.cwd();
  const harvestDir = path.join(base, HARVEST_DIR);

  try {
    const entries = await fs.readdir(harvestDir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).length;
  } catch (err) {
    if (err instanceof Error && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return 0;
    }
    throw err;
  }
}

// ─── Meta-Evolution Trigger ────────────────────────────────────────────────────

/**
 * Return true when the track count is a positive non-zero multiple of 5.
 * Every 5 tracks the framework should run a meta-track on Titan Harvest itself.
 */
export function shouldTriggerMetaEvolution(trackCount: number): boolean {
  return trackCount > 0 && trackCount % 5 === 0;
}

// ─── Empty Track Factory ──────────────────────────────────────────────────────

/**
 * Create a new HarvestTrack with all required fields initialized to empty
 * defaults. The caller fills in each step after creating the shell.
 */
export function createEmptyTrack(system: string, mode: 'full' | 'sep-lite'): HarvestTrack {
  const trackId = generateTrackId(system);

  const track: HarvestTrack = {
    trackId,
    system,
    mode,

    step1Discovery: {
      objective: '',
      donors: [],
      superpowerClusters: [],
      organs: [],
    },

    step2Constitution: {
      organBehaviors: {},
      globalMandates: [],
      globalProhibitions: [],
    },

    step3Wiring: {
      signals: [],
      wiringMap: '',
      dependencyGraph: '',
      spineCompliance: {
        apiEnvelope: false,
        eventEnvelope: false,
        idTimeRules: false,
        rbac: false,
        auditFields: false,
      },
    },

    step5Ratification: {
      metacodeCatalog: {
        patterns: [],
        antiPatterns: [],
      },
      gateSheet: {},
      expansionReadiness: 0,
      reflection: '',
      hash: '',
    },

    summary: {
      trackId,
      organs: [],
      goldenFlows: [],
      expansionReadiness: 0,
    },
  };

  // step4Evidence is only present in full mode
  if (mode === 'full') {
    track.step4Evidence = {
      evidenceRules: [],
      testCharters: [],
      goldenFlows: [],
    };
  }

  return track;
}
