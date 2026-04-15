// OSS Deep — systematic full extraction from a single OSS repo.
// Stores everything persistently under .danteforge/oss-deep/{slug}/.
// Three modes: LLM execute / --prompt (print plan) / local fallback (deterministic extraction).

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import { selectBestModel, loadPerformanceIndex } from '../../core/model-selector.js';
import { loadRegistry, saveRegistry, upsertEntry, getOssReposDir } from '../../core/oss-registry.js';

const execFileAsync = promisify(execFile);
const CLONE_TIMEOUT_MS = 180_000;

/** Increment when the extraction prompt changes — written to patterns.json for drift detection. */
export const EXTRACTION_PROMPT_VERSION = 1;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DeepPattern {
  patternName: string;
  category: 'algorithm' | 'architecture' | 'api-design' | 'error-handling' | 'performance' | 'testing' | 'ux';
  /** Actual code snippet, not a summary */
  implementationSnippet: string;
  whyItWorks: string;
  adoptionComplexity: 'low' | 'medium' | 'high';
  /** Relative path inside the repo */
  sourceFile: string;
  /** 1-10: +3 if in tests, +2 if in 3+ files, +1 if documented */
  confidence: number;
}

export interface DeepHarvestResult {
  slug: string;
  url: string;
  license: string;
  patterns: DeepPattern[];
  /** Top 3 unique innovations this repo demonstrates */
  topInnovations: string[];
  /** Top 5 patterns to adopt immediately (by impact × simplicity) */
  immediateAdoptions: string[];
  /** Follow-up questions to resolve before next harvest */
  followUpQuestions: string[];
  /** Absolute path to .danteforge/oss-deep/{slug}/ */
  harvestPath: string;
  /** Newly detected quality dimensions not in the standard universe-scan set */
  emergentDimensions?: EmergentDimension[];
  /** Prompt version used for extraction — for drift detection */
  extractionPromptVersion?: number;
}

export interface EmergentDimension {
  dimension: string;     // e.g. "ai-observability", "edge-native-patterns"
  description: string;
  emergenceSignal: string; // why this is newly emerging
  relevanceScore: number;  // 0-1
  recommendedAction: 'add-to-universe-scan' | 'monitor' | 'ignore';
}

export interface EmergentDimensionResult {
  version: '1.0.0';
  slug: string;
  detectedAt: string;
  dimensions: EmergentDimension[];
}

export interface OssDeepOptions {
  cwd?: string;
  promptMode?: boolean;
  /** Max critical files to read in full (default 20) */
  maxFiles?: number;
  /** Include git log analysis for top 5 critical files (slower) */
  includeGitLog?: boolean;
  _llmCaller?: (prompt: string) => Promise<string>;
  _isLLMAvailable?: () => Promise<boolean>;
  /** Enable model performance-based routing for extraction LLM calls */
  enableModelSelection?: boolean;
  /** Candidate models to select from (defaults to current configured model) */
  modelCandidates?: string[];
  /** Override git clone — used in tests */
  _gitClone?: (url: string, dest: string) => Promise<void>;
  /** Override git log — used in tests */
  _gitLog?: (repoPath: string, filePath: string) => Promise<string>;
  /** Override file read — used in tests */
  _fsRead?: (filePath: string) => Promise<string>;
  /** Override `gh pr list` call — used in tests. Returns raw text output. */
  _runGhPrList?: (repoPath: string) => Promise<string>;
  /** Override grep for confidence scoring — used in tests */
  _grepFn?: (pattern: string, dir: string) => Promise<string[]>;
}

// ── Path helpers ──────────────────────────────────────────────────────────────

function slugify(urlOrPath: string): string {
  const base = path.basename(urlOrPath).replace(/\.git$/, '');
  return base.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
}

function getDeepDir(slug: string, cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', 'oss-deep', slug);
}

function getRepoDir(slug: string, cwd?: string): string {
  return path.join(getOssReposDir(cwd), slug);
}

// ── Internal: structural mapping ──────────────────────────────────────────────

interface FileEntry {
  filePath: string;
  relativePath: string;
  importCount: number;
}

