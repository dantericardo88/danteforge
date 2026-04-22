// src/dossier/registry.ts — Competitor registry loading and lookup

import fs from 'node:fs/promises';
import path from 'node:path';
import type { CompetitorEntry, CompetitorRegistry } from './types.js';

export type ReadFileFn = (p: string, enc: BufferEncoding) => Promise<string>;

export function registryPath(cwd: string): string {
  return path.join(cwd, '.danteforge', 'competitor-registry.json');
}

export async function loadRegistry(
  cwd: string,
  _readFile: ReadFileFn = fs.readFile as ReadFileFn,
): Promise<CompetitorRegistry> {
  const filePath = registryPath(cwd);
  let raw: string;
  try {
    raw = await _readFile(filePath, 'utf8');
  } catch {
    throw new Error(
      `Competitor registry not found at ${filePath}. ` +
      `Ensure .danteforge/competitor-registry.json exists.`,
    );
  }
  return JSON.parse(raw) as CompetitorRegistry;
}

export function getCompetitor(
  registry: CompetitorRegistry,
  id: string,
): CompetitorEntry | undefined {
  return registry.competitors.find((c) => c.id === id);
}

export function listCompetitorIds(registry: CompetitorRegistry): string[] {
  return registry.competitors.map((c) => c.id);
}
