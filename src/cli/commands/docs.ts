// docs - auto-generate command reference documentation and JSDoc coverage reports.
// Supports --output, --format (md|json), and --coverage flags.
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  CANVAS_PRESET_TEXT,
  SPARK_PLANNING_TEXT,
} from '../../core/workflow-surface.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandEntry {
  name: string;
  args?: string;
  description: string;
  options: string[];
  group: string;
}

/** A documented symbol found in src/core/ */
export interface DocumentedSymbol {
  /** Source file path relative to project root */
  file: string;
  /** Exported symbol name */
  name: string;
  /** Kind: function, class, or const */
  kind: 'function' | 'class' | 'const';
  /** First line of the JSDoc block above the symbol */
  summary: string;
  /** Whether a JSDoc block was found */
  hasJsDoc: boolean;
}

/** Result of the documentation coverage scan */
export interface DocCoverageResult {
  /** Total exported symbols found */
  total: number;
  /** Symbols that have a JSDoc block */
  documented: number;
  /** Percentage 0–100 */
  coveragePercent: number;
  /** All symbols with documentation status */
  symbols: DocumentedSymbol[];
  /** Up to 10 symbols missing JSDoc, ordered by file */
  undocumentedTop10: DocumentedSymbol[];
}

/** Options for the `docs` command */
export interface DocsOptions {
  /** Path to write the output (default: docs/API.md or docs/api.json) */
  output?: string;
  /** Output format: 'md' for Markdown, 'json' for JSON (default: 'md') */
  format?: 'md' | 'json';
  /** If true, run coverage analysis and exit 1 if below 60% */
  coverage?: boolean;
  /** Injection seam: override loadState for testing */
  _loadState?: typeof loadState;
  /** Injection seam: override saveState for testing */
  _saveState?: typeof saveState;
  /** Injection seam: override fs.readdir for testing */
  _readdir?: (p: string) => Promise<string[]>;
  /** Injection seam: override fs.readFile for testing */
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>;
  /** Injection seam: override fs.mkdir for testing */
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<string | undefined>;
  /** Injection seam: override fs.writeFile for testing */
  _writeFile?: (p: string, data: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Command registry — declarative list used to generate COMMAND_REFERENCE.md
// ---------------------------------------------------------------------------

const COMMAND_REGISTRY: CommandEntry[] = [
  { name: 'init', description: 'Interactive first-run wizard - detect project, check health, show next steps', options: ['--prompt'], group: 'Pipeline' },
  { name: 'constitution', description: 'Initialize project constitution and principles', options: [], group: 'Pipeline' },
  { name: 'specify', args: '<idea>', description: 'High-level idea -> full spec artifacts', options: ['--prompt', '--light', '--ceo-review', '--refine'], group: 'Pipeline' },
  { name: 'clarify', description: 'Run clarification Q&A on current spec', options: ['--prompt', '--light'], group: 'Pipeline' },
  { name: 'plan', description: 'Generate detailed plan from spec', options: ['--prompt', '--light', '--ceo-review', '--refine'], group: 'Pipeline' },
  { name: 'tasks', description: 'Break plan into executable tasks', options: ['--prompt', '--light'], group: 'Pipeline' },
  { name: 'forge', args: '[phase]', description: 'Execute development waves with agent orchestration', options: ['--parallel', '--profile <type>', '--prompt', '--light', '--worktree', '--figma', '--skip-ux', '--confirm'], group: 'Pipeline' },
  { name: 'verify', description: 'Run verification checks on project state and artifacts', options: ['--release', '--live', '--url <url>', '--recompute'], group: 'Pipeline' },
  { name: 'synthesize', description: 'Generate Ultimate Planning Resource (UPR.md) from all artifacts', options: [], group: 'Pipeline' },

  { name: 'spark', args: '[goal]', description: `Zero-token planning preset: ${SPARK_PLANNING_TEXT}`, options: ['--prompt', '--skip-tech-decide'], group: 'Automation' },
  { name: 'ember', args: '[goal]', description: 'Very low-token preset with light checkpoints and loop detection', options: ['--profile <type>', '--prompt'], group: 'Automation' },
  { name: 'canvas', args: '[goal]', description: `Design-first frontend preset: ${CANVAS_PRESET_TEXT}`, options: ['--profile <type>', '--prompt', '--design-prompt <text>'], group: 'Automation' },
  { name: 'magic', args: '[goal]', description: 'Balanced default preset for daily follow-up work', options: ['--level <level>', '--profile <type>', '--skip-ux', '--host <type>', '--prompt', '--worktree', '--isolation', '--max-repos <n>'], group: 'Automation' },
  { name: 'blaze', args: '[goal]', description: 'High-power preset with full party orchestration, synthesis, and retro', options: ['--profile <type>', '--prompt', '--worktree', '--isolation', '--with-design', '--design-prompt <text>'], group: 'Automation' },
  { name: 'nova', args: '[goal]', description: 'Very-high-power preset with planning prefix plus deep execution and polish', options: ['--profile <type>', '--prompt', '--worktree', '--isolation', '--tech-decide', '--with-design', '--design-prompt <text>'], group: 'Automation' },
  { name: 'inferno', args: '[goal]', description: 'Maximum-power preset with OSS discovery, full implementation, and evolution', options: ['--profile <type>', '--prompt', '--worktree', '--isolation', '--max-repos <n>', '--with-design', '--design-prompt <text>', '--local-sources <paths>', '--local-depth <level>', '--local-config <path>'], group: 'Automation' },
  { name: 'autoforge', args: '[goal]', description: 'Deterministic auto-orchestration of the full DanteForge pipeline', options: ['--dry-run', '--max-waves <n>', '--profile <type>', '--parallel', '--worktree', '--light', '--prompt', '--score-only', '--auto', '--force', '--confirm'], group: 'Automation' },
  { name: 'autoresearch', args: '<goal>', description: 'Autonomous metric-driven optimization loop', options: ['--metric <metric>', '--measurement-command <command>', '--time <budget>', '--prompt', '--dry-run', '--allow-dirty'], group: 'Automation' },
  { name: 'party', description: 'Launch multi-agent collaboration mode', options: ['--worktree', '--isolation', '--figma', '--skip-ux', '--design', '--no-design'], group: 'Automation' },

  { name: 'design', args: '<prompt>', description: 'Generate design artifacts via OpenPencil Design-as-Code engine', options: ['--prompt', '--light', '--format <type>', '--parallel', '--worktree', '--seed'], group: 'Design' },
  { name: 'ux-refine', description: 'Explicit UX refinement via OpenPencil or Figma', options: ['--prompt', '--light', '--host <type>', '--figma-url <url>', '--token-file <path>', '--skip-ux', '--after-forge', '--openpencil', '--lint', '--live', '--url <url>'], group: 'Design' },
  { name: 'browse', args: '<subcommand> [args...]', description: 'Browser automation - navigate, screenshot, inspect live apps', options: ['--url <url>', '--port <port>'], group: 'Design' },
  { name: 'qa', description: 'Structured QA pass with health score on live app', options: ['--url <url> (required)', '--type <mode>', '--baseline <path>', '--save-baseline', '--fail-below <score>'], group: 'Design' },

  { name: 'tech-decide', description: 'Guided tech stack selection - 3-5 options per category with pros/cons', options: ['--prompt', '--auto'], group: 'Intelligence' },
  { name: 'debug', args: '<issue>', description: 'Systematic 4-phase debugging framework', options: ['--prompt'], group: 'Intelligence' },
  { name: 'lessons', args: '[correction]', description: 'Self-improving lessons - capture corrections, view rules, auto-compact', options: ['--prompt', '--compact'], group: 'Intelligence' },
  { name: 'oss', description: 'Auto-detect project, search OSS, clone, license-gate, scan, extract patterns, report', options: ['--prompt', '--dry-run', '--max-repos <n>'], group: 'Intelligence' },
  { name: 'local-harvest', args: '[paths...]', description: 'Harvest patterns from local private repos, folders, and zip archives', options: ['--config <path>', '--depth <level>', '--prompt', '--dry-run', '--max-sources <n>'], group: 'Intelligence' },
  { name: 'harvest', args: '<system>', description: 'Titan Harvest V2 - constitutional harvest of OSS patterns with hash-verifiable ratification', options: ['--prompt', '--lite'], group: 'Intelligence' },
  { name: 'retro', description: 'Project retrospective with metrics, delta scoring, and trend tracking', options: ['--summary', '--cwd <path>'], group: 'Intelligence' },

  { name: 'config', description: 'Manage API keys and LLM provider settings', options: ['--set-key <provider:key>', '--delete-key <provider>', '--provider <name>', '--model <provider:model>', '--show'], group: 'Tools' },
  { name: 'setup', args: '<tool>', description: 'Interactive setup wizard for integrations (figma|assistants)', options: ['--host <type>', '--assistants <list>', '--figma-url <url>', '--token-file <path>', '--no-test'], group: 'Tools' },
  { name: 'doctor', description: 'System health check and diagnostics', options: ['--fix', '--live'], group: 'Tools' },
  { name: 'dashboard', description: 'Launch progress dashboard (local HTML, auto-closes in 5 min)', options: ['--port <number>'], group: 'Tools' },
  { name: 'compact', description: 'Compact audit log - summarize old entries to save context', options: [], group: 'Tools' },
  { name: 'import', args: '<file>', description: 'Import an LLM-generated file into .danteforge/', options: ['--as <name>'], group: 'Tools' },
  { name: 'skills import', description: 'Import one Antigravity bundle into the packaged skills catalog', options: ['--from <source> (required)', '--bundle <name>', '--allow-overwrite', '--enhance'], group: 'Tools' },
  { name: 'ship', description: 'Paranoid release guidance + version bump plan + changelog draft', options: ['--dry-run', '--skip-review'], group: 'Tools' },

  { name: 'measure', args: '', description: 'Answer "How good is the project?" — light=quick score, standard=score+maturity+proof, deep=verify+adversary. Alias: score', options: ['--level light|standard|deep', '--full', '--strict', '--adversary', '--json'], group: 'Self-Assessment' },
  { name: 'assess', description: 'Harsh self-assessment: score all 20 dimensions, benchmark vs competitors, generate masterplan', options: ['--no-harsh', '--min-score <n>', '--json', '--preset <level>', '--set-baseline', '--cwd <path>'], group: 'Self-Assessment' },
  { name: 'maturity', description: 'Assess current code maturity level with founder-friendly quality report', options: ['--preset <level>', '--json', '--cwd <path>'], group: 'Self-Assessment' },
  { name: 'quality', description: 'Visual quality scorecard: dimension bars, P0 gaps, and automation ceilings', options: [], group: 'Self-Assessment' },

  { name: 'help', args: '[query]', description: 'Context-aware guidance engine', options: [], group: 'Meta' },
  { name: 'review', description: 'Scan existing repo -> generate CURRENT_STATE.md', options: ['--prompt'], group: 'Meta' },
  { name: 'feedback', description: 'Generate prompt from UPR.md for LLM refinement', options: ['--auto'], group: 'Meta' },
  { name: 'update-mcp', description: 'Manual MCP self-healing - check for protocol updates', options: ['--prompt', '--apply', '--check'], group: 'Meta' },
  { name: 'awesome-scan', description: 'Discover, classify, and import skills across all sources', options: ['--source <path>', '--domain <type>', '--install'], group: 'Meta' },
  { name: 'docs', description: 'Generate or update the command reference and API documentation', options: ['--output <path>', '--format <md|json>', '--coverage'], group: 'Meta' },
];

// ---------------------------------------------------------------------------
// Command reference formatter (existing functionality)
// ---------------------------------------------------------------------------

/**
 * Format the command registry as a Markdown reference document.
 *
 * Groups commands by category, includes a table of contents, and renders
 * each command with its usage pattern, description, and options.
 *
 * @returns Multi-line Markdown string suitable for writing to `docs/API.md`.
 */
export function formatCommandReference(): string {
  const groups = new Map<string, CommandEntry[]>();
  for (const cmd of COMMAND_REGISTRY) {
    const list = groups.get(cmd.group) ?? [];
    list.push(cmd);
    groups.set(cmd.group, list);
  }

  const lines: string[] = [
    '# DanteForge Command Reference',
    '',
    `> Auto-generated by \`danteforge docs\`. ${COMMAND_REGISTRY.length} commands across ${groups.size} categories.`,
    '',
    '## Table of Contents',
    '',
  ];

  for (const group of groups.keys()) {
    lines.push(`- [${group}](#${group.toLowerCase()})`);
  }
  lines.push('');

  for (const [group, cmds] of groups) {
    lines.push(`## ${group}`, '');
    for (const cmd of cmds) {
      const usage = cmd.args
        ? `danteforge ${cmd.name} ${cmd.args}`
        : `danteforge ${cmd.name}`;
      lines.push(`### \`${usage}\``, '');
      lines.push(cmd.description, '');
      if (cmd.options.length > 0) {
        lines.push('**Options:**', '');
        for (const opt of cmd.options) {
          lines.push(`- \`${opt}\``);
        }
        lines.push('');
      }
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// JSDoc coverage scanner
// ---------------------------------------------------------------------------

/** Regex matching an exported function, class, or const declaration */
const EXPORT_RE = /^export\s+(?:async\s+)?(function|class|const)\s+(\w+)/m;

/** Regex matching a JSDoc block ending just before the export */
const JSDOC_BEFORE_RE = /\/\*\*[\s\S]*?\*\/\s*$/;

/**
 * Scan a single TypeScript source file and extract all exported symbols
 * along with whether they have a JSDoc block above them.
 *
 * Uses regex-based scanning (not AST) to stay lightweight and dependency-free.
 *
 * @param filePath    - Absolute path to the TypeScript file.
 * @param relPath     - Path relative to the project root for display purposes.
 * @param _readFile   - Optional injection seam for testing.
 * @returns Array of `DocumentedSymbol` objects, one per exported symbol.
 */
export async function scanFileForExports(
  filePath: string,
  relPath: string,
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>,
): Promise<DocumentedSymbol[]> {
  const readFn = _readFile ?? fs.readFile;
  let source: string;
  try {
    source = await readFn(filePath, 'utf8');
  } catch {
    return [];
  }

  const results: DocumentedSymbol[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const exportMatch = line.match(/^export\s+(?:async\s+)?(function|class|const)\s+(\w+)/);
    if (!exportMatch) continue;

    const kind = exportMatch[1] as 'function' | 'class' | 'const';
    const name = exportMatch[2] ?? '';

    // Look backward for a JSDoc block
    let hasJsDoc = false;
    let summary = '';

    // Scan up to 30 lines back for /** ... */ block
    const contextLines = lines.slice(Math.max(0, i - 30), i).join('\n');
    const jsDocMatch = contextLines.match(JSDOC_BEFORE_RE);
    if (jsDocMatch) {
      hasJsDoc = true;
      // Extract the first text line from the JSDoc block
      const docLines = jsDocMatch[0].split('\n');
      for (const dl of docLines) {
        const stripped = dl.replace(/^\s*\*\s?/, '').trim();
        if (stripped && stripped !== '/**' && stripped !== '*/' && !stripped.startsWith('@')) {
          summary = stripped;
          break;
        }
      }
    }

    results.push({ file: relPath, name, kind, summary, hasJsDoc });
  }

  return results;
}

/**
 * Scan all TypeScript files in `src/core/` for exported symbols and report
 * JSDoc coverage.
 *
 * @param coreDir   - Absolute path to the `src/core/` directory.
 * @param _readdir  - Optional injection seam for directory listing.
 * @param _readFile - Optional injection seam for file reading.
 * @returns A `DocCoverageResult` with coverage stats and symbol lists.
 */
export async function scanDocCoverage(
  coreDir: string,
  _readdir?: (p: string) => Promise<string[]>,
  _readFile?: (p: string, enc: BufferEncoding) => Promise<string>,
): Promise<DocCoverageResult> {
  const readdirFn = _readdir ?? fs.readdir;

  let files: string[];
  try {
    files = await readdirFn(coreDir);
  } catch {
    files = [];
  }

  const tsFiles = files.filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'));

  const allSymbols: DocumentedSymbol[] = [];
  for (const file of tsFiles) {
    const filePath = path.join(coreDir, file);
    const relPath = path.join('src', 'core', file);
    const symbols = await scanFileForExports(filePath, relPath, _readFile);
    allSymbols.push(...symbols);
  }

  const documented = allSymbols.filter(s => s.hasJsDoc).length;
  const total = allSymbols.length;
  const coveragePercent = total > 0 ? Math.round((documented / total) * 100) : 100;

  const undocumented = allSymbols.filter(s => !s.hasJsDoc);
  const undocumentedTop10 = undocumented.slice(0, 10);

  return { total, documented, coveragePercent, symbols: allSymbols, undocumentedTop10 };
}

/**
 * Format a `DocCoverageResult` as a human-readable report string.
 *
 * @param result - Coverage result from `scanDocCoverage`.
 * @returns Multi-line string suitable for console output.
 */
export function formatCoverageReport(result: DocCoverageResult): string {
  const lines: string[] = [
    `Documentation Coverage: ${result.documented}/${result.total} symbols (${result.coveragePercent}%)`,
    '',
  ];

  if (result.undocumentedTop10.length > 0) {
    lines.push('Top undocumented exports (add JSDoc to fix):');
    for (const sym of result.undocumentedTop10) {
      lines.push(`  - ${sym.file}: export ${sym.kind} ${sym.name}`);
    }
  } else {
    lines.push('All scanned exports are documented.');
  }

  lines.push('');
  if (result.coveragePercent < 60) {
    lines.push('FAIL: Coverage below 60% threshold. Add JSDoc to exported functions.');
  } else {
    lines.push(`PASS: Coverage ${result.coveragePercent}% meets minimum threshold.`);
  }

  return lines.join('\n');
}

/**
 * Format a `DocCoverageResult` as a JSON-serialisable object for `--format json`.
 *
 * @param result - Coverage result from `scanDocCoverage`.
 * @returns Plain object safe to pass to `JSON.stringify`.
 */
export function formatCoverageJson(result: DocCoverageResult): Record<string, unknown> {
  return {
    total: result.total,
    documented: result.documented,
    coveragePercent: result.coveragePercent,
    pass: result.coveragePercent >= 60,
    undocumentedTop10: result.undocumentedTop10.map(s => ({
      file: s.file,
      name: s.name,
      kind: s.kind,
    })),
  };
}

// ---------------------------------------------------------------------------
// API reference generator (--format md|json output from core scan)
// ---------------------------------------------------------------------------

/**
 * Generate an API reference markdown document from scanned `src/core/` exports.
 *
 * Groups symbols by source file and renders each documented symbol with its
 * summary. Undocumented symbols are listed without descriptions.
 *
 * @param result - Coverage result from `scanDocCoverage`.
 * @returns Markdown string suitable for writing to `docs/API.md`.
 */
export function generateApiMarkdown(result: DocCoverageResult): string {
  const byFile = new Map<string, DocumentedSymbol[]>();
  for (const sym of result.symbols) {
    const list = byFile.get(sym.file) ?? [];
    list.push(sym);
    byFile.set(sym.file, list);
  }

  const lines: string[] = [
    '# DanteForge Core API Reference',
    '',
    `> Auto-generated by \`danteforge docs\`. ${result.total} exported symbols across ${byFile.size} files.`,
    `> Coverage: ${result.documented}/${result.total} (${result.coveragePercent}%) symbols documented.`,
    '',
  ];

  for (const [file, symbols] of byFile) {
    lines.push(`## \`${file}\``, '');
    for (const sym of symbols) {
      lines.push(`### \`${sym.name}\` *(${sym.kind})*`);
      if (sym.summary) {
        lines.push('', sym.summary);
      } else {
        lines.push('', '_No documentation. Add a JSDoc block above this export._');
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Main command entry point
// ---------------------------------------------------------------------------

/**
 * Execute the `danteforge docs` command.
 *
 * Depending on options, either:
 * - Generates a Markdown command reference (`docs/COMMAND_REFERENCE.md`)
 * - Generates an API reference from `src/core/` JSDoc (`docs/API.md`)
 * - Reports documentation coverage and exits 1 when below 60%
 * - Outputs JSON instead of Markdown (`--format json`)
 *
 * @param options - Command options with optional injection seams for testing.
 */
export async function docs(options: DocsOptions = {}): Promise<void> {
  const loadFn = options._loadState ?? loadState;
  const saveFn = options._saveState ?? saveState;
  const readdirFn = options._readdir ?? fs.readdir;
  const readFileFn = options._readFile ?? ((p: string, enc: BufferEncoding) => fs.readFile(p, enc));
  const mkdirFn = options._mkdir ?? ((p: string, opts?: { recursive?: boolean }) => fs.mkdir(p, opts));
  const writeFileFn = options._writeFile ?? fs.writeFile;

  return withErrorBoundary('docs', async () => {
    const cwd = process.cwd();
    const timestamp = new Date().toISOString();
    const format = options.format ?? 'md';
    const coreDir = path.join(cwd, 'src', 'core');

    // ── Coverage mode ────────────────────────────────────────────────────────
    if (options.coverage) {
      logger.info('Scanning src/core/ for JSDoc coverage...');
      const result = await scanDocCoverage(coreDir, readdirFn, readFileFn);

      if (format === 'json') {
        process.stdout.write(JSON.stringify(formatCoverageJson(result), null, 2) + '\n');
      } else {
        logger.info(formatCoverageReport(result));
      }

      if (result.coveragePercent < 60) {
        process.exitCode = 1;
      }
      return;
    }

    // ── API reference mode ───────────────────────────────────────────────────
    logger.info('Scanning src/core/ for exported symbols...');
    const coverageResult = await scanDocCoverage(coreDir, readdirFn, readFileFn);

    const docsDir = path.join(cwd, 'docs');
    await mkdirFn(docsDir, { recursive: true });

    if (format === 'json') {
      const defaultOut = options.output ?? path.join(docsDir, 'api.json');
      const jsonData = {
        generatedAt: timestamp,
        commandReference: COMMAND_REGISTRY,
        apiCoverage: formatCoverageJson(coverageResult),
        symbols: coverageResult.symbols,
      };
      await writeFileFn(defaultOut, JSON.stringify(jsonData, null, 2));
      logger.success(`API JSON written to: ${defaultOut}`);
    } else {
      // Write command reference
      const cmdRefPath = path.join(docsDir, 'COMMAND_REFERENCE.md');
      await writeFileFn(cmdRefPath, formatCommandReference());
      logger.success(`Command reference written to: ${cmdRefPath}`);
      logger.info(`${COMMAND_REGISTRY.length} commands documented.`);

      // Write API reference
      const apiPath = options.output ?? path.join(docsDir, 'API.md');
      await writeFileFn(apiPath, generateApiMarkdown(coverageResult));
      logger.success(`API reference written to: ${apiPath}`);
      logger.info(`${coverageResult.documented}/${coverageResult.total} symbols documented (${coverageResult.coveragePercent}%).`);
    }

    // ── Audit log ────────────────────────────────────────────────────────────
    try {
      const state = await loadFn();
      state.auditLog.push(
        `${timestamp} | docs: generated API reference (${coverageResult.documented}/${coverageResult.total} symbols documented)`,
      );
      await saveFn(state);
    } catch {
      // Best-effort audit log only.
    }
  });
}
