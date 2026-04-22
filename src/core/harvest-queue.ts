// Harvest Queue — persistent priority queue for compounding OSS intelligence
// Stored at .danteforge/harvest-queue.json — only updated, never overwritten.

import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HarvestRepo {
  /** Full GitHub/GitLab URL */
  url: string;
  /** Normalised slug, e.g. "express" */
  slug: string;
  /** Priority 1-10, recomputed each cycle. Higher = harvest sooner. */
  priority: number;
  /** Which gap dimensions this repo addresses */
  gapTargets: string[];
  /** Lifecycle status */
  status: 'queued' | 'shallow' | 'deep' | 'exhausted';
  /** ISO timestamp when added */
  addedAt: string;
  /** ISO timestamp of last harvest run */
  lastHarvestedAt?: string;
  /** How many patterns were extracted from this repo */
  patternsExtracted: number;
  /** How many of those patterns were adopted into the codebase */
  patternsAdopted: number;
  /** Git SHA of the last commit in the source repo at time of harvest (for freshness tracking) */
  lastSourceCommit?: string;
  /**
   * Days after which this repo should be re-harvested.
   * Default 90. Set lower for fast-moving repos.
   */
  staleAfterDays?: number;
  /**
   * Days since last harvest (computed at read time for display / freshness logging).
   * Stored so consumers can display "repo is 14d old" without recomputing.
   */
  freshnessDays?: number;
}

export interface HarvestGap {
  /** Scoring dimension name, e.g. "circuit-breaker-reliability" */
  dimension: string;
  /** Current evidence-based score (0-10) */
  currentScore: number;
  /** Target score (default 9.0) */
  targetScore: number;
  /** URL of the repo best suited to close this gap */
  bestRepoForGap?: string;
  /** Total patterns identified that address this gap */
  patternsAvailable: number;
  /** How many of those patterns have been adopted */
  patternsAdopted: number;
}

