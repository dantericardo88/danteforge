// Local Harvester — token-efficient pattern extraction from private repos, folders, and archives.
import fs from 'fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { estimateTokens } from './token-estimator.js';
import { callLLM } from './llm.js';
import { logger } from './logger.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type LocalSourceType = 'folder' | 'zip' | 'git-repo';
export type HarvestDepth = 'shallow' | 'medium' | 'full';

export interface LocalSource {
  path: string;
  /** Auto-detected if omitted */
  type?: LocalSourceType;
  label?: string;
  depth: HarvestDepth;
}

export interface LocalPattern {
  category: string;
  name: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
}

export interface LocalSourceResult {
  source: LocalSource;
  resolvedType: LocalSourceType;
  planningDocs: { name: string; content: string; tokens: number }[];
  codeInsights: { file: string; snippet: string }[];
  patterns: LocalPattern[];
  tokensUsed: number;
  error?: string;
}

export interface LocalHarvestReport {
  sources: LocalSourceResult[];
  synthesis: string;
  topPatterns: LocalPattern[];
  /** Feed these into oss researcher for complementary discovery */
  recommendedOssQueries: string[];
  generatedAt: string;
}

export interface LocalHarvesterFsOps {
  readFile: (p: string, enc: string) => Promise<string>;
  readdir: (p: string) => Promise<string[]>;
  stat: (p: string) => Promise<{ isDirectory(): boolean; size: number }>;
  exists: (p: string) => Promise<boolean>;
}

export interface LocalHarvesterOptions {
  depth?: HarvestDepth;
  maxTokensPerSource?: number;
  cwd?: string;
  _llmCaller?: (prompt: string) => Promise<string>;
  _fsOps?: LocalHarvesterFsOps;
  _extractZip?: (zipPath: string, destDir: string) => Promise<void>;
}

// ── Constants ────────────────────────────────────────────────────────────────

const PLANNING_DOC_PRIORITY = [
  'UPR.md',
  'SPEC.md',
  'PLAN.md',
  'CONSTITUTION.md',
  'TASKS.md',
  'README.md',
  'CURRENT_STATE.md',
  'DESIGN.md',
  'ARCHITECTURE.md',
];

const ENTRY_POINT_CANDIDATES = [
  'src/index.ts',
  'src/index.js',
  'index.ts',
  'index.js',
  'lib/index.ts',
  'lib/index.js',
  'main.ts',
  'main.js',
  'app.ts',
  'app.js',
];

const MANIFEST_CANDIDATES = ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod'];
const MAX_CHARS_PER_DOC = 3000;
const MAX_CHARS_PER_SNIPPET = 1500;
const TRUNCATION_MARKER = '\n... [truncated]';
const PATTERN_LINE_REGEX = /^PATTERN\|([^|]+)\|([^|]+)\|([^|]+)\|(P[012])$/;

// ── Source type detection ────────────────────────────────────────────────────

export async function detectSourceType(
  sourcePath: string,
  fsOps: LocalHarvesterFsOps,
): Promise<LocalSourceType> {
  const lower = sourcePath.toLowerCase();
  if (lower.endsWith('.zip') || lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) {
    return 'zip';
  }
  try {
    const stat = await fsOps.stat(sourcePath);
    if (stat.isDirectory()) {
      const hasGit = await fsOps.exists(path.join(sourcePath, '.git'));
      return hasGit ? 'git-repo' : 'folder';
    }
  } catch {
    // Fall through
  }
  return 'folder';
}

// ── Planning document reader ─────────────────────────────────────────────────

export async function readPlanningDocs(
  folderPath: string,
  fsOps: LocalHarvesterFsOps,
  maxTokens: number,
): Promise<{ name: string; content: string; tokens: number }[]> {
  const tokenBudget = Math.floor(maxTokens * 0.6);
  let usedTokens = 0;
  const results: { name: string; content: string; tokens: number }[] = [];

  for (const docName of PLANNING_DOC_PRIORITY) {
    if (usedTokens >= tokenBudget) break;
    const docPath = path.join(folderPath, docName);
    try {
      let content = await fsOps.readFile(docPath, 'utf-8');
      if (content.length > MAX_CHARS_PER_DOC) {
        content = content.slice(0, MAX_CHARS_PER_DOC) + TRUNCATION_MARKER;
      }
      const tokens = estimateTokens(content);
      usedTokens += tokens;
      results.push({ name: docName, content, tokens });
    } catch {
      // File doesn't exist — skip
    }
  }

  return results;
}

