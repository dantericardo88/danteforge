// local-harvest command — harvest patterns from local private repos, folders, and zip archives
import path from 'node:path';
import readline from 'node:readline';
import fs from 'fs/promises';
import yaml from 'yaml';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import {
  harvestLocalSources,
  type LocalSource,
  type LocalHarvestReport,
  type HarvestDepth,
  type LocalHarvesterOptions,
} from '../../core/local-harvester.js';

export interface LocalHarvestCommandOptions {
  config?: string;
  depth?: string;
  prompt?: boolean;
  dryRun?: boolean;
  maxSources?: number;
  cwd?: string;
  /** Injection seam — avoids real harvester execution in tests */
  _harvester?: (sources: LocalSource[], opts: LocalHarvesterOptions) => Promise<LocalHarvestReport>;
  /** Injection seam — avoids real readline interaction in tests */
  _pickSourcesInteractive?: (cwd: string) => Promise<string[]>;
}

interface LocalSourcesYamlEntry {
  path: string;
  label?: string;
  depth?: HarvestDepth;
}
interface LocalSourcesConfig {
  sources: LocalSourcesYamlEntry[];
}

export async function localHarvest(
  paths: string[],
  options: LocalHarvestCommandOptions = {},
): Promise<void> {
  const cwd = options.cwd ?? process.cwd();
  const depth = (options.depth as HarvestDepth | undefined) ?? 'medium';
  const harvester = options._harvester ?? harvestLocalSources;

  // ── Prompt mode ──────────────────────────────────────────────────────────
  if (options.prompt) {
    logger.success('DanteForge Local Harvest — prompt mode');
    process.stdout.write(buildLocalHarvestPrompt() + '\n');
    return;
  }

  // ── Resolve sources ───────────────────────────────────────────────────────
  let sources: LocalSource[] = [];

  if (paths.length > 0) {
    sources = paths.map(p => ({ path: p, depth }));
  } else if (options.config) {
    const configPath = path.isAbsolute(options.config)
      ? options.config
      : path.join(cwd, options.config);
    try {
      const raw = await fs.readFile(configPath, 'utf-8');
      const config = yaml.parse(raw) as LocalSourcesConfig;
      sources = (config.sources ?? []).map(s => ({
        path: s.path,
        label: s.label,
        depth: s.depth ?? depth,
      }));
    } catch (err) {
      logger.error(
        `[local-harvest] Failed to load sources config: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }
  } else {
    // Interactive fallback
    const picker = options._pickSourcesInteractive ?? pickSourcesInteractive;
    const picked = await picker(cwd);
    sources = picked.map(p => ({ path: p, depth }));
  }

  // Apply max-sources limit
  const maxSources = options.maxSources ?? 5;
  if (sources.length > maxSources) {
    logger.warn(
      `[local-harvest] Limiting to ${maxSources} sources (${sources.length} provided — use --max-sources to increase)`,
    );
    sources = sources.slice(0, maxSources);
  }

  if (sources.length === 0) {
    logger.warn('[local-harvest] No sources selected — nothing to harvest');
    return;
  }

  // ── Dry-run mode ─────────────────────────────────────────────────────────
  if (options.dryRun) {
    logger.info(`[local-harvest] Dry-run: ${sources.length} source(s) detected`);
    for (const source of sources) {
      const absPath = path.isAbsolute(source.path)
        ? source.path
        : path.join(cwd, source.path);
      logger.info(`  ${source.label ?? source.path}  →  ${absPath}  (depth: ${source.depth})`);
    }
    logger.info(`[local-harvest] Would harvest at depth: ${depth}`);
    logger.info(
      '[local-harvest] Run without --dry-run to execute, or add --local-sources to /inferno.',
    );
    return;
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  logger.success(
    `[local-harvest] Harvesting ${sources.length} source(s) at depth: ${depth}`,
  );
  logger.info('');

  const startTime = Date.now();
  const report = await harvester(sources, { depth, cwd });
  const dur = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.info('');
  logger.info('='.repeat(60));
  logger.success('  LOCAL HARVEST COMPLETE');
  logger.info('='.repeat(60));
  logger.info('');
  logger.success(
    `Sources: ${report.sources.length}  |  Patterns: ${report.topPatterns.length}  |  Time: ${dur}s`,
  );
  logger.info('');

  if (report.synthesis) {
    logger.info('Synthesis:');
    logger.info(report.synthesis);
    logger.info('');
  }

  if (report.topPatterns.length > 0) {
    logger.info('Top Patterns:');
    for (const p of report.topPatterns.slice(0, 5)) {
      logger.info(`  [${p.priority}] ${p.name}: ${p.description}`);
    }
    logger.info('');
  }

  if (report.recommendedOssQueries.length > 0) {
    logger.info('Recommended OSS Queries (pass to /oss or /inferno --local-sources):');
    for (const q of report.recommendedOssQueries) {
      logger.info(`  "${q}"`);
    }
    logger.info('');
  }

  logger.info('Written: .danteforge/LOCAL_HARVEST_REPORT.md');
  logger.info('         .danteforge/local-harvest-summary.json');
  logger.info('');
  logger.info(
    'Next: run /inferno to build from these insights + OSS discovery.',
  );

  // Audit log (best-effort)
  try {
    const state = await loadState();
    state.auditLog.push(
      `${new Date().toISOString()} | local-harvest: ${sources.length} sources, ${report.topPatterns.length} patterns, ${dur}s`,
    );
    await saveState(state);
  } catch {
    // Best-effort
  }
}

// ── Interactive source picker ─────────────────────────────────────────────────

export async function pickSourcesInteractive(cwd: string): Promise<string[]> {
  let entries: string[] = [];
  try {
    const all = await fs.readdir(cwd, { withFileTypes: true });
    entries = all
      .filter(
        e =>
          (e.isDirectory() || /\.(zip|tar\.gz|tgz)$/i.test(e.name)) &&
          !e.name.startsWith('.') &&
          e.name !== 'node_modules' &&
          e.name !== 'dist',
      )
      .map(e => e.name);
  } catch {
    return [];
  }

  if (entries.length === 0) {
    logger.warn('[local-harvest] No folders or archives found in current directory');
    return [];
  }

  return new Promise<string[]>(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    logger.info('[local-harvest] Available sources (enter numbers separated by commas):');
    entries.forEach((e, i) => logger.info(`  ${i + 1}. ${e}`));
    rl.question('Select sources [1]: ', answer => {
      rl.close();
      const selected = (answer.trim() || '1')
        .split(',')
        .map(s => parseInt(s.trim(), 10) - 1)
        .filter(i => i >= 0 && i < entries.length)
        .map(i => entries[i]!);
      resolve(selected);
    });
  });
}

// ── Prompt template ───────────────────────────────────────────────────────────

function buildLocalHarvestPrompt(): string {
  return `# DanteForge Local Harvest Plan

## Purpose
Extract patterns, ideas, and architecture decisions from private local projects to inform new development.

## Source Specification

### Option 1: Path arguments (quick)
\`\`\`bash
danteforge local-harvest ./old-project-1 ./old-project-2 ~/archives/idea.zip
\`\`\`

### Option 2: Config file (persistent)
\`\`\`bash
danteforge local-harvest --config .danteforge/local-sources.yaml
\`\`\`

Config file format (.danteforge/local-sources.yaml):
\`\`\`yaml
sources:
  - path: ./old-project-1
    label: "Auth MVP 2024"
    depth: medium
  - path: ~/archives/stealthy.zip
    label: "Secret idea"
    depth: shallow
\`\`\`

### Option 3: Interactive picker
\`\`\`bash
danteforge local-harvest
# Arrow-key menu lists folders and archives in current directory
\`\`\`

## Depth Levels
- **shallow**: Planning docs only (UPR, SPEC, PLAN, CONSTITUTION, README) — ~$0.05/source
- **medium**: Planning docs + entry points (package.json, src/index.ts) — ~$0.15/source (default)
- **full**: Planning docs + top source files — ~$0.30/source

## Ultimate Synthesis (One Command)
Combine local harvest with OSS discovery and full inferno build:
\`\`\`bash
danteforge inferno "my goal" --local-sources ./proj1,./proj2 --local-depth medium
\`\`\`

This runs: local-harvest → oss → specify → plan → tasks → autoforge → party → verify → convergence loop

## Output
- .danteforge/LOCAL_HARVEST_REPORT.md — Full markdown report with synthesis + patterns
- .danteforge/local-harvest-summary.json — Compact JSON for pipeline consumption`;
}
