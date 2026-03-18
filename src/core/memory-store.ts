// Low-level file I/O for persistent memory — .danteforge/memory.json
import fs from 'fs/promises';
import path from 'path';

const STATE_DIR = '.danteforge';
const MEMORY_FILE = 'memory.json';

export interface MemoryEntry {
  id: string;
  timestamp: string;
  sessionId: string;
  category: 'command' | 'decision' | 'error' | 'insight' | 'correction';
  summary: string;
  detail: string;
  tags: string[];
  relatedCommands: string[];
  tokenCount: number;
}

export interface MemoryStore {
  version: '1.0.0';
  entries: MemoryEntry[];
  compactedAt?: string;
  totalEntriesBeforeCompaction?: number;
}

function resolveMemoryPath(cwd = process.cwd()): string {
  return path.join(cwd, STATE_DIR, MEMORY_FILE);
}

function createEmptyStore(): MemoryStore {
  return { version: '1.0.0', entries: [] };
}

export async function loadMemoryStore(cwd?: string): Promise<MemoryStore> {
  const filePath = resolveMemoryPath(cwd);
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(content) as Partial<MemoryStore>;
    return {
      version: parsed.version ?? '1.0.0',
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      compactedAt: parsed.compactedAt,
      totalEntriesBeforeCompaction: parsed.totalEntriesBeforeCompaction,
    };
  } catch (err) {
    if (err instanceof Error && err.message.includes('ENOENT')) {
      return createEmptyStore();
    }
    // Corrupted file — start fresh
    return createEmptyStore();
  }
}

export async function saveMemoryStore(store: MemoryStore, cwd?: string): Promise<void> {
  const filePath = resolveMemoryPath(cwd);
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(store, null, 2));
}
