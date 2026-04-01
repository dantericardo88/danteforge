// OSS Researcher — auto-detect project, search OSS, clone, license-gate, scan, extract patterns, report
// Repos are persisted in .danteforge/oss-repos/ — NEVER auto-deleted.
// Use `danteforge oss clean` to remove repos explicitly.
// Three modes: --prompt (research plan), --dry-run (show queries), execute (full pipeline)
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { isLLMAvailable, callLLM } from '../../core/llm.js';
import {
  detectProjectProfile,
  buildSearchQueries,
  classifyLicense,
  prioritizePatterns,
  formatOSSReport,
  type OSSRepo,
  type PatternExtraction,
  type OSSResearchReport,
} from '../../core/oss-researcher.js';
import {
  loadRegistry,
  saveRegistry,
  filterNewRepos,
  upsertEntry,
  getRepoStoragePath,
  getOssReposDir,
  type OSSRegistry,
  type OSSRegistryEntry,
} from '../../core/oss-registry.js';

const execFileAsync = promisify(execFile);

/** Default number of NEW repos to discover per run (library grows incrementally) */
const MAX_REPOS_DEFAULT = 4;
const CLONE_TIMEOUT_MS = 120_000;

// ── Utility helpers ───────────────────────────────────────────────────────────

async function safeRm(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch { /* best-effort */ }
}

/** Returns true if the directory contains a valid `.git` folder. */
async function isValidGitRepo(dirPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(dirPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

/** Recursively estimate directory size in MB. */
async function getDirSizeMb(dirPath: string): Promise<number> {
  let total = 0;
  async function walk(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(fullPath);
        } else {
          try {
            const stat = await fs.stat(fullPath);
            total += stat.size;
          } catch { /* ignore */ }
        }
      }
    } catch { /* ignore */ }
  }
  await walk(dirPath);
  return Math.round(total / (1024 * 1024));
}

/**
 * Attempt to read LICENSE file content from a cloned repo directory.
 * Tries common license file names.
 */
async function readLicenseFile(repoDir: string): Promise<string> {
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'COPYING'];
  for (const name of candidates) {
    try {
      return await fs.readFile(path.join(repoDir, name), 'utf8');
    } catch { /* try next */ }
  }
  return '';
}

/**
 * Shallow-clone a git repository to a persistent storage path.
 * If the target directory already contains a valid git repo, skips re-cloning (idempotent).
 * Returns the clone path on success, null on failure.
 */
