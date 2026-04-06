// Wiki Engine — public API for the three-tier knowledge architecture
// Orchestrates: init, constitutional integrity, ingest, query, lint, entity access, health.

import path from 'node:path';
import crypto from 'node:crypto';
import {
  type WikiEntityPage,
  type WikiHealth,
  type WikiQueryResult,
  type WikiAuditEntry,
  type ConstitutionalHashStore,
  type IntegrityCheckResult,
  WIKI_DIR,
  RAW_DIR,
  CONSTITUTION_DIR,
  AUDIT_LOG_FILE,
  CONSTITUTION_HASH_FILE,
  WIKI_TIER0_TOKEN_BUDGET,
  STALENESS_DAYS,
} from './wiki-schema.js';
import {
  rebuildIndex,
  buildLinkGraph,
  findOrphanPages,
  computeLinkDensity,
  getEntityPage as indexerGetEntityPage,
  listEntityIds,
  parseFrontmatter,
  extractBody,
} from './wiki-indexer.js';
import { ingest, bootstrapFromArtifacts } from './wiki-ingestor.js';
import type { WikiIngestOptions } from './wiki-ingestor.js';

// ── I/O injection types ───────────────────────────────────────────────────────

export type ReadFileFn = (filePath: string) => Promise<string>;
export type WriteFileFn = (filePath: string, content: string) => Promise<void>;
export type ReadDirFn = (dirPath: string) => Promise<string[]>;
export type ExistsFn = (filePath: string) => Promise<boolean>;
export type MkdirFn = (dirPath: string, opts?: { recursive?: boolean }) => Promise<void>;
export type CopyFileFn = (src: string, dest: string) => Promise<void>;
export type LLMCallerFn = (prompt: string) => Promise<string>;
export type ComputeHashFn = (content: string) => string;

async function defaultReadFile(filePath: string): Promise<string> {
  const { default: fs } = await import('node:fs/promises');
  return fs.readFile(filePath, 'utf8');
}

async function defaultWriteFile(filePath: string, content: string): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.writeFile(filePath, content, 'utf8');
}

async function defaultReadDir(dirPath: string): Promise<string[]> {
  const { default: fs } = await import('node:fs/promises');
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map(e => path.join(dirPath, e.name));
  } catch {
    return [];
  }
}

async function defaultExists(filePath: string): Promise<boolean> {
  const { default: fs } = await import('node:fs/promises');
  try { await fs.access(filePath); return true; } catch { return false; }
}

async function defaultMkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.mkdir(dirPath, opts);
}

async function defaultCopyFile(src: string, dest: string): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.copyFile(src, dest);
}

function defaultComputeHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

// ── Engine options ────────────────────────────────────────────────────────────

export interface WikiEngineOptions {
  cwd?: string;
  _llmCaller?: LLMCallerFn;
  _readFile?: ReadFileFn;
  _writeFile?: WriteFileFn;
  _readDir?: ReadDirFn;
  _exists?: ExistsFn;
  _mkdir?: MkdirFn;
  _copyFile?: CopyFileFn;
  _computeHash?: ComputeHashFn;
}

export interface WikiQueryOptions extends WikiEngineOptions {
  maxResults?: number;
  useLLMFallback?: boolean;
}

// ── Init ──────────────────────────────────────────────────────────────────────

/**
 * Initialize the three-tier wiki directory layout.
 * Creates wiki/, raw/, and constitution/ directories.
 * If CONSTITUTION.md exists in .danteforge/, copies it to constitution/ and hashes it.
 * Safe to call multiple times (idempotent — won't overwrite existing hash store).
 */
export async function initWiki(opts: WikiEngineOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const mkdir = opts._mkdir ?? defaultMkdir;
  const exists = opts._exists ?? defaultExists;
  const readFile = opts._readFile ?? defaultReadFile;
  const writeFile = opts._writeFile ?? defaultWriteFile;
  const copyFile = opts._copyFile ?? defaultCopyFile;
  const computeHash = opts._computeHash ?? defaultComputeHash;

  await mkdir(path.join(cwd, WIKI_DIR), { recursive: true });
  await mkdir(path.join(cwd, RAW_DIR), { recursive: true });
  await mkdir(path.join(cwd, CONSTITUTION_DIR), { recursive: true });

  const constitutionSrc = path.join(cwd, '.danteforge', 'CONSTITUTION.md');
  const constitutionDest = path.join(cwd, CONSTITUTION_DIR, 'CONSTITUTION.md');
  const hashStorePath = path.join(cwd, CONSTITUTION_HASH_FILE);

  // Copy constitution if it exists and hash store hasn't been created yet
  if (await exists(constitutionSrc)) {
    await copyFile(constitutionSrc, constitutionDest);

    if (!(await exists(hashStorePath))) {
      const content = await readFile(constitutionDest);
      const hash = computeHash(content);
      const store: ConstitutionalHashStore = {
        hashes: { 'CONSTITUTION.md': hash },
        lockedAt: new Date().toISOString(),
      };
      await writeFile(hashStorePath, JSON.stringify(store, null, 2) + '\n');
    }
  }
}

