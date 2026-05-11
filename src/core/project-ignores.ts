import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const MANAGED_START = '# DanteForge agent hygiene start';
const MANAGED_END = '# DanteForge agent hygiene end';

const AGENT_IGNORE_ENTRIES = [
  '.danteforge/oss-repos/',
  '.danteforge/oss-deep/',
  '.danteforge-worktrees/',
  '.claude/worktrees/',
  '.dantecode/',
  '.tmp-*/',
  'node_modules/',
  'dist/',
  'coverage/',
  '*.log',
  'test_output.*',
  'test-output.*',
  'test-run*.log',
];

const DANTECODE_EXCLUDE_PATTERNS = [
  'node_modules/',
  'dist/',
  'coverage/',
  '.danteforge/oss-repos/',
  '.danteforge/oss-deep/',
  '.danteforge-worktrees/',
  '.claude/worktrees/',
  '.dantecode/worktrees/',
  '.tmp-*/',
];

const STATIC_CLEANUP_PATHS = [
  '.danteforge/oss-repos',
  '.danteforge/oss-deep',
  '.dantecode/index.json',
  '.dantecode/index',
];

const ROOT_LOG_PATTERNS = [
  /^.*\.log$/i,
  /^test[_-]output\..+$/i,
  /^test-output\.txt$/i,
  /^test-run\d+\.log$/i,
  /^test_output\.tap$/i,
];

export type HygieneStatus = 'ok' | 'warn' | 'fixed' | 'removed' | 'would-remove' | 'skipped' | 'missing';

export interface IgnoreFileReport {
  file: string;
  missingEntries: string[];
  status: 'ok' | 'fixed' | 'missing';
}

export interface CleanupCandidate {
  relativePath: string;
  absolutePath: string;
  kind: 'file' | 'directory' | 'worktree';
}

export interface CleanupAction extends CleanupCandidate {
  status: 'removed' | 'would-remove' | 'skipped';
  reason?: string;
}

export interface ProjectHygieneReport {
  cwd: string;
  ignoreFiles: IgnoreFileReport[];
  cleanupCandidates: CleanupCandidate[];
}

export interface EnsureProjectIgnoresOptions {
  configureGit?: boolean;
  _git?: GitRunner;
}

export interface CleanGeneratedAgentStateOptions {
  dryRun?: boolean;
  force?: boolean;
  _git?: GitRunner;
}

export interface CleanupResult {
  cwd: string;
  dryRun: boolean;
  actions: CleanupAction[];
}

type GitRunner = (args: string[], cwd?: string) => Promise<string>;

async function defaultGit(args: string[], cwd?: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd });
  return stdout;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/');
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function hasEntry(content: string, entry: string): boolean {
  const wanted = trimTrailingSlash(entry.trim());
  return content
    .split(/\r?\n/)
    .map(line => trimTrailingSlash(line.trim()))
    .some(line => line === wanted);
}

