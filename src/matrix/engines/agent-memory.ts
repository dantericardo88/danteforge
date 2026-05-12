// Matrix Kernel — Agent memory (Phase 14 / CrewAI harvest)
//
// Persistent, per-role short-form memory. Lives under
//   .danteforge/matrix/agent-memory/<role-id>.json
//
// Memory is opt-in per role (AgentRoleDefinition.persistentMemory). Only roles
// flagged true read or write here; everything else is stateless.
//
// Native implementation — no CrewAI dependency. Harvested pattern:
// agent-level memory survives across runs and informs subsequent prompts.
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AgentMemoryEntry, AgentMemoryFile } from '../types/role.js';
import { getRole } from './agent-roles.js';

const MEMORY_DIR = '.danteforge/matrix/agent-memory';
const DEFAULT_MAX_ENTRIES = 50;

export async function loadMemory(
  roleId: string,
  cwd?: string,
  _readFile?: (p: string) => Promise<string>,
): Promise<AgentMemoryFile> {
  const root = cwd ?? process.cwd();
  const filePath = path.join(root, MEMORY_DIR, `${roleId}.json`);
  const reader = _readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await reader(filePath);
    const parsed = JSON.parse(raw) as Partial<AgentMemoryFile>;
    return {
      roleId,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
      maxEntries: typeof parsed.maxEntries === 'number' ? parsed.maxEntries : DEFAULT_MAX_ENTRIES,
    };
  } catch {
    return { roleId, entries: [], maxEntries: DEFAULT_MAX_ENTRIES };
  }
}

export async function saveMemory(
  memory: AgentMemoryFile,
  cwd?: string,
  _writeFile?: (p: string, c: string) => Promise<void>,
): Promise<string> {
  const root = cwd ?? process.cwd();
  const dir = path.join(root, MEMORY_DIR);
  const filePath = path.join(dir, `${memory.roleId}.json`);
  await fs.mkdir(dir, { recursive: true });
  const trimmed: AgentMemoryFile = {
    ...memory,
    entries: memory.entries.slice(-memory.maxEntries),
  };
  const writer = _writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  await writer(filePath, JSON.stringify(trimmed, null, 2));
  return filePath;
}

export async function appendMemoryEntry(
  roleId: string,
  entry: AgentMemoryEntry,
  cwd?: string,
): Promise<void> {
  const role = getRole(roleId);
  if (!role?.persistentMemory) return;
  const file = await loadMemory(roleId, cwd);
  file.entries.push(entry);
  await saveMemory(file, cwd);
}

/**
 * Build a short prompt block surfacing this role's memory to the model.
 * Returns empty string if the role has no persistent memory or no entries.
 * Caps emitted entries to avoid prompt bloat.
 */
export async function buildMemoryPromptBlock(
  roleId: string,
  cwd?: string,
  maxEntriesEmitted = 10,
): Promise<string> {
  const role = getRole(roleId);
  if (!role?.persistentMemory) return '';
  const file = await loadMemory(roleId, cwd);
  if (file.entries.length === 0) return '';
  const recent = file.entries.slice(-maxEntriesEmitted);
  const bullets = recent
    .map(e => `- (${e.tag ?? 'note'}) ${e.note}`)
    .join('\n');
  return `# Prior Memory (${role.label})
${bullets}
`;
}
