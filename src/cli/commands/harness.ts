// harness.ts — AI coding assistant harness command suite
// Positions DanteForge as a harness/optimizer for Claude Code, Codex, DanteCode.
// Detects which assistants are present, generates per-assistant session briefs,
// reports token usage and integration health across all detected assistants.

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export type Assistant = 'claude-code' | 'codex' | 'dantecode';

export interface AssistantDetection {
  assistant: Assistant;
  detected: boolean;
  configPath?: string;
  evidencePath?: string;
  notes: string[];
}

export interface HarnessStatusResult {
  cwd: string;
  detected: AssistantDetection[];
  detectedCount: number;
  forgePresent: boolean;
}

export interface HarnessOptions {
  cwd?: string;
  homeDir?: string;
  // Injection seams
  _exists?: (p: string) => Promise<boolean>;
  _readFile?: (p: string) => Promise<string>;
  _stdout?: (line: string) => void;
}

export interface HarnessBriefOptions extends HarnessOptions {
  for?: Assistant;
  output?: string;
  _writeFile?: (p: string, data: string) => Promise<void>;
}

// ── Detection ─────────────────────────────────────────────────────────────────

const ASSISTANT_PROBES: Record<Assistant, (homeDir: string, cwd: string) => string[]> = {
  'claude-code': (h, c) => [
    path.join(c, '.claude'),
    path.join(c, '.claude', 'settings.local.json'),
    path.join(c, '.claude', 'mcp.json'),
    path.join(h, '.claude', 'settings.json'),
    path.join(h, '.claude', 'plugins'),
    path.join(h, '.claude', 'skills'),
  ],
  'codex': (h, c) => [
    path.join(c, '.codex'),
    path.join(h, '.codex', 'config.toml'),
    path.join(h, '.codex', 'AGENTS.md'),
    path.join(h, '.codex', 'commands'),
  ],
  'dantecode': (h, c) => [
    path.join(c, '.dantecode'),
    path.join(h, '.dantecode'),
    path.join(h, '.vscode', 'extensions'),
  ],
};

export async function detectAssistant(
  assistant: Assistant,
  homeDir: string,
  cwd: string,
  existsFn: (p: string) => Promise<boolean>,
): Promise<AssistantDetection> {
  const probes = ASSISTANT_PROBES[assistant](homeDir, cwd);
  const notes: string[] = [];
  let configPath: string | undefined;
  let evidencePath: string | undefined;

  for (const probe of probes) {
    if (await existsFn(probe)) {
      evidencePath ??= probe;
      if (probe.endsWith('settings.json') || probe.endsWith('config.toml') || probe.endsWith('mcp.json')) {
        configPath ??= probe;
      }
      notes.push(`✓ ${probe}`);
    }
  }

  return {
    assistant,
    detected: evidencePath !== undefined,
    configPath,
    evidencePath,
    notes,
  };
}

// ── Status ────────────────────────────────────────────────────────────────────

export async function harnessStatus(options: HarnessOptions = {}): Promise<HarnessStatusResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const existsFn = options._exists ?? defaultExists;
  const emit = options._stdout ?? ((l: string) => logger.info(l));

  const assistants: Assistant[] = ['claude-code', 'codex', 'dantecode'];
  const detected = await Promise.all(
    assistants.map(a => detectAssistant(a, homeDir, cwd, existsFn)),
  );

  const forgePresent = await existsFn(path.join(cwd, '.danteforge'));
  const detectedCount = detected.filter(d => d.detected).length;

  emit(chalk.bold('\nDanteForge Harness Status'));
  emit(chalk.dim('─'.repeat(50)));
  emit('');
  for (const d of detected) {
    const icon = d.detected ? chalk.green('●') : chalk.dim('○');
    const status = d.detected ? chalk.green('detected') : chalk.dim('not found');
    emit(`  ${icon} ${chalk.bold(d.assistant.padEnd(14))} ${status}`);
    if (d.detected && d.configPath) {
      emit(`      ${chalk.dim('config:')} ${d.configPath}`);
    }
  }
  emit('');
  emit(`  ${chalk.bold('DanteForge:')} ${forgePresent ? chalk.green('initialized') : chalk.yellow('not initialized — run danteforge init')}`);
  emit('');

  if (detectedCount === 0) {
    emit(chalk.yellow('  No AI coding assistants detected.'));
    emit(chalk.dim('  DanteForge optimizes Claude Code, Codex, and DanteCode workflows.'));
  } else {
    emit(chalk.dim(`  ${detectedCount}/3 assistants detected — harness ready.`));
  }

  return { cwd, detected, detectedCount, forgePresent };
}

// ── Brief generation ──────────────────────────────────────────────────────────

