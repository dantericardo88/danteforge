// mcp-tools.ts — List MCP tools exposed by the DanteForge server.
// Used by Claude Code, Codex, and DanteCode users to discover available capabilities.

import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { TOOL_DEFINITIONS, type ToolDefinition } from '../../core/mcp-tool-definitions.js';

// ── Categorization ────────────────────────────────────────────────────────────

const CATEGORY_PREFIXES: Array<[string, string]> = [
  ['danteforge_state', 'State'],
  ['danteforge_score', 'Scoring'],
  ['danteforge_gate', 'Gates'],
  ['danteforge_task', 'Tasks'],
  ['danteforge_health', 'Health'],
  ['danteforge_audit', 'Audit'],
  ['danteforge_constitution', 'Workflow'],
  ['danteforge_specify', 'Workflow'],
  ['danteforge_plan', 'Workflow'],
  ['danteforge_tasks', 'Workflow'],
  ['danteforge_forge', 'Workflow'],
  ['danteforge_verify', 'Workflow'],
  ['danteforge_synthesize', 'Workflow'],
  ['danteforge_assess', 'Assessment'],
  ['danteforge_maturity', 'Assessment'],
  ['danteforge_complexity', 'Assessment'],
  ['danteforge_quality', 'Assessment'],
  ['danteforge_security', 'Security'],
  ['danteforge_adversarial', 'Scoring'],
  ['danteforge_lessons', 'Learning'],
  ['danteforge_retro', 'Learning'],
  ['danteforge_memory', 'Learning'],
  ['danteforge_pattern', 'Patterns'],
  ['danteforge_harvest', 'Patterns'],
  ['danteforge_competitors', 'Compete'],
  ['danteforge_compete', 'Compete'],
  ['danteforge_canonical', 'Compete'],
  ['danteforge_dossier', 'Dossier'],
  ['danteforge_landscape', 'Dossier'],
  ['danteforge_leapfrog', 'Dossier'],
  ['danteforge_route', 'Routing'],
  ['danteforge_budget', 'Routing'],
  ['danteforge_universe', 'Universe'],
  ['danteforge_artifact', 'Artifacts'],
  ['danteforge_handoff', 'Workflow'],
  ['danteforge_cofl', 'Learning'],
];

function categorize(toolName: string): string {
  for (const [prefix, category] of CATEGORY_PREFIXES) {
    if (toolName.startsWith(prefix)) return category;
  }
  return 'Other';
}

// ── Filtering ─────────────────────────────────────────────────────────────────

export function filterTools(
  tools: ToolDefinition[],
  filter?: { category?: string; query?: string },
): ToolDefinition[] {
  return tools.filter(t => {
    if (filter?.category) {
      const cat = categorize(t.name).toLowerCase();
      if (cat !== filter.category.toLowerCase()) return false;
    }
    if (filter?.query) {
      const q = filter.query.toLowerCase();
      const hay = `${t.name} ${t.description}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

// ── Formatters ────────────────────────────────────────────────────────────────

export function formatToolList(tools: ToolDefinition[]): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`\nDanteForge MCP Tools (${tools.length})`));
  lines.push(chalk.dim('─'.repeat(60)));
  lines.push('');

  const byCategory = new Map<string, ToolDefinition[]>();
  for (const t of tools) {
    const cat = categorize(t.name);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(t);
  }

  const sortedCategories = Array.from(byCategory.keys()).sort();
  for (const category of sortedCategories) {
    const items = byCategory.get(category)!;
    lines.push(chalk.bold(`  ${category}:`));
    for (const tool of items) {
      lines.push(`    ${chalk.cyan(tool.name)}`);
      lines.push(`      ${chalk.dim(tool.description.slice(0, 80))}`);
    }
    lines.push('');
  }

  lines.push(chalk.dim('  Connect via Claude Code/Codex/DanteCode MCP config.'));
  lines.push(chalk.dim('  Run "danteforge mcp-tools <name>" for detailed schema.'));
  return lines.join('\n');
}

export function formatToolDetail(tool: ToolDefinition): string {
  const lines: string[] = [];
  lines.push(chalk.bold(`\n${tool.name}`) + chalk.dim(` (${categorize(tool.name)})`));
  lines.push(chalk.dim('─'.repeat(60)));
  lines.push('');
  lines.push(`  ${chalk.bold('Description:')}`);
  lines.push(`    ${tool.description}`);
  lines.push('');
  lines.push(`  ${chalk.bold('Input schema:')}`);
  const schemaLines = JSON.stringify(tool.inputSchema, null, 2).split('\n');
  for (const sl of schemaLines) lines.push(`    ${sl}`);
  lines.push('');
  return lines.join('\n');
}

// ── CLI entry ─────────────────────────────────────────────────────────────────

export async function runMcpTools(
  name: string | undefined,
  opts: { json?: boolean; category?: string; query?: string } = {},
): Promise<void> {
  if (name) {
    const tool = TOOL_DEFINITIONS.find(t => t.name === name);
    if (!tool) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ error: 'unknown_tool', name }, null, 2) + '\n');
      } else {
        logger.error(`Unknown MCP tool: ${name}`);
        logger.info(`Run "danteforge mcp-tools" to see all available tools.`);
      }
      process.exitCode = 1;
      return;
    }
    if (opts.json) {
      process.stdout.write(JSON.stringify(tool, null, 2) + '\n');
    } else {
      logger.info(formatToolDetail(tool));
    }
    return;
  }

  const filtered = filterTools(TOOL_DEFINITIONS, { category: opts.category, query: opts.query });
  if (opts.json) {
    process.stdout.write(JSON.stringify(filtered, null, 2) + '\n');
  } else {
    logger.info(formatToolList(filtered));
  }
}
