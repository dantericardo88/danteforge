// OSS Researcher — auto-detect project, search OSS, clone, license-gate, scan, extract patterns, report
// Three modes: --prompt (research plan), --dry-run (show queries), execute (full pipeline)
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
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
import { withErrorBoundary } from '../../core/cli-error-boundary.js';

const execFileAsync = promisify(execFile);

const OSS_CLONE_PREFIX = 'oss-research-';
const MAX_REPOS_DEFAULT = 8;
const CLONE_TIMEOUT_MS = 120_000;

// ── Utility helpers ───────────────────────────────────────────────────────────

async function safeRm(dirPath: string): Promise<void> {
  try {
    await fs.rm(dirPath, { recursive: true, force: true });
  } catch { /* best-effort */ }
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
 * Shallow-clone a git repository to a temp directory.
 * Returns the clone path on success, null on failure.
 */
async function shallowClone(url: string, name: string): Promise<string | null> {
  const safeName = name.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const clonePath = path.join(os.tmpdir(), `${OSS_CLONE_PREFIX}${safeName}`);

  // Remove any stale clone
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
 * In the real pipeline, this is driven by WebSearch results captured by the LLM agent.
 * In CLI mode, we provide a structured prompt for the LLM to reason about.
 */
async function gapAnalysisAndRepoSelection(
  queries: string[],
  projectSummary: string,
  maxRepos: number,
): Promise<OSSRepo[]> {
  const prompt = `You are an OSS research assistant. A developer needs you to recommend ${maxRepos} highly relevant open-source GitHub repositories to study for their project.

Project: ${projectSummary}

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
    '1. Run: `git clone --depth 1 <url> /tmp/oss-research-<name>`',
    '2. Read the LICENSE file immediately',
    '3. If GPL/AGPL/SSPL: delete clone and skip',
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
    '**Phase 6 — Cleanup**',
    'Run `rm -rf /tmp/oss-research-*` when done.',
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
  logger.info(`Max repos:        ${maxRepos}`);
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
  logger.info('  2. Clone up to ' + maxRepos + ' repos to /tmp/oss-research-*');
  logger.info('  3. License gate: skip GPL/AGPL/SSPL/proprietary');
  logger.info('  4. Rapid structural scan (2-3 min per repo)');
  logger.info('  5. Pattern extraction across 5 categories');
  logger.info('  6. Gap analysis and P0-P1 prioritization');
  logger.info('  7. Implement top patterns, run typecheck/lint/test');
  logger.info('  8. Write OSS report to .danteforge/OSS_REPORT.md');
  logger.info('  9. Cleanup cloned repos');
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
  logger.info('  2. Clone with: git clone --depth 1 <url> /tmp/oss-research-<name>');
  logger.info('  3. Check LICENSE file — skip GPL, AGPL, SSPL');
  logger.info('  4. Read src/index.ts, package.json for patterns');
  logger.info('  5. Identify architecture, CLI/UX, quality patterns');
  logger.info('  6. Implement the best patterns in this project');
  logger.info('  7. Run: npm run verify');
  logger.info('  8. Cleanup: rm -rf /tmp/oss-research-*');
  logger.info('');
  logger.info('Tip: Configure an LLM provider for automated research:');
  logger.info('  danteforge config --set-key "grok:<key>"');
}

// ── Execute mode ──────────────────────────────────────────────────────────────

async function executeOSSResearch(
  projectSummary: string,
  projectType: string,
  language: string,
  queries: string[],
  maxRepos: number,
): Promise<OSSResearchReport> {
  const clonedPaths: string[] = [];
  const report: OSSResearchReport = {
    projectSummary,
    reposScanned: [],
    patternsExtracted: [],
    implemented: [],
    skipped: [],
    filesChanged: [],
  };

  try {
    // Phase 1: Refine queries with LLM
    logger.info('Refining search queries with LLM...');
    let refinedQueries = queries;
    try {
      refinedQueries = await refineQueries(queries, projectSummary, projectType);
      logger.info(`Using ${refinedQueries.length} refined queries`);
    } catch (err) {
      logger.warn(`Query refinement failed: ${err instanceof Error ? err.message : String(err)} — using base queries`);
    }

    // Phase 2: Gap analysis & repo selection via LLM
    logger.info('Selecting repositories to analyze...');
    const candidateRepos = await gapAnalysisAndRepoSelection(refinedQueries, projectSummary, maxRepos);

    if (candidateRepos.length === 0) {
      logger.warn('LLM did not return usable repo candidates. Check connectivity.');
      return report;
    }

    logger.info(`Selected ${candidateRepos.length} candidate repos`);

    // Phase 3: Clone & license gate
    logger.info('');
    logger.info('Phase 2/3: Clone & License Gate');
    logger.info('-'.repeat(40));

    const allowedRepos: Array<OSSRepo & { clonePath: string }> = [];

    for (const repo of candidateRepos) {
      logger.info(`Cloning: ${repo.name} (${repo.url})`);
      const clonePath = await shallowClone(repo.url, repo.name.split('/').pop() ?? repo.name);

      if (!clonePath) {
        report.skipped.push(`${repo.name} — clone failed`);
        continue;
      }

      clonedPaths.push(clonePath);

      // License gate
      const licenseContent = await readLicenseFile(clonePath);
      const { status, name: licenseName } = classifyLicense(licenseContent);

      const finalRepo: OSSRepo = {
        ...repo,
        license: status,
        licenseName: licenseContent ? licenseName : repo.licenseName,
        clonePath,
      };

      if (status === 'blocked') {
        logger.warn(`  License BLOCKED (${licenseName}) — skipping ${repo.name}`);
        report.skipped.push(`${repo.name} — ${licenseName} license blocked`);
        await safeRm(clonePath);
        clonedPaths.splice(clonedPaths.indexOf(clonePath), 1);
        report.reposScanned.push({ ...finalRepo, clonePath: undefined });
        continue;
      }

      if (status === 'unknown') {
        logger.warn(`  License UNKNOWN — skipping ${repo.name} (no license file or unrecognized)`);
        report.skipped.push(`${repo.name} — license unknown or missing`);
        await safeRm(clonePath);
        clonedPaths.splice(clonedPaths.indexOf(clonePath), 1);
        report.reposScanned.push({ ...finalRepo, clonePath: undefined });
        continue;
      }

      logger.success(`  License OK (${licenseName}) — ${repo.name}`);
      report.reposScanned.push(finalRepo);
      allowedRepos.push({ ...finalRepo, clonePath });
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
      logger.info(`Scanning: ${repo.name}`);
      try {
        const scanResult = await structuralScan(repo.clonePath);
        const patterns = await extractPatternsFromScan(repo.name, scanResult, projectSummary);
        logger.info(`  Extracted ${patterns.length} pattern(s) from ${repo.name}`);
        report.patternsExtracted.push(...patterns);
      } catch (err) {
        logger.warn(`  Scan failed for ${repo.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Phase 5: Prioritize
    report.patternsExtracted = prioritizePatterns(report.patternsExtracted);

    const p0p1Patterns = report.patternsExtracted.filter(p => p.priority === 'P0' || p.priority === 'P1');
    logger.info('');
    logger.info(`Pattern extraction complete: ${report.patternsExtracted.length} total, ${p0p1Patterns.length} P0/P1`);

    // Note: actual implementation of patterns is delegated to the LLM agent.
    // The report documents what was found; the agent decides what to implement based on context.
    if (p0p1Patterns.length > 0) {
      logger.info('');
      logger.info('Top P0/P1 patterns identified (implement these):');
      for (const p of p0p1Patterns.slice(0, 8)) {
        logger.info(`  [${p.priority}/${p.effort}] ${p.pattern} (${p.repoName}) — ${p.description}`);
      }
    }

    return report;
  } finally {
    // Cleanup all cloned repos
    if (clonedPaths.length > 0) {
      logger.info('');
      logger.info('Cleaning up cloned repos...');
      for (const clonePath of clonedPaths) {
        await safeRm(clonePath);
        logger.verbose(`  Removed: ${clonePath}`);
      }
      logger.info('Cleanup complete.');
    }
  }
}

// ── Main command ──────────────────────────────────────────────────────────────

/**
 * OSS Researcher command — auto-detect project, search OSS, clone, license-gate,
 * scan, extract patterns, and report.
 */
export async function ossResearcher(options: {
  prompt?: boolean;
  dryRun?: boolean;
  maxRepos?: string;
  _loadState?: typeof loadState;
  _saveState?: typeof saveState;
  _isLLMAvailable?: typeof isLLMAvailable;
} = {}): Promise<void> {
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;
  const llmAvailFn = options._isLLMAvailable ?? isLLMAvailable;

  return withErrorBoundary('oss', async () => {
  const timestamp = new Date().toISOString();
  const maxRepos = Math.min(Math.max(parseInt(options.maxRepos ?? '8', 10) || MAX_REPOS_DEFAULT, 1), 15);

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

    const state = await loadFn();
    state.auditLog.push(`${timestamp} | oss: research plan prompt generated (${projectType}, ${language})`);
    await saveFn(state);
    return;
  }

  // ── Dry-run mode ─────────────────────────────────────────────────────────────
  if (options.dryRun) {
    displayDryRun(projectSummary, projectType, language, queries, maxRepos);

    const state = await loadFn();
    state.auditLog.push(`${timestamp} | oss: dry run — ${queries.length} queries, ${maxRepos} max repos`);
    await saveFn(state);
    return;
  }

  // ── Execute mode ─────────────────────────────────────────────────────────────
  const llmAvailable = await llmAvailFn();
  if (!llmAvailable) {
    displayLocalFallback(projectSummary, projectType, language, queries);

    const state = await loadFn();
    state.auditLog.push(`${timestamp} | oss: local fallback — no LLM provider available`);
    await saveFn(state);
    return;
  }

  logger.info(`LLM provider available — starting full OSS research pipeline (max ${maxRepos} repos)`);
  logger.info('');

  const report = await executeOSSResearch(
    projectSummary,
    projectType,
    language,
    queries,
    maxRepos,
  );

  // Write report
  const reportPath = path.join(cwd, '.danteforge', 'OSS_REPORT.md');
  await fs.mkdir(path.join(cwd, '.danteforge'), { recursive: true });
  const reportMd = formatOSSReport(report);
  await fs.writeFile(reportPath, reportMd, 'utf8');

  // Final summary
  logger.info('');
  logger.info('='.repeat(60));
  logger.success('  OSS RESEARCH COMPLETE');
  logger.info('='.repeat(60));
  logger.info('');
  logger.info(`Repos scanned:       ${report.reposScanned.length}`);
  logger.info(`Repos skipped:       ${report.skipped.length}`);
  logger.info(`Patterns extracted:  ${report.patternsExtracted.length}`);
  const p0p1Count = report.patternsExtracted.filter(p => p.priority === 'P0' || p.priority === 'P1').length;
  logger.info(`P0/P1 patterns:      ${p0p1Count}`);
  logger.info('');
  logger.info(`Report saved to:     ${reportPath}`);
  logger.info('');

  if (p0p1Count > 0) {
    logger.info('Next: review the report and implement the P0/P1 patterns.');
    logger.info('Run `danteforge verify` after implementing each pattern.');
  } else if (report.patternsExtracted.length > 0) {
    logger.info('No P0/P1 patterns found. Review the report for P2/P3 items.');
  } else {
    logger.info('No patterns extracted — the repos may already align with your architecture.');
  }

  // COFL gap cross-check: flag patterns that address known operator-visible gaps (best-effort)
  try {
    const { loadMatrix } = await import('../../core/compete-matrix.js');
    const { runDecisionFilter } = await import('../../core/cofl-engine.js');
    const matrix = await loadMatrix(cwd).catch(() => null);
    if (matrix && report.patternsExtracted.length > 0) {
      const gapDimensions = matrix.dimensions
        .filter(d => (d.gap_to_closed_source_leader ?? d.gap_to_leader ?? 0) > 1)
        .map(d => d.id);
      const coflAligned = report.patternsExtracted.filter(p => {
        // Map oss pattern category to COFL dimension coverage proxy
        const category = p.category;
        const isOperatorVisible = category === 'cli-ux' || category === 'agent-ai' || category === 'innovation';
        const decision = runDecisionFilter(
          {
            sourceRole: 'reference_teacher',
            operatorLeverageScore: p.priority === 'P0' ? 8 : p.priority === 'P1' ? 6 : 3,
            affectedDimensions: gapDimensions.slice(0, 2),
            proofRequirement: `Implement and run npm test (${p.effort} effort)`,
            implementationScope: p.effort === 'L' ? 'broad' : 'narrow',
          },
          { validTeacherRoles: ['reference_teacher', 'specialist_teacher'], knownGapDimensions: gapDimensions },
        );
        return isOperatorVisible && decision.passedAll;
      });
      if (coflAligned.length > 0) {
        logger.info('');
        logger.info(`COFL-aligned patterns (operator-visible, gap-closing): ${coflAligned.length}`);
        for (const p of coflAligned.slice(0, 5)) {
          logger.info(`  [${p.priority}] ${p.pattern} — ${p.description.slice(0, 80)}`);
        }
        logger.info('Run `danteforge cofl --harvest` to extract and classify these via the full COFL pipeline.');
      }
    }
  } catch { /* best-effort — never block oss output */ }

  // Audit
  const state = await loadFn();
  state.auditLog.push(
    `${timestamp} | oss: research complete — ${report.reposScanned.length} repos scanned, ` +
    `${report.patternsExtracted.length} patterns extracted, ${p0p1Count} P0/P1`,
  );
  await saveFn(state);
  });
}
