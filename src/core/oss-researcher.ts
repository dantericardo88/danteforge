// OSS Researcher — core engine for discovering, analyzing, and harvesting patterns from open-source repos
import fs from 'node:fs/promises';
import path from 'node:path';

// ── License Classification ────────────────────────────────────────────────────

export type LicenseStatus = 'allowed' | 'blocked' | 'unknown';

export const ALLOWED_LICENSES = new Set([
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'Unlicense',
  'MPL-2.0',
]);

export const BLOCKED_LICENSES = new Set([
  'GPL-2.0',
  'GPL-3.0',
  'AGPL-3.0',
  'SSPL-1.0',
  'EUPL-1.2',
]);

// SPDX identifiers and common phrases used in license files
const LICENSE_PATTERNS: Array<{ pattern: RegExp; spdx: string; status: LicenseStatus }> = [
  // Allowed
  { pattern: /\bMIT License\b/i, spdx: 'MIT', status: 'allowed' },
  { pattern: /\bMIT\b/i, spdx: 'MIT', status: 'allowed' },
  { pattern: /\bApache License[\s\S]{0,100}2\.0\b/i, spdx: 'Apache-2.0', status: 'allowed' },
  { pattern: /\bApache-2\.0\b/i, spdx: 'Apache-2.0', status: 'allowed' },
  { pattern: /\bBSD 2-Clause\b/i, spdx: 'BSD-2-Clause', status: 'allowed' },
  { pattern: /\bBSD-2-Clause\b/i, spdx: 'BSD-2-Clause', status: 'allowed' },
  { pattern: /\bBSD 3-Clause\b/i, spdx: 'BSD-3-Clause', status: 'allowed' },
  { pattern: /\bBSD-3-Clause\b/i, spdx: 'BSD-3-Clause', status: 'allowed' },
  { pattern: /\bISC License\b/i, spdx: 'ISC', status: 'allowed' },
  { pattern: /\bISC\b/i, spdx: 'ISC', status: 'allowed' },
  { pattern: /The Unlicense/i, spdx: 'Unlicense', status: 'allowed' },
  { pattern: /\bunlicense\b/i, spdx: 'Unlicense', status: 'allowed' },
  { pattern: /Mozilla Public License.*2\.0/i, spdx: 'MPL-2.0', status: 'allowed' },
  { pattern: /\bMPL-2\.0\b/i, spdx: 'MPL-2.0', status: 'allowed' },
  // Blocked — must come BEFORE generic GPL checks
  { pattern: /GNU AFFERO GENERAL PUBLIC LICENSE/i, spdx: 'AGPL-3.0', status: 'blocked' },
  { pattern: /\bAGPL-3\.0\b/i, spdx: 'AGPL-3.0', status: 'blocked' },
  { pattern: /Server Side Public License/i, spdx: 'SSPL-1.0', status: 'blocked' },
  { pattern: /\bSSPL-1\.0\b/i, spdx: 'SSPL-1.0', status: 'blocked' },
  { pattern: /European Union Public Licen/i, spdx: 'EUPL-1.2', status: 'blocked' },
  { pattern: /\bEUPL-1\.2\b/i, spdx: 'EUPL-1.2', status: 'blocked' },
  { pattern: /GNU GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 3/i, spdx: 'GPL-3.0', status: 'blocked' },
  { pattern: /\bGPL-3\.0\b/i, spdx: 'GPL-3.0', status: 'blocked' },
  { pattern: /GNU GENERAL PUBLIC LICENSE[\s\S]{0,200}Version 2/i, spdx: 'GPL-2.0', status: 'blocked' },
  { pattern: /\bGPL-2\.0\b/i, spdx: 'GPL-2.0', status: 'blocked' },
  { pattern: /GNU GENERAL PUBLIC LICENSE/i, spdx: 'GPL-3.0', status: 'blocked' },
];

/**
 * Classify a license from the raw content of a LICENSE file.
 * Returns the SPDX identifier and allow/block/unknown status.
 */
