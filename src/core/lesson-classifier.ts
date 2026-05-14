// lesson-classifier.ts — Classify lessons by quality and prevent duplicates.
// Pure functions, no I/O, no LLM required.

import crypto from 'node:crypto';

// ── Types ─────────────────────────────────────────────────────────────────────

export type LessonCategory =
  | 'root-cause'   // root cause analysis findings
  | 'pattern'      // harvested patterns
  | 'anti-pattern' // things that failed
  | 'calibration'  // score calibration adjustments
  | 'workflow'     // process improvements
  | 'tooling';     // tooling/infrastructure (default)

export interface ClassifiedLesson {
  id: string;         // sha256 of content truncated to 8 chars
  category: LessonCategory;
  content: string;
  confidence: number; // 0.0-1.0 — how confident we are in the classification
  tags: string[];
  createdAt: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'being', 'by',
  'do', 'for', 'from', 'has', 'have', 'he', 'her', 'him', 'his',
  'how', 'i', 'in', 'is', 'it', 'its', 'me', 'my', 'not', 'of',
  'on', 'or', 'our', 'out', 'so', 'that', 'the', 'their', 'them',
  'they', 'this', 'to', 'up', 'us', 'was', 'we', 'what', 'when',
  'where', 'which', 'while', 'who', 'will', 'with', 'you', 'your',
]);

// Keyword rules — ordered by priority (first match wins).
// Each rule carries a confidence bonus for keyword density.
const CATEGORY_RULES: Array<{
  category: LessonCategory;
  keywords: string[];
  baseConfidence: number;
}> = [
  {
    category: 'root-cause',
    keywords: ['root cause', '7 levels', 'seven levels', 'five whys', 'because', 'root-cause'],
    baseConfidence: 0.85,
  },
  {
    category: 'pattern',
    keywords: ['pattern', 'harvest', 'adopted from', 'inspired by', 'oss harvest'],
    baseConfidence: 0.80,
  },
  {
    category: 'anti-pattern',
    keywords: ['failed', "doesn't work", 'avoid', 'broken', 'do not', "don't", 'never', 'anti-pattern'],
    baseConfidence: 0.82,
  },
  {
    category: 'calibration',
    keywords: ['score', 'calibrate', 'adversarial', 'dimension', 'calibration', 'metric'],
    baseConfidence: 0.78,
  },
  {
    category: 'workflow',
    keywords: ['workflow', 'pipeline', 'process', 'sequence', 'step', 'phase', 'stage'],
    baseConfidence: 0.75,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sha8(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
}

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
}

/**
 * Return word set after removing stopwords and short tokens.
 */
function meaningfulWords(text: string): Set<string> {
  const words = normalise(text).split(/\s+/).filter(w => w.length > 2 && !STOPWORDS.has(w));
  return new Set(words);
}

/**
 * Count how many of `keywords` appear (case-insensitive) in `text`.
 */
function countKeywordHits(text: string, keywords: string[]): number {
  const lower = text.toLowerCase();
  return keywords.filter(kw => lower.includes(kw)).length;
}

/**
 * Compute Jaccard similarity between two word sets.
 */
function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const w of a) {
    if (b.has(w)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Extract simple tags from content (capitalised words, hashtag-like tokens).
 */
function extractTags(content: string): string[] {
  const tags: string[] = [];

  // CamelCase or ALLCAPS tokens that look like identifiers
  const identifiers = content.match(/\b[A-Z][a-zA-Z0-9]{3,}\b/g) ?? [];
  tags.push(...identifiers.map(t => t.toLowerCase()).slice(0, 5));

  // #hashtag style
  const hashtags = content.match(/#([a-zA-Z][a-zA-Z0-9_-]+)/g) ?? [];
  tags.push(...hashtags.map(t => t.slice(1).toLowerCase()));

  return [...new Set(tags)].slice(0, 8);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a raw lesson string into a `ClassifiedLesson`.
 * Classification is keyword-based — no LLM calls.
 */
export function classifyLesson(content: string): ClassifiedLesson {
  let bestCategory: LessonCategory = 'tooling';
  let bestConfidence = 0.60; // default confidence for tooling fallback
  let bestHits = 0;

  for (const rule of CATEGORY_RULES) {
    const hits = countKeywordHits(content, rule.keywords);
    if (hits === 0) continue;

    // Confidence scales with hit density (log scale to avoid runaway).
    const density = hits / rule.keywords.length;
    const confidence = Math.min(0.99, rule.baseConfidence + density * 0.15);

    if (hits > bestHits || (hits === bestHits && confidence > bestConfidence)) {
      bestCategory = rule.category;
      bestConfidence = confidence;
      bestHits = hits;
    }
  }

  return {
    id: sha8(content),
    category: bestCategory,
    content,
    confidence: Math.round(bestConfidence * 100) / 100,
    tags: extractTags(content),
    createdAt: new Date().toISOString(),
  };
}

/**
 * Remove near-duplicate lessons.
 * Two lessons are considered near-duplicates if they share >70% of their
 * meaningful words (Jaccard similarity > 0.70). When duplicates are found,
 * the one with higher confidence is kept.
 */
export function deduplicateLessons(lessons: ClassifiedLesson[]): ClassifiedLesson[] {
  if (lessons.length === 0) return [];

  const wordSets = lessons.map(l => meaningfulWords(l.content));
  const kept: boolean[] = new Array(lessons.length).fill(true);

  for (let i = 0; i < lessons.length; i++) {
    if (!kept[i]) continue;
    for (let j = i + 1; j < lessons.length; j++) {
      if (!kept[j]) continue;
      const similarity = jaccardSimilarity(wordSets[i]!, wordSets[j]!);
      if (similarity > 0.70) {
        // Keep the higher-confidence lesson; drop the other.
        if (lessons[i]!.confidence >= lessons[j]!.confidence) {
          kept[j] = false;
        } else {
          kept[i] = false;
          break; // lesson i is gone; stop comparing it
        }
      }
    }
  }

  return lessons.filter((_, idx) => kept[idx]);
}

/**
 * Filter lessons by category.
 */
export function getLessonsByCategory(
  lessons: ClassifiedLesson[],
  category: LessonCategory,
): ClassifiedLesson[] {
  return lessons.filter(l => l.category === category);
}

/**
 * Aggregate statistics over a set of classified lessons.
 */
export function computeLessonStats(lessons: ClassifiedLesson[]): {
  total: number;
  byCategory: Record<LessonCategory, number>;
  avgConfidence: number;
} {
  const byCategory: Record<LessonCategory, number> = {
    'root-cause': 0,
    pattern: 0,
    'anti-pattern': 0,
    calibration: 0,
    workflow: 0,
    tooling: 0,
  };

  let confidenceSum = 0;
  for (const lesson of lessons) {
    byCategory[lesson.category]++;
    confidenceSum += lesson.confidence;
  }

  const avgConfidence =
    lessons.length === 0 ? 0 : Math.round((confidenceSum / lessons.length) * 100) / 100;

  return { total: lessons.length, byCategory, avgConfidence };
}
