// Persistent Memory Engine — cross-session memory with search, compaction, and token-awareness
import crypto from 'crypto';
import { loadMemoryStore, saveMemoryStore } from './memory-store.js';
import { estimateTokens } from './token-estimator.js';
import { isLLMAvailable, callLLM } from './llm.js';
import { logger } from './logger.js';
import type { MemoryEntry, MemoryStore } from './memory-store.js';

export type { MemoryEntry, MemoryStore } from './memory-store.js';

const MAX_TOKEN_BUDGET = 200_000;
const COMPACTION_AGE_DAYS = 7;
const DEFAULT_SEARCH_LIMIT = 20;

// Stable session ID per CLI invocation
let _sessionId: string | null = null;
function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = crypto.randomUUID();
  }
  return _sessionId;
}

// Category weights for search scoring (higher = more relevant)
const CATEGORY_WEIGHTS: Record<MemoryEntry['category'], number> = {
  correction: 5,
  error: 4,
  decision: 3,
  insight: 2,
  command: 1,
};

export async function recordMemory(
  entry: Omit<MemoryEntry, 'id' | 'timestamp' | 'tokenCount' | 'sessionId'>,
  cwd?: string,
): Promise<void> {
  const store = await loadMemoryStore(cwd);
  const fullText = `${entry.summary} ${entry.detail}`;
  const tokenCount = estimateTokens(fullText);

  const memoryEntry: MemoryEntry = {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    sessionId: getSessionId(),
    tokenCount,
    ...entry,
  };

  store.entries.push(memoryEntry);
  await saveMemoryStore(store, cwd);

  // Auto-compact if over budget
  const totalTokens = store.entries.reduce((sum, e) => sum + e.tokenCount, 0);
  if (totalTokens > MAX_TOKEN_BUDGET) {
    logger.verbose('Memory token budget exceeded — triggering auto-compaction');
    await compactMemory(MAX_TOKEN_BUDGET, cwd);
  }
}

export async function searchMemory(
  query: string,
  limit = DEFAULT_SEARCH_LIMIT,
  cwd?: string,
): Promise<MemoryEntry[]> {
  const store = await loadMemoryStore(cwd);
  if (store.entries.length === 0) return [];

  const keywords = query
    .toLowerCase()
    .split(/\s+/)
    .filter(w => w.length > 2);

  if (keywords.length === 0) {
    return store.entries.slice(-limit);
  }

  const now = Date.now();

  const scored = store.entries.map(entry => {
    const searchText = `${entry.summary} ${entry.detail} ${entry.tags.join(' ')}`.toLowerCase();

    // Keyword match score
    let keywordScore = 0;
    for (const kw of keywords) {
      if (searchText.includes(kw)) keywordScore++;
    }

    // Recency bias — exponential decay over days
    const ageMs = now - new Date(entry.timestamp).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    const recencyScore = Math.exp(-ageDays / 30); // Half-life ~21 days

    // Category weight
    const categoryScore = CATEGORY_WEIGHTS[entry.category] ?? 1;

    const totalScore = keywordScore * 3 + recencyScore * 2 + categoryScore;

    return { entry, score: totalScore, keywordScore };
  });

  // Only return entries with at least one keyword match
  return scored
    .filter(s => s.keywordScore > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.entry);
}

export async function getRecentMemory(count = 10, cwd?: string): Promise<MemoryEntry[]> {
  const store = await loadMemoryStore(cwd);
  return store.entries.slice(-count);
}

export async function compactMemory(maxTokenBudget = MAX_TOKEN_BUDGET, cwd?: string): Promise<void> {
  const store = await loadMemoryStore(cwd);
  if (store.entries.length === 0) return;

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - COMPACTION_AGE_DAYS);
  const cutoffISO = cutoff.toISOString();

  const oldEntries = store.entries.filter(e => e.timestamp < cutoffISO);
  const recentEntries = store.entries.filter(e => e.timestamp >= cutoffISO);

  if (oldEntries.length === 0) return;

  const totalBefore = store.entries.length;

  // Try LLM-assisted compression
  const llmReady = await isLLMAvailable();
  if (llmReady) {
    try {
      const compacted = await compactWithLLM(oldEntries);
      store.entries = [...compacted, ...recentEntries];
      store.compactedAt = new Date().toISOString();
      store.totalEntriesBeforeCompaction = totalBefore;
      await saveMemoryStore(store, cwd);
      logger.verbose(`Memory compacted: ${totalBefore} -> ${store.entries.length} entries (LLM-assisted)`);
      return;
    } catch {
      logger.verbose('LLM compaction failed — falling back to truncation');
    }
  }

  // Fallback: drop detail from old entries
  const compactedOld = oldEntries.map(e => ({
    ...e,
    detail: '',
    tokenCount: estimateTokens(e.summary),
  }));

  // If still over budget, drop the oldest entries entirely
  let combined = [...compactedOld, ...recentEntries];
  let totalTokens = combined.reduce((sum, e) => sum + e.tokenCount, 0);

  while (totalTokens > maxTokenBudget && combined.length > recentEntries.length) {
    const removed = combined.shift()!;
    totalTokens -= removed.tokenCount;
  }

  store.entries = combined;
  store.compactedAt = new Date().toISOString();
  store.totalEntriesBeforeCompaction = totalBefore;
  await saveMemoryStore(store, cwd);
  logger.verbose(`Memory compacted: ${totalBefore} -> ${store.entries.length} entries (truncation)`);
}

async function compactWithLLM(entries: MemoryEntry[]): Promise<MemoryEntry[]> {
  // Group by category
  const groups = new Map<MemoryEntry['category'], MemoryEntry[]>();
  for (const entry of entries) {
    const list = groups.get(entry.category) ?? [];
    list.push(entry);
    groups.set(entry.category, list);
  }

  const compacted: MemoryEntry[] = [];

  for (const [category, groupEntries] of groups) {
    if (groupEntries.length <= 2) {
      // Keep small groups as-is
      compacted.push(...groupEntries);
      continue;
    }

    const summariesText = groupEntries
      .map((e, i) => `${i + 1}. [${e.timestamp}] ${e.summary}: ${e.detail}`)
      .join('\n');

    const prompt = `Summarize these ${groupEntries.length} ${category} memory entries into a single concise entry that preserves all key decisions, errors, and insights. Return ONLY the summary text, nothing else.\n\n${summariesText}`;

    const response = await callLLM(prompt, undefined, { recordMemory: false });

    compacted.push({
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      sessionId: 'compaction',
      category,
      summary: `[Compacted ${groupEntries.length} ${category} entries]`,
      detail: response,
      tags: [...new Set(groupEntries.flatMap(e => e.tags))],
      relatedCommands: [...new Set(groupEntries.flatMap(e => e.relatedCommands))],
      tokenCount: estimateTokens(response),
    });
  }

  return compacted;
}

export async function getMemoryBudget(cwd?: string): Promise<{
  totalTokens: number;
  entryCount: number;
  oldestEntry: string | null;
}> {
  const store = await loadMemoryStore(cwd);
  const totalTokens = store.entries.reduce((sum, e) => sum + e.tokenCount, 0);
  const oldestEntry = store.entries.length > 0 ? store.entries[0].timestamp : null;
  return { totalTokens, entryCount: store.entries.length, oldestEntry };
}
