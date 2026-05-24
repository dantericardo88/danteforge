// titan-harvest-loop — clean-room harvest pipeline for GPL/AGPL-licensed OSS repos.
// For each repo in the titan registry with status 'pending', clones it temporarily,
// feeds key files to the LLM for conceptual pattern extraction (no code copying),
// writes a pattern document to .danteforge/titan-patterns/<name>.md, then deletes
// the clone. Legally clean: we store LLM-generated analysis, not GPL source code.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { callLLM, isLLMAvailable } from '../../core/llm.js';
import {
  loadTitanRegistry,
  saveTitanRegistry,
  pendingTitanEntries,
  type TitanRegistryEntry,
} from '../../core/titan-registry.js';
import { getOssCacheRoot, ensureCacheRoot } from '../../core/oss-cache.js';

const execFileAsync = promisify(execFile);

const CLONE_TIMEOUT_MS = 180_000;
const LINES_PER_FILE = 250;
const MAX_SOURCE_FILES = 5;
const TITAN_PATTERNS_DIR = 'titan-patterns';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TitanHarvestOptions {
  cwd?: string;
  /** Max repos to analyze per run (default 10) */
  maxReposPerRun?: number;
  /** Retry repos that previously failed (default true) */
  retryFailed?: boolean;
  /** Show plan without cloning or calling LLM */
  dryRun?: boolean;
  /** Injection seams for testing */
  _clone?: (url: string, dest: string) => Promise<boolean>;
  _callLLM?: (prompt: string) => Promise<string>;
}

export interface TitanHarvestResult {
  analyzed: string[];
  failed: string[];
  skipped: string[];
  totalPending: number;
}

// ── File reading ──────────────────────────────────────────────────────────────

async function readLines(filePath: string, maxLines: number): Promise<string> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    const truncated = lines.slice(0, maxLines);
    const suffix = lines.length > maxLines ? `\n[... ${lines.length - maxLines} more lines truncated]` : '';
    return truncated.join('\n') + suffix;
  } catch {
    return '';
  }
}

async function collectRepoFiles(repoDir: string): Promise<string> {
  const sections: string[] = [];

  // README
  for (const name of ['README.md', 'README.rst', 'README.txt', 'README']) {
    const content = await readLines(path.join(repoDir, name), 150);
    if (content) { sections.push(`## ${name}\n\`\`\`\n${content}\n\`\`\``); break; }
  }

  // Package manifest (deps signal)
  for (const name of ['package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']) {
    const content = await readLines(path.join(repoDir, name), 60);
    if (content) { sections.push(`## ${name}\n\`\`\`\n${content}\n\`\`\``); break; }
  }

  // Core source files
  const srcDirs = ['src', 'lib', 'core', '.'];
  const extensions = ['.ts', '.js', '.py', '.go', '.rs'];
  const seenFiles = new Set<string>();
  let fileCount = 0;

  for (const dir of srcDirs) {
    if (fileCount >= MAX_SOURCE_FILES) break;
    const dirPath = path.join(repoDir, dir);
    let entries: string[] = [];
    try { entries = await fs.readdir(dirPath); } catch { continue; }

    for (const entry of entries) {
      if (fileCount >= MAX_SOURCE_FILES) break;
      if (!extensions.some(ext => entry.endsWith(ext))) continue;
      const fullPath = path.join(dirPath, entry);
      if (seenFiles.has(fullPath)) continue;
      seenFiles.add(fullPath);
      const content = await readLines(fullPath, LINES_PER_FILE);
      if (content) {
        sections.push(`## ${path.relative(repoDir, fullPath)}\n\`\`\`\n${content}\n\`\`\``);
        fileCount++;
      }
    }
  }

  return sections.join('\n\n');
}

// ── Clean-room LLM prompt ─────────────────────────────────────────────────────

