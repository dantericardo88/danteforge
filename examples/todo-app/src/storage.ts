// Atomic file storage for TodoStore.
// Writes to a temp file then renames to ensure atomicity.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { TodoStore } from './todo.js';

const DEFAULT_PATH = path.join(os.homedir(), '.todos.json');

/**
 * Load store from disk. Returns an empty store if the file doesn't exist.
 * Throws on corrupt JSON with a helpful message.
 */
export async function loadStore(filePath = DEFAULT_PATH): Promise<TodoStore> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidStore(parsed)) {
      throw new Error('Corrupt store format');
    }
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { todos: [], nextId: 1 };
    }
    if (err instanceof SyntaxError || (err instanceof Error && err.message === 'Corrupt store format')) {
      throw new Error(
        `Could not read ${filePath}: ${err.message}. Delete the file to reset.`,
      );
    }
    throw err;
  }
}

/**
 * Persist store to disk atomically:
 * write to <filePath>.tmp, then rename to <filePath>.
 */
export async function saveStore(store: TodoStore, filePath = DEFAULT_PATH): Promise<void> {
  const tmp = `${filePath}.tmp`;
  const content = JSON.stringify(store, null, 2);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmp, content, 'utf8');
  await fs.rename(tmp, filePath);
}

function isValidStore(value: unknown): value is TodoStore {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v['todos']) && typeof v['nextId'] === 'number';
}