async function mapSourceFiles(
  repoDir: string,
  maxFiles: number,
  fsRead?: (f: string) => Promise<string>,
): Promise<FileEntry[]> {
  const extensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.py', '.rs', '.go'];
  const entries: FileEntry[] = [];

  async function walk(dir: string): Promise<void> {
    let items: string[];
    try {
      items = await fs.readdir(dir);
    } catch {
      return;
    }
    for (const item of items) {
      if (item.startsWith('.') || item === 'node_modules' || item === 'dist' || item === 'build') continue;
      const full = path.join(dir, item);
      let stat: Awaited<ReturnType<typeof fs.stat>>;
      try {
        stat = await fs.stat(full);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        await walk(full);
      } else if (extensions.includes(path.extname(item).toLowerCase())) {
        entries.push({ filePath: full, relativePath: path.relative(repoDir, full), importCount: 0 });
      }
    }
  }

  // Walk src/ first, then root if nothing found
  const srcDir = path.join(repoDir, 'src');
  try {
    await fs.access(srcDir);
    await walk(srcDir);
  } catch {
    await walk(repoDir);
  }

  // Count import references — each file gets +1 for each other file that imports it
  const basenames = new Map<string, FileEntry>();
  for (const e of entries) {
    basenames.set(path.basename(e.relativePath, path.extname(e.relativePath)), e);
  }

  for (const entry of entries) {
    try {
      const content = fsRead
        ? await fsRead(entry.filePath)
        : await fs.readFile(entry.filePath, 'utf8');
      for (const [base, target] of basenames) {
        if (target !== entry && content.includes(base)) {
          target.importCount++;
        }
      }
    } catch { /* skip unreadable files */ }
  }

  return entries
    .sort((a, b) => b.importCount - a.importCount)
    .slice(0, maxFiles);
}

async function readTestFiles(repoDir: string): Promise<string> {
  const testDirs = ['tests', 'test', 'spec', '__tests__', '__test__'];
  const parts: string[] = [];

  for (const dir of testDirs) {
    const testPath = path.join(repoDir, dir);
    try {
      await fs.access(testPath);
      const files = await fs.readdir(testPath);
      for (const file of files.slice(0, 10)) {
        try {
          const content = await fs.readFile(path.join(testPath, file), 'utf8');
          parts.push(`--- ${dir}/${file} ---\n${content.slice(0, 2000)}`);
        } catch { /* skip */ }
      }
    } catch { /* dir not found */ }
  }

  return parts.join('\n\n');
}

// ── Internal: LLM pattern synthesis ──────────────────────────────────────────

function buildExtractionPrompt(
  slug: string,
  manifestContent: string,
  criticalFiles: Array<{ relativePath: string; content: string }>,
  testContent: string,
  gitLogContent: string,
): string {
  const fileSection = criticalFiles
    .map(f => `=== ${f.relativePath} ===\n${f.content.slice(0, 3000)}`)
    .join('\n\n');

  return `You are extracting reusable software patterns from the OSS project "${slug}".

MANIFEST / DEPENDENCIES:
${manifestContent.slice(0, 1000)}

CRITICAL SOURCE FILES (top by import count):
${fileSection}

TEST SUITE SAMPLES:
${testContent.slice(0, 2000)}

${gitLogContent ? `GIT ARCHAEOLOGY:\n${gitLogContent.slice(0, 1500)}` : ''}

Extract all reusable patterns. For EACH pattern, produce a JSON object with these exact keys:
- patternName: short descriptive name
- category: one of algorithm|architecture|api-design|error-handling|performance|testing|ux
- implementationSnippet: actual code (20-60 lines), NOT a summary
- whyItWorks: 1-2 sentences explaining WHY this pattern is effective
- adoptionComplexity: low|medium|high
- sourceFile: relative file path where this pattern lives
- confidence: number 1-10 (add 3 if in tests, add 2 if used in 3+ files, add 1 if documented)

After patterns, output:
- topInnovations: array of 3 strings — what this repo does better than anything else
- immediateAdoptions: array of 5 pattern names ranked by impact × simplicity
- followUpQuestions: array of 3 questions to resolve before next harvest

Respond with ONLY valid JSON matching this schema:
{
  "patterns": [...],
  "topInnovations": [...],
  "immediateAdoptions": [...],
  "followUpQuestions": [...]
}`;
}