// ── Code insight reader ──────────────────────────────────────────────────────

export async function readCodeInsights(
  folderPath: string,
  fsOps: LocalHarvesterFsOps,
  depth: HarvestDepth,
  maxTokens: number,
): Promise<{ file: string; snippet: string }[]> {
  if (depth === 'shallow') return [];

  const tokenBudget = Math.floor(maxTokens * 0.4);
  let usedTokens = 0;
  const results: { file: string; snippet: string }[] = [];

  // Read first available manifest
  for (const manifest of MANIFEST_CANDIDATES) {
    const p = path.join(folderPath, manifest);
    try {
      let content = await fsOps.readFile(p, 'utf-8');
      if (content.length > MAX_CHARS_PER_SNIPPET) {
        content = content.slice(0, MAX_CHARS_PER_SNIPPET) + TRUNCATION_MARKER;
      }
      const tokens = estimateTokens(content);
      usedTokens += tokens;
      results.push({ file: manifest, snippet: content });
      break;
    } catch {
      // Not found
    }
  }

  // Read entry point(s)
  const maxEntries = depth === 'full' ? 4 : 1;
  let entriesRead = 0;
  const maxChars = depth === 'full' ? 1000 : MAX_CHARS_PER_SNIPPET;

  for (const entry of ENTRY_POINT_CANDIDATES) {
    if (entriesRead >= maxEntries || usedTokens >= tokenBudget) break;
    const p = path.join(folderPath, entry);
    try {
      let content = await fsOps.readFile(p, 'utf-8');
      if (content.length > maxChars) {
        content = content.slice(0, maxChars) + TRUNCATION_MARKER;
      }
      const tokens = estimateTokens(content);
      usedTokens += tokens;
      results.push({ file: entry, snippet: content });
      entriesRead++;
    } catch {
      // Not found
    }
  }

  return results;
}

// ── Pattern extraction via LLM ───────────────────────────────────────────────

export async function extractLocalPatterns(
  planningDocs: { name: string; content: string }[],
  codeInsights: { file: string; snippet: string }[],
  llmCaller: (prompt: string) => Promise<string>,
): Promise<LocalPattern[]> {
  if (planningDocs.length === 0 && codeInsights.length === 0) return [];

  const docsText = planningDocs.map(d => `### ${d.name}\n${d.content}`).join('\n\n');
  const codeText = codeInsights.map(c => `### ${c.file}\n${c.snippet}`).join('\n\n');

  const prompt = `You are analyzing a private software project to extract its best ideas.

## Planning Documents
${docsText || '(none)'}

## Code Insights
${codeText || '(none)'}

Extract the top 3-5 patterns worth preserving: architecture choices, novel ideas, technical approaches, reusable design decisions.

For each pattern, output exactly one line:
PATTERN|category|name|description|priority

Where:
- category: one of: architecture, agent-ai, cli-ux, quality, innovation, data, auth, api
- name: 2-5 word name
- description: one sentence max 120 chars
- priority: P0 (high impact, low effort) | P1 (high impact) | P2 (medium impact)

Output ONLY the PATTERN| lines, nothing else.`;

  try {
    const response = await llmCaller(prompt);
    const patterns: LocalPattern[] = [];
    for (const line of response.split('\n')) {
      const match = PATTERN_LINE_REGEX.exec(line.trim());
      if (match) {
        patterns.push({
          category: match[1]!.trim(),
          name: match[2]!.trim(),
          description: match[3]!.trim(),
          priority: match[4]! as 'P0' | 'P1' | 'P2',
        });
      }
    }
    return patterns;
  } catch {
    return [];
  }
}

