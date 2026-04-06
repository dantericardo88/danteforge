// Wiki Indexer — bidirectional link graph builder and master index maintainer
// Scans the wiki directory, parses frontmatter, builds entity cross-references.

import path from 'node:path';
import {
  type WikiFrontmatter,
  type WikiEntityPage,
  type WikiIndex,
  type WikiIndexEntry,
  WIKI_DIR,
  WIKI_INDEX_FILE,
} from './wiki-schema.js';

// ── I/O injection types ───────────────────────────────────────────────────────

export type ReadFileFn = (filePath: string) => Promise<string>;
export type WriteFileFn = (filePath: string, content: string) => Promise<void>;
export type ReadDirFn = (dirPath: string) => Promise<string[]>;
export type MkdirFn = (dirPath: string, opts?: { recursive?: boolean }) => Promise<void>;

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

async function defaultMkdir(dirPath: string, opts?: { recursive?: boolean }): Promise<void> {
  const { default: fs } = await import('node:fs/promises');
  await fs.mkdir(dirPath, opts);
}

// ── Frontmatter parsing ───────────────────────────────────────────────────────

/**
 * Extract YAML frontmatter fields from entity page markdown.
 * Returns null if no valid frontmatter block is present.
 */
export function parseFrontmatter(content: string): WikiFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;

  const yaml = match[1];

  function readScalar(key: string): string {
    const m = yaml.match(new RegExp(`^${key}:\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm'));
    return m ? m[1].trim() : '';
  }

  function readArray(key: string): string[] {
    // Matches both inline `[a, b]` and multi-line `- item` YAML arrays
    const inlineMatch = yaml.match(new RegExp(`^${key}:\\s*\\[([^\\]]*?)\\]`, 'm'));
    if (inlineMatch) {
      return inlineMatch[1].split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    // Multi-line block list under this key
    const blockMatch = yaml.match(new RegExp(`^${key}:\\s*\\n((?:\\s+-\\s+.+\\n?)*)`, 'm'));
    if (blockMatch) {
      return blockMatch[1]
        .split('\n')
        .map(l => l.replace(/^\s+-\s+/, '').trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);
    }
    return [];
  }

  const entityType = readScalar('type') as WikiFrontmatter['type'];
  const validTypes = ['module', 'decision', 'pattern', 'tool', 'concept'];

  return {
    entity: readScalar('entity'),
    type: validTypes.includes(entityType) ? entityType : 'concept',
    created: readScalar('created'),
    updated: readScalar('updated'),
    sources: readArray('sources'),
    links: readArray('links'),
    constitutionRefs: readArray('constitution-refs'),
    tags: readArray('tags'),
  };
}

/**
 * Extract the body text (content after the frontmatter block).
 */
export function extractBody(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---([\s\S]*)$/);
  return match ? match[1].trim() : content.trim();
}

/**
 * Parse a full entity page from its file content and path.
 */
export function parseEntityPage(content: string, filePath: string): WikiEntityPage | null {
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter || !frontmatter.entity) return null;
  return { frontmatter, body: extractBody(content), filePath };
}

// ── Link graph ────────────────────────────────────────────────────────────────

/**
 * Scan all .md files in wikiDir, parse frontmatter, and build a bidirectional link map.
 * Returns Map<entityId, Set<entityId>> where the key has inbound links FROM the values.
 */
export async function buildLinkGraph(
  wikiDir: string,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
): Promise<Map<string, Set<string>>> {
  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;

  const files = await readDir(wikiDir);
  const outbound = new Map<string, Set<string>>(); // entityId → entities it links to
  const allEntities = new Set<string>();

  // First pass: collect all entity IDs and outbound links
  for (const filePath of files) {
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (!fm?.entity) continue;
      allEntities.add(fm.entity);
      outbound.set(fm.entity, new Set(fm.links.filter(Boolean)));
    } catch {
      // Skip unreadable files
    }
  }

  // Build inbound link map (for each entity, who links TO it)
  const inbound = new Map<string, Set<string>>();
  for (const entity of allEntities) {
    inbound.set(entity, new Set());
  }

  for (const [source, targets] of outbound.entries()) {
    for (const target of targets) {
      if (!inbound.has(target)) {
        inbound.set(target, new Set());
      }
      inbound.get(target)!.add(source);
    }
  }

  return inbound;
}

/**
 * Find pages with zero inbound links (orphans).
 */
export function findOrphanPages(graph: Map<string, Set<string>>): string[] {
  const orphans: string[] = [];
  for (const [entity, inboundSet] of graph.entries()) {
    if (inboundSet.size === 0) orphans.push(entity);
  }
  return orphans.sort();
}

/**
 * Compute average links per page (total inbound link references / page count).
 */
export function computeLinkDensity(graph: Map<string, Set<string>>): number {
  if (graph.size === 0) return 0;
  const total = [...graph.values()].reduce((sum, s) => sum + s.size, 0);
  return Math.round((total / graph.size) * 100) / 100;
}

/**
 * Check if a wikilink target resolves to an existing entity.
 */
export function resolveWikiLink(link: string, existingEntities: Set<string>): boolean {
  // Strip [[...]] notation if present
  const clean = link.replace(/^\[\[|\]\]$/g, '').trim().toLowerCase();
  for (const entity of existingEntities) {
    if (entity.toLowerCase() === clean) return true;
  }
  return false;
}

// ── Index file management ─────────────────────────────────────────────────────

/**
 * List all entity IDs found in a wiki directory by scanning .md files.
 */
export async function listEntityIds(
  wikiDir: string,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
): Promise<string[]> {
  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;

  const files = await readDir(wikiDir);
  const ids: string[] = [];

  for (const filePath of files) {
    try {
      const content = await readFile(filePath);
      const fm = parseFrontmatter(content);
      if (fm?.entity) ids.push(fm.entity);
    } catch {
      // Skip unreadable
    }
  }

  return ids.sort();
}

/**
 * Load a single entity page by entity ID from the wiki directory.
 * Scans all .md files looking for a matching `entity:` frontmatter value.
 */
export async function getEntityPage(
  entityId: string,
  wikiDir: string,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
): Promise<WikiEntityPage | null> {
  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;

  const files = await readDir(wikiDir);

  for (const filePath of files) {
    try {
      const content = await readFile(filePath);
      const page = parseEntityPage(content, filePath);
      if (page?.frontmatter.entity === entityId) return page;
    } catch {
      // Skip
    }
  }

  return null;
}

/**
 * Rebuild the master wiki/index.md file with entity listings, stats, and orphan info.
 * Returns the rebuilt WikiIndex metadata.
 */
export async function rebuildIndex(
  wikiDir: string,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
  _writeFile?: WriteFileFn,
  _mkdir?: MkdirFn,
): Promise<WikiIndex> {
  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;
  const writeFile = _writeFile ?? defaultWriteFile;
  const mkdir = _mkdir ?? defaultMkdir;

  const files = await readDir(wikiDir);
  const pages: WikiEntityPage[] = [];

  for (const filePath of files) {
    // Skip the index file itself
    if (filePath.endsWith('index.md')) continue;
    try {
      const content = await readFile(filePath);
      const page = parseEntityPage(content, filePath);
      if (page) pages.push(page);
    } catch {
      // Skip
    }
  }

  const graph = await buildLinkGraph(wikiDir, _readDir, _readFile);
  const orphans = findOrphanPages(graph);
  const linkDensity = computeLinkDensity(graph);
  const now = new Date().toISOString();

  // Build index entries
  const entries: WikiIndexEntry[] = pages.map(page => {
    const { entity, type, updated, tags, links } = page.frontmatter;
    return {
      entityId: entity,
      type,
      filePath: page.filePath,
      tags,
      inboundLinks: [...(graph.get(entity) ?? new Set())],
      outboundLinks: links,
      lastUpdated: updated || now,
    };
  });

  // Total outbound links
  const totalLinks = entries.reduce((sum, e) => sum + e.outboundLinks.length, 0);

  // Write index.md
  const indexLines: string[] = [
    '# Wiki Index',
    '',
    `**Last built:** ${now}`,
    `**Pages:** ${pages.length}`,
    `**Total links:** ${totalLinks}`,
    `**Link density:** ${linkDensity}`,
    `**Orphan pages:** ${orphans.length}`,
    '',
    '## Entities',
    '',
  ];

  for (const entry of entries.sort((a, b) => a.entityId.localeCompare(b.entityId))) {
    const tagStr = entry.tags.length ? ` \`[${entry.tags.join(', ')}]\`` : '';
    const linksStr = entry.outboundLinks.length ? ` → ${entry.outboundLinks.join(', ')}` : '';
    indexLines.push(`- **${entry.entityId}** (${entry.type})${tagStr}${linksStr}`);
  }

  if (orphans.length > 0) {
    indexLines.push('', '## Orphan Pages', '');
    orphans.forEach(o => indexLines.push(`- ${o}`));
  }

  await mkdir(wikiDir, { recursive: true });
  const indexPath = path.join(wikiDir, 'index.md');
  await writeFile(indexPath, indexLines.join('\n') + '\n');

  return {
    entities: entries,
    lastBuilt: now,
    totalLinks,
    orphanCount: orphans.length,
  };
}