function removeManagedBlock(content: string): { contentWithoutBlock: string; hadBlock: boolean } {
  const escapedStart = MANAGED_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = MANAGED_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\n?${escapedStart}[\\s\\S]*?${escapedEnd}\\n?`, 'm');
  return {
    contentWithoutBlock: content.replace(pattern, '\n').replace(/\n{3,}/g, '\n\n').trimEnd(),
    hadBlock: pattern.test(content),
  };
}

async function ensureManagedIgnoreFile(cwd: string, fileName: string, entries: string[]): Promise<IgnoreFileReport> {
  const filePath = path.join(cwd, fileName);
  let existing = '';
  let existed = true;
  try {
    existing = await fs.readFile(filePath, 'utf8');
  } catch {
    existed = false;
  }

  const newline = existing.includes('\r\n') ? '\r\n' : '\n';
  const { contentWithoutBlock } = removeManagedBlock(existing);
  const missingEntries = entries.filter(entry => !hasEntry(contentWithoutBlock, entry));

  if (missingEntries.length === 0) {
    if (existing !== contentWithoutBlock) {
      await fs.writeFile(filePath, `${contentWithoutBlock}${newline}`, 'utf8');
      return { file: fileName, missingEntries: [], status: 'fixed' };
    }
    return { file: fileName, missingEntries: [], status: existed ? 'ok' : 'missing' };
  }

  const block = [
    MANAGED_START,
    ...missingEntries,
    MANAGED_END,
  ].join(newline);
  const prefix = contentWithoutBlock.trim().length > 0 ? `${contentWithoutBlock}${newline}${newline}` : '';
  await fs.writeFile(filePath, `${prefix}${block}${newline}`, 'utf8');
  return { file: fileName, missingEntries, status: 'fixed' };
}

async function ensureDanteCodeExcludes(cwd: string): Promise<void> {
  const statePath = path.join(cwd, '.dantecode', 'STATE.yaml');
  let raw: string;
  try {
    raw = await fs.readFile(statePath, 'utf8');
  } catch {
    return;
  }

  const lines = raw.split(/\r?\n/);
  const newline = raw.includes('\r\n') ? '\r\n' : '\n';
  const excludeIndex = lines.findIndex(line => /^\s*excludePatterns:\s*$/.test(line));
  const existing = new Set<string>();

  if (excludeIndex >= 0) {
    const baseIndent = lines[excludeIndex]!.match(/^\s*/)?.[0].length ?? 0;
    let insertAt = excludeIndex + 1;
    while (insertAt < lines.length) {
      const line = lines[insertAt]!;
      if (line.trim() === '') {
        insertAt++;
        continue;
      }
      const indent = line.match(/^\s*/)?.[0].length ?? 0;
      if (indent <= baseIndent) break;
      const match = line.match(/^\s*-\s*(.+?)\s*$/);
      if (match) existing.add(match[1]!);
      insertAt++;
    }

    const missing = DANTECODE_EXCLUDE_PATTERNS.filter(entry => !existing.has(entry));
    if (missing.length === 0) return;
    lines.splice(insertAt, 0, ...missing.map(entry => `${' '.repeat(baseIndent + 2)}- ${entry}`));
    await fs.writeFile(statePath, lines.join(newline), 'utf8');
    return;
  }

  const block = [
    '',
    'project:',
    '  excludePatterns:',
    ...DANTECODE_EXCLUDE_PATTERNS.map(entry => `    - ${entry}`),
  ];
  await fs.writeFile(statePath, `${raw.trimEnd()}${block.join(newline)}${newline}`, 'utf8');
}

async function configureSafeGit(cwd: string, git: GitRunner): Promise<void> {
  try { await git(['config', '--local', 'diff.ignoreSubmodules', 'all'], cwd); } catch { /* best effort */ }
  try { await git(['config', '--local', 'submodule.recurse', 'false'], cwd); } catch { /* best effort */ }
}

export async function ensureProjectIgnores(
  cwd: string,
  options: EnsureProjectIgnoresOptions = {},
): Promise<ProjectHygieneReport> {
  const ignoreFiles = await Promise.all([
    ensureManagedIgnoreFile(cwd, '.gitignore', AGENT_IGNORE_ENTRIES),
    ensureManagedIgnoreFile(cwd, '.claudeignore', AGENT_IGNORE_ENTRIES),
    ensureManagedIgnoreFile(cwd, '.cursorignore', AGENT_IGNORE_ENTRIES),
  ]);
  await ensureDanteCodeExcludes(cwd);
  if (options.configureGit) {
    await configureSafeGit(cwd, options._git ?? defaultGit);
  }
  const inspected = await inspectProjectHygiene(cwd);
  return { ...inspected, ignoreFiles };
}

async function pathCandidate(cwd: string, relativePath: string): Promise<CleanupCandidate | null> {
  const absolutePath = path.join(cwd, relativePath);
  try {
    const stat = await fs.stat(absolutePath);
    return {
      relativePath: normalizePath(relativePath),
      absolutePath,
      kind: stat.isDirectory() ? 'directory' : 'file',
    };
  } catch {
    return null;
  }
}

async function collectCleanupCandidates(cwd: string): Promise<CleanupCandidate[]> {
  const candidates: CleanupCandidate[] = [];
  for (const relativePath of STATIC_CLEANUP_PATHS) {
    const candidate = await pathCandidate(cwd, relativePath);
    if (candidate) candidates.push(candidate);
  }

  try {
    const dantecodeEntries = await fs.readdir(path.join(cwd, '.dantecode'), { withFileTypes: true });
    for (const entry of dantecodeEntries) {
      if (!entry.name.startsWith('index')) continue;
      const relativePath = `.dantecode/${entry.name}`;
      if (!candidates.some(candidate => candidate.relativePath === relativePath)) {
        const candidate = await pathCandidate(cwd, relativePath);
        if (candidate) candidates.push(candidate);
      }
    }
  } catch { /* no DanteCode dir */ }

  try {
    const rootEntries = await fs.readdir(cwd, { withFileTypes: true });
    for (const entry of rootEntries) {
      if (entry.isDirectory() && entry.name.startsWith('.tmp-')) {
        const candidate = await pathCandidate(cwd, entry.name);
        if (candidate) candidates.push(candidate);
      }
      if (entry.isFile() && ROOT_LOG_PATTERNS.some(pattern => pattern.test(entry.name))) {
        const candidate = await pathCandidate(cwd, entry.name);
        if (candidate) candidates.push(candidate);
      }
    }
  } catch { /* no root listing */ }

  return candidates;
}

export async function inspectProjectHygiene(cwd: string): Promise<ProjectHygieneReport> {
  const ignoreFiles: IgnoreFileReport[] = [];
  for (const file of ['.gitignore', '.claudeignore', '.cursorignore']) {
    let content = '';
    try { content = await fs.readFile(path.join(cwd, file), 'utf8'); } catch { /* missing */ }
    const missingEntries = AGENT_IGNORE_ENTRIES.filter(entry => !hasEntry(content, entry));
    ignoreFiles.push({
      file,
      missingEntries,
      status: missingEntries.length === 0 ? 'ok' : 'missing',
    });
  }

  return {
    cwd,
    ignoreFiles,
    cleanupCandidates: await collectCleanupCandidates(cwd),
  };
}

function assertInsideCwd(cwd: string, absolutePath: string): void {
  const root = path.resolve(cwd);
  const target = path.resolve(absolutePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error(`Refusing to clean path outside workspace: ${target}`);
  }
}

function toRelativePath(cwd: string, absolutePath: string): string {
  return normalizePath(path.relative(cwd, absolutePath));
}

async function removeCandidate(
  cwd: string,
  candidate: CleanupCandidate,
  options: CleanGeneratedAgentStateOptions,
): Promise<CleanupAction> {
  const dryRun = options.dryRun ?? true;
  assertInsideCwd(cwd, candidate.absolutePath);

  if (!options.force) {
    const git = options._git ?? defaultGit;
    try {
      await git(['ls-files', '--error-unmatch', '--', candidate.relativePath], cwd);
      return { ...candidate, status: 'skipped', reason: 'tracked by git' };
    } catch { /* untracked or not a git repo — ok to clean */ }
  }

  if (dryRun) return { ...candidate, status: 'would-remove' };

  await fs.rm(candidate.absolutePath, { recursive: true, force: true });
  return { ...candidate, status: 'removed' };
}

interface ParsedWorktree {
  path: string;
  branch?: string;
}

function parseWorktrees(raw: string): ParsedWorktree[] {
  const worktrees: ParsedWorktree[] = [];
  let current: ParsedWorktree | null = null;
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('worktree ')) {
      if (current) worktrees.push(current);
      current = { path: line.slice('worktree '.length).trim() };
      continue;
    }
    if (current && line.startsWith('branch ')) {
      current.branch = line.slice('branch '.length).trim();
    }
  }
  if (current) worktrees.push(current);
  return worktrees;
}

function isGeneratedWorktree(cwd: string, worktreePath: string): boolean {
  const normalized = normalizePath(path.resolve(worktreePath));
  const root = normalizePath(path.resolve(cwd));
  return [
    `${root}/.claude/worktrees/`,
    `${root}/.danteforge-worktrees/`,
    `${root}/.dantecode/worktrees/`,
  ].some(prefix => normalized.startsWith(prefix));
}

async function cleanRegisteredWorktrees(
  cwd: string,
  options: CleanGeneratedAgentStateOptions,
): Promise<CleanupAction[]> {
  const git = options._git ?? defaultGit;
  let raw = '';
  try {
    raw = await git(['worktree', 'list', '--porcelain'], cwd);
  } catch {
    return [];
  }

  const actions: CleanupAction[] = [];
  let removedAny = false;
  for (const worktree of parseWorktrees(raw)) {
    if (!isGeneratedWorktree(cwd, worktree.path)) continue;
    const candidate: CleanupCandidate = {
      absolutePath: worktree.path,
      relativePath: toRelativePath(cwd, worktree.path),
      kind: 'worktree',
    };
    if (options.dryRun) {
      actions.push({ ...candidate, status: 'would-remove' });
      continue;
    }
    if (!options.force) {
      let trackedStatus = '';
      try {
        trackedStatus = await git(['status', '--short', '--untracked-files=no'], worktree.path);
      } catch {
        trackedStatus = 'unknown';
      }
      if (trackedStatus.trim().length > 0) {
        actions.push({ ...candidate, status: 'skipped', reason: 'tracked changes present' });
        continue;
      }
    }
    try {
      await git(['worktree', 'remove', worktree.path, '--force'], cwd);
      removedAny = true;
      actions.push({ ...candidate, status: 'removed' });
    } catch (err) {
      actions.push({
        ...candidate,
        status: 'skipped',
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (removedAny) {
    try { await git(['worktree', 'prune'], cwd); } catch { /* best effort */ }
  }

  return actions;
}

export async function cleanGeneratedAgentState(
  cwd: string,
  options: CleanGeneratedAgentStateOptions = {},
): Promise<CleanupResult> {
  const dryRun = options.dryRun ?? true;
  const actions: CleanupAction[] = [];
  for (const candidate of await collectCleanupCandidates(cwd)) {
    actions.push(await removeCandidate(cwd, candidate, { ...options, dryRun }));
  }
  actions.push(...await cleanRegisteredWorktrees(cwd, { ...options, dryRun }));
  return { cwd, dryRun, actions };
}
