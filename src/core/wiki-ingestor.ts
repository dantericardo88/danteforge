// Wiki Ingestor — converts raw source files into compiled wiki entity pages
// Handles: manifest tracking, SHA-256 change detection, LLM entity extraction,
// fuzzy matching against existing entities, and page upsert with History entries.

import path from 'node:path';
import crypto from 'node:crypto';
import {
  type WikiFrontmatter,
  type RawManifest,
  type WikiAuditEntry,
  RAW_DIR,
  WIKI_DIR,
  RAW_MANIFEST_FILE,
  FUZZY_MATCH_THRESHOLD,
  AUDIT_LOG_FILE,
} from './wiki-schema.js';
import { parseFrontmatter, extractBody, rebuildIndex } from './wiki-indexer.js';
import { ANTI_STUB_PATTERNS } from './pdse-config.js';

// ── I/O injection types ───────────────────────────────────────────────────────

export type ReadFileFn = (filePath: string) => Promise<string>;
export type WriteFileFn = (filePath: string, content: string) => Promise<void>;
export type ReadDirFn = (dirPath: string) => Promise<string[]>;
export type ExistsFn = (filePath: string) => Promise<boolean>;
export type MkdirFn = (dirPath: string, opts?: { recursive?: boolean }) => Promise<void>;
export type LLMCallerFn = (prompt: string) => Promise<string>;

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
      .filter(e => e.isFile() && !e.name.startsWith('.'))
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

// ── Options ───────────────────────────────────────────────────────────────────

export interface WikiIngestOptions {
  cwd?: string;
  _llmCaller?: LLMCallerFn;
  _readFile?: ReadFileFn;
  _writeFile?: WriteFileFn;
  _readDir?: ReadDirFn;
  _exists?: ExistsFn;
  _mkdir?: MkdirFn;
}

// ── Utility ───────────────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hex digest of string content.
 * Matches the pattern in safe-self-edit.ts.
 */
export function computeFileHash(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Inline Levenshtein distance for fuzzy entity matching.
 * Returns 0..1 similarity (1 = identical).
 */
export function levenshteinSimilarity(a: string, b: string): number {
  const aLow = a.toLowerCase();
  const bLow = b.toLowerCase();
  if (aLow === bLow) return 1;
  if (!aLow.length || !bLow.length) return 0;

  const m = aLow.length;
  const n = bLow.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);

  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = aLow[i - 1] === bLow[j - 1] ? 0 : 1;
      curr.push(Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost));
    }
    prev = curr;
  }

  const dist = prev[n];
  return 1 - dist / Math.max(m, n);
}

/**
 * Find the best matching existing entity for a candidate name.
 * Returns the matched entity ID and score, or null if no match above threshold.
 */
export function fuzzyMatchEntity(
  name: string,
  existingEntities: string[],
  threshold = FUZZY_MATCH_THRESHOLD,
): { entityId: string; score: number } | null {
  let best: { entityId: string; score: number } | null = null;

  for (const entity of existingEntities) {
    const score = levenshteinSimilarity(name, entity);
    if (score >= threshold && (!best || score > best.score)) {
      best = { entityId: entity, score };
    }
  }

  return best;
}

/**
 * Check if content contains anti-stub patterns (from PDSE config).
 */
export function hasStubContent(content: string): boolean {
  return ANTI_STUB_PATTERNS.some(pattern => {
    if (typeof pattern === 'string') {
      return content.toLowerCase().includes(pattern.toLowerCase());
    }
    return pattern.test(content);
  });
}

// ── Raw manifest ──────────────────────────────────────────────────────────────

export async function loadRawManifest(
  cwd?: string,
  _readFile?: ReadFileFn,
): Promise<RawManifest> {
  const readFile = _readFile ?? defaultReadFile;
  const manifestPath = path.join(cwd ?? process.cwd(), RAW_MANIFEST_FILE);

  try {
    const content = await readFile(manifestPath);
    return JSON.parse(content) as RawManifest;
  } catch {
    return { files: {}, lastUpdated: new Date().toISOString() };
  }
}

export async function saveRawManifest(
  manifest: RawManifest,
  cwd?: string,
  _writeFile?: WriteFileFn,
  _mkdir?: MkdirFn,
): Promise<void> {
  const writeFile = _writeFile ?? defaultWriteFile;
  const mkdir = _mkdir ?? defaultMkdir;
  const manifestPath = path.join(cwd ?? process.cwd(), RAW_MANIFEST_FILE);
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}

// ── New file detection ────────────────────────────────────────────────────────