// ── Cross-source synthesis ───────────────────────────────────────────────────

export async function synthesizeHarvest(
  results: LocalSourceResult[],
  llmCaller: (prompt: string) => Promise<string>,
): Promise<{ synthesis: string; recommendedOssQueries: string[] }> {
  const allPatterns = results.flatMap(r => r.patterns);

  if (allPatterns.length === 0) {
    return { synthesis: 'No patterns extracted from local sources.', recommendedOssQueries: [] };
  }

  const patternSummary = allPatterns
    .map(p => `[${p.priority}] ${p.category}: ${p.name} — ${p.description}`)
    .join('\n');

  const sourceLabels = results
    .map((r, i) => r.source.label ?? path.basename(r.source.path) ?? `Source ${i + 1}`)
    .join(', ');

  const prompt = `You analyzed these private project sources: ${sourceLabels}

Top patterns found:
${patternSummary}

1. Write a 2-3 sentence synthesis of the most valuable ideas to carry forward.
2. List 3-5 specific GitHub search queries to find OSS projects implementing these patterns.

Format:
SYNTHESIS: <2-3 sentence synthesis>
QUERY: <query 1>
QUERY: <query 2>
QUERY: <query 3>`;

  try {
    const response = await llmCaller(prompt);
    const synthesis =
      response.match(/SYNTHESIS:\s*(.+?)(?=QUERY:|$)/s)?.[1]?.trim() ??
      allPatterns.map(p => p.name).join(', ');
    const queries = [...response.matchAll(/QUERY:\s*(.+)/g)].map(m => m[1]!.trim());
    return { synthesis, recommendedOssQueries: queries };
  } catch {
    return {
      synthesis: allPatterns.map(p => p.name).join(', '),
      recommendedOssQueries: [],
    };
  }
}

// ── Zip extraction ───────────────────────────────────────────────────────────

export async function extractZipToTemp(zipPath: string, destDir: string): Promise<void> {
  if (process.platform === 'win32') {
    const result = spawnSync('powershell', [
      '-Command',
      `Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force`,
    ]);
    if (result.status !== 0) {
      throw new Error(
        `Failed to extract zip: ${result.stderr?.toString().trim() ?? 'unknown error'}`,
      );
    }
  } else {
    if (zipPath.endsWith('.tar.gz') || zipPath.endsWith('.tgz')) {
      const result = spawnSync('tar', ['-xzf', zipPath, '-C', destDir]);
      if (result.status !== 0) {
        throw new Error(
          `Failed to extract archive: ${result.stderr?.toString().trim() ?? 'unknown error'}`,
        );
      }
    } else {
      const result = spawnSync('unzip', ['-q', '-o', zipPath, '-d', destDir]);
      if (result.status !== 0) {
        throw new Error(
          `Failed to extract zip: ${result.stderr?.toString().trim() ?? 'unknown error'}. Install unzip or extract manually.`,
        );
      }
    }
  }
}

// ── Main entry ───────────────────────────────────────────────────────────────

