// src/dossier/rubric.ts — Rubric loading, validation, and criteria access

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Rubric, RubricDimension } from './types.js';

export type ReadFileFn = typeof fs.readFile;
export type WriteFileFn = typeof fs.writeFile;

export function rubricPath(cwd: string): string {
  return path.join(cwd, '.danteforge', 'rubric.json');
}

export async function getRubric(
  cwd: string,
  _readFile: ReadFileFn = fs.readFile,
): Promise<Rubric> {
  const filePath = rubricPath(cwd);
  let raw: string;
  try {
    raw = await (_readFile as (p: string, enc: BufferEncoding) => Promise<string>)(filePath, 'utf8');
  } catch {
    throw new Error(
      `Rubric not found at ${filePath}. Run: danteforge rubric init`,
    );
  }
  let rubric: unknown;
  try {
    rubric = JSON.parse(raw);
  } catch {
    throw new Error(`Rubric at ${filePath} is not valid JSON`);
  }
  return rubric as Rubric;
}

export function getDimCriteria(rubric: Rubric, dim: number): RubricDimension | undefined {
  return rubric.dimensions[String(dim)];
}

export function validateFrozenAt(rubric: Rubric, existing?: Rubric): void {
  if (!existing) return;
  if (existing.version !== rubric.version) return; // version bump is allowed
  // Check that no existing dim criteria were silently changed
  for (const [dimKey, dimDef] of Object.entries(existing.dimensions)) {
    const updated = rubric.dimensions[dimKey];
    if (!updated) continue; // dim removed — append-only violation but not our concern here
    for (const tier of ['9', '7', '5', '3', '1'] as const) {
      const existingCriteria = JSON.stringify(dimDef.scoreCriteria[tier] ?? []);
      const updatedCriteria = JSON.stringify(updated.scoreCriteria[tier] ?? []);
      if (existingCriteria !== updatedCriteria) {
        throw new Error(
          `Rubric is frozen at ${existing.frozenAt}: criteria for dim ${dimKey} (score ${tier}) cannot be changed. ` +
          `Add a new version instead.`,
        );
      }
    }
  }
}

export async function saveRubric(
  cwd: string,
  rubric: Rubric,
  _writeFile: WriteFileFn = fs.writeFile,
): Promise<void> {
  const filePath = rubricPath(cwd);
  await (_writeFile as (p: string, d: string) => Promise<void>)(
    filePath,
    JSON.stringify(rubric, null, 2),
  );
}

export function getDimCount(rubric: Rubric): number {
  return Object.keys(rubric.dimensions).length;
}
