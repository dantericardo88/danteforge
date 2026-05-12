// Matrix Kernel — Ownership Map loader (Phase 5 of PRD)
//
// Wraps .danteforge/agent-ownership.json + .danteforge/agent-guard.json into
// a queryable OwnershipMap. Reuses existing JSON files; does NOT create a
// parallel ownership system.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { OwnershipMap, OwnershipClaim } from '../types/ownership.js';
import { MATRIX_DIR, MATRIX_REPORT_PATHS } from '../types/index.js';

// ── Public API ──────────────────────────────────────────────────────────────

export interface LoadOwnershipMapOptions {
  cwd?: string;
  /** Override the ownership manifest path (default: .danteforge/agent-ownership.json). */
  ownershipPath?: string;
  /** Override the guard manifest path (default: .danteforge/agent-guard.json). */
  guardPath?: string;
  /** Injection seam: replaces fs.readFile for tests. */
  _readFile?: (p: string) => Promise<string>;
}

export async function loadOwnershipMap(
  options: LoadOwnershipMapOptions = {},
): Promise<OwnershipMap> {
  const cwd = options.cwd ?? process.cwd();
  const ownershipPath = options.ownershipPath ?? path.join(cwd, '.danteforge/agent-ownership.json');
  const guardPath = options.guardPath ?? path.join(cwd, '.danteforge/agent-guard.json');
  const readFile = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  const ownership = await readJsonSafe(ownershipPath, readFile) as Record<string, unknown>;
  const guard = await readJsonSafe(guardPath, readFile) as Record<string, unknown>;

  const workstreams: Record<string, OwnershipClaim> = {};
  const rawWorkstreams = ownership?.workstreams as Record<string, { owned?: string[]; shared?: string[]; description?: string }> | undefined;
  if (rawWorkstreams) {
    for (const [name, claim] of Object.entries(rawWorkstreams)) {
      workstreams[name] = {
        workstream: name,
        ownedPaths: claim.owned ?? [],
        sharedPaths: claim.shared,
        description: claim.description,
      };
    }
  }

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    globalAllowed: (ownership?.globalAllowed as string[]) ?? [],
    workstreams,
    frozenFiles: (guard?.frozenFiles as string[]) ?? [],
  };
}

export async function writeOwnershipMap(map: OwnershipMap, cwd?: string): Promise<string> {
  const root = cwd ?? process.cwd();
  const outPath = path.join(root, MATRIX_REPORT_PATHS.ownershipMap);
  await fs.mkdir(path.join(root, MATRIX_DIR), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(map, null, 2), 'utf8');
  return outPath;
}

// ── Query helpers ───────────────────────────────────────────────────────────

export function pathOwner(map: OwnershipMap, filePath: string): string | undefined {
  for (const [name, claim] of Object.entries(map.workstreams)) {
    if (matchesAnyGlob(filePath, claim.ownedPaths)) return name;
  }
  return undefined;
}

export function isPathFrozen(map: OwnershipMap, filePath: string): boolean {
  return matchesAnyGlob(filePath, map.frozenFiles);
}

export function pathsForWorkstream(map: OwnershipMap, workstream: string): string[] {
  return map.workstreams[workstream]?.ownedPaths ?? [];
}

export function isPathGloballyAllowed(map: OwnershipMap, filePath: string): boolean {
  return matchesAnyGlob(filePath, map.globalAllowed);
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function readJsonSafe(
  filePath: string,
  readFile: (p: string) => Promise<string>,
): Promise<Record<string, unknown> | null> {
  try {
    const raw = await readFile(filePath);
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function matchesAnyGlob(filePath: string, globs: string[]): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  for (const g of globs) {
    const re = globToRegex(g.replace(/\\/g, '/'));
    if (re.test(normalized)) return true;
  }
  return false;
}

function globToRegex(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '___DOUBLESTAR___')
    .replace(/\*/g, '[^/]*')
    .replace(/___DOUBLESTAR___/g, '.*');
  return new RegExp(`^${escaped}$`);
}