const BRIEF_TEMPLATES: Record<Assistant, (ctx: BriefContext) => string> = {
  'claude-code': (ctx) => [
    `# Claude Code Session Brief — ${ctx.project}`,
    '',
    `**Date:** ${ctx.date}`,
    `**Stage:** ${ctx.stage}`,
    '',
    '## Context',
    '',
    `You are continuing work on **${ctx.project}**, a DanteForge-managed project.`,
    `Current workflow stage: \`${ctx.stage}\`.`,
    '',
    '## How DanteForge Helps Here',
    '',
    '- `/specify`, `/plan`, `/tasks` — structured spec pipeline before code',
    '- `/forge` — execute tasks with multi-agent waves',
    '- `/verify` — run gates after each change',
    '- `/measure` — quick quality check (1.6s warm)',
    '',
    '## Recommended Next Move',
    '',
    `Run \`danteforge ${ctx.nextCommand}\` first to understand the current state.`,
    '',
    '## Token Budget',
    '',
    `Remaining session budget: ${ctx.tokenBudget ?? 'unlimited (no DANTEFORGE_BUDGET_USD set)'}`,
  ].join('\n'),

  'codex': (ctx) => [
    `# Codex CLI Session Brief — ${ctx.project}`,
    '',
    `Date: ${ctx.date}`,
    `Stage: ${ctx.stage}`,
    '',
    '## Operating Mode',
    '',
    'You are working inside Codex CLI with DanteForge as your workflow harness.',
    'Codex CLI strengths: precise file edits, focused changes, deterministic output.',
    '',
    '## DanteForge Commands Available via Slash',
    '',
    '- /spark — zero-token planning',
    '- /forge — execute tasks',
    '- /verify — gate check',
    '- /df-verify — full verify chain',
    '',
    '## Recommended First Action',
    '',
    `\`danteforge ${ctx.nextCommand}\``,
    '',
    '## Constraints',
    '',
    '- Stay under 500 LOC per file (hard cap 750).',
    '- Run `npm run verify` before claiming completion.',
    '- Capture lessons via `danteforge lessons "<correction>"`.',
  ].join('\n'),

  'dantecode': (ctx) => [
    `# DanteCode VS Code Session Brief — ${ctx.project}`,
    '',
    `Date: ${ctx.date}`,
    `Stage: ${ctx.stage}`,
    '',
    '## DanteCode + DanteForge',
    '',
    'You are running inside the DanteCode VS Code extension with DanteForge as the workflow harness.',
    'The native extension shells out to the DanteForge CLI for most operations.',
    '',
    '## Suggested Workflow',
    '',
    `1. \`danteforge ${ctx.nextCommand}\` — start here`,
    '2. Use the VS Code panel for diff review',
    '3. `danteforge measure --json` for live score feedback',
    '',
    '## Constraints',
    '',
    '- Use `[filename.ts:42](src/filename.ts#L42)` markdown link format for code refs.',
    '- DO NOT use backticks for file references — use markdown links.',
  ].join('\n'),
};

interface BriefContext {
  project: string;
  date: string;
  stage: string;
  nextCommand: string;
  tokenBudget?: string;
}

export async function generateBrief(
  assistant: Assistant,
  options: HarnessBriefOptions = {},
): Promise<{ assistant: Assistant; brief: string; outputPath?: string }> {
  const cwd = options.cwd ?? process.cwd();
  const readFn = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const existsFn = options._exists ?? defaultExists;

  const ctx = await collectBriefContext(cwd, readFn, existsFn);
  const brief = BRIEF_TEMPLATES[assistant](ctx);

  if (options.output) {
    const writeFn = options._writeFile ?? ((p: string, d: string) => fs.writeFile(p, d, 'utf8'));
    const outPath = path.isAbsolute(options.output) ? options.output : path.join(cwd, options.output);
    await writeFn(outPath, brief);
    return { assistant, brief, outputPath: outPath };
  }

  return { assistant, brief };
}

async function collectBriefContext(
  cwd: string,
  readFn: (p: string) => Promise<string>,
  existsFn: (p: string) => Promise<boolean>,
): Promise<BriefContext> {
  const date = new Date().toISOString().slice(0, 10);
  let project = path.basename(cwd);
  let stage = 'initialized';
  let nextCommand = 'go';

  const statePath = path.join(cwd, '.danteforge', 'STATE.yaml');
  if (await existsFn(statePath)) {
    try {
      const raw = await readFn(statePath);
      const projectMatch = raw.match(/^project:\s*(\S+)/m);
      if (projectMatch) project = projectMatch[1] ?? project;
      const stageMatch = raw.match(/^workflowStage:\s*(\S+)/m);
      if (stageMatch) stage = stageMatch[1] ?? stage;
    } catch { /* best-effort */ }
  }

  if (stage === 'initialized') nextCommand = 'specify';
  else if (stage === 'specify' || stage === 'clarify') nextCommand = 'plan';
  else if (stage === 'plan') nextCommand = 'tasks';
  else if (stage === 'tasks') nextCommand = 'forge';
  else if (stage === 'forge') nextCommand = 'verify';
  else if (stage === 'verify') nextCommand = 'synthesize';
  else nextCommand = 'measure';

  const tokenBudget = process.env.DANTEFORGE_BUDGET_USD
    ? `$${process.env.DANTEFORGE_BUDGET_USD}`
    : undefined;

  return { project, date, stage, nextCommand, tokenBudget };
}