async function shallowClone(url: string, clonePath: string, name: string): Promise<string | null> {
  // Already cached — skip clone
  if (await isValidGitRepo(clonePath)) {
    logger.info(`  Already cached: ${name} -> ${clonePath}`);
    return clonePath;
  }

  // Ensure parent directory exists; remove any incomplete prior attempt
  await fs.mkdir(path.dirname(clonePath), { recursive: true });
  await safeRm(clonePath);

  try {
    await execFileAsync('git', ['clone', '--depth', '1', '--single-branch', url, clonePath], {
      timeout: CLONE_TIMEOUT_MS,
    });
    logger.info(`  Cloned: ${name} -> ${clonePath}`);
    return clonePath;
  } catch (err) {
    logger.warn(`  Clone failed for ${name}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/**
 * Do a rapid structural scan of a cloned repo:
 * reads the manifest, lists top-level dirs, and reads the main entry point.
 */
async function structuralScan(clonePath: string): Promise<string> {
  const parts: string[] = [];

  // Top-level directory listing
  try {
    const entries = await fs.readdir(clonePath, { withFileTypes: true });
    const dirs = entries.filter(e => e.isDirectory()).map(e => e.name + '/');
    const files = entries.filter(e => e.isFile()).map(e => e.name);
    parts.push(`Top-level dirs: ${dirs.slice(0, 15).join(', ')}`);
    parts.push(`Top-level files: ${files.slice(0, 15).join(', ')}`);
  } catch { /* ignore */ }

  // Read package.json / manifest
  for (const manifest of ['package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod']) {
    try {
      const content = await fs.readFile(path.join(clonePath, manifest), 'utf8');
      parts.push(`--- ${manifest} ---`);
      parts.push(content.slice(0, 1500));
      break;
    } catch { /* try next */ }
  }

  // Read main entry point if discoverable
  for (const entry of ['src/index.ts', 'index.ts', 'src/cli.ts', 'src/main.ts', 'main.ts', 'index.js']) {
    try {
      const content = await fs.readFile(path.join(clonePath, entry), 'utf8');
      parts.push(`--- ${entry} (first 1000 chars) ---`);
      parts.push(content.slice(0, 1000));
      break;
    } catch { /* try next */ }
  }

  return parts.join('\n');
}

// ── LLM-assisted operations ───────────────────────────────────────────────────

/**
 * Use the LLM to refine and augment search queries with project context.
 */
async function refineQueries(
  queries: string[],
  projectSummary: string,
  projectType: string,
): Promise<string[]> {
  const prompt = `You are helping research open-source repositories for a software project.

Project summary: ${projectSummary}
Project type: ${projectType}

Here are initial search queries:
${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Refine these queries and suggest 5 highly targeted GitHub search queries that will find the most relevant, high-quality, permissively-licensed open-source repositories in the same domain. Each query should be on its own line starting with "Q: ".`;

  const result = await callLLM(prompt, undefined, { enrichContext: false });
  const extracted = result
    .split('\n')
    .filter(line => line.trim().startsWith('Q:'))
    .map(line => line.replace(/^Q:\s*/i, '').trim())
    .filter(q => q.length > 5)
    .slice(0, 5);

  return extracted.length >= 3 ? extracted : queries;
}

/**
 * Use the LLM to extract patterns from a repo's structural scan.
 */
async function extractPatternsFromScan(
  repoName: string,
  scanResult: string,
  projectSummary: string,
): Promise<PatternExtraction[]> {
  const prompt = `You are analyzing an open-source repository to extract reusable software patterns.

Our project: ${projectSummary}

Repository being analyzed: ${repoName}

Structural scan:
${scanResult.slice(0, 4000)}

Extract up to 5 distinct patterns from this repository that could benefit our project. For each pattern, respond with this EXACT format (one per line, no extra text between entries):

PATTERN|<category: architecture|agent-ai|cli-ux|quality|innovation>|<pattern name>|<one-sentence description>|<priority: P0|P1|P2|P3>|<effort: S|M|L>

Priority guide:
- P0: Multiple top repos have it, we don't, small effort
- P1: Clear user benefit, moderate effort
- P2: Nice to have, larger effort
- P3: Niche, significant effort

Effort guide:
- S: < 2 hours
- M: 2-8 hours
- L: > 8 hours`;

  const result = await callLLM(prompt, undefined, { enrichContext: false });
  const patterns: PatternExtraction[] = [];

  for (const line of result.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('PATTERN|')) continue;

    const parts = trimmed.split('|');
    if (parts.length < 6) continue;

    const [, rawCategory, rawPattern, rawDesc, rawPriority, rawEffort] = parts;
    if (!rawCategory || !rawPattern || !rawDesc || !rawPriority || !rawEffort) continue;

    const category = (['architecture', 'agent-ai', 'cli-ux', 'quality', 'innovation'].includes(rawCategory.trim())
      ? rawCategory.trim()
      : 'innovation') as PatternExtraction['category'];

    const priority = (['P0', 'P1', 'P2', 'P3'].includes(rawPriority.trim())
      ? rawPriority.trim()
      : 'P2') as PatternExtraction['priority'];

    const effort = (['S', 'M', 'L'].includes(rawEffort.trim())
      ? rawEffort.trim()
      : 'M') as PatternExtraction['effort'];

    patterns.push({
      repoName,
      category,
      pattern: rawPattern.trim(),
      description: rawDesc.trim(),
      priority,
      effort,
    });
  }

  return patterns;
}

/**
 * Use the LLM to perform gap analysis and generate a list of repo URLs to scan.
 * Optionally accepts a list of repo names/URLs to exclude (already in library).
 */
async function gapAnalysisAndRepoSelection(
  queries: string[],
  projectSummary: string,
  maxRepos: number,
  excludeNames?: string[],
): Promise<OSSRepo[]> {
  const exclusionNote = excludeNames && excludeNames.length > 0
    ? `\nAlready in our library (do NOT recommend these again):\n${excludeNames.slice(0, 20).join('\n')}\n`
    : '';

  const prompt = `You are an OSS research assistant. A developer needs you to recommend ${maxRepos} highly relevant open-source GitHub repositories to study for their project.

Project: ${projectSummary}
${exclusionNote}
Research queries to answer:
${queries.map((q, i) => `${i + 1}. ${q}`).join('\n')}

Based on your knowledge, list ${maxRepos} real GitHub repositories that:
1. Are in the same domain as the project
2. Have permissive licenses (MIT, Apache-2.0, BSD, ISC, MPL-2.0)
3. Have significant adoption (1000+ stars preferred)
4. Are actively maintained
5. Use TypeScript or JavaScript (or compatible languages)

For each repo, respond with this EXACT format (one per line):
REPO|<owner/repo>|<https://github.com/owner/repo>|<one-sentence description>|<estimated license: MIT|Apache-2.0|BSD-3-Clause|ISC|MPL-2.0|unknown>|<approximate stars>

Only include real, well-known repositories you are confident exist.`;

  const result = await callLLM(prompt, undefined, { enrichContext: false });
  const repos: OSSRepo[] = [];

  for (const line of result.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('REPO|')) continue;

    const parts = trimmed.split('|');
    if (parts.length < 5) continue;

    const [, name, url, description, licenseName, starsRaw] = parts;
    if (!name || !url || !description || !licenseName) continue;

    const stars = starsRaw ? parseInt(starsRaw.replace(/[^0-9]/g, ''), 10) : undefined;
    const { status } = classifyLicense(licenseName.trim());

    repos.push({
      name: name.trim(),
      url: url.trim(),
      description: description.trim(),
      license: status,
      licenseName: licenseName.trim(),
      stars: isNaN(stars ?? NaN) ? undefined : stars,
    });
  }

  return repos.slice(0, maxRepos);
}

// ── Prompt mode ───────────────────────────────────────────────────────────────

function buildResearchPlanPrompt(
  projectSummary: string,
  projectType: string,
  language: string,
  queries: string[],
): string {
  const lines: string[] = [
    '# OSS Research Plan',
    '',
    '## Project Profile',
    `- **Type**: ${projectType}`,
    `- **Language**: ${language}`,
    `- **Summary**: ${projectSummary}`,
    '',
    '## Search Queries',
    '',
    ...queries.map((q, i) => `${i + 1}. ${q}`),
    '',
    '## Research Instructions',
    '',
    'Execute the following pipeline:',
    '',
    '**Phase 1 — Search & Select**',
    'Use the queries above to find 5-10 relevant OSS repositories. Select repos that:',
    '- Are in the same domain as this project',
    '- Have permissive licenses (MIT, Apache-2.0, BSD, ISC, MPL-2.0)',
    '- Have 1000+ stars and recent activity (< 6 months)',
    '',
    '**Phase 2 — Clone & License Gate**',
    'For each selected repo:',
    '1. Run: `git clone --depth 1 <url> .danteforge/oss-repos/<name>`',
    '2. Read the LICENSE file immediately',
    '3. If GPL/AGPL/SSPL: record as blocked in .danteforge/oss-registry.json',
    '',
    '**Phase 3 — Structural Scan**',
    'For each allowed repo:',
    '- List top-level directory',
    '- Read main entry point (src/index.ts, index.js, etc.)',
    '- Read manifest (package.json, Cargo.toml, etc.)',
    '',
    '**Phase 4 — Pattern Extraction**',
    'Extract patterns across:',
    '- Architecture: plugin loading, provider/adapter patterns, state management',
    '- Agent/AI: agent loop, tool registration, context management, streaming',
    '- CLI/UX: command parsing, REPL, progress indicators, error UX',
    '- Quality: test structure, CI/CD, linting',
    '- Innovations: novel approaches unique to each repo',
    '',
    '**Phase 5 — Gap Analysis**',
    'Prioritize by P0 (critical, small effort) through P3 (niche, high effort).',
    'Implement top 5-8 P0/P1 patterns fresh — never copy code verbatim.',
    '',
    '**Note**: Repos stay in .danteforge/oss-repos/ for future reference.',
    'Run `danteforge oss learn` to re-extract patterns. `danteforge oss clean` to remove.',
    '',
    `CLI equivalent: \`danteforge oss\``,
  ];

  return lines.join('\n');
}

// ── Dry-run mode ──────────────────────────────────────────────────────────────

function displayDryRun(
  projectSummary: string,
  projectType: string,
  language: string,
  queries: string[],
  maxRepos: number,
): void {
  logger.info('');
  logger.info('='.repeat(60));
  logger.info('  OSS RESEARCHER — DRY RUN');
  logger.info('='.repeat(60));
  logger.info('');
  logger.info(`Project type:     ${projectType}`);
  logger.info(`Language:         ${language}`);
  logger.info(`New repos/run:    ${maxRepos}`);
  logger.info('');
  logger.info('Project summary:');
  logger.info(`  ${projectSummary}`);
  logger.info('');
  logger.info('Search queries to be issued:');
  queries.forEach((q, i) => {
    logger.info(`  ${i + 1}. ${q}`);
  });
  logger.info('');
  logger.info('Pipeline steps:');
  logger.info('  1. Search for relevant OSS repos using queries above');
  logger.info('  2. Filter out repos already in .danteforge/oss-registry.json');
  logger.info('  3. Clone up to ' + maxRepos + ' NEW repos to .danteforge/oss-repos/');
  logger.info('  4. License gate: skip GPL/AGPL/SSPL/proprietary');
  logger.info('  5. Rapid structural scan (2-3 min per repo)');
  logger.info('  6. Pattern extraction across 5 categories');
  logger.info('  7. Holistic gap analysis across ALL cached repos');
  logger.info('  8. Write OSS report to .danteforge/OSS_REPORT.md');
  logger.info('  9. Repos remain cached in .danteforge/oss-repos/');
  logger.info('');
  logger.info('[DRY RUN] No repos were cloned or patterns implemented.');
}

// ── Local fallback ────────────────────────────────────────────────────────────

function displayLocalFallback(
  projectSummary: string,
  projectType: string,
  language: string,
  queries: string[],
): void {
  logger.info('');
  logger.warn('No LLM provider available. Showing manual instructions.');
  logger.info('');
  logger.info('Project summary:');
  logger.info(`  ${projectSummary}`);
  logger.info('');
  logger.info('Search queries — paste each into GitHub or your browser:');
  queries.forEach((q, i) => {
    logger.info(`  ${i + 1}. ${q}`);
  });
  logger.info('');
  logger.info('Manual pipeline:');
  logger.info('  1. Search GitHub for repos matching the queries above');
  logger.info('  2. Clone with: git clone --depth 1 <url> .danteforge/oss-repos/<name>');
  logger.info('  3. Check LICENSE file — skip GPL, AGPL, SSPL');
  logger.info('  4. Read src/index.ts, package.json for patterns');
  logger.info('  5. Identify architecture, CLI/UX, quality patterns');
  logger.info('  6. Implement the best patterns in this project');
  logger.info('  7. Run: npm run verify');
  logger.info('  8. Repos stay in .danteforge/oss-repos/ for future reference');
  logger.info('');
  logger.info('Tip: Configure an LLM provider for automated research:');
  logger.info('  danteforge config --set-key "grok:<key>"');
}

// ── Execute mode ──────────────────────────────────────────────────────────────

interface ExecuteOSSOptions {
  cwd: string;
  _registry?: OSSRegistry;
  _saveRegistry?: (registry: OSSRegistry, cwd: string) => Promise<void>;
}

async function executeOSSResearch(
  projectSummary: string,
  projectType: string,
  language: string,
  queries: string[],
  maxRepos: number,
  opts: ExecuteOSSOptions,
): Promise<OSSResearchReport> {
  const { cwd } = opts;
  const report: OSSResearchReport = {
    projectSummary,
    reposScanned: [],
    patternsExtracted: [],
    implemented: [],
    skipped: [],
    filesChanged: [],
  };

  // Load registry (or use injected one for testing)
  const registry = opts._registry ?? await loadRegistry(cwd);
  const doSaveRegistry = opts._saveRegistry ?? saveRegistry;

  // Phase 1: Refine queries with LLM
  logger.info('Refining search queries with LLM...');
  let refinedQueries = queries;
  try {
    refinedQueries = await refineQueries(queries, projectSummary, projectType);
    logger.info(`Using ${refinedQueries.length} refined queries`);
  } catch (err) {
    logger.warn(`Query refinement failed: ${err instanceof Error ? err.message : String(err)} — using base queries`);
  }

  // Phase 2: Gap analysis & repo selection — ask for extras so we have enough after filtering
  logger.info('Selecting repositories to analyze...');
  const knownNames = registry.repos.map(r => r.url);
  const requestCount = Math.min(maxRepos + Math.max(registry.repos.length, 4), 15);
  const candidateRepos = await gapAnalysisAndRepoSelection(
    refinedQueries, projectSummary, requestCount, knownNames,
  );

  if (candidateRepos.length === 0) {
    logger.warn('LLM did not return usable repo candidates. Check connectivity.');
    return report;
  }

  // Filter to only NEW repos not already in registry
  const newRepos = filterNewRepos(candidateRepos, registry).slice(0, maxRepos);

  logger.info(
    `Selected ${candidateRepos.length} candidates — ${newRepos.length} new ` +
    `(${registry.repos.length} already in library)`,
  );

  if (newRepos.length === 0) {
    logger.info('All recommended repos are already in your library.');
    logger.info('Run `danteforge oss` again to discover more, or `danteforge oss learn` to re-extract patterns.');
    return report;
  }

  // Phase 3: Clone & license gate
  logger.info('');
  logger.info('Phase 2/3: Clone & License Gate');
  logger.info('-'.repeat(40));

  // Ensure persistent storage directory exists
  await fs.mkdir(getOssReposDir(cwd), { recursive: true });

  const allowedRepos: Array<OSSRepo & { clonePath: string }> = [];

  for (const repo of newRepos) {
    const repoShortName = repo.name.split('/').pop() ?? repo.name;
    const clonePath = getRepoStoragePath(repoShortName, cwd);

    logger.info(`Cloning: ${repo.name} (${repo.url})`);
    const cloned = await shallowClone(repo.url, clonePath, repoShortName);

    if (!cloned) {
      report.skipped.push(`${repo.name} — clone failed`);
      continue;
    }

    // License gate
    const licenseContent = await readLicenseFile(cloned);
    const { status, name: licenseName } = classifyLicense(licenseContent);

    const finalRepo: OSSRepo = {
      ...repo,
      license: status,
      licenseName: licenseContent ? licenseName : repo.licenseName,
      clonePath: cloned,
    };

    if (status === 'blocked') {
      logger.warn(`  License BLOCKED (${licenseName}) — recording in registry, skipping scan`);
      report.skipped.push(`${repo.name} — ${licenseName} license blocked`);
      report.reposScanned.push({ ...finalRepo, clonePath: undefined });
      // Register as blocked — user can review and remove with `oss clean --blocked`
      upsertEntry(registry, {
        name: repoShortName,
        url: repo.url,
        license: licenseName,
        status: 'blocked',
        clonedAt: new Date().toISOString(),
        lastLearnedAt: new Date().toISOString(),
        patternsCount: 0,
        storagePath: path.relative(cwd, cloned),
        patterns: [],
      });
      await doSaveRegistry(registry, cwd);
      continue;
    }

    if (status === 'unknown') {
      logger.warn(`  License UNKNOWN — skipping ${repo.name} (no license file or unrecognized)`);
      report.skipped.push(`${repo.name} — license unknown or missing`);
      report.reposScanned.push({ ...finalRepo, clonePath: undefined });
      upsertEntry(registry, {
        name: repoShortName,
        url: repo.url,
        license: 'unknown',
        status: 'blocked',
        clonedAt: new Date().toISOString(),
        lastLearnedAt: new Date().toISOString(),
        patternsCount: 0,
        storagePath: path.relative(cwd, cloned),
        patterns: [],
      });
      await doSaveRegistry(registry, cwd);
      continue;
    }

    logger.success(`  License OK (${licenseName}) — ${repo.name}`);
    report.reposScanned.push(finalRepo);
    allowedRepos.push({ ...finalRepo, clonePath: cloned });
  }

  if (allowedRepos.length === 0) {
    logger.warn('No repos passed the license gate. Nothing to analyze.');
    return report;
  }

  // Phase 4: Structural scan + pattern extraction
  logger.info('');
  logger.info('Phase 4/5: Scan & Pattern Extraction');
  logger.info('-'.repeat(40));

  for (const repo of allowedRepos) {
    const repoShortName = repo.name.split('/').pop() ?? repo.name;
    logger.info(`Scanning: ${repo.name}`);
    let patterns: PatternExtraction[] = [];
    try {
      const scanResult = await structuralScan(repo.clonePath);
      patterns = await extractPatternsFromScan(repo.name, scanResult, projectSummary);
      logger.info(`  Extracted ${patterns.length} pattern(s) from ${repo.name}`);
      report.patternsExtracted.push(...patterns);
    } catch (err) {
      logger.warn(`  Scan failed for ${repo.name}: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Persist this repo and its patterns to registry
    upsertEntry(registry, {
      name: repoShortName,
      url: repo.url,
      license: repo.licenseName ?? 'unknown',
      status: 'active',
      clonedAt: new Date().toISOString(),
      lastLearnedAt: new Date().toISOString(),
      patternsCount: patterns.length,
      storagePath: path.relative(cwd, repo.clonePath),
      patterns,
    });
    await doSaveRegistry(registry, cwd);
  }

  // Holistic synthesis: combine ALL patterns from the full library (not just this run)
  const allLibraryPatterns = registry.repos.flatMap(r => r.patterns ?? []);
  const holistic = prioritizePatterns(allLibraryPatterns);

  const p0p1Patterns = holistic.filter(p => p.priority === 'P0' || p.priority === 'P1');
  logger.info('');
  logger.info(
    `This run: ${report.patternsExtracted.length} patterns | ` +
    `Library total: ${holistic.length} | P0/P1: ${p0p1Patterns.length}`,
  );

  if (p0p1Patterns.length > 0) {
    logger.info('');
    logger.info('Top P0/P1 patterns (from full library):');
    for (const p of p0p1Patterns.slice(0, 8)) {
      logger.info(`  [${p.priority}/${p.effort}] ${p.pattern} (${p.repoName}) — ${p.description}`);
    }
  }

  // Return with holistic patterns so the report covers the full library
  return { ...report, patternsExtracted: holistic };
}

// ── Main command ──────────────────────────────────────────────────────────────

/**
 * OSS Researcher command — auto-detect project, search OSS, clone to persistent storage,
 * license-gate, scan, extract patterns, and report.
 * Discovers 4 NEW repos per run; accumulates a growing reference library.
 */
export async function ossResearcher(options: {
  prompt?: boolean;
  dryRun?: boolean;
  maxRepos?: string;
  _registry?: OSSRegistry;
  _saveRegistry?: (registry: OSSRegistry, cwd: string) => Promise<void>;
} = {}): Promise<void> {
  const timestamp = new Date().toISOString();
  const maxRepos = Math.min(Math.max(parseInt(options.maxRepos ?? '4', 10) || MAX_REPOS_DEFAULT, 1), 15);

  logger.success('DanteForge OSS Researcher');
  logger.info('');

  // Phase 0: Detect project profile
  logger.info('Detecting project profile...');
  const cwd = process.cwd();
  const profile = await detectProjectProfile(cwd);
  const { type: projectType, language, summary: projectSummary } = profile;

  logger.info(`  Type:     ${projectType}`);
  logger.info(`  Language: ${language}`);
  logger.info(`  Summary:  ${projectSummary.slice(0, 100)}${projectSummary.length > 100 ? '...' : ''}`);
  logger.info('');

  // Build base search queries
  const queries = buildSearchQueries(projectSummary, projectType, language);

  // ── Prompt mode ──────────────────────────────────────────────────────────────
  if (options.prompt) {
    const promptText = buildResearchPlanPrompt(projectSummary, projectType, language, queries);

    logger.success('=== OSS RESEARCH PLAN (copy-paste) ===');
    process.stdout.write('\n' + promptText + '\n\n');
    logger.success('=== END OF PLAN ===');
    logger.info('');
    logger.info('Paste this into Claude Code, ChatGPT, or any LLM with web search access.');
    logger.info('The LLM will execute the full OSS research pipeline autonomously.');

    const state = await loadState();
    state.auditLog.push(`${timestamp} | oss: research plan prompt generated (${projectType}, ${language})`);
    await saveState(state);
    return;
  }

  // ── Dry-run mode ─────────────────────────────────────────────────────────────
  if (options.dryRun) {
    displayDryRun(projectSummary, projectType, language, queries, maxRepos);

    const state = await loadState();
    state.auditLog.push(`${timestamp} | oss: dry run — ${queries.length} queries, ${maxRepos} max new repos`);
    await saveState(state);
    return;
  }

  // ── Execute mode ─────────────────────────────────────────────────────────────
  const llmAvailable = await isLLMAvailable();
  if (!llmAvailable) {
    displayLocalFallback(projectSummary, projectType, language, queries);

    const state = await loadState();
    state.auditLog.push(`${timestamp} | oss: local fallback — no LLM provider available`);
    await saveState(state);
    return;
  }

  logger.info(`LLM provider available — starting OSS research pipeline (max ${maxRepos} new repos)`);
  logger.info('Repos will be stored in: .danteforge/oss-repos/');
  logger.info('');

  const report = await executeOSSResearch(
    projectSummary, projectType, language, queries, maxRepos,
    { cwd, _registry: options._registry, _saveRegistry: options._saveRegistry },
  );

  // Write holistic report (includes all accumulated library patterns)
  const reportPath = path.join(cwd, '.danteforge', 'OSS_REPORT.md');
  await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
  await fs.writeFile(reportPath, formatOSSReport(report), 'utf8');

  // Final summary
  logger.info('');
  logger.info('='.repeat(60));
  logger.success('  OSS RESEARCH COMPLETE');
  logger.info('='.repeat(60));
  logger.info('');
  logger.info(`Repos scanned (this run): ${report.reposScanned.length}`);
  logger.info(`Repos skipped:            ${report.skipped.length}`);
  logger.info(`Library total patterns:   ${report.patternsExtracted.length}`);
  const p0p1Count = report.patternsExtracted.filter(p => p.priority === 'P0' || p.priority === 'P1').length;
  logger.info(`P0/P1 patterns:           ${p0p1Count}`);
  logger.info('');
  logger.info(`Report saved to:  ${reportPath}`);
  logger.info(`Repos cached in:  .danteforge/oss-repos/`);
  logger.info('');
  logger.info('Run `danteforge oss`        — discover more repos');
  logger.info('Run `danteforge oss learn`  — re-extract patterns from all cached repos');
  logger.info('Run `danteforge oss clean`  — manage cached repos');

  const state = await loadState();
  state.auditLog.push(
    `${timestamp} | oss: research complete — ${report.reposScanned.length} repos scanned, ` +
    `${report.patternsExtracted.length} library patterns, ${p0p1Count} P0/P1`,
  );
  await saveState(state);
}

// ── oss learn ─────────────────────────────────────────────────────────────────

export interface OSSLearnOptions {
  /** Re-learn only repos whose name contains this string */
  repo?: string;
  /** Output manual instructions instead of executing */
  prompt?: boolean;
  _registry?: OSSRegistry;
  _saveRegistry?: (registry: OSSRegistry, cwd: string) => Promise<void>;
}

/**
 * Re-scan all cached repos in .danteforge/oss-repos/ and re-extract patterns.
 * Regenerates OSS_REPORT.md from the full accumulated library.
 */
export async function ossLearn(options: OSSLearnOptions = {}): Promise<void> {
  const timestamp = new Date().toISOString();
  const cwd = process.cwd();

  logger.success('DanteForge OSS Learn');
  logger.info('');

  if (options.prompt) {
    logger.info('Manual instructions:');
    logger.info('  1. Review repos in .danteforge/oss-repos/');
    logger.info('  2. For each repo: read src/, package.json, README');
    logger.info('  3. Identify new patterns not yet captured');
    logger.info('  4. Update .danteforge/oss-registry.json manually if needed');
    logger.info('  5. Run `danteforge oss learn` with an LLM configured for automation');
    return;
  }

  const llmAvailable = await isLLMAvailable();
  if (!llmAvailable) {
    logger.warn('No LLM provider available. Cannot extract patterns automatically.');
    logger.info('Configure an LLM provider: danteforge config --set-key "grok:<key>"');
    return;
  }

  const registry = options._registry ?? await loadRegistry(cwd);
  const doSaveRegistry = options._saveRegistry ?? saveRegistry;

  let entries = registry.repos.filter(r => r.status === 'active');
  if (options.repo) {
    entries = entries.filter(r => r.name.toLowerCase().includes(options.repo!.toLowerCase()));
    if (entries.length === 0) {
      logger.warn(`No active repo matching "${options.repo}" in registry.`);
      logger.info('Run `danteforge oss learn` without --repo to re-learn all repos.');
      return;
    }
  }

  if (entries.length === 0) {
    logger.info('No active repos in library. Run `danteforge oss` to discover repos first.');
    return;
  }

  logger.info(`Re-learning ${entries.length} repo(s)...`);
  logger.info('');

  const profile = await detectProjectProfile(cwd);
  const projectSummary = profile.summary;

  let totalPatternsThisRun = 0;
  let learnedCount = 0;

  for (const entry of entries) {
    const clonePath = path.resolve(cwd, entry.storagePath);

    // Verify repo still exists on disk
    let exists = false;
    try {
      await fs.access(clonePath);
      exists = true;
    } catch { /* missing */ }

    if (!exists) {
      logger.warn(`  ${entry.name}: not found at ${entry.storagePath} — marking archived`);
      entry.status = 'archived';
      upsertEntry(registry, entry);
      await doSaveRegistry(registry, cwd);
      continue;
    }

    logger.info(`  Scanning: ${entry.name}`);
    try {
      const scanResult = await structuralScan(clonePath);
      const patterns = await extractPatternsFromScan(entry.name, scanResult, projectSummary);
      logger.info(`    Extracted ${patterns.length} pattern(s)`);

      entry.patterns = patterns;
      entry.patternsCount = patterns.length;
      entry.lastLearnedAt = new Date().toISOString();
      upsertEntry(registry, entry);
      await doSaveRegistry(registry, cwd);

      totalPatternsThisRun += patterns.length;
      learnedCount++;
    } catch (err) {
      logger.warn(`    Failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // Regenerate holistic OSS_REPORT.md from full library
  const allPatterns = prioritizePatterns(registry.repos.flatMap(r => r.patterns ?? []));
  const holisticReport: OSSResearchReport = {
    projectSummary,
    reposScanned: registry.repos.filter(r => r.status === 'active').map(r => ({
      name: r.name,
      url: r.url,
      description: '',
      license: 'allowed' as const,
      licenseName: r.license,
    })),
    patternsExtracted: allPatterns,
    implemented: [],
    skipped: [],
    filesChanged: [],
  };

  const reportPath = path.join(cwd, '.danteforge', 'OSS_REPORT.md');
  await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
  await fs.writeFile(reportPath, formatOSSReport(holisticReport), 'utf8');

  const p0p1Count = allPatterns.filter(p => p.priority === 'P0' || p.priority === 'P1').length;

  logger.info('');
  logger.info('='.repeat(60));
  logger.success('  OSS LEARN COMPLETE');
  logger.info('='.repeat(60));
  logger.info('');
  logger.info(`Repos re-learned:    ${learnedCount}`);
  logger.info(`New patterns found:  ${totalPatternsThisRun}`);
  logger.info(`Library total:       ${allPatterns.length} patterns`);
  logger.info(`P0/P1 patterns:      ${p0p1Count}`);
  logger.info(`Report updated:      ${reportPath}`);

  const state = await loadState();
  state.auditLog.push(
    `${timestamp} | oss:learn: ${learnedCount} repos re-learned, ` +
    `${allPatterns.length} total patterns in library`,
  );
  await saveState(state);
}

// ── oss clean ─────────────────────────────────────────────────────────────────

export interface OSSCleanOptions {
  /** Remove all repos */
  all?: boolean;
  /** Remove only repos with status 'blocked' */
  blocked?: boolean;
  /** Remove repos older than this many days */
  olderThan?: string;
  /** Preview what would be deleted without actually deleting */
  dryRun?: boolean;
  _registry?: OSSRegistry;
  _saveRegistry?: (registry: OSSRegistry, cwd: string) => Promise<void>;
}

/**
 * Remove cached OSS repos from .danteforge/oss-repos/.
 * Repos are NEVER removed automatically — this command is the only delete path.
 */
export async function ossClean(options: OSSCleanOptions = {}): Promise<void> {
  const timestamp = new Date().toISOString();
  const cwd = process.cwd();

  logger.success('DanteForge OSS Clean');
  logger.info('');

  const registry = options._registry ?? await loadRegistry(cwd);
  const doSaveRegistry = options._saveRegistry ?? saveRegistry;

  if (registry.repos.length === 0) {
    logger.info('No repos in library. Nothing to clean.');
    return;
  }

  // Determine targets based on flags
  let targets: OSSRegistryEntry[] = [];

  if (options.all) {
    targets = [...registry.repos];
  } else if (options.blocked) {
    targets = registry.repos.filter(r => r.status === 'blocked');
    if (targets.length === 0) {
      logger.info('No blocked-license repos in library. Nothing to clean.');
      return;
    }
  } else if (options.olderThan) {
    const days = parseInt(options.olderThan, 10);
    if (isNaN(days) || days < 1) {
      logger.error('--older-than requires a positive number of days (e.g. --older-than 30)');
      process.exitCode = 1;
      return;
    }
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    targets = registry.repos.filter(r => new Date(r.clonedAt) < cutoff);
    if (targets.length === 0) {
      logger.info(`No repos older than ${days} days. Nothing to clean.`);
      return;
    }
  } else {
    // No flags — show library inventory and usage
    logger.info('Library contents:');
    logger.info('');
    for (const r of registry.repos) {
      const ageDays = Math.floor((Date.now() - new Date(r.clonedAt).getTime()) / (24 * 60 * 60 * 1000));
      logger.info(`  ${r.name.padEnd(30)} [${r.status}]  ${String(r.patternsCount).padStart(2)} patterns  ${ageDays}d old`);
    }
    logger.info('');
    logger.info('Select repos to remove with a flag:');
    logger.info('  --all              Remove all repos');
    logger.info('  --blocked          Remove only blocked-license repos');
    logger.info('  --older-than <N>   Remove repos older than N days');
    logger.info('  --dry-run          Preview any of the above without deleting');
    return;
  }

  // Preview
  logger.info(`${options.dryRun ? '[DRY RUN] ' : ''}Repos to remove (${targets.length}):`);
  for (const r of targets) {
    logger.info(`  ${r.name} [${r.status}] — ${r.storagePath}`);
  }
  logger.info('');

  if (options.dryRun) {
    logger.info('[DRY RUN] No files were deleted.');
    return;
  }

  // Execute deletions
  let removedCount = 0;
  let totalMb = 0;

  for (const r of targets) {
    const clonePath = path.resolve(cwd, r.storagePath);
    const sizeMb = await getDirSizeMb(clonePath);
    await safeRm(clonePath);
    registry.repos = registry.repos.filter(e => e.url !== r.url);
    totalMb += sizeMb;
    removedCount++;
    logger.info(`  Removed: ${r.name} (~${sizeMb}MB)`);
  }

  await doSaveRegistry(registry, cwd);

  logger.info('');
  logger.success(`Removed ${removedCount} repo(s), freed ~${totalMb}MB`);
  logger.info(`Registry updated: ${registry.repos.length} repo(s) remaining`);

  const state = await loadState();
  state.auditLog.push(
    `${timestamp} | oss:clean: removed ${removedCount} repos (~${totalMb}MB)`,
  );
  await saveState(state);
}