// ── Constitutional integrity ───────────────────────────────────────────────────

/**
 * Verify that all Tier 1 constitutional documents are unmodified.
 * Recomputes SHA-256 for each file in constitution/ and compares against stored hashes.
 * Returns { ok: true } if all match; { ok: false, violations: [...] } if any changed.
 */
export async function verifyConstitutionalIntegrity(
  opts: WikiEngineOptions = {},
): Promise<IntegrityCheckResult> {
  const cwd = opts.cwd ?? process.cwd();
  const readFile = opts._readFile ?? defaultReadFile;
  const exists = opts._exists ?? defaultExists;
  const computeHash = opts._computeHash ?? defaultComputeHash;

  const hashStorePath = path.join(cwd, CONSTITUTION_HASH_FILE);

  if (!(await exists(hashStorePath))) {
    // No hash store = wiki not initialized; return ok (not a violation)
    return { ok: true, violations: [] };
  }

  let store: ConstitutionalHashStore;
  try {
    const raw = await readFile(hashStorePath);
    store = JSON.parse(raw) as ConstitutionalHashStore;
  } catch {
    return { ok: false, violations: ['Could not read constitutional hash store'] };
  }

  const violations: string[] = [];

  for (const [filename, expectedHash] of Object.entries(store.hashes)) {
    const filePath = path.join(cwd, CONSTITUTION_DIR, filename);
    try {
      const content = await readFile(filePath);
      const actualHash = computeHash(content);
      if (actualHash !== expectedHash) {
        violations.push(filename);
      }
    } catch {
      violations.push(`${filename} (missing)`);
    }
  }

  return { ok: violations.length === 0, violations };
}

// ── Ingest (delegation) ───────────────────────────────────────────────────────

/**
 * Run the full ingest pipeline (delegates to wiki-ingestor.ts).
 * First verifies constitutional integrity — returns BLOCKED if violated.
 */
export async function wikiIngest(
  opts: WikiEngineOptions = {},
): Promise<{ blocked?: true; reason?: string; processed: string[]; entityPages: string[]; errors: string[] }> {
  const integrity = await verifyConstitutionalIntegrity(opts);
  if (!integrity.ok) {
    return {
      blocked: true,
      reason: `Constitutional integrity violation: ${integrity.violations.join(', ')}`,
      processed: [],
      entityPages: [],
      errors: [],
    };
  }

  const ingestOpts: WikiIngestOptions = {
    cwd: opts.cwd,
    _llmCaller: opts._llmCaller,
    _readFile: opts._readFile,
    _writeFile: opts._writeFile,
    _readDir: opts._readDir,
    _exists: opts._exists,
    _mkdir: opts._mkdir,
  };

  return ingest(ingestOpts);
}

/**
 * Bootstrap wiki from existing .danteforge/ artifacts (delegates to wiki-ingestor.ts).
 */
export async function wikiBootstrap(
  opts: WikiEngineOptions = {},
): Promise<{ ingested: string[]; skipped: string[] }> {
  return bootstrapFromArtifacts({
    cwd: opts.cwd,
    _llmCaller: opts._llmCaller,
    _readFile: opts._readFile,
    _writeFile: opts._writeFile,
    _readDir: opts._readDir,
    _exists: opts._exists,
    _mkdir: opts._mkdir,
  });
}

// ── Query ─────────────────────────────────────────────────────────────────────

/**
 * Extract key terms from a query string (stop-word filtered).
 */
function extractKeyTerms(query: string): string[] {
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
    'and', 'or', 'but', 'not', 'in', 'on', 'at', 'to', 'for', 'of',
    'with', 'from', 'by', 'about', 'as', 'into', 'through', 'during',
    'what', 'which', 'who', 'how', 'when', 'where', 'why', 'that', 'this',
  ]);
  return query
    .toLowerCase()
    .split(/\W+/)
    .filter(t => t.length > 2 && !stopWords.has(t))
    .slice(0, 10);
}

/**
 * Score an entity page against query terms.
 * Returns 0..1 relevance score.
 */