// ── MCP integration health ─────────────────────────────────────────────────

export interface McpHealthResult {
  serverReachable: boolean;
  toolCount: number;
  perAssistant: Array<{ assistant: Assistant; mcpConfigured: boolean; configPath?: string }>;
}

const MCP_CONFIG_PROBES: Record<Assistant, (homeDir: string, cwd: string) => string[]> = {
  'claude-code': (h, c) => [
    path.join(c, '.claude', 'mcp.json'),
    path.join(h, '.claude', 'mcp.json'),
    path.join(c, '.mcp.json'),
  ],
  'codex': (h, c) => [
    path.join(c, '.codex', 'mcp.json'),
    path.join(h, '.codex', 'mcp.json'),
    path.join(h, '.codex', 'config.toml'),
  ],
  'dantecode': (h, c) => [
    path.join(c, '.dantecode', 'mcp.json'),
    path.join(h, '.dantecode', 'mcp.json'),
  ],
};

export async function mcpHealth(options: HarnessOptions = {}): Promise<McpHealthResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const existsFn = options._exists ?? defaultExists;

  const serverPath = path.join(cwd, 'src', 'core', 'mcp-server.ts');
  const toolDefsPath = path.join(cwd, 'src', 'core', 'mcp-tool-definitions.ts');
  const serverReachable = await existsFn(serverPath)
    || await existsFn(path.join(cwd, 'dist', 'index.js'));

  let toolCount = 0;
  const readFile = options._readFile;
  const probePaths = [toolDefsPath, serverPath];
  for (const probe of probePaths) {
    if (!(await existsFn(probe))) continue;
    try {
      const source = readFile
        ? await readFile(probe)
        : await fs.readFile(probe, 'utf8');
      // Match either `server.tool(...)` registrations OR `name: '...'` entries in TOOL_DEFINITIONS.
      const calls = source.match(/server\.tool\s*\(/g);
      const named = source.match(/name:\s*'[a-z][a-z0-9_]*'/g);
      toolCount = Math.max(calls?.length ?? 0, named?.length ?? 0);
      if (toolCount > 0) break;
    } catch { /* best-effort */ }
  }

  const assistants: Assistant[] = ['claude-code', 'codex', 'dantecode'];
  const perAssistant = await Promise.all(assistants.map(async (assistant) => {
    const probes = MCP_CONFIG_PROBES[assistant](homeDir, cwd);
    for (const probe of probes) {
      if (await existsFn(probe)) {
        return { assistant, mcpConfigured: true, configPath: probe };
      }
    }
    return { assistant, mcpConfigured: false };
  }));

  return { serverReachable, toolCount, perAssistant };
}

function emitMcpReport(result: McpHealthResult, emit: (l: string) => void): void {
  emit(chalk.bold('\nDanteForge MCP Health'));
  emit(chalk.dim('─'.repeat(50)));
  emit('');
  emit(`  ${chalk.bold('Server:')} ${result.serverReachable ? chalk.green('reachable') : chalk.red('unreachable')}`);
  emit(`  ${chalk.bold('Tools exposed:')} ${result.toolCount > 0 ? chalk.green(result.toolCount) : chalk.yellow('0')}`);
  emit('');
  emit(chalk.bold('  Per-assistant configuration:'));
  for (const a of result.perAssistant) {
    const icon = a.mcpConfigured ? chalk.green('●') : chalk.dim('○');
    const status = a.mcpConfigured ? chalk.green('configured') : chalk.dim('not configured');
    emit(`    ${icon} ${a.assistant.padEnd(14)} ${status}`);
    if (a.configPath) emit(`        ${chalk.dim(a.configPath)}`);
  }
  emit('');
  const configured = result.perAssistant.filter(a => a.mcpConfigured).length;
  if (configured === 0) {
    emit(chalk.yellow('  No assistants have MCP configured.'));
    emit(chalk.dim('  Run: danteforge update-mcp --apply'));
  }
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export async function runHarness(
  subcommand: string | undefined,
  opts: {
    for?: Assistant;
    output?: string;
    cwd?: string;
  } = {},
): Promise<void> {
  switch (subcommand) {
    case 'status':
    case undefined:
      await harnessStatus({ cwd: opts.cwd });
      return;
    case 'brief': {
      const assistant: Assistant = opts.for ?? 'claude-code';
      const result = await generateBrief(assistant, {
        cwd: opts.cwd,
        output: opts.output,
        for: assistant,
      });
      if (result.outputPath) {
        logger.success(`Brief written to ${result.outputPath}`);
      } else {
        process.stdout.write(result.brief + '\n');
      }
      return;
    }
    case 'mcp': {
      const result = await mcpHealth({ cwd: opts.cwd });
      emitMcpReport(result, (l) => logger.info(l));
      return;
    }
    default:
      logger.error(`Unknown harness subcommand: ${subcommand}`);
      logger.info('Valid subcommands: status, brief, mcp');
      process.exitCode = 1;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function defaultExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
