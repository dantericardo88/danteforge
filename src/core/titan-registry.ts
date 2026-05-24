// Titan Registry — tracks GPL/AGPL repos queued for clean-room harvest.
// Lives at .danteforge/titan-registry.json. Never stores source code, only metadata
// and paths to LLM-generated pattern documents.
import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TitanRegistryEntry {
  /** Short repo name */
  name: string;
  /** Full GitHub URL */
  url: string;
  /** SPDX license identifier that triggered titan routing, e.g. "GPL-3.0" */
  license: string;
  /** ISO timestamp when discovered by oss-loop */
  discoveredAt: string;
  /** pending = not yet analyzed; complete = patterns extracted; failed = LLM failed */
  harvestStatus: 'pending' | 'complete' | 'failed';
  /** Number of harvest attempts (for retry throttling) */
  harvestAttempts: number;
  /** ISO timestamp of last harvest attempt */
  lastHarvestAt?: string;
  /** Relative path to the pattern document: .danteforge/titan-patterns/<name>.md */
  patternsFile?: string;
  /** Number of pattern sections documented */
  patternsCount: number;
}

export interface TitanRegistry {
  version: '1';
  repos: TitanRegistryEntry[];
  updatedAt: string;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

const TITAN_REGISTRY_FILENAME = 'titan-registry.json';

function getDanteforgeDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge');
}

// ── Load / Save ───────────────────────────────────────────────────────────────

export async function loadTitanRegistry(cwd?: string): Promise<TitanRegistry> {
  const registryPath = path.join(getDanteforgeDir(cwd), TITAN_REGISTRY_FILENAME);
  try {
    const raw = await fs.readFile(registryPath, 'utf8');
    return JSON.parse(raw) as TitanRegistry;
  } catch {
    return { version: '1', repos: [], updatedAt: new Date().toISOString() };
  }
}

export async function saveTitanRegistry(registry: TitanRegistry, cwd?: string): Promise<void> {
  const danteforgeDir = getDanteforgeDir(cwd);
  await fs.mkdir(danteforgeDir, { recursive: true });
  const registryPath = path.join(danteforgeDir, TITAN_REGISTRY_FILENAME);
  registry.updatedAt = new Date().toISOString();
  await fs.writeFile(registryPath, JSON.stringify(registry, null, 2), 'utf8');
}

// ── Query helpers ─────────────────────────────────────────────────────────────

export function upsertTitanEntry(
  registry: TitanRegistry,
  entry: TitanRegistryEntry,
): TitanRegistry {
  const normalize = (u: string) => u.toLowerCase().replace(/\/+$/, '');
  const idx = registry.repos.findIndex(r => normalize(r.url) === normalize(entry.url));
  if (idx >= 0) {
    registry.repos[idx] = entry;
  } else {
    registry.repos.push(entry);
  }
  return registry;
}

export function isTitanKnown(url: string, registry: TitanRegistry): boolean {
  const normalize = (u: string) => u.toLowerCase().replace(/\/+$/, '');
  return registry.repos.some(r => normalize(r.url) === normalize(url));
}

/** All URLs tracked in the titan registry (for deduplication in discovery). */
export function titanKnownUrls(registry: TitanRegistry): Set<string> {
  return new Set(registry.repos.map(r => r.url.toLowerCase()));
}

/** Entries ready for harvest (pending, or failed with < maxAttempts). */
export function pendingTitanEntries(
  registry: TitanRegistry,
  maxAttempts = 3,
): TitanRegistryEntry[] {
  return registry.repos.filter(
    r => r.harvestStatus === 'pending' ||
      (r.harvestStatus === 'failed' && r.harvestAttempts < maxAttempts),
  );
}
