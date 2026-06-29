// scaffold-library.ts — the versioned, on-disk scaffold store. One file per task type at
// `.danteforge/scaffolds/<taskType>.json` holding every version, so the improvement chain is auditable and the
// best-performing scaffold (by MEASURED mean reward) can be reused and refined next time — Ornith's "reuse the
// scaffold last used for this task" made durable. Best-effort writes, injectable fs for tests.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { Scaffold } from './scaffold-types.js';

export const SCAFFOLD_DIR = '.danteforge/scaffolds';

type ReadFn = (p: string) => Promise<string>;
type WriteFn = (p: string, d: string) => Promise<void>;

function sanitize(taskType: string): string {
  return taskType.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

function fileFor(cwd: string, taskType: string): string {
  return path.join(cwd, SCAFFOLD_DIR, `${sanitize(taskType)}.json`);
}

/** All versions for a task type, oldest→newest. Empty if none/malformed. */
export async function loadScaffolds(taskType: string, cwd: string = process.cwd(), _read?: ReadFn): Promise<Scaffold[]> {
  const read = _read ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await read(fileFor(cwd, taskType));
    const arr = JSON.parse(raw) as Scaffold[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/** The best scaffold for a task type by mean measured reward (tie → highest version). Null if none. */
export async function bestScaffold(taskType: string, cwd: string = process.cwd(), _read?: ReadFn): Promise<Scaffold | null> {
  const all = await loadScaffolds(taskType, cwd, _read);
  if (all.length === 0) return null;
  return all.reduce((best, s) => {
    if (s.rewardStats.runs === 0 && best.rewardStats.runs === 0) return s.version > best.version ? s : best;
    if (s.rewardStats.meanReward > best.rewardStats.meanReward) return s;
    if (s.rewardStats.meanReward === best.rewardStats.meanReward && s.version > best.version) return s;
    return best;
  });
}

/** Insert or replace a scaffold version, then persist the whole task-type file. Best-effort. */
export async function saveScaffold(
  scaffold: Scaffold, cwd: string = process.cwd(), _read?: ReadFn, _write?: WriteFn,
): Promise<void> {
  const write = _write ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, d, 'utf8');
  });
  const all = await loadScaffolds(scaffold.taskType, cwd, _read);
  const idx = all.findIndex((s) => s.version === scaffold.version);
  if (idx >= 0) all[idx] = scaffold; else all.push(scaffold);
  all.sort((a, b) => a.version - b.version);
  try {
    await write(fileFor(cwd, scaffold.taskType), JSON.stringify(all, null, 2));
  } catch {
    // best-effort
  }
}