function buildCleanRoomPrompt(entry: TitanRegistryEntry, fileContents: string): string {
  return `
You are performing a CLEAN-ROOM architectural analysis of the OSS project "${entry.name}" (${entry.url}).

LICENSE CONSTRAINT: This project is licensed under ${entry.license}, which is copyleft. You are reading it for learning purposes only. Your output MUST be entirely in your own words — conceptual documentation and architectural insight. You MUST NOT quote source code verbatim or reproduce function signatures, variable names, or implementation details directly from the source.

PROJECT FILES:
${fileContents}

---

Produce a clean-room pattern document covering these sections. Be specific and actionable — a developer should be able to independently re-implement these ideas without ever reading the original source:

# Clean-Room Analysis: ${entry.name}

## 1. Architecture Overview
How is the system structured? What are the key subsystems and their responsibilities? How do they communicate?

## 2. Core Algorithms & Strategies
What algorithmic approaches make this project effective? Describe the concepts, not the code.

## 3. API & Interface Design Patterns
How are public interfaces designed? What design decisions stand out?

## 4. Key Data Structures & State Management
What data structures underpin the core functionality and why do they work well here?

## 5. Competitive Advantages
What specifically makes this project better than naive implementations? What is its "secret sauce"?

## 6. Implementation Targets
List 5-10 concrete patterns worth independently re-implementing. For each: what it does, why it matters, how to approach it from scratch.

## 7. Gaps & Weaknesses
What does this project do poorly? Where are the obvious improvement opportunities?

Return only the markdown document. No preamble, no explanation outside the document.
`.trim();
}

// ── Clone helpers ─────────────────────────────────────────────────────────────

function getTitanTempDir(name: string, cwd?: string): string {
  const slug = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  return path.join(getOssCacheRoot(cwd), 'titan-temp', slug);
}