function scorePageAgainstTerms(page: WikiEntityPage, terms: string[]): number {
  if (!terms.length) return 0;

  const text = (page.frontmatter.entity + ' ' +
    page.frontmatter.tags.join(' ') + ' ' +
    page.frontmatter.links.join(' ') + ' ' +
    page.body.slice(0, 2000)).toLowerCase();

  let matches = 0;
  for (const term of terms) {
    if (text.includes(term)) matches++;
  }

  // Recency bonus: pages updated recently score slightly higher
  const updated = page.frontmatter.updated ? new Date(page.frontmatter.updated).getTime() : 0;
  const ageMs = Date.now() - updated;
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const recencyBonus = Math.max(0, 1 - ageDays / 365) * 0.1;

  return Math.min(1, (matches / terms.length) * 0.9 + recencyBonus);
}

/**
 * Extract a short excerpt from page body (first non-heading line with content).
 */
function buildExcerpt(body: string, maxLen = 200): string {
  const lines = body.split('\n').filter(l => l.trim() && !l.startsWith('#'));
  return (lines[0] ?? '').slice(0, maxLen);
}

/**
 * Two-stage wiki query.
 * Stage 1 (zero-LLM): keyword match on index. Fast, deterministic.
 * Stage 2 (optional, LLM): if <3 results and query looks complex, infer relationships.
 */
export async function query(
  topic: string,
  opts: WikiQueryOptions = {},
): Promise<WikiQueryResult[]> {
  const cwd = opts.cwd ?? process.cwd();
  const readDir = opts._readDir ?? defaultReadDir;
  const readFile = opts._readFile ?? defaultReadFile;
  const maxResults = opts.maxResults ?? 10;

  const wikiDir = path.join(cwd, WIKI_DIR);
  const terms = extractKeyTerms(topic);
  const files = await readDir(wikiDir);

  const results: WikiQueryResult[] = [];

  for (const filePath of files) {
    if (filePath.endsWith('index.md') || filePath.endsWith('pdse-history.md') || filePath.endsWith('LINT_REPORT.md')) continue;
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (!fm?.entity) continue;

      const body = extractBody(content);
      const page: WikiEntityPage = { frontmatter: fm, body, filePath };
      const score = scorePageAgainstTerms(page, terms);

      if (score > 0) {
        results.push({
          entityId: fm.entity,
          entityType: fm.type,
          score,
          excerpt: buildExcerpt(body),
          sources: fm.sources,
          tags: fm.tags,
        });
      }
    } catch {
      // Skip unreadable files
    }
  }

  // Stage 2: LLM fallback for complex queries with few results
  if (results.length < 3 && opts.useLLMFallback !== false && opts._llmCaller && terms.length > 2) {
    try {
      const entityIds = await listEntityIds(wikiDir, readDir, readFile);
      const prompt = [
        'Given these wiki entity IDs: ' + entityIds.join(', '),
        'Which entities are most relevant to this query: "' + topic + '"?',
        'Return a JSON array of entity ID strings, most relevant first. Example: ["entity-a", "entity-b"]',
      ].join('\n');

      const response = await opts._llmCaller(prompt);
      const jsonMatch = response.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const suggestedIds = JSON.parse(jsonMatch[0]) as string[];
        for (const entityId of suggestedIds.slice(0, 3)) {
          if (!results.some(r => r.entityId === entityId)) {
            const page = await indexerGetEntityPage(entityId, wikiDir, readDir, readFile);
            if (page) {
              results.push({
                entityId,
                entityType: page.frontmatter.type,
                score: 0.3, // LLM-suggested, lower confidence
                excerpt: buildExcerpt(page.body),
                sources: page.frontmatter.sources,
                tags: page.frontmatter.tags,
              });
            }
          }
        }
      }
    } catch {
      // LLM stage is optional — never block on failure
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

// ── Entity access ─────────────────────────────────────────────────────────────

/**
 * Load a single entity page by ID.
 */
export async function getEntityPage(
  entityId: string,
  opts: WikiEngineOptions = {},
): Promise<WikiEntityPage | null> {
  const cwd = opts.cwd ?? process.cwd();
  const wikiDir = path.join(cwd, WIKI_DIR);
  return indexerGetEntityPage(entityId, wikiDir, opts._readDir, opts._readFile);
}

/**
 * Get the History section content for a specific entity.
 */
export async function getHistory(
  entityId: string,
  opts: WikiEngineOptions = {},
): Promise<string | null> {
  const page = await getEntityPage(entityId, opts);
  if (!page) return null;

  const historyMatch = page.body.match(/##\s+History\s*\n([\s\S]*?)(?=\n##\s|\n$|$)/);
  return historyMatch ? historyMatch[1].trim() : null;
}

// ── Health ─────────────────────────────────────────────────────────────────────

/**
 * Compute wiki health metrics from the index and lint report.
 */
export async function getWikiHealth(opts: WikiEngineOptions = {}): Promise<WikiHealth | null> {
  const cwd = opts.cwd ?? process.cwd();
  const readDir = opts._readDir ?? defaultReadDir;
  const readFile = opts._readFile ?? defaultReadFile;
  const exists = opts._exists ?? defaultExists;

  const wikiDir = path.join(cwd, WIKI_DIR);

  // If wiki not initialized, return null
  if (!(await exists(wikiDir))) return null;

  const files = (await readDir(wikiDir)).filter(
    f => !f.endsWith('index.md') && !f.endsWith('pdse-history.md') && !f.endsWith('LINT_REPORT.md')
  );

  if (files.length === 0) {
    return { pageCount: 0, linkDensity: 0, orphanRatio: 0, stalenessScore: 0, lintPassRate: 1, lastLint: null, anomalyCount: 0 };
  }

  const graph = await buildLinkGraph(wikiDir, readDir, readFile);
  const orphans = findOrphanPages(graph);
  const linkDensity = computeLinkDensity(graph);

  // Staleness: count pages with updated older than STALENESS_DAYS
  let staleCount = 0;
  const now = Date.now();
  for (const filePath of files) {
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (fm?.updated) {
        const updatedMs = new Date(fm.updated).getTime();
        const ageDays = (now - updatedMs) / (1000 * 60 * 60 * 24);
        if (ageDays > STALENESS_DAYS) staleCount++;
      }
    } catch {
      // Skip
    }
  }

  // Lint pass rate: check if LINT_REPORT.md exists and extract pass rate
  let lintPassRate = 1;
  let lastLint: string | null = null;
  try {
    const lintReportPath = path.join(wikiDir, 'LINT_REPORT.md');
    const lintContent = await readFile(lintReportPath);
    const passMatch = lintContent.match(/Pass rate:\s*([\d.]+)/i);
    const dateMatch = lintContent.match(/Generated:\s*(.+)/i);
    if (passMatch) lintPassRate = parseFloat(passMatch[1]);
    if (dateMatch) lastLint = dateMatch[1].trim();
  } catch {
    // No lint report yet
  }

  // Anomaly count: count active REVIEW_REQUIRED entries in pdse-history
  let anomalyCount = 0;
  try {
    const historyPath = path.join(wikiDir, 'pdse-history.md');
    const historyContent = await readFile(historyPath);
    const anomalyMatches = historyContent.match(/ANOMALY/g);
    anomalyCount = anomalyMatches?.length ?? 0;
  } catch {
    // No history yet
  }

  return {
    pageCount: files.length,
    linkDensity,
    orphanRatio: files.length > 0 ? orphans.length / files.length : 0,
    stalenessScore: files.length > 0 ? staleCount / files.length : 0,
    lintPassRate,
    lastLint,
    anomalyCount,
  };
}

// ── Audit log ─────────────────────────────────────────────────────────────────

/**
 * Append an entry to the wiki audit log (append-only JSONL).
 */
export async function appendAuditEntry(
  entry: WikiAuditEntry,
  opts: WikiEngineOptions = {},
): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const readFile = opts._readFile ?? defaultReadFile;
  const writeFile = opts._writeFile ?? defaultWriteFile;
  const mkdir = opts._mkdir ?? defaultMkdir;

  const auditPath = path.join(cwd, AUDIT_LOG_FILE);
  await mkdir(path.dirname(auditPath), { recursive: true });

  let existing = '';
  try { existing = await readFile(auditPath); } catch { /* new file */ }

  await writeFile(auditPath, existing + JSON.stringify(entry) + '\n');
}

