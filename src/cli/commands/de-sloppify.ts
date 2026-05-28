// CLI — de-sloppify command
//
// Post-forge cleanup using a fresh-context agent (author-bias elimination).
// Removes: type-system-only tests, debug artifacts, over-defensive null checks, dead imports.
//
// Usage: danteforge de-sloppify [options]
import path from 'node:path';
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';
import { ClaudeCodeAdapter } from '../../matrix/adapters/claude-code-adapter.js';
import { runAdapter } from '../../matrix/adapters/adapter-interface.js';
import type { WorkPacket } from '../../matrix/types/work-graph.js';
import type { AgentLease } from '../../matrix/types/lease.js';

export interface DeSloppifyOptions {
  cwd?: string;
  files?: string;
  dryRun?: boolean;
  json?: boolean;
}

export interface DeSloppifyResult {
  filesScanned: string[];
  removalsFound: string[];
  applied: boolean;
}

function makeWriteLease(projectPath: string): AgentLease {
  return {
    agentId: 'de-sloppify',
    workspaceRoot: projectPath,
    branchName: 'main',
    worktreePath: projectPath,
    forbiddenPaths: ['**/*.json', '.danteforge/**', 'dist/**', 'node_modules/**'],
    allowedWritePaths: ['src/**', 'tests/**'],
    readOnlyPaths: [],
    expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
  } as unknown as AgentLease;
}

function getTargetFiles(cwd: string, pattern?: string): string[] {
  if (pattern) {
    // Pattern is comma-separated globs — use git ls-files to enumerate
    const pats = pattern.split(',').map(p => p.trim());
    const files: string[] = [];
    for (const pat of pats) {
      try {
        const out = execSync(`git ls-files -- "${pat}"`, { cwd, encoding: 'utf8' });
        files.push(...out.split('\n').filter(f => f.endsWith('.ts')));
      } catch { /* ignore */ }
    }
    return [...new Set(files)];
  }
  // Default: all TypeScript files tracked by git
  try {
    const out = execSync('git ls-files -- "src/**/*.ts" "tests/**/*.ts"', { cwd, encoding: 'utf8' });
    return out.split('\n').filter(f => f.endsWith('.ts'));
  } catch {
    return [];
  }
}

function buildDeSloppifyPrompt(files: string[], dryRun: boolean): string {
  return [
    'You are a fresh-context cleanup agent. Review the following TypeScript files and remove slop.',
    '',
    'Slop patterns to remove:',
    '  1. Type-system-only tests — tests that only assert TypeScript compilation, never call real functions',
    '     (e.g., `const _: MyType = { ... }` with no actual assertions)',
    '  2. Debug artifacts — console.log and open-work marker comments in src/ files',
    '  3. Over-defensive null checks on values guaranteed by the framework or type system',
    '     (e.g., `if (arr === undefined) return` when arr is typed as string[])',
    '  4. Dead imports — imports that are never used in the file',
    '',
    dryRun
      ? 'MODE: DRY RUN — report what you WOULD remove, do not edit files.'
      : 'MODE: EDIT — remove the slop patterns. Edit the files directly.',
    '',
    'Files to review:',
    ...files.map(f => `  - ${f}`),
    '',
    'For each file, report:',
    '  SLOP_FOUND: <file>:<line> — <description>',
    '  or CLEAN: <file>',
    '',
    'After reporting, if not dry-run, apply the removals.',
  ].join('\n');
}

export async function runDeSloppifyCommand(opts: DeSloppifyOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const files = getTargetFiles(cwd, opts.files);

  if (files.length === 0) {
    logger.info('[de-sloppify] No TypeScript files found to scan.');
    return;
  }

  logger.info(chalk.bold(`\n[de-sloppify] Scanning ${files.length} file(s)${opts.dryRun ? ' (dry run)' : ''}...`));

  const prompt = buildDeSloppifyPrompt(files, opts.dryRun ?? false);

  const workPacket: WorkPacket = {
    id: `de-sloppify.${Date.now()}`,
    dimensionId: 'de-sloppify',
    objective: prompt,
    acceptanceCriteria: ['SLOP_FOUND or CLEAN reported for each file'],
    proof: { proofRequired: [] },
    globalForbidden: ['dist/**', 'node_modules/**', '.danteforge/**'],
    context: { mode: opts.dryRun ? 'review-only' : 'cleanup' },
  } as unknown as WorkPacket;

  const lease = makeWriteLease(cwd);
  const adapter = new ClaudeCodeAdapter({ workPacket, skipPermissions: true });

  const available = await adapter.isAvailable();
  if (!available) {
    logger.warn('[de-sloppify] Claude Code not available. Install the claude CLI to use this command.');
    return;
  }

  const result = await runAdapter(adapter, { lease });
  const output = result.finalMessage ?? (result as unknown as { output?: string }).output ?? '';

  const slopLines = output.split('\n').filter(l => l.startsWith('SLOP_FOUND:'));
  const cleanFiles = output.split('\n').filter(l => l.startsWith('CLEAN:')).length;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ filesScanned: files, removalsFound: slopLines, applied: !opts.dryRun }, null, 2) + '\n');
    return;
  }

  logger.info(chalk.bold('\n[de-sloppify] Summary:'));
  logger.info(`  Files scanned: ${files.length}`);
  logger.info(`  Clean files:   ${cleanFiles}`);
  if (slopLines.length > 0) {
    logger.info(chalk.yellow(`  Slop found:    ${slopLines.length} item(s)`));
    slopLines.forEach(l => logger.info(chalk.yellow(`    ${l}`)));
    if (!opts.dryRun) {
      logger.info(chalk.green('  Applied: removals completed.'));
    } else {
      logger.info(chalk.dim('  (dry run — no files modified)'));
    }
  } else {
    logger.info(chalk.green('  No slop found — files are clean.'));
  }

  if (path.isAbsolute(cwd)) {
    logger.info(chalk.dim(`  Project: ${cwd}`));
  }
}
