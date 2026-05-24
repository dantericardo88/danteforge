// changelog.ts — auto-generate CHANGELOG entries from git conventional commits
// Parses git log, groups by commit type, writes formatted entry.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import chalk from 'chalk';
import { logger } from '../../core/logger.js';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GitCommit {
  hash: string;
  subject: string;
  author: string;
  date: string;
}

export interface ChangelogOptions {
  from?: string;
  to?: string;
  version?: string;
  append?: boolean;
  dry?: boolean;
  cwd?: string;
  // Injection seams
  _gitLog?: (from: string | undefined, to: string, cwd: string) => Promise<GitCommit[]>;
  _lastTag?: (cwd: string) => Promise<string | undefined>;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, data: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  _stdout?: (line: string) => void;
}

export interface ChangelogResult {
  version: string;
  sections: Record<string, string[]>;
  entry: string;
  commitCount: number;
}

// ── Commit type → section mapping ────────────────────────────────────────────

const TYPE_TO_SECTION: Record<string, string> = {
  feat: 'Features', feature: 'Features', add: 'Features',
  fix: 'Bug Fixes', bugfix: 'Bug Fixes', hotfix: 'Bug Fixes',
  perf: 'Performance',
  refactor: 'Improvements', improve: 'Improvements',
  docs: 'Documentation',
  test: 'Testing', tests: 'Testing',
  chore: 'Maintenance', ci: 'CI/CD', build: 'Build',
  style: 'Code Style', revert: 'Reverts',
};

const SECTION_ORDER = [
  'Features', 'Bug Fixes', 'Performance', 'Improvements',
  'Documentation', 'Testing', 'CI/CD', 'Build', 'Maintenance',
  'Code Style', 'Reverts', 'Other',
];

// ── Git helpers ───────────────────────────────────────────────────────────────

async function defaultLastTag(cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['describe', '--tags', '--abbrev=0'], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function defaultGitLog(
  from: string | undefined,
  to: string,
  cwd: string,
): Promise<GitCommit[]> {
  const range = from ? `${from}..${to}` : to;
  const format = '%H%n%s%n%an%n%as%n---COMMIT---';
  try {
    const { stdout } = await execFileAsync(
      'git', ['log', range, `--format=${format}`],
      { cwd, maxBuffer: 2 * 1024 * 1024 },
    );
    return parseGitLog(stdout);
  } catch {
    return [];
  }
}

function parseGitLog(raw: string): GitCommit[] {
  return raw
    .split('---COMMIT---')
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const [hash = '', subject = '', author = '', date = ''] = block.split('\n');
      return { hash, subject, author, date };
    });
}

// ── Conventional commit parser ────────────────────────────────────────────────

function parseCommitType(subject: string): { type: string; scope?: string; body: string } {
  const match = subject.match(/^(\w+)(?:\(([^)]+)\))?!?\s*:\s*(.*)/);
  if (!match) return { type: 'other', body: subject };
  return { type: match[1]?.toLowerCase() ?? 'other', scope: match[2], body: match[3] ?? subject };
}

function classifyCommit(subject: string): { section: string; entry: string } {
  const { type, scope, body } = parseCommitType(subject);
  const section = TYPE_TO_SECTION[type] ?? 'Other';
  const scopeTag = scope ? chalk.dim(`(${scope})`) : '';
  const entry = scopeTag ? `${body} ${scopeTag}` : body;
  return { section, entry };
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function formatChangelogEntry(
  version: string,
  sections: Record<string, string[]>,
  date: string,
): string {
  const lines: string[] = [`## [${version}] — ${date}`, ''];
  for (const sectionName of SECTION_ORDER) {
    const entries = sections[sectionName];
    if (!entries || entries.length === 0) continue;
    lines.push(`### ${sectionName}`, '');
    for (const e of entries) lines.push(`- ${e}`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function generateChangelog(options: ChangelogOptions = {}): Promise<ChangelogResult> {
  const cwd = options.cwd ?? process.cwd();
  const emit = options._stdout ?? ((l: string) => logger.info(l));
  const gitLog = options._gitLog ?? defaultGitLog;
  const lastTagFn = options._lastTag ?? defaultLastTag;
  const readFn = options._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFn = options._writeFile ?? ((p: string, d: string) => fs.writeFile(p, d, 'utf8'));
  const existsFn = options._exists ?? ((p: string) => fs.access(p).then(() => true).catch(() => false));

  const to = options.to ?? 'HEAD';
  const from = options.from ?? (await lastTagFn(cwd));
  const date = new Date().toISOString().slice(0, 10);
  const version = options.version ?? `${date}-next`;

  const commits = await gitLog(from, to, cwd);

  const sections: Record<string, string[]> = {};
  for (const commit of commits) {
    if (!commit.subject) continue;
    const { section, entry } = classifyCommit(commit.subject);
    if (!sections[section]) sections[section] = [];
    // Strip ANSI for storage (chalk adds it for display only)
    sections[section].push(entry.replace(/\x1b\[[0-9;]*m/g, ''));
  }

  const entry = formatChangelogEntry(version, sections, date);

  const shouldWrite = !options.dry || options.append;

  if (!shouldWrite) {
    emit(chalk.bold(`\nChangelog entry for ${chalk.cyan(version)} (${commits.length} commits):`));
    emit(chalk.dim('─'.repeat(60)));
    emit(entry);
  } else {
    const outPath = path.join(cwd, 'CHANGELOG.md');
    const exists = await existsFn(outPath);
    let content = entry + '\n';
    if (exists) {
      const existing = await readFn(outPath);
      const firstHeading = existing.indexOf('\n## ');
      if (firstHeading !== -1) {
        content = existing.slice(0, firstHeading + 1) + entry + '\n' + existing.slice(firstHeading + 1);
      } else {
        content = existing + '\n' + entry;
      }
    }
    await writeFn(outPath, content);
    emit(chalk.green(`  ✓ CHANGELOG.md updated with ${commits.length} commits`));
  }

  return { version, sections, entry, commitCount: commits.length };
}

// ── CLI entry point ────────────────────────────────────────────────────────────

export async function runChangelog(opts: {
  from?: string;
  to?: string;
  version?: string;
  append?: boolean;
  dry?: boolean;
  cwd?: string;
}): Promise<void> {
  const result = await generateChangelog({
    ...opts,
    dry: opts.dry !== false,
  });
  if (!opts.dry) {
    logger.info(`Generated ${result.commitCount} commit entries for version ${result.version}`);
  }
  if (result.commitCount === 0) {
    logger.warn('No commits found in the specified range. Check --from/--to refs.');
  }
}