export function classifyLicense(licenseText: string): { status: LicenseStatus; name: string } {
  if (!licenseText || !licenseText.trim()) {
    return { status: 'unknown', name: 'unknown' };
  }

  for (const { pattern, spdx, status } of LICENSE_PATTERNS) {
    if (pattern.test(licenseText)) {
      return { status, name: spdx };
    }
  }

  return { status: 'unknown', name: 'unknown' };
}

// ── Data Structures ───────────────────────────────────────────────────────────

export interface OSSRepo {
  name: string;
  url: string;
  description: string;
  license: LicenseStatus;
  licenseName: string;
  stars?: number;
  clonePath?: string;
}

export interface PatternExtraction {
  repoName: string;
  category: 'architecture' | 'agent-ai' | 'cli-ux' | 'quality' | 'innovation';
  pattern: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2' | 'P3';
  effort: 'S' | 'M' | 'L';
}

export interface OSSResearchReport {
  projectSummary: string;
  reposScanned: OSSRepo[];
  patternsExtracted: PatternExtraction[];
  implemented: string[];
  skipped: string[];
  filesChanged: string[];
}

// ── Search Query Builder ──────────────────────────────────────────────────────

/**
 * Build 3-5 targeted search queries from the detected project profile.
 * Queries are adapted to surface relevant OSS repos via web search.
 */
export function buildSearchQueries(
  projectSummary: string,
  projectType: string,
  language: string,
): string[] {
  const queries: string[] = [];
  const type = projectType || 'cli tool';
  const lang = language || 'TypeScript';

  // Primary: best tools for this type/language
  queries.push(`best open source ${type} ${lang} 2025 2026 github`);

  // Secondary: key features from summary
  const summaryWords = projectSummary
    .split(/\W+/)
    .filter(w => w.length > 4)
    .slice(0, 3)
    .join(' ');

  if (summaryWords) {
    queries.push(`open source ${summaryWords} ${lang} github stars:>1000`);
  }

  // Third: alternatives
  queries.push(`${type} alternative open source github`);

  // Fourth: awesome list
  queries.push(`awesome ${type} list github`);

  // Fifth: specific quality/architecture patterns
  queries.push(`${type} ${lang} architecture patterns best practices open source 2025`);

  return queries;
}

// ── Pattern Prioritization ────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<PatternExtraction['priority'], number> = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3,
};

const EFFORT_ORDER: Record<PatternExtraction['effort'], number> = {
  S: 0,
  M: 1,
  L: 2,
};

/**
 * Sort patterns by priority (P0 first) then effort (S first within same priority).
 * This surfaces highest-impact, lowest-effort items first for implementation.
 */
export function prioritizePatterns(patterns: PatternExtraction[]): PatternExtraction[] {
  return [...patterns].sort((a, b) => {
    const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    if (priorityDiff !== 0) return priorityDiff;
    return EFFORT_ORDER[a.effort] - EFFORT_ORDER[b.effort];
  });
}

// ── Report Formatter ──────────────────────────────────────────────────────────

/**
 * Generate a complete markdown OSS research report.
 * Sections: project summary, repos scanned, patterns found, what was implemented/skipped.
 */