async function defaultClone(url: string, dest: string): Promise<boolean> {
  try {
    await ensureCacheRoot();
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', url, dest], {
      timeout: CLONE_TIMEOUT_MS,
    });
    return true;
  } catch (err) {
    logger.warn(`[titan-harvest] Clone failed ${url}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

async function safeDeleteClone(dest: string): Promise<void> {
  try { await fs.rm(dest, { recursive: true, force: true }); } catch { /* best-effort */ }
}

// ── Single repo analysis ──────────────────────────────────────────────────────

async function analyzeRepo(
  entry: TitanRegistryEntry,
  cwd: string,
  opts: { dryRun: boolean; clone: typeof defaultClone; llm: typeof callLLM },
): Promise<{ ok: boolean; patternsCount: number; patternsFile: string }> {
  const tempDir = getTitanTempDir(entry.name, cwd);
  const patternsDir = path.join(cwd, '.danteforge', TITAN_PATTERNS_DIR);
  const patternsFile = path.join(patternsDir, `${entry.name.replace(/[^a-z0-9-]/gi, '-').toLowerCase()}.md`);
  const relPatternsFile = path.relative(cwd, patternsFile);

  if (opts.dryRun) {
    logger.info(`[titan-harvest] [dry-run] Would analyze ${entry.url} → ${relPatternsFile}`);
    return { ok: true, patternsCount: 0, patternsFile: relPatternsFile };
  }

  // Clone temporarily
  logger.info(`[titan-harvest] Cloning ${entry.url} for analysis...`);
  const cloned = await opts.clone(entry.url, tempDir);
  if (!cloned) return { ok: false, patternsCount: 0, patternsFile: relPatternsFile };

  try {
    // Read key files
    const fileContents = await collectRepoFiles(tempDir);
    if (!fileContents.trim()) {
      logger.warn(`[titan-harvest] "${entry.name}" — no readable source files found.`);
      return { ok: false, patternsCount: 0, patternsFile: relPatternsFile };
    }

    // LLM clean-room analysis
    logger.info(`[titan-harvest] Running clean-room analysis on "${entry.name}"...`);
    const prompt = buildCleanRoomPrompt(entry, fileContents);
    const analysis = await opts.llm(prompt);

    // Write pattern document
    await fs.mkdir(patternsDir, { recursive: true });
    const header = `---\nname: ${entry.name}\nurl: ${entry.url}\nlicense: ${entry.license}\nanalyzedAt: ${new Date().toISOString()}\ncleanRoom: true\n---\n\n`;
    await fs.writeFile(patternsFile, header + analysis, 'utf8');

    const sections = (analysis.match(/^## /gm) ?? []).length;
    logger.info(`[titan-harvest] ✓ "${entry.name}" — ${sections} pattern sections written to ${relPatternsFile}`);
    return { ok: true, patternsCount: sections, patternsFile: relPatternsFile };
  } finally {
    // Always delete the GPL clone — analysis is complete
    await safeDeleteClone(tempDir);
  }
}

// ── Main loop ─────────────────────────────────────────────────────────────────

export async function titanHarvestLoop(options: TitanHarvestOptions = {}): Promise<TitanHarvestResult> {
  const cwd = options.cwd ?? process.cwd();
  const maxReposPerRun = options.maxReposPerRun ?? 10;
  const dryRun = options.dryRun ?? false;
  const clone = options._clone ?? defaultClone;
  const llm = options._callLLM ?? callLLM;

  const result: TitanHarvestResult = { analyzed: [], failed: [], skipped: [], totalPending: 0 };

  if (!dryRun) {
    const llmAvailable = await isLLMAvailable();
    if (!llmAvailable) {
      logger.warn('[titan-harvest] No LLM available — clean-room analysis requires an LLM. Configure one with `danteforge config`.');
      return result;
    }
  }

  const registry = await loadTitanRegistry(cwd);
  const pending = pendingTitanEntries(registry);
  result.totalPending = pending.length;

  if (pending.length === 0) {
    logger.info('[titan-harvest] No pending repos in titan registry. Run `danteforge oss-loop` first to populate it.');
    return result;
  }

  logger.info(`[titan-harvest] ${pending.length} repo(s) pending clean-room harvest. Processing up to ${maxReposPerRun}.`);

  const batch = pending.slice(0, maxReposPerRun);

  for (const entry of batch) {
    logger.info(`\n[titan-harvest] ── ${entry.name} (${entry.license}) ──────────────────`);
    entry.harvestAttempts++;
    entry.lastHarvestAt = new Date().toISOString();

    const { ok, patternsCount, patternsFile } = await analyzeRepo(entry, cwd, { dryRun, clone, llm });

    if (ok) {
      entry.harvestStatus = 'complete';
      entry.patternsCount = patternsCount;
      entry.patternsFile = patternsFile;
      result.analyzed.push(entry.name);
    } else {
      entry.harvestStatus = 'failed';
      result.failed.push(entry.name);
    }

    await saveTitanRegistry(registry, cwd);
  }

  const remaining = pending.length - batch.length;
  if (remaining > 0) {
    result.skipped = pending.slice(maxReposPerRun).map(r => r.name);
    logger.info(`\n[titan-harvest] ${remaining} repo(s) remaining — re-run to continue.`);
  }

  logger.info('\n[titan-harvest] ─────────────────────────────────────────────────');
  logger.info(`[titan-harvest] Analyzed:  ${result.analyzed.length} repo(s) — ${result.analyzed.join(', ') || 'none'}`);
  logger.info(`[titan-harvest] Failed:    ${result.failed.length} repo(s) — ${result.failed.join(', ') || 'none'}`);
  logger.info(`[titan-harvest] Remaining: ${remaining} repo(s) queued`);
  logger.info('[titan-harvest] ─────────────────────────────────────────────────');
  logger.info(`[titan-harvest] Pattern docs: ${path.join(cwd, '.danteforge', TITAN_PATTERNS_DIR)}`);
  logger.info('[titan-harvest] Next: run `danteforge crusade` — titan patterns are automatically included in harvest context.');

  return result;
}