export async function harvestLocalSources(
  sources: LocalSource[],
  opts: LocalHarvesterOptions = {},
): Promise<LocalHarvestReport> {
  const depth = opts.depth ?? 'medium';
  const maxTokensPerSource = opts.maxTokensPerSource ?? 6000;
  const cwd = opts.cwd ?? process.cwd();

  const fsOps: LocalHarvesterFsOps = opts._fsOps ?? {
    readFile: (p, enc) => fs.readFile(p, enc as BufferEncoding),
    readdir: (p) => fs.readdir(p),
    stat: (p) => fs.stat(p),
    exists: async (p) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    },
  };

  const llmCaller =
    opts._llmCaller ??
    ((prompt: string) => callLLM(prompt, undefined, { enrichContext: false }));

  const doExtractZip = opts._extractZip ?? extractZipToTemp;

  const results: LocalSourceResult[] = [];

  for (const source of sources) {
    const sourcePath = path.isAbsolute(source.path)
      ? source.path
      : path.join(cwd, source.path);

    const result: LocalSourceResult = {
      source,
      resolvedType: 'folder',
      planningDocs: [],
      codeInsights: [],
      patterns: [],
      tokensUsed: 0,
    };

    try {
      result.resolvedType = await detectSourceType(sourcePath, fsOps);

      let workingPath = sourcePath;

      if (result.resolvedType === 'zip') {
        const tempDir = path.join(os.tmpdir(), `danteforge-harvest-${Date.now()}`);
        await mkdir(tempDir, { recursive: true });
        await doExtractZip(sourcePath, tempDir);
        workingPath = tempDir;
      }

      const sourceDepth = source.depth ?? depth;
      result.planningDocs = await readPlanningDocs(workingPath, fsOps, maxTokensPerSource);
      result.codeInsights = await readCodeInsights(workingPath, fsOps, sourceDepth, maxTokensPerSource);
      result.patterns = await extractLocalPatterns(
        result.planningDocs,
        result.codeInsights,
        llmCaller,
      );
      result.tokensUsed = result.planningDocs.reduce((sum, d) => sum + d.tokens, 0);

      logger.success(
        `[local-harvest] ${path.basename(sourcePath)}: ${result.planningDocs.length} docs, ${result.patterns.length} patterns`,
      );
    } catch (err) {
      result.error = err instanceof Error ? err.message : String(err);
      logger.warn(`[local-harvest] Failed to harvest ${sourcePath}: ${result.error}`);
    }

    results.push(result);
  }

  const { synthesis, recommendedOssQueries } = await synthesizeHarvest(results, llmCaller);

  const topPatterns = results
    .flatMap(r => r.patterns)
    .sort((a, b) => a.priority.localeCompare(b.priority));

  const report: LocalHarvestReport = {
    sources: results,
    synthesis,
    topPatterns,
    recommendedOssQueries,
    generatedAt: new Date().toISOString(),
  };

  // Write report files (best-effort)
  try {
    const danteDir = path.join(cwd, '.danteforge');
    await mkdir(danteDir, { recursive: true });
    await writeFile(
      path.join(danteDir, 'LOCAL_HARVEST_REPORT.md'),
      buildLocalHarvestMarkdown(report),
      'utf-8',
    );
    await writeFile(
      path.join(danteDir, 'local-harvest-summary.json'),
      JSON.stringify(
        {
          synthesis,
          topPatterns,
          recommendedOssQueries,
          generatedAt: report.generatedAt,
          sourceCount: results.length,
          totalPatterns: topPatterns.length,
        },
        null,
        2,
      ),
      'utf-8',
    );
  } catch (err) {
    logger.warn(
      `[local-harvest] Failed to write report files: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return report;
}

// ── Report formatter ─────────────────────────────────────────────────────────

export function buildLocalHarvestMarkdown(report: LocalHarvestReport): string {
  const lines: string[] = [
    '# Local Harvest Report',
    '',
    `Generated: ${report.generatedAt}`,
    `Sources analyzed: ${report.sources.length}`,
    '',
    '## Synthesis',
    '',
    report.synthesis,
    '',
    '## Top Patterns',
    '',
  ];

  for (const pattern of report.topPatterns) {
    lines.push(
      `- **[${pattern.priority}] ${pattern.name}** (${pattern.category}): ${pattern.description}`,
    );
  }

  lines.push('', '## Recommended OSS Queries', '');
  for (const query of report.recommendedOssQueries) {
    lines.push(`- \`${query}\``);
  }

  lines.push('', '## Per-Source Details', '');
  for (const result of report.sources) {
    const label = result.source.label ?? path.basename(result.source.path);
    lines.push(`### ${label} (${result.resolvedType})`);
    if (result.error) {
      lines.push(`> Error: ${result.error}`);
    } else {
      lines.push(
        `- Planning docs: ${result.planningDocs.map(d => d.name).join(', ') || 'none'}`,
      );
      lines.push(
        `- Patterns: ${result.patterns.map(p => p.name).join(', ') || 'none'}`,
      );
      lines.push(`- Tokens used: ~${result.tokensUsed}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}
