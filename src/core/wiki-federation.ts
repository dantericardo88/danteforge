// Cross-Project Wiki Federation — promotes high-confidence entities to a global wiki
// at ~/.danteforge/global-wiki/, making knowledge portable across projects.
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  GLOBAL_WIKI_DIR,
  GLOBAL_FEDERATION_THRESHOLD,
  type WikiQueryResult,
  type WikiEntityType,
} from './wiki-schema.js';
import { parseFrontmatter, extractBody } from './wiki-indexer.js';

// ── I/O types ─────────────────────────────────────────────────────────────────

export type ReadFileFn = (p: string) => Promise<string>;
export type WriteFileFn = (p: string, c: string) => Promise<void>;
export type ReadDirFn = (p: string) => Promise<string[]>;
export type MkdirFn = (p: string, opts?: { recursive?: boolean }) => Promise<void>;

export interface FederateOptions {
  _readDir?: ReadDirFn;
  _readFile?: ReadFileFn;
  _writeFile?: WriteFileFn;
  _mkdir?: MkdirFn;
}

export interface QueryGlobalWikiOptions extends FederateOptions {
  maxResults?: number;
}

// ── Default I/O ───────────────────────────────────────────────────────────────

const defaultReadFile: ReadFileFn = (p) => fs.readFile(p, 'utf8');
const defaultWriteFile: WriteFileFn = (p, c) => fs.writeFile(p, c, 'utf8');
const defaultMkdir: MkdirFn = (p, o) => fs.mkdir(p, o).then(() => {}).catch(() => {});

