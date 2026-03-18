// Context Injection Layer — memory-aware progressive context injection
import { searchMemory, getRecentMemory, getMemoryBudget } from './memory-engine.js';
import { estimateTokens } from './token-estimator.js';
import { logger } from './logger.js';
import type { MemoryEntry } from './memory-store.js';
import fs from 'fs/promises';

const DEFAULT_MAX_BUDGET = 4000; // tokens for injected context
const LESSONS_FILE = '.danteforge/lessons.md';

interface ContextTier {
  label: string;
  entries: string[];
  tokens: number;
}

/**
 * Extract key terms from a prompt for memory search.
 */
function extractKeyTerms(prompt: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must', 'to', 'of',
    'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'and', 'or', 'but', 'not', 'no', 'if', 'then', 'else', 'when', 'up',
    'out', 'so', 'than', 'too', 'very', 'just', 'about', 'also', 'that',
    'this', 'these', 'those', 'it', 'its', 'you', 'your', 'we', 'our',
  ]);

  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopWords.has(w))
    .slice(0, 10);
}

/**
 * Load lessons from .danteforge/lessons.md if it exists.
 */
async function loadLessons(cwd?: string): Promise<string> {
  try {
    const filePath = cwd ? `${cwd}/${LESSONS_FILE}` : LESSONS_FILE;
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Format a memory entry for injection.
 */
function formatEntry(entry: MemoryEntry): string {
  const prefix = entry.category === 'correction' ? '[CORRECTION]'
    : entry.category === 'error' ? '[ERROR]'
    : entry.category === 'decision' ? '[DECISION]'
    : entry.category === 'insight' ? '[INSIGHT]'
    : '[NOTE]';
  return `${prefix} ${entry.summary}`;
}

/**
 * Build progressive context tiers within a token budget.
 * Tier 1 (always): Error corrections and critical lessons
 * Tier 2 (if budget): Recent decisions and insights
 * Tier 3 (if budget): Historical command summaries
 */
export function buildProgressiveContext(
  memories: MemoryEntry[],
  lessons: string,
  budget: number,
): string {
  const tiers: ContextTier[] = [
    { label: 'Critical Corrections', entries: [], tokens: 0 },
    { label: 'Recent Decisions', entries: [], tokens: 0 },
    { label: 'Historical Context', entries: [], tokens: 0 },
  ];

  // Tier 1: Corrections and errors (highest priority)
  for (const m of memories) {
    if (m.category === 'correction' || m.category === 'error') {
      const formatted = formatEntry(m);
      tiers[0].entries.push(formatted);
      tiers[0].tokens += estimateTokens(formatted);
    }
  }

  // Add lessons to tier 1 if available
  if (lessons.length > 0) {
    const lessonLines = lessons.split('\n').filter(l => l.trim().startsWith('-')).slice(0, 10);
    for (const line of lessonLines) {
      tiers[0].entries.push(`[LESSON] ${line.trim().slice(2)}`);
      tiers[0].tokens += estimateTokens(line);
    }
  }

  // Tier 2: Recent decisions and insights
  for (const m of memories) {
    if (m.category === 'decision' || m.category === 'insight') {
      const formatted = formatEntry(m);
      tiers[1].entries.push(formatted);
      tiers[1].tokens += estimateTokens(formatted);
    }
  }

  // Tier 3: Command summaries
  for (const m of memories) {
    if (m.category === 'command') {
      const formatted = formatEntry(m);
      tiers[2].entries.push(formatted);
      tiers[2].tokens += estimateTokens(formatted);
    }
  }

  // Progressively include tiers within budget
  const parts: string[] = [];
  let remainingBudget = budget;

  for (const tier of tiers) {
    if (tier.entries.length === 0) continue;
    if (remainingBudget <= 0) break;

    const tierText = tier.entries.join('\n');
    const tierTokens = estimateTokens(tierText);

    if (tierTokens <= remainingBudget) {
      parts.push(`### ${tier.label}\n${tierText}`);
      remainingBudget -= tierTokens;
    } else {
      // Partial inclusion: take what fits
      const partialEntries: string[] = [];
      for (const entry of tier.entries) {
        const entryTokens = estimateTokens(entry);
        if (entryTokens <= remainingBudget) {
          partialEntries.push(entry);
          remainingBudget -= entryTokens;
        } else {
          break;
        }
      }
      if (partialEntries.length > 0) {
        parts.push(`### ${tier.label}\n${partialEntries.join('\n')}`);
      }
    }
  }

  return parts.join('\n\n');
}

/**
 * Main entry point: inject relevant past context into a prompt.
 * Returns the enriched prompt with a "Prior Context" section appended.
 */
export async function injectContext(
  prompt: string,
  maxTokenBudget: number = DEFAULT_MAX_BUDGET,
  cwd?: string,
): Promise<string> {
  const budget = await getMemoryBudget(cwd);
  if (budget.entryCount === 0) {
    // No memory — return prompt as-is
    return prompt;
  }

  const promptTokens = estimateTokens(prompt);
  const availableBudget = Math.max(0, maxTokenBudget - Math.min(promptTokens * 0.1, 500));

  if (availableBudget < 50) {
    return prompt; // Not enough budget for meaningful context
  }

  // Extract key terms and search memory
  const terms = extractKeyTerms(prompt);
  const searchQuery = terms.join(' ');

  let memories: MemoryEntry[] = [];
  if (searchQuery.length > 0) {
    memories = await searchMemory(searchQuery, 20, cwd);
  }

  // Also get recent memories for recency
  const recent = await getRecentMemory(10, cwd);
  const seen = new Set(memories.map(m => m.id));
  for (const r of recent) {
    if (!seen.has(r.id)) {
      memories.push(r);
      seen.add(r.id);
    }
  }

  // Load lessons
  const lessons = await loadLessons(cwd);

  // Build progressive context
  const contextBlock = buildProgressiveContext(memories, lessons, availableBudget);

  if (contextBlock.length === 0) {
    return prompt;
  }

  logger.info(`[Context] Injected ${estimateTokens(contextBlock)} tokens of prior context`);

  return `${prompt}\n\n## Prior Context (auto-injected)\n${contextBlock}`;
}