// ── Internal: deterministic fallback extraction ────────────────────────────────

function deterministicExtract(
  criticalFiles: Array<{ relativePath: string; content: string }>,
): Pick<DeepHarvestResult, 'patterns' | 'topInnovations' | 'immediateAdoptions' | 'followUpQuestions'> {
  const patterns: DeepPattern[] = [];

  for (const f of criticalFiles) {
    const { content, relativePath } = f;

    // Detect injection seam pattern (_optionalFn?: () => ...)
    if (/_\w+\?:\s*\(/.test(content) || /_\w+\?:\s*[A-Z]/.test(content)) {
      patterns.push({
        patternName: 'dependency-injection-seams',
        category: 'architecture',
        implementationSnippet: extractSnippet(content, /_\w+\?:/),
        whyItWorks: 'Underscore-prefixed optional parameters make every side-effect testable without mocking frameworks.',
        adoptionComplexity: 'low',
        sourceFile: relativePath,
        confidence: 6,
      });
    }

    // Detect circuit breaker pattern
    if (/OPEN|HALF_OPEN|CLOSED/.test(content) && /circuit/i.test(content)) {
      patterns.push({
        patternName: 'circuit-breaker',
        category: 'error-handling',
        implementationSnippet: extractSnippet(content, /OPEN|HALF_OPEN/),
        whyItWorks: 'Three-state circuit breaker prevents cascading failures by temporarily blocking failing providers.',
        adoptionComplexity: 'medium',
        sourceFile: relativePath,
        confidence: 7,
      });
    }

    // Detect retry with backoff
    if (/backoff|exponential|retryDelay/i.test(content)) {
      patterns.push({
        patternName: 'exponential-backoff-retry',
        category: 'error-handling',
        implementationSnippet: extractSnippet(content, /backoff|exponential|retryDelay/i),
        whyItWorks: 'Exponential backoff prevents retry storms while recovering gracefully from transient failures.',
        adoptionComplexity: 'low',
        sourceFile: relativePath,
        confidence: 5,
      });
    }

    // Detect streaming pattern
    if (/ReadableStream|EventSource|SSE|stream\.on/i.test(content)) {
      patterns.push({
        patternName: 'streaming-response',
        category: 'performance',
        implementationSnippet: extractSnippet(content, /ReadableStream|EventSource|stream\.on/i),
        whyItWorks: 'Streaming responses reduce time-to-first-byte and enable real-time UX without polling.',
        adoptionComplexity: 'medium',
        sourceFile: relativePath,
        confidence: 5,
      });
    }
  }

  // Deduplicate by patternName
  const seen = new Set<string>();
  const unique = patterns.filter(p => {
    if (seen.has(p.patternName)) return false;
    seen.add(p.patternName);
    return true;
  });

  return {
    patterns: unique,
    topInnovations: unique.slice(0, 3).map(p => p.patternName),
    immediateAdoptions: unique.filter(p => p.adoptionComplexity === 'low').map(p => p.patternName).slice(0, 5),
    followUpQuestions: [
      'Which patterns are covered by tests in the source repo?',
      'Does the license permit direct implementation inspiration?',
      'Are there newer commits that refine these patterns?',
    ],
  };
}

function extractSnippet(content: string, pattern: RegExp): string {
  const lines = content.split('\n');
  const idx = lines.findIndex(l => pattern.test(l));
  if (idx < 0) return content.slice(0, 300);
  return lines.slice(Math.max(0, idx - 2), idx + 15).join('\n');
}

// ── Internal: report writing ──────────────────────────────────────────────────

function buildDeepHarvestMd(result: Omit<DeepHarvestResult, 'harvestPath'>): string {
  const patternEntries = result.patterns
    .map(
      p => `### ${p.patternName}

**Category**: ${p.category} | **Complexity**: ${p.adoptionComplexity} | **Confidence**: ${p.confidence}/10

**Why it works**: ${p.whyItWorks}

**Source**: \`${p.sourceFile}\`

\`\`\`
${p.implementationSnippet}
\`\`\`
`,
    )
    .join('\n');

  return `# Deep Harvest: ${result.slug}

**URL**: ${result.url}
**License**: ${result.license}
**Patterns extracted**: ${result.patterns.length}

## Top Innovations

${result.topInnovations.map((v, i) => `${i + 1}. ${v}`).join('\n')}

## Adopt Immediately

${result.immediateAdoptions.map((v, i) => `${i + 1}. ${v}`).join('\n')}

## Follow-up Questions

${result.followUpQuestions.map((v, i) => `${i + 1}. ${v}`).join('\n')}

---

## Pattern Library

${patternEntries || '_No patterns extracted._'}
`;
}

// ── PR description reading ────────────────────────────────────────────────────

async function defaultRunGhPrList(repoPath: string): Promise<string> {
  const { execFile: execFileCb } = await import('node:child_process');
  const { promisify: prom } = await import('node:util');
  const exec = prom(execFileCb);
  const result = await exec(
    'gh',
    ['pr', 'list', '--state', 'merged', '--limit', '20',
     '--json', 'title,body,mergedAt',
     '--jq', '.[] | "# " + .title + "\n" + .body'],
    { cwd: repoPath, timeout: 15_000 },
  );
  return result.stdout;
}

// ── Confidence scoring helpers ────────────────────────────────────────────────

async function defaultGrepFn(pattern: string, dir: string): Promise<string[]> {
  try {
    await fs.access(dir);
    const { exec: execCb } = await import('node:child_process');
    const { promisify: prom } = await import('node:util');
    const execAsync = prom(execCb);
    const safePattern = pattern.replace(/"/g, '\\"');
    const result = await execAsync(
      `grep -rl "${safePattern}" . 2>/dev/null || true`,
      { cwd: dir, timeout: 5_000 },
    );
    return result.stdout.trim().split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Post-extraction confidence adjustment using actual repo evidence.
 *
 * Scoring increments (spec §4):
 *   +3  pattern name found in any test directory
 *   +2  source file referenced in 3+ git commit lines (survived refactors)
 *   +1  pattern name appears in 2+ source files (not a one-off)
 *   +1  JSDoc present in implementation snippet
 *
 * Exported for unit testing.
 */
export async function adjustConfidenceFromEvidence(
  patterns: DeepPattern[],
  repoDir: string,
  gitLogText: string,
  grepFn: (pattern: string, dir: string) => Promise<string[]>,
): Promise<DeepPattern[]> {
  return Promise.all(patterns.map(async (p) => {
    let bonus = 0;

    // +3: pattern name found in any test directory
    const testDirs = ['test', 'tests', '__tests__', 'spec'];
    for (const testDir of testDirs) {
      const matches = await grepFn(p.patternName, path.join(repoDir, testDir)).catch(() => []);
      if (matches.length > 0) {
        bonus += 3;
        break;
      }
    }

    // +2: source file referenced in 3+ git commit lines (survived major refactors)
    const commitCount = gitLogText.split('\n').filter(l => l.includes(p.sourceFile)).length;
    if (commitCount >= 3) bonus += 2;

    // +1: pattern name appears in 2+ source files (not a one-off)
    const srcMatches = await grepFn(p.patternName, path.join(repoDir, 'src')).catch(() => []);
    if (srcMatches.length >= 2) bonus += 1;

    // +1: JSDoc present in snippet (authors documented it)
    if (p.implementationSnippet.includes('/**') || p.implementationSnippet.includes('@param')) bonus += 1;

    return { ...p, confidence: Math.min(10, (p.confidence ?? 5) + bonus) };
  }));
}

// ── Emergent dimension detection ──────────────────────────────────────────────

async function detectEmergentDimensions(
  slug: string,
  patterns: DeepPattern[],
  cwd: string | undefined,
  llm: ((prompt: string) => Promise<string>) | null,
  opts: Pick<OssDeepOptions, '_llmCaller' | '_isLLMAvailable'>,
): Promise<EmergentDimensionResult> {
  const result: EmergentDimensionResult = {
    version: '1.0.0',
    slug,
    detectedAt: new Date().toISOString(),
    dimensions: [],
  };

  if (!llm || patterns.length === 0) return result;

  const patternSummary = patterns
    .slice(0, 20)
    .map(p => `- ${p.patternName} (${p.category}): ${p.whyItWorks.slice(0, 80)}`)
    .join('\n');

  const prompt = `You are analyzing patterns extracted from the OSS repo "${slug}".
Patterns found:
${patternSummary}

Identify dimensions of software quality that these patterns represent which are NOT in the standard set:
(standard: functionality, testing, error-handling, security, ux, documentation, performance, maintainability)

Return JSON array of EmergentDimension objects:
[{ "dimension": "string", "description": "string", "emergenceSignal": "string", "relevanceScore": 0.0-1.0, "recommendedAction": "add-to-universe-scan"|"monitor"|"ignore" }]

Return [] if no genuinely new dimensions found. Return ONLY the JSON array.`;

  try {
    const raw = await llm(prompt);
    const cleaned = raw.replace(/```json\n?|\n?```/g, '').trim();
    const parsed = JSON.parse(cleaned) as EmergentDimension[];
    if (Array.isArray(parsed)) {
      result.dimensions = parsed.filter(d =>
        typeof d.dimension === 'string' && typeof d.relevanceScore === 'number'
      );
    }
  } catch {
    // Best-effort: return empty on parse failure
  }

  // Persist emergent dimensions
  try {
    const deepDir = path.join(cwd ?? process.cwd(), '.danteforge', 'oss-deep', slug);
    await fs.mkdir(deepDir, { recursive: true });
    await fs.writeFile(
      path.join(deepDir, 'emergent-dimensions.json'),
      JSON.stringify(result, null, 2),
      'utf8',
    );
  } catch {
    // Best-effort write
  }

  return result;
}

// ── Main entry ─────────────────────────────────────────────────────────────────

export async function ossDeep(urlOrPath: string, opts: OssDeepOptions = {}): Promise<DeepHarvestResult> {
  try {
    const cwd = opts.cwd ?? process.cwd();
    const maxFiles = opts.maxFiles ?? 20;
    const slug = slugify(urlOrPath);

    // ── Prompt mode ────────────────────────────────────────────────────────
    if (opts.promptMode) {
      const plan = `# OSS Deep Extraction Plan: ${slug}

## Target
URL/Path: ${urlOrPath}

## Phase 1 — Structural Mapping
- Clone to .danteforge/oss-repos/${slug}/ (persistent)
- Glob all src/**/*.ts files
- Rank by import-count to find top ${maxFiles} critical files
- Read package.json / Cargo.toml for dependency context

## Phase 2 — Deep Code Extraction
- Read each critical file in full (no truncation)
- Read full test suite (tests/, spec/, __tests__/)
- Pass to LLM for pattern extraction with confidence scoring

## Phase 3 — Git Archaeology ${opts.includeGitLog ? '(ENABLED)' : '(disabled — use --include-git-log)'}
- git log --follow --stat -- {critical-file} for top 5 files
- Extract major refactor commits and design decisions

## Phase 4 — Pattern Synthesis
- Output: .danteforge/oss-deep/${slug}/patterns.json
- Output: .danteforge/oss-deep/${slug}/DEEP_HARVEST.md
- Update: .danteforge/oss-registry.json (status: deep-extracted)
`;
      logger.info(plan);
      return {
        slug,
        url: urlOrPath,
        license: 'unknown',
        patterns: [],
        topInnovations: [],
        immediateAdoptions: [],
        followUpQuestions: [],
        harvestPath: getDeepDir(slug, cwd),
      };
    }

    logger.info(`[oss-deep] Starting deep extraction: ${slug}`);

    // ── Phase 1: Locate / clone repo ─────────────────────────────────────
    const isUrl = urlOrPath.startsWith('http://') || urlOrPath.startsWith('https://') || urlOrPath.startsWith('git@');
    const repoDir = isUrl ? getRepoDir(slug, cwd) : path.resolve(urlOrPath);

    if (isUrl) {
      try {
        await fs.access(repoDir);
        logger.info(`[oss-deep] Using cached clone at ${repoDir}`);
      } catch {
        logger.info(`[oss-deep] Cloning ${urlOrPath} → ${repoDir}`);
        const ossReposDir = getOssReposDir(cwd);
        await fs.mkdir(ossReposDir, { recursive: true });

        if (opts._gitClone) {
          await opts._gitClone(urlOrPath, repoDir);
        } else {
          await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', urlOrPath, repoDir], {
            timeout: CLONE_TIMEOUT_MS,
          });
        }
      }
    }

    // Read manifest
    let manifestContent = '';
    for (const name of ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod']) {
      try {
        manifestContent = await fs.readFile(path.join(repoDir, name), 'utf8');
        break;
      } catch { /* try next */ }
    }

    // Detect license
    let license = 'unknown';
    for (const name of ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING']) {
      try {
        const licenseText = await fs.readFile(path.join(repoDir, name), 'utf8');
        if (/\bMIT\b/.test(licenseText)) license = 'MIT';
        else if (/Apache-2\.0|Apache License/.test(licenseText)) license = 'Apache-2.0';
        else if (/BSD/.test(licenseText)) license = 'BSD';
        else if (/ISC/.test(licenseText)) license = 'ISC';
        else if (/GPL/.test(licenseText)) license = 'GPL';
        else license = 'other';
        break;
      } catch { /* try next */ }
    }

    // Phase 1: map critical files
    logger.info(`[oss-deep] Mapping source files (max ${maxFiles})...`);
    const criticalEntries = await mapSourceFiles(repoDir, maxFiles, opts._fsRead);
    logger.info(`[oss-deep] Found ${criticalEntries.length} critical files`);

    // Phase 2: read critical files in full
    const criticalFiles: Array<{ relativePath: string; content: string }> = [];
    for (const entry of criticalEntries) {
      try {
        const content = opts._fsRead
          ? await opts._fsRead(entry.filePath)
          : await fs.readFile(entry.filePath, 'utf8');
        criticalFiles.push({ relativePath: entry.relativePath, content });
      } catch { /* skip unreadable */ }
    }

    const testContent = await readTestFiles(repoDir);

    // Phase 3: git archaeology (optional)
    let gitLogContent = '';
    if (opts.includeGitLog) {
      const topFive = criticalEntries.slice(0, 5);
      for (const entry of topFive) {
        try {
          const log = opts._gitLog
            ? await opts._gitLog(repoDir, entry.relativePath)
            : await execFileAsync('git', ['log', '--follow', '--stat', '-20', '--', entry.relativePath], {
                cwd: repoDir,
              }).then(r => r.stdout);
          gitLogContent += `\n=== git log: ${entry.relativePath} ===\n${log.slice(0, 600)}`;
        } catch { /* skip */ }
      }

      // PR descriptions — best-effort, requires gh CLI and repo access
      let prContent = '';
      try {
        const runPrList = opts._runGhPrList ?? defaultRunGhPrList;
        prContent = await runPrList(repoDir);
      } catch { /* gh not installed, private repo, or no merged PRs — non-fatal */ }
      if (prContent.trim()) {
        gitLogContent += `\n\n=== Merged PR Descriptions (last 20) ===\n${prContent.slice(0, 1_200)}`;
      }
    }

    // Phase 4: LLM synthesis or deterministic fallback
    const llmAvailable = opts._isLLMAvailable
      ? await opts._isLLMAvailable()
      : await isLLMAvailable();

    // Sprint E-4C: Select best model for extraction based on performance history
    let selectedModel: string | undefined;
    if (opts.enableModelSelection && opts.modelCandidates && opts.modelCandidates.length > 0) {
      try {
        const perfIndex = await loadPerformanceIndex(opts.cwd);
        selectedModel = selectBestModel('extraction', opts.modelCandidates, perfIndex) ?? undefined;
        if (selectedModel) {
          logger.info(`[oss-deep] Model selection: using ${selectedModel} for extraction (performance-based)`);
        }
      } catch {
        // Best-effort model selection
      }
    }

    let extracted: Pick<DeepHarvestResult, 'patterns' | 'topInnovations' | 'immediateAdoptions' | 'followUpQuestions'>;
    const llm: ((prompt: string) => Promise<string>) | null = llmAvailable ? (opts._llmCaller ?? callLLM) : null;

    if (llmAvailable) {
      try {
        const prompt = buildExtractionPrompt(slug, manifestContent, criticalFiles, testContent, gitLogContent);
        // When using the injection seam (_llmCaller), honour it as-is.
        // When using the real callLLM, apply model selection if available.
        const response = opts._llmCaller
          ? await opts._llmCaller(prompt)
          : await callLLM(prompt, selectedModel);

        // Extract JSON from response
        const jsonMatch = response.match(/```json\s*([\s\S]*?)```/) ?? response.match(/(\{[\s\S]*\})/);
        const raw = jsonMatch ? jsonMatch[1]! : response;
        const parsed = JSON.parse(raw.trim()) as {
          patterns: DeepPattern[];
          topInnovations: string[];
          immediateAdoptions: string[];
          followUpQuestions: string[];
        };
        extracted = parsed;
      } catch (err) {
        logger.warn(`[oss-deep] LLM extraction failed, falling back to deterministic: ${err instanceof Error ? err.message : String(err)}`);
        extracted = deterministicExtract(criticalFiles);
      }
    } else {
      logger.info('[oss-deep] LLM unavailable — using deterministic extraction');
      extracted = deterministicExtract(criticalFiles);
    }

    // Deduplicate patterns by patternName (merge, keep higher confidence)
    const patternMap = new Map<string, DeepPattern>();
    for (const p of extracted.patterns) {
      const existing = patternMap.get(p.patternName);
      if (!existing || p.confidence > existing.confidence) {
        patternMap.set(p.patternName, p);
      }
    }
    const deduped = [...patternMap.values()];

    // Post-extraction confidence adjustment from actual repo evidence
    const grepFn = opts._grepFn ?? defaultGrepFn;
    const patterns = await adjustConfidenceFromEvidence(deduped, repoDir, gitLogContent, grepFn);

    const result: Omit<DeepHarvestResult, 'harvestPath'> = {
      slug,
      url: urlOrPath,
      license,
      patterns,
      topInnovations: extracted.topInnovations,
      immediateAdoptions: extracted.immediateAdoptions,
      followUpQuestions: extracted.followUpQuestions,
    };

    // Write outputs
    const deepDir = getDeepDir(slug, cwd);
    await fs.mkdir(deepDir, { recursive: true });

    await fs.writeFile(
      path.join(deepDir, 'patterns.json'),
      JSON.stringify(patterns, null, 2),
      'utf8',
    );
    await fs.writeFile(
      path.join(deepDir, 'DEEP_HARVEST.md'),
      buildDeepHarvestMd(result),
      'utf8',
    );

    // Update oss-registry.json
    const registry = await loadRegistry(cwd);
    const now = new Date().toISOString();
    upsertEntry(registry, {
      name: slug,
      url: urlOrPath,
      license,
      status: 'active',
      clonedAt: now,
      lastLearnedAt: now,
      patternsCount: patterns.length,
      storagePath: path.relative(cwd, repoDir),
      patterns: [],  // lightweight registry entry — full patterns in oss-deep/{slug}/patterns.json
    });
    await saveRegistry(registry, cwd);

    logger.info(`[oss-deep] Extracted ${patterns.length} patterns → ${deepDir}`);
    logger.info(`[oss-deep] Top innovations: ${result.topInnovations.join(', ')}`);

    // Sprint B: Detect emergent dimensions from extracted patterns (second LLM call, best-effort)
    const emergentResult = await detectEmergentDimensions(slug, result.patterns, opts.cwd, llm, opts);
    result.emergentDimensions = emergentResult.dimensions;
    result.extractionPromptVersion = EXTRACTION_PROMPT_VERSION;

    return { ...result, harvestPath: deepDir };
  } catch (err) {
    logger.error(`[oss-deep] Fatal error: ${err instanceof Error ? err.message : String(err)}`);
    throw err;
  }
}

// ── CLI entry point ───────────────────────────────────────────────────────────

export async function ossDeepCommand(
  urlOrPath: string,
  opts: { prompt?: boolean; includeGitLog?: boolean; maxFiles?: string },
): Promise<void> {
  if (!urlOrPath) {
    logger.error('[oss-deep] URL or local path required. Usage: danteforge oss-deep <url-or-path>');
    process.exitCode = 1;
    return;
  }
  await ossDeep(urlOrPath, {
    promptMode: opts.prompt,
    includeGitLog: opts.includeGitLog,
    maxFiles: opts.maxFiles ? parseInt(opts.maxFiles, 10) : undefined,
  });
}