async function defaultReadDir(p: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(p, { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith('.md') && !e.name.startsWith('.'))
      .map(e => path.join(p, e.name));
  } catch {
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const SKIP_FILES = new Set(['index.md', 'pdse-history.md', 'LINT_REPORT.md']);

function shouldSkipFile(filePath: string): boolean {
  const name = path.basename(filePath);
  return SKIP_FILES.has(name) || name.startsWith('.');
}

/** Build a markdown page for the federated entity with provenance metadata. */
function buildFederatedPage(
  originalContent: string,
  sourceProjects: string[],
  federatedAt: string,
): string {
  const fm = parseFrontmatter(originalContent);
  const body = extractBody(originalContent);
  if (!fm) return originalContent; // Can't parse — preserve as-is

  // Inject federation metadata into frontmatter
  const lines = originalContent.split('\n');
  const endDelimiter = lines.indexOf('---', 1);
  if (endDelimiter === -1) return originalContent;

  const fmBlock = lines.slice(1, endDelimiter);
  // Remove old sourceProject/sourceProjects/federatedAt lines
  const cleaned = fmBlock.filter(l =>
    !l.startsWith('sourceProject:') &&
    !l.startsWith('sourceProjects:') &&
    !l.startsWith('federatedAt:') &&
    !l.startsWith('  - ') ||
    !fmBlock.some((prev, i) => i < fmBlock.indexOf(l) && prev.startsWith('sourceProjects:'))
  );

  const fedLines = [
    ...cleaned,
    `sourceProjects:`,
    ...sourceProjects.map(p => `  - "${p}"`),
    `federatedAt: "${federatedAt}"`,
  ];

  return ['---', ...fedLines, '---', '', body].join('\n');
}

// ── Main federation function ──────────────────────────────────────────────────

/**
 * Copy high-confidence entities (confidence >= GLOBAL_FEDERATION_THRESHOLD)
 * from a project wiki to the global wiki at ~/.danteforge/global-wiki/.
 * If an entity already exists in global wiki, merges sourceProjects.
 */
export async function federateHighConfidenceEntities(
  wikiDir: string,
  globalWikiDir: string = GLOBAL_WIKI_DIR,
  opts?: FederateOptions,
): Promise<{ federated: string[]; skipped: string[] }> {
  const readDir = opts?._readDir ?? defaultReadDir;
  const readFile = opts?._readFile ?? defaultReadFile;
  const writeFile = opts?._writeFile ?? defaultWriteFile;
  const mkdir = opts?._mkdir ?? defaultMkdir;

  await mkdir(globalWikiDir, { recursive: true });

  const files = await readDir(wikiDir);
  const federated: string[] = [];
  const skipped: string[] = [];

  for (const filePath of files) {
    if (shouldSkipFile(filePath)) continue;

    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (!fm) { skipped.push(path.basename(filePath)); continue; }

      // Check confidence threshold
      const confidence = fm.confidence;
      if (typeof confidence !== 'number' || confidence < GLOBAL_FEDERATION_THRESHOLD) {
        skipped.push(fm.entity ?? path.basename(filePath));
        continue;
      }

      const entityId = fm.entity ?? path.basename(filePath, '.md');
      const destPath = path.join(globalWikiDir, `${entityId}.md`);
      const federatedAt = new Date().toISOString();

      // Check if already exists — merge sourceProjects
      let sourceProjects: string[] = [wikiDir];
      try {
        const existing = await readFile(destPath);
        // Extract sourceProjects list directly from the YAML block (federation-specific field)
        const spBlock = existing.match(/^sourceProjects:\s*\n((?:[ \t]+-[ \t]+.+\n?)*)/m);
        if (spBlock) {
          const existingProjects = spBlock[1]!
            .split('\n')
            .map(l => l.replace(/^\s*-\s*/, '').trim().replace(/^["']|["']$/g, ''))
            .filter(Boolean);
          sourceProjects = Array.from(new Set([...existingProjects, wikiDir]));
        }
      } catch {
        // File doesn't exist — first federation
      }

      const pageContent = buildFederatedPage(content, sourceProjects, federatedAt);
      await writeFile(destPath, pageContent);
      federated.push(entityId);
    } catch {
      skipped.push(path.basename(filePath));
    }
  }

  return { federated, skipped };
}

// ── Global wiki query ─────────────────────────────────────────────────────────

/** Stop words for term extraction */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'have', 'has', 'had',
  'do', 'does', 'did', 'will', 'would', 'could', 'should', 'and', 'or',
  'but', 'not', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from',
  'by', 'about', 'as', 'what', 'which', 'who', 'how', 'when', 'where',
]);

function extractTerms(text: string): string[] {
  return text.toLowerCase().split(/\W+/)
    .filter(t => t.length > 2 && !STOP_WORDS.has(t))
    .slice(0, 10);
}

/**
 * Query the global wiki using TF-IDF-style keyword matching.
 * Returns results sorted by descending relevance score.
 */
export async function queryGlobalWiki(
  promptText: string,
  globalWikiDir: string = GLOBAL_WIKI_DIR,
  budget: number,
  opts?: QueryGlobalWikiOptions,
): Promise<WikiQueryResult[]> {
  const readDir = opts?._readDir ?? defaultReadDir;
  const readFile = opts?._readFile ?? defaultReadFile;
  const maxResults = opts?.maxResults ?? 3;

  const terms = extractTerms(promptText);
  if (!terms.length) return [];

  const files = await readDir(globalWikiDir);
  const scored: Array<WikiQueryResult & { _score: number }> = [];

  for (const filePath of files) {
    if (shouldSkipFile(filePath)) continue;
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      const body = extractBody(content);
      if (!fm) continue;

      const text = (
        (fm.entity ?? '') + ' ' +
        (Array.isArray(fm.tags) ? fm.tags.join(' ') : '') + ' ' +
        body.slice(0, 2000)
      ).toLowerCase();

      let matches = 0;
      for (const term of terms) {
        if (text.includes(term)) matches++;
      }
      if (matches === 0) continue;

      const score = matches / terms.length;
      const excerpt = body.split('\n').find(l => l.trim() && !l.startsWith('#'))?.slice(0, 200) ?? '';

      scored.push({
        entityId: fm.entity ?? path.basename(filePath, '.md'),
        entityType: (fm.type ?? 'concept') as WikiEntityType,
        score,
        excerpt: `[global] ${excerpt}`,
        sources: Array.isArray(fm.sources) ? fm.sources as string[] : [],
        tags: Array.isArray(fm.tags) ? fm.tags as string[] : [],
        _score: score,
      });
    } catch { /* skip */ }
  }

  scored.sort((a, b) => b._score - a._score);

  // Apply token budget (rough 4 chars/token)
  const charBudget = budget * 4;
  let usedChars = 0;
  const results: WikiQueryResult[] = [];
  for (const r of scored.slice(0, maxResults)) {
    const chars = r.excerpt.length + r.entityId.length + 20;
    if (usedChars + chars > charBudget) break;
    const { _score: _, ...result } = r;
    results.push(result);
    usedChars += chars;
  }

  return results;
}