/**
 * Detect files in rawDir that are new or have changed since last ingest.
 * Returns absolute file paths for processing.
 */
export async function detectNewFiles(
  rawDir: string,
  manifest: RawManifest,
  _readDir?: ReadDirFn,
  _readFile?: ReadFileFn,
): Promise<string[]> {
  const readDir = _readDir ?? defaultReadDir;
  const readFile = _readFile ?? defaultReadFile;

  const files = await readDir(rawDir);
  const newOrChanged: string[] = [];

  for (const filePath of files) {
    const relPath = path.relative(rawDir, filePath).replace(/\\/g, '/');
    const existing = manifest.files[relPath];

    try {
      const content = await readFile(filePath);
      const hash = computeFileHash(content);

      if (!existing || existing.hash !== hash) {
        newOrChanged.push(filePath);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return newOrChanged;
}

// ── LLM entity extraction ─────────────────────────────────────────────────────

export interface ExtractedEntities {
  entities: Array<{
    name: string;
    type: 'module' | 'decision' | 'pattern' | 'tool' | 'concept';
    summary: string;
    tags: string[];
  }>;
  relationships: Array<{ from: string; to: string }>;
}

/**
 * Extract entities from a raw source file using LLM or fallback header extraction.
 */
export async function extractEntitiesFromRaw(
  content: string,
  filePath: string,
  _llmCaller?: LLMCallerFn,
): Promise<ExtractedEntities> {
  if (_llmCaller) {
    const prompt = [
      'You are a knowledge extraction system. Given the following document, extract all named entities',
      '(modules, architectural decisions, patterns, tools, and concepts) as structured JSON.',
      '',
      'Return ONLY a JSON object matching this schema:',
      '{ "entities": [{ "name": string, "type": "module"|"decision"|"pattern"|"tool"|"concept", "summary": string, "tags": string[] }],',
      '  "relationships": [{ "from": string, "to": string }] }',
      '',
      `Document path: ${filePath}`,
      '---',
      content.slice(0, 8000), // Cap at 8k chars to limit token usage
    ].join('\n');

    try {
      const response = await _llmCaller(prompt);
      // Extract JSON from response (may be wrapped in markdown code blocks)
      const jsonMatch = response.match(/```(?:json)?\s*([\s\S]*?)```/) ??
                        response.match(/(\{[\s\S]*\})/);
      const raw = JSON.parse(jsonMatch ? jsonMatch[1] : response) as ExtractedEntities;
      return raw;
    } catch {
      // Fall through to header extraction
    }
  }

  // Fallback: extract headings as entities
  return extractEntitiesFromHeaders(content, filePath);
}

/**
 * Simple fallback: extract ## headings as entity names.
 */
function extractEntitiesFromHeaders(content: string, _filePath: string): ExtractedEntities {
  const entities: ExtractedEntities['entities'] = [];
  const headingRegex = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(content)) !== null) {
    const name = match[1].trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    if (name) {
      entities.push({
        name,
        type: 'concept',
        summary: `Extracted from heading: ${match[1].trim()}`,
        tags: [],
      });
    }
  }

  return { entities, relationships: [] };
}

// ── Entity page management ────────────────────────────────────────────────────

/**
 * Build a new entity page markdown string from extracted entity data.
 */
export function buildEntityPage(
  entity: { name: string; type: string; summary: string; tags: string[] },
  sourceFile: string,
  existingContent?: string,
): string {
  const now = new Date().toISOString();
  const entityId = entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (existingContent) {
    // Update existing page: bump updated timestamp, add History entry
    const existingFm = parseFrontmatter(existingContent);
    const existingBody = extractBody(existingContent);

    const newSource = sourceFile;
    const sources = existingFm ? [...new Set([...existingFm.sources, newSource])] : [newSource];

    const frontmatter = buildFrontmatter({
      entity: entityId,
      type: (existingFm?.type ?? entity.type) as WikiFrontmatter['type'],
      created: existingFm?.created ?? now,
      updated: now,
      sources,
      links: existingFm?.links ?? [],
      constitutionRefs: existingFm?.constitutionRefs ?? [],
      tags: [...new Set([...(existingFm?.tags ?? []), ...entity.tags])],
    });

    // Append History entry
    const historyEntry = `\n### ${now}\n\nRe-ingested from \`${sourceFile}\`. ${entity.summary}\n`;
    const updatedBody = existingBody.includes('## History')
      ? existingBody + historyEntry
      : existingBody + '\n\n## History\n' + historyEntry;

    return frontmatter + '\n' + updatedBody;
  }

  // New page
  const frontmatter = buildFrontmatter({
    entity: entityId,
    type: entity.type as WikiFrontmatter['type'],
    created: now,
    updated: now,
    sources: [sourceFile],
    links: [],
    constitutionRefs: [],
    tags: entity.tags,
  });

  const body = [
    `# ${entity.name}`,
    '',
    '## Summary',
    '',
    entity.summary,
    '',
    '## Architecture',
    '',
    '_Add architecture notes here._',
    '',
    '## Decisions',
    '',
    '_Architectural decisions will be recorded here._',
    '',
    '## History',
    '',
    `### ${now}`,
    '',
    `Initial ingestion from \`${sourceFile}\`.`,
  ].join('\n');

  return frontmatter + '\n' + body;
}

function buildFrontmatter(fm: WikiFrontmatter): string {
  const lines = [
    '---',
    `entity: "${fm.entity}"`,
    `type: ${fm.type}`,
    `created: ${fm.created}`,
    `updated: ${fm.updated}`,
    `sources:`,
    ...fm.sources.map(s => `  - ${s}`),
    `links:`,
    ...fm.links.map(l => `  - ${l}`),
    `constitution-refs:`,
    ...fm.constitutionRefs.map(r => `  - ${r}`),
    `tags:`,
    ...fm.tags.map(t => `  - ${t}`),
    '---',
  ];
  return lines.join('\n');
}

/**
 * Upsert an entity page: create new or append History entry to existing.
 * Rejects (throws) if the generated content contains anti-stub patterns.
 */
export async function upsertEntityPage(
  entity: { name: string; type: string; summary: string; tags: string[] },
  sourceFile: string,
  wikiDir: string,
  _readFile?: ReadFileFn,
  _writeFile?: WriteFileFn,
  _mkdir?: MkdirFn,
): Promise<string> {
  const readFile = _readFile ?? defaultReadFile;
  const writeFile = _writeFile ?? defaultWriteFile;
  const mkdir = _mkdir ?? defaultMkdir;

  const entityId = entity.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filePath = path.join(wikiDir, `${entityId}.md`);

  let existingContent: string | undefined;
  try {
    existingContent = await readFile(filePath);
  } catch {
    // New page
  }

  const newContent = buildEntityPage(entity, sourceFile, existingContent);

  // Anti-stub enforcement: never write placeholder content to wiki
  if (hasStubContent(newContent)) {
    throw new Error(`Anti-stub check failed for entity "${entityId}": generated content contains stub patterns`);
  }

  await mkdir(wikiDir, { recursive: true });
  await writeFile(filePath, newContent + '\n');
  return filePath;
}

// ── Audit log ─────────────────────────────────────────────────────────────────

export async function appendAuditEntry(
  entry: WikiAuditEntry,
  cwd?: string,
  _writeFile?: WriteFileFn,
  _readFile?: ReadFileFn,
  _mkdir?: MkdirFn,
): Promise<void> {
  const readFile = _readFile ?? defaultReadFile;
  const writeFile = _writeFile ?? defaultWriteFile;
  const mkdir = _mkdir ?? defaultMkdir;

  const auditPath = path.join(cwd ?? process.cwd(), AUDIT_LOG_FILE);
  await mkdir(path.dirname(auditPath), { recursive: true });

  let existing = '';
  try { existing = await readFile(auditPath); } catch { /* new file */ }

  await writeFile(auditPath, existing + JSON.stringify(entry) + '\n');
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const BOOTSTRAP_ARTIFACTS = [
  'CONSTITUTION.md', 'SPEC.md', 'PLAN.md', 'TASKS.md', 'lessons.md',
];

/**
 * Seed the wiki from existing .danteforge/ artifacts.
 * Does NOT modify or move source files — reads only.
 */
export async function bootstrapFromArtifacts(
  opts: WikiIngestOptions = {},
): Promise<{ ingested: string[]; skipped: string[] }> {
  const cwd = opts.cwd ?? process.cwd();
  const readFile = opts._readFile ?? defaultReadFile;
  const exists = opts._exists ?? defaultExists;
  const mkdir = opts._mkdir ?? defaultMkdir;
  const writeFile = opts._writeFile ?? defaultWriteFile;

  const wikiDir = path.join(cwd, WIKI_DIR);
  const danteforgeDir = path.join(cwd, '.danteforge');

  const ingested: string[] = [];
  const skipped: string[] = [];

  for (const artifactName of BOOTSTRAP_ARTIFACTS) {
    const artifactPath = path.join(danteforgeDir, artifactName);
    if (!(await exists(artifactPath))) { skipped.push(artifactName); continue; }

    try {
      const content = await readFile(artifactPath);
      const entityName = artifactName.replace(/\.md$/, '').toLowerCase();

      const extracted = await extractEntitiesFromRaw(content, artifactName, opts._llmCaller);

      // Always create a page for the artifact itself
      await upsertEntityPage(
        { name: entityName, type: 'module', summary: `Bootstrapped from ${artifactName}`, tags: ['artifact', 'bootstrap'] },
        artifactName,
        wikiDir,
        opts._readFile,
        opts._writeFile,
        mkdir,
      );

      // Also create pages for sub-entities found by extraction
      for (const entity of extracted.entities) {
        try {
          await upsertEntityPage(entity, artifactName, wikiDir, opts._readFile, opts._writeFile, mkdir);
        } catch {
          // Skip entities that fail anti-stub check
        }
      }

      ingested.push(artifactName);
    } catch {
      skipped.push(artifactName);
    }
  }

  // Rebuild index after bootstrap
  try {
    const readDir = opts._readDir ?? defaultReadDir;
    await rebuildIndex(wikiDir, readDir, opts._readFile, writeFile, mkdir);
  } catch {
    // Non-fatal
  }

  // Append audit entry
  try {
    await appendAuditEntry(
      {
        timestamp: new Date().toISOString(),
        event: 'bootstrap',
        triggeredBy: 'wiki-ingest --bootstrap',
        summary: `Bootstrapped ${ingested.length} artifacts, skipped ${skipped.length}`,
      },
      cwd,
      writeFile,
      readFile,
      mkdir,
    );
  } catch {
    // Non-fatal
  }

  return { ingested, skipped };
}

// ── Main ingest pipeline ──────────────────────────────────────────────────────

/**
 * Full ingest pipeline: detect new/changed raw files → extract entities → upsert pages →
 * rebuild index → update manifest → append audit entry.
 */
export async function ingest(opts: WikiIngestOptions = {}): Promise<{
  processed: string[];
  entityPages: string[];
  errors: string[];
}> {
  const cwd = opts.cwd ?? process.cwd();
  const readFile = opts._readFile ?? defaultReadFile;
  const writeFile = opts._writeFile ?? defaultWriteFile;
  const readDir = opts._readDir ?? defaultReadDir;
  const mkdir = opts._mkdir ?? defaultMkdir;

  const rawDir = path.join(cwd, RAW_DIR);
  const wikiDir = path.join(cwd, WIKI_DIR);

  await mkdir(rawDir, { recursive: true });
  await mkdir(wikiDir, { recursive: true });

  const manifest = await loadRawManifest(cwd, readFile);
  const newFiles = await detectNewFiles(rawDir, manifest, readDir, readFile);

  const processed: string[] = [];
  const entityPages: string[] = [];
  const errors: string[] = [];

  for (const filePath of newFiles) {
    try {
      const content = await readFile(filePath);
      const relPath = path.relative(rawDir, filePath).replace(/\\/g, '/');

      const extracted = await extractEntitiesFromRaw(content, relPath, opts._llmCaller);

      const pageFiles: string[] = [];
      for (const entity of extracted.entities) {
        try {
          const pf = await upsertEntityPage(entity, relPath, wikiDir, readFile, writeFile, mkdir);
          pageFiles.push(pf);
        } catch (err) {
          errors.push(`Entity "${entity.name}": ${String(err)}`);
        }
      }

      // Update manifest entry
      manifest.files[relPath] = {
        hash: computeFileHash(content),
        ingestedAt: new Date().toISOString(),
        entityIds: extracted.entities.map(e => e.name),
      };

      processed.push(filePath);
      entityPages.push(...pageFiles);
    } catch (err) {
      errors.push(`File "${filePath}": ${String(err)}`);
    }
  }

  // Persist manifest
  manifest.lastUpdated = new Date().toISOString();
  await saveRawManifest(manifest, cwd, writeFile, mkdir);

  // Rebuild index
  try {
    await rebuildIndex(wikiDir, readDir, readFile, writeFile, mkdir);
  } catch {
    // Non-fatal
  }

  // Audit entry
  try {
    await appendAuditEntry(
      {
        timestamp: new Date().toISOString(),
        event: 'ingest',
        triggeredBy: 'wiki-ingest',
        summary: `Processed ${processed.length} files, created/updated ${entityPages.length} entity pages`,
      },
      cwd,
      writeFile,
      readFile,
      mkdir,
    );
  } catch {
    // Non-fatal
  }

  return { processed, entityPages, errors };
}