export interface HarvestQueue {
  version: '1.0.0';
  repos: HarvestRepo[];
  gaps: HarvestGap[];
  /** Total number of harvest cycles completed */
  harvestCycles: number;
  /** Running total of patterns extracted across all repos */
  totalPatternsExtracted: number;
  /** Running total of patterns adopted into the codebase */
  totalPatternsAdopted: number;
  /** ISO timestamp of last save */
  updatedAt: string;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

const QUEUE_FILENAME = 'harvest-queue.json';

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

// ── Load / Save ───────────────────────────────────────────────────────────────

/** Load the harvest queue. Returns a fresh empty queue if the file does not exist or is corrupted. */
export async function loadHarvestQueue(cwd?: string): Promise<HarvestQueue> {
  const queuePath = path.join(getDanteforgeDir(cwd), QUEUE_FILENAME);
  try {
    const raw = await fs.readFile(queuePath, 'utf8');
    return JSON.parse(raw) as HarvestQueue;
  } catch {
    return emptyQueue();
  }
}

/** Persist the harvest queue. Automatically updates `updatedAt` and increments `harvestCycles`. */
export async function saveHarvestQueue(queue: HarvestQueue, cwd?: string): Promise<void> {
  const danteforgeDir = getDanteforgeDir(cwd);
  const queuePath = path.join(danteforgeDir, QUEUE_FILENAME);
  const toSave: HarvestQueue = {
    ...queue,
    harvestCycles: queue.harvestCycles + 1,
    updatedAt: new Date().toISOString(),
  };
  try {
    await fs.mkdir(danteforgeDir, { recursive: true });
    await fs.writeFile(queuePath, JSON.stringify(toSave, null, 2), 'utf8');
  } catch {
    // best-effort — failure is non-fatal
  }
}

// ── Mutation helpers (pure — return new queue, do not mutate in-place) ─────────

/**
 * Add a repo to the queue. Deduplicates by URL (case-insensitive).
 * Defaults `patternsExtracted` and `patternsAdopted` to 0.
 */
export function addToQueue(
  queue: HarvestQueue,
  repo: Omit<HarvestRepo, 'addedAt' | 'patternsExtracted' | 'patternsAdopted'>,
): HarvestQueue {
  const normalize = (u: string) => u.toLowerCase().replace(/\/+$/, '');
  const existing = queue.repos.some(r => normalize(r.url) === normalize(repo.url));
  if (existing) return queue;
  return {
    ...queue,
    repos: [
      ...queue.repos,
      {
        ...repo,
        addedAt: new Date().toISOString(),
        patternsExtracted: 0,
        patternsAdopted: 0,
      },
    ],
  };
}

/**
 * Pop the highest-priority non-exhausted repo from the queue.
 * Returns [null, unchanged-queue] when no eligible repos remain.
 */
export function popHighestPriority(queue: HarvestQueue): [HarvestRepo | null, HarvestQueue] {
  const eligible = queue.repos.filter(r => r.status !== 'exhausted');
  if (eligible.length === 0) return [null, queue];

  const sorted = [...eligible].sort((a, b) => b.priority - a.priority);
  const top = sorted[0]!;
  return [
    top,
    {
      ...queue,
      repos: queue.repos.map(r =>
        r.url === top.url
          ? { ...r, status: 'deep' as const, lastHarvestedAt: new Date().toISOString() }
          : r,
      ),
    },
  ];
}

/**
 * Update a repo's lifecycle status without touching other fields.
 */
export function markRepoStatus(
  queue: HarvestQueue,
  url: string,
  status: HarvestRepo['status'],
): HarvestQueue {
  const normalize = (u: string) => u.toLowerCase().replace(/\/+$/, '');
  return {
    ...queue,
    repos: queue.repos.map(r =>
      normalize(r.url) === normalize(url) ? { ...r, status } : r,
    ),
  };
}

/**
 * Check whether a repo is stale and should be re-harvested.
 * A repo is fresh when lastHarvestedAt is within staleAfterDays (default 90).
 */
export function isRepoStale(repo: HarvestRepo): boolean {
  if (!repo.lastHarvestedAt) return true;
  const staleAfterDays = repo.staleAfterDays ?? 90;
  const harvestedAt = new Date(repo.lastHarvestedAt).getTime();
  const staleCutoff = Date.now() - staleAfterDays * 24 * 60 * 60 * 1000;
  return harvestedAt < staleCutoff;
}

/**
 * Compute freshness in days since last harvest (undefined if never harvested).
 */
export function computeFreshnessDays(repo: HarvestRepo): number | undefined {
  if (!repo.lastHarvestedAt) return undefined;
  const ms = Date.now() - new Date(repo.lastHarvestedAt).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

/**
 * Update gap coverage score for a dimension.
 * Also updates `bestRepoForGap` when the new repo has higher quality.
 */
export function updateGapCoverage(
  queue: HarvestQueue,
  dimension: string,
  newScore: number,
  bestRepo?: string,
): HarvestQueue {
  const exists = queue.gaps.some(g => g.dimension === dimension);
  if (exists) {
    return {
      ...queue,
      gaps: queue.gaps.map(g =>
        g.dimension === dimension
          ? {
              ...g,
              currentScore: newScore,
              bestRepoForGap: bestRepo ?? g.bestRepoForGap,
            }
          : g,
      ),
    };
  }
  // Insert new gap
  return {
    ...queue,
    gaps: [
      ...queue.gaps,
      {
        dimension,
        currentScore: newScore,
        targetScore: 9.0,
        bestRepoForGap: bestRepo,
        patternsAvailable: 0,
        patternsAdopted: 0,
      },
    ],
  };
}

/**
 * Compute priority score for a repo targeting a gap.
 * Formula: (targetScore - currentScore) × repoQuality / 10, clamped to [1, 10].
 */
export function computePriority(gap: HarvestGap, repoQuality: number): number {
  const raw = (gap.targetScore - gap.currentScore) * (repoQuality / 10);
  return Math.min(10, Math.max(1, Math.round(raw * 10) / 10));
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function emptyQueue(): HarvestQueue {
  return {
    version: '1.0.0',
    repos: [],
    gaps: [],
    harvestCycles: 0,
    totalPatternsExtracted: 0,
    totalPatternsAdopted: 0,
    updatedAt: new Date().toISOString(),
  };
}
