import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createStore } from './todo.js';

const DEFAULT_PATH = path.join(os.homedir(), '.todos.json');

export async function loadStore(filePath = DEFAULT_PATH) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!isValidStore(parsed)) {
      throw new Error('Corrupt store format');
    }
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return createStore();
    }

    if (error instanceof SyntaxError || error?.message === 'Corrupt store format') {
      throw new Error(`Could not read ${filePath}: ${error.message}. Delete the file to reset.`);
    }

    throw error;
  }
}

export async function saveStore(store, filePath = DEFAULT_PATH) {
  const tmpPath = `${filePath}.tmp`;
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  await fs.rename(tmpPath, filePath);
}

function isValidStore(value) {
  if (!value || typeof value !== 'object') return false;
  if (!Array.isArray(value.todos) || typeof value.nextId !== 'number') return false;
  return value.todos.every(isValidTodo);
}

function isValidTodo(value) {
  return Boolean(
    value
      && typeof value === 'object'
      && typeof value.id === 'number'
      && typeof value.text === 'string'
      && typeof value.done === 'boolean'
      && typeof value.createdAt === 'string',
  );
}