// ── Tier 0 context helper ─────────────────────────────────────────────────────

/**
 * Build Tier 0 wiki context string for context injection.
 * Returns empty string if wiki not present or query yields no results.
 * Never throws — failure is silent (Tier 0 is best-effort).
 */
export async function getWikiContextForPrompt(
  promptText: string,
  opts: WikiEngineOptions = {},
  tokenBudget = WIKI_TIER0_TOKEN_BUDGET,
): Promise<string> {
  try {
    const cwd = opts.cwd ?? process.cwd();
    const exists = opts._exists ?? defaultExists;
    const wikiDir = path.join(cwd, WIKI_DIR);

    if (!(await exists(wikiDir))) return '';

    const results = await query(promptText, { ...opts, maxResults: 5, useLLMFallback: false });
    if (!results.length) return '';

    const lines: string[] = ['[WIKI CONTEXT]'];
    let usedChars = 0;
    const charBudget = tokenBudget * 4; // rough 4 chars/token estimate

    for (const result of results) {
      const entry = `[WIKI: ${result.entityId}] ${result.excerpt}`;
      if (usedChars + entry.length > charBudget) break;
      lines.push(entry);
      usedChars += entry.length;
    }

    return lines.length > 1 ? lines.join('\n') + '\n' : '';
  } catch {
    return '';
  }
}