export function formatOSSReport(report: OSSResearchReport): string {
  const timestamp = new Date().toISOString();
  const lines: string[] = [];

  lines.push('# OSS Research Report');
  lines.push(`> Generated: ${timestamp}`);
  lines.push('');

  // Project Summary
  lines.push('## Project Summary');
  lines.push('');
  lines.push(report.projectSummary);
  lines.push('');

  // Repos Scanned
  lines.push('## Repositories Scanned');
  lines.push('');
  if (report.reposScanned.length === 0) {
    lines.push('_No repositories scanned._');
  } else {
    lines.push('| Repository | License | Stars | Description |');
    lines.push('|---|---|---|---|');
    for (const repo of report.reposScanned) {
      const stars = repo.stars !== undefined ? String(repo.stars) : 'n/a';
      const licenseLabel = `${repo.licenseName} (${repo.license})`;
      const desc = repo.description.length > 60
        ? repo.description.slice(0, 57) + '...'
        : repo.description;
      lines.push(`| [${repo.name}](${repo.url}) | ${licenseLabel} | ${stars} | ${desc} |`);
    }
  }
  lines.push('');

  // Patterns Extracted
  lines.push('## Patterns Extracted');
  lines.push('');

  const prioritized = prioritizePatterns(report.patternsExtracted);

  if (prioritized.length === 0) {
    lines.push('_No patterns extracted._');
  } else {
    const categories: Array<PatternExtraction['category']> = [
      'architecture',
      'agent-ai',
      'cli-ux',
      'quality',
      'innovation',
    ];

    for (const category of categories) {
      const categoryPatterns = prioritized.filter(p => p.category === category);
      if (categoryPatterns.length === 0) continue;

      const categoryLabel = {
        architecture: 'Architecture',
        'agent-ai': 'Agent / AI',
        'cli-ux': 'CLI / UX',
        quality: 'Quality',
        innovation: 'Unique Innovations',
      }[category];

      lines.push(`### ${categoryLabel}`);
      lines.push('');
      lines.push('| Priority | Effort | Pattern | Repo | Description |');
      lines.push('|---|---|---|---|---|');

      for (const p of categoryPatterns) {
        lines.push(`| ${p.priority} | ${p.effort} | **${p.pattern}** | ${p.repoName} | ${p.description} |`);
      }
      lines.push('');
    }
  }

  // Implemented
  lines.push('## Implemented');
  lines.push('');
  if (report.implemented.length === 0) {
    lines.push('_Nothing implemented in this run._');
  } else {
    for (const item of report.implemented) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');

  // Skipped
  lines.push('## Skipped');
  lines.push('');
  if (report.skipped.length === 0) {
    lines.push('_Nothing skipped._');
  } else {
    for (const item of report.skipped) {
      lines.push(`- ${item}`);
    }
  }
  lines.push('');

  // Files Changed
  lines.push('## Files Changed');
  lines.push('');
  if (report.filesChanged.length === 0) {
    lines.push('_No files modified._');
  } else {
    for (const file of report.filesChanged) {
      lines.push(`- \`${file}\``);
    }
  }
  lines.push('');

  return lines.join('\n');
}

// ── Project Profile Detection ─────────────────────────────────────────────────

interface PackageJson {
  name?: string;
  description?: string;
  keywords?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  bin?: Record<string, string> | string;
  main?: string;
  scripts?: Record<string, string>;
}

/**
 * Read and parse a file safely; returns null if not found or invalid.
 */
async function safeReadJson<T>(filePath: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function safeReadFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

/**
 * Determine project type from package.json and directory structure.
 */
function detectProjectType(pkg: PackageJson | null, fileList: string[]): string {
  if (!pkg) {
    // Heuristics from file structure alone
    if (fileList.some(f => f.includes('Cargo.toml'))) return 'rust cli tool';
    if (fileList.some(f => f.includes('go.mod'))) return 'go application';
    if (fileList.some(f => f.includes('pyproject.toml') || f.includes('setup.py'))) return 'python tool';
    return 'software project';
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };

  // CLI tool
  if (pkg.bin || (pkg.scripts && Object.keys(pkg.scripts).some(k => k === 'start' || k.includes('cli')))) {
    if (deps.commander || deps.yargs || deps.meow || deps.clipanion || deps.oclif) {
      return 'CLI tool';
    }
  }

  // Web app / framework detection
  if (deps.next || deps['@nuxtjs/nuxt']) return 'Next.js web application';
  if (deps.nuxt) return 'Nuxt.js web application';
  if (deps.react && deps.vite) return 'React application';
  if (deps.vue && deps.vite) return 'Vue application';
  if (deps.svelte) return 'Svelte application';
  if (deps.react) return 'React application';

  // API / backend
  if (deps.express || deps.fastify || deps.koa || deps.hapi) return 'Node.js API server';
  if (deps.nestjs || deps['@nestjs/core']) return 'NestJS application';

  // AI / agent tools
  if (deps['@anthropic-ai/sdk'] || deps.openai || deps['@google/generative-ai']) return 'AI agent tool';

  // Library
  if (!pkg.bin && pkg.main) return 'JavaScript library';

  // Default to CLI if no frontend deps
  if (Object.keys(deps).some(d => d.startsWith('@types/'))) return 'TypeScript CLI tool';

  return 'Node.js application';
}

/**
 * Determine primary language from project structure.
 */
async function detectLanguage(cwd: string, pkg: PackageJson | null): Promise<string> {
  if (!pkg) {
    // Non-JS projects
    try {
      await fs.access(path.join(cwd, 'Cargo.toml'));
      return 'Rust';
    } catch { /* not rust */ }
    try {
      await fs.access(path.join(cwd, 'go.mod'));
      return 'Go';
    } catch { /* not go */ }
    try {
      await fs.access(path.join(cwd, 'pyproject.toml'));
      return 'Python';
    } catch { /* not python */ }
    return 'unknown';
  }

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const hasTypeScript = deps.typescript || deps['ts-node'] || deps.tsx || deps.tsup;

  if (hasTypeScript) return 'TypeScript';
  return 'JavaScript';
}

/**
 * Build a concise 3-sentence project summary for use in search queries.
 */
function buildSummary(
  pkg: PackageJson | null,
  projectType: string,
  language: string,
  readmeSnippet: string,
): string {
  const parts: string[] = [];

  if (pkg?.name && pkg?.description) {
    parts.push(`${pkg.name} is a ${language} ${projectType} — ${pkg.description}.`);
  } else if (pkg?.name) {
    parts.push(`${pkg.name} is a ${language} ${projectType}.`);
  } else {
    parts.push(`This is a ${language} ${projectType}.`);
  }

  // Key dependencies signal
  const deps = Object.keys({ ...pkg?.dependencies });
  if (deps.length > 0) {
    const notableDeps = deps
      .filter(d => !d.startsWith('@types/') && !d.startsWith('eslint') && d !== 'typescript')
      .slice(0, 5);
    if (notableDeps.length > 0) {
      parts.push(`Key dependencies include: ${notableDeps.join(', ')}.`);
    }
  }

  // README excerpt
  if (readmeSnippet) {
    const cleanedExcerpt = readmeSnippet
      .replace(/^#+\s+/gm, '')
      .replace(/\n+/g, ' ')
      .trim()
      .slice(0, 200);
    if (cleanedExcerpt.length > 20) {
      parts.push(cleanedExcerpt + '.');
    }
  }

  return parts.join(' ');
}

/**
 * Auto-detect the project profile from the current working directory.
 * Reads package.json, README, and directory structure to build a project summary.
 */
export async function detectProjectProfile(cwd: string): Promise<{
  type: string;
  language: string;
  summary: string;
}> {
  const pkg = await safeReadJson<PackageJson>(path.join(cwd, 'package.json'));

  // Get a list of top-level files for heuristics
  let topLevelFiles: string[] = [];
  try {
    const entries = await fs.readdir(cwd);
    topLevelFiles = entries;
  } catch { /* ignore */ }

  const projectType = detectProjectType(pkg, topLevelFiles);
  const language = await detectLanguage(cwd, pkg);

  // Read README for summary context
  let readmeSnippet = '';
  for (const readmeName of ['README.md', 'Readme.md', 'readme.md']) {
    const content = await safeReadFile(path.join(cwd, readmeName));
    if (content) {
      // Take first 400 chars of README (skip badges/shields)
      readmeSnippet = content
        .replace(/\[!\[.*?\]\(.*?\)\]\(.*?\)/g, '') // strip badge links
        .replace(/!\[.*?\]\(.*?\)/g, '')             // strip images
        .trim()
        .slice(0, 400);
      break;
    }
  }

  const summary = buildSummary(pkg, projectType, language, readmeSnippet);

  return { type: projectType, language, summary };
}
