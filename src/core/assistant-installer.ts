import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_PIPELINE_TEXT } from './workflow-surface.js';
import {
  buildCursorBootstrapRule,
  buildCursorBootstrapRuleV2,
  buildWindsurfBootstrapRule,
  buildAiderConfig,
  buildAiderConventions,
  buildOpenHandsMicroagent,
  buildCopilotInstructions,
  buildGeminiMd,
  CONTINUE_RULES,
} from './assistant-bootstrap-rules.js';

export type AssistantRegistry =
  | 'claude'
  | 'codex'
  | 'antigravity'
  | 'opencode'
  | 'cursor'
  | 'windsurf'
  | 'aider'
  | 'openhands'
  | 'copilot'
  | 'continue'
  | 'gemini-cli';

export interface AssistantInstallResult {
  assistant: AssistantRegistry;
  targetDir: string;
  installedSkills: string[];
  installMode?: 'skills' | 'cursor-rules' | 'windsurf-rules' | 'aider-config' | 'openhands-microagent' | 'copilot-instructions' | 'continue-config' | 'gemini-cli';
}

export interface InstallAssistantSkillsOptions {
  assistants?: AssistantRegistry[];
  homeDir?: string;
  skillsDir?: string;
  projectDir?: string;
}

const CODEX_BOOTSTRAP_START = '<!-- DANTEFORGE CODEX BOOTSTRAP START -->';
const CODEX_BOOTSTRAP_END = '<!-- DANTEFORGE CODEX BOOTSTRAP END -->';

const CODEX_NATIVE_WORKFLOW_COMMANDS = [
  'spark',
  'ember',
  'canvas',
  'blaze',
  'nova',
  'inferno',
  'review',
  'constitution',
  'specify',
  'clarify',
  'tech-decide',
  'plan',
  'tasks',
  'design',
  'forge',
  'ux-refine',
  'party',
  'autoforge',
  'magic',
  'qa',
  'ship',
  'retro',
  'lessons',
  'debug',
  'browse',
  'oss',
  'local-harvest',
  'harvest',
  'awesome-scan',
  'synthesize',
] as const;

const CODEX_GLOBAL_COMMANDS: Array<[string, string]> = [
  ['setup-assistants', 'npx danteforge setup assistants --assistants codex'],
  ['doctor', 'npx danteforge doctor'],
  ['doctor-live', 'npx danteforge doctor --live'],
  ['df-verify', 'npx danteforge verify'],
  ['verify-release', 'npx danteforge verify --release'],
  ['feedback', 'npx danteforge feedback'],
];

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolvePackagedSkillsDir(): string {
  const candidates = [
    path.resolve(__dirname, '..', 'src', 'harvested', 'dante-agents', 'skills'),
    path.resolve(__dirname, '..', 'harvested', 'dante-agents', 'skills'),
  ];

  for (const candidate of candidates) {
    try {
      if (fsSync.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return candidates[0]!;
}

function resolvePackagedCommandsDir(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'commands'),
    path.resolve(__dirname, '..', 'commands'),
  ];

  for (const candidate of candidates) {
    try {
      if (fsSync.statSync(candidate).isDirectory()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return candidates[0]!;
}

function resolvePackagedCodexBootstrapPath(): string {
  const candidates = [
    path.resolve(__dirname, '..', '..', 'agents', 'codex-home-AGENTS.md'),
    path.resolve(__dirname, '..', 'agents', 'codex-home-AGENTS.md'),
  ];

  for (const candidate of candidates) {
    try {
      if (fsSync.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // Try the next candidate.
    }
  }

  return candidates[0]!;
}

function resolveConfigHome(homeDir: string): string {
  if (process.platform === 'win32') {
    return path.join(homeDir, '.config');
  }

  return process.env.XDG_CONFIG_HOME ?? path.join(homeDir, '.config');
}

function mergeCodexBootstrap(existingContent: string, bootstrapContent: string): string {
  const newline = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const normalized = existingContent.replace(/\r\n/g, '\n');
  const managedBlock = [
    CODEX_BOOTSTRAP_START,
    bootstrapContent.trim(),
    CODEX_BOOTSTRAP_END,
  ].join('\n');
  const escapedStart = CODEX_BOOTSTRAP_START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const escapedEnd = CODEX_BOOTSTRAP_END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`${escapedStart}[\\s\\S]*?${escapedEnd}`, 'm');

  if (pattern.test(normalized)) {
    return normalized.replace(pattern, managedBlock).replace(/\n{3,}/g, '\n\n').replace(/\n?$/, newline);
  }

  const trimmed = normalized.trimEnd();
  if (trimmed.length === 0) {
    return managedBlock + newline;
  }

  return `${trimmed}${newline}${newline}${managedBlock}${newline}`;
}

function resolveAssistantTargetDir(homeDir: string, assistant: AssistantRegistry, projectDir: string): string {
  switch (assistant) {
    case 'claude':
      return path.join(homeDir, '.claude', 'skills');
    case 'codex':
      return path.join(homeDir, '.codex', 'skills');
    case 'antigravity':
      return path.join(homeDir, '.gemini', 'antigravity', 'skills');
    case 'opencode':
      return path.join(resolveConfigHome(homeDir), 'opencode', 'skills');
    case 'cursor':
      return path.join(projectDir, '.cursor', 'rules');
    case 'windsurf':
      return path.join(projectDir, '.windsurf', 'rules');
    case 'aider':
      return projectDir;
    case 'openhands':
      return path.join(projectDir, '.openhands', 'microagents');
    case 'copilot':
      return path.join(projectDir, '.github');
    case 'continue':
      return path.join(homeDir, '.continue');
    case 'gemini-cli':
      return projectDir;
  }
}

async function syncContinueConfig(targetDir: string): Promise<void> {
  const configPath = path.join(targetDir, 'config.yaml');
  let existingContent = '';
  try {
    existingContent = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  // Parse existing rules array (simple line-based detection — avoids heavy YAML dep)
  const lines = existingContent.split('\n');
  const rulesHeaderIdx = lines.findIndex(l => l.trim() === 'rules:');

  if (rulesHeaderIdx === -1) {
    // No rules section — append one
    const trimmed = existingContent.trimEnd();
    const prefix = trimmed.length > 0 ? trimmed + '\n\n' : '';
    const rulesBlock = 'rules:\n' + CONTINUE_RULES.map(r => `  - "${r}"`).join('\n') + '\n';
    await fs.writeFile(configPath, prefix + rulesBlock, 'utf8');
    return;
  }

  // Rules section exists — collect existing rule strings, append missing ones
  const existingRules = new Set<string>();
  let i = rulesHeaderIdx + 1;
  while (i < lines.length && (lines[i]!.startsWith('  ') || lines[i]!.trim() === '')) {
    const m = lines[i]!.match(/^\s*-\s*"(.+)"$/);
    if (m) existingRules.add(m[1]!);
    i++;
  }

  const missing = CONTINUE_RULES.filter(r => !existingRules.has(r));
  if (missing.length === 0) {
    return; // Already idempotent
  }

  // Insert missing rules before the next non-rules line
  const insertAt = i;
  const newLines = [
    ...lines.slice(0, insertAt),
    ...missing.map(r => `  - "${r}"`),
    ...lines.slice(insertAt),
  ];
  await fs.writeFile(configPath, newLines.join('\n'), 'utf8');
}

const DEFAULT_GLOBAL_ASSISTANTS: AssistantRegistry[] = ['claude', 'codex', 'antigravity', 'opencode'];

function buildCodexCommandLine(command: string, target: string): string {
  return `${command} = "${target}"`;
}

function isTomlTableHeader(line: string): boolean {
  return /^\[[^\]]+\]\s*$/.test(line.trim());
}

function isCommandAssignment(line: string, command: string): boolean {
  return new RegExp(`^\\s*${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`).test(line);
}

function mergeCodexCommandsConfig(existingContent: string): string {
  const newline = existingContent.includes('\r\n') ? '\r\n' : '\n';
  const normalized = existingContent.replace(/\r\n/g, '\n');
  const lines = normalized.length > 0 ? normalized.split('\n') : [];
  const commandsHeaderIndex = lines.findIndex(line => line.trim() === '[commands]');
  const danteforgeLines = CODEX_GLOBAL_COMMANDS.map(([command, target]) => buildCodexCommandLine(command, target));

  if (commandsHeaderIndex === -1) {
    const nextLines = [...lines];
    while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
      nextLines.pop();
    }

    if (nextLines.length > 0) {
      nextLines.push('');
    }

    nextLines.push('[commands]', ...danteforgeLines, '');
    return nextLines.join(newline);
  }

  let commandsSectionEnd = commandsHeaderIndex + 1;
  while (commandsSectionEnd < lines.length && !isTomlTableHeader(lines[commandsSectionEnd]!)) {
    commandsSectionEnd += 1;
  }

  const commandsSection = lines.slice(commandsHeaderIndex + 1, commandsSectionEnd);
  const seen = new Set<string>();
  const nextSection: string[] = [];

  for (const line of commandsSection) {
    const existingCommand = CODEX_GLOBAL_COMMANDS.find(([command]) => isCommandAssignment(line, command));
    if (existingCommand) {
      const [command, target] = existingCommand;
      nextSection.push(buildCodexCommandLine(command, target));
      seen.add(command);
      continue;
    }

    if (CODEX_NATIVE_WORKFLOW_COMMANDS.some(command => isCommandAssignment(line, command))) {
      continue;
    }

    nextSection.push(line);
  }

  const missingLines = CODEX_GLOBAL_COMMANDS
    .filter(([command]) => !seen.has(command))
    .map(([command, target]) => buildCodexCommandLine(command, target));

  if (missingLines.length > 0) {
    if (nextSection.length > 0 && nextSection[nextSection.length - 1] !== '') {
      nextSection.push('');
    }
    nextSection.push(...missingLines);
  }

  const mergedLines = [
    ...lines.slice(0, commandsHeaderIndex + 1),
    ...nextSection,
    ...lines.slice(commandsSectionEnd),
  ];

  return mergedLines.join(newline);
}

async function syncCodexConfig(homeDir: string): Promise<void> {
  const codexDir = path.join(homeDir, '.codex');
  const configPath = path.join(codexDir, 'config.toml');

  await fs.mkdir(codexDir, { recursive: true });

  let existingContent = '';
  try {
    existingContent = await fs.readFile(configPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const mergedContent = mergeCodexCommandsConfig(existingContent);
  await fs.writeFile(configPath, mergedContent, 'utf8');
}

async function syncCodexCommands(homeDir: string): Promise<void> {
  const commandsDir = resolvePackagedCommandsDir();
  const targetDir = path.join(homeDir, '.codex', 'commands');
  let entries: string[];

  try {
    entries = await fs.readdir(commandsDir);
  } catch {
    return;
  }

  await fs.mkdir(targetDir, { recursive: true });

  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    await fs.copyFile(path.join(commandsDir, entry), path.join(targetDir, entry));
  }
}

/**
 * Read a command file, peel off the frontmatter header (if any), and return
 * { name, description, body }. Falls back to filename-derived name and an
 * empty description if no frontmatter is present.
 */
async function parseCommandFile(filePath: string): Promise<{ name: string; description: string; body: string }> {
  const raw = await fs.readFile(filePath, 'utf8');
  const fallbackName = path.basename(filePath, '.md');
  const match = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/.exec(raw);
  if (!match) {
    return { name: fallbackName, description: '', body: raw };
  }
  const header = match[1] ?? '';
  const body = match[2] ?? '';
  const nameMatch = /^name:\s*(.+)$/m.exec(header);
  const descMatch = /^description:\s*"?(.+?)"?\s*$/m.exec(header);
  return {
    name: nameMatch?.[1]?.trim() ?? fallbackName,
    description: descMatch?.[1]?.trim() ?? '',
    body,
  };
}

/**
 * Install every slash command in `commands/` into a tool's rule directory,
 * one file per command. Cursor uses `.mdc` with cursor-specific frontmatter;
 * Windsurf accepts plain markdown with a name/description header.
 */
async function syncToolCommands(targetDir: string, kind: 'cursor' | 'windsurf'): Promise<void> {
  const commandsDir = resolvePackagedCommandsDir();
  let entries: string[];
  try {
    entries = await fs.readdir(commandsDir);
  } catch {
    return;
  }
  await fs.mkdir(targetDir, { recursive: true });
  for (const entry of entries) {
    if (!entry.endsWith('.md')) continue;
    const parsed = await parseCommandFile(path.join(commandsDir, entry));
    const base = path.basename(entry, '.md');
    if (kind === 'cursor') {
      const outPath = path.join(targetDir, `danteforge-${base}.mdc`);
      const frontmatter = [
        '---',
        `description: ${JSON.stringify(parsed.description)}`,
        'globs:',
        'alwaysApply: false',
        '---',
        '',
      ].join('\n');
      await fs.writeFile(outPath, frontmatter + parsed.body, 'utf8');
    } else {
      const outPath = path.join(targetDir, `danteforge-${base}.md`);
      const frontmatter = [
        '---',
        `name: ${parsed.name}`,
        `description: ${JSON.stringify(parsed.description)}`,
        '---',
        '',
      ].join('\n');
      await fs.writeFile(outPath, frontmatter + parsed.body, 'utf8');
    }
  }
}

async function syncClaudePluginCache(homeDir: string, projectDir: string): Promise<void> {
  let pkgJson: { version?: string; files?: string[] };
  try {
    const raw = await fs.readFile(path.join(projectDir, 'package.json'), 'utf8');
    pkgJson = JSON.parse(raw) as { version?: string; files?: string[] };
  } catch {
    return; // No package.json — nothing to sync
  }

  const version = pkgJson.version;
  if (!version) return;

  const pluginsDir = path.join(homeDir, '.claude', 'plugins');
  const installedPluginsPath = path.join(pluginsDir, 'installed_plugins.json');

  let installedPlugins: {
    version?: number;
    plugins?: Record<string, Array<{ scope?: string; installPath?: string; version?: string; installedAt?: string; lastUpdated?: string }>>;
  };
  try {
    const raw = await fs.readFile(installedPluginsPath, 'utf8');
    installedPlugins = JSON.parse(raw) as typeof installedPlugins;
  } catch {
    return; // No installed plugins registry — nothing to sync
  }

  const pluginKey = 'danteforge@danteforge-dev';
  const entries = installedPlugins.plugins?.[pluginKey];
  if (!entries || entries.length === 0) return;

  const entry = entries[0]!;
  const oldCacheDir = entry.installPath;
  const cacheBaseDir = path.join(pluginsDir, 'cache', 'danteforge-dev', 'danteforge', version);
  await fs.mkdir(cacheBaseDir, { recursive: true });

  const filesToCopy = pkgJson.files ?? [];
  for (const fileEntry of filesToCopy) {
    const src = path.join(projectDir, fileEntry);
    const dst = path.join(cacheBaseDir, fileEntry);
    try {
      const stat = await fs.stat(src);
      if (stat.isDirectory()) {
        await fs.cp(src, dst, { recursive: true, force: true });
      } else {
        await fs.mkdir(path.dirname(dst), { recursive: true });
        await fs.copyFile(src, dst);
      }
    } catch {
      // File/dir not found — skip
    }
  }

  try {
    await fs.copyFile(path.join(projectDir, 'package.json'), path.join(cacheBaseDir, 'package.json'));
  } catch {
    // Ignore
  }

  if (oldCacheDir && oldCacheDir !== cacheBaseDir) {
    const oldNodeModules = path.join(oldCacheDir, 'node_modules');
    try {
      await fs.access(oldNodeModules);
      await fs.cp(oldNodeModules, path.join(cacheBaseDir, 'node_modules'), { recursive: true, force: true });
    } catch {
      // No prior node_modules — skip
    }
  }

  const now = new Date().toISOString();
  entry.version = version;
  entry.installPath = cacheBaseDir;
  entry.lastUpdated = now;
  await fs.writeFile(installedPluginsPath, JSON.stringify(installedPlugins, null, 2), 'utf8');
}

async function syncCodexBootstrap(homeDir: string): Promise<void> {
  const codexDir = path.join(homeDir, '.codex');
  const bootstrapPath = path.join(codexDir, 'AGENTS.md');
  const templatePath = resolvePackagedCodexBootstrapPath();

  await fs.mkdir(codexDir, { recursive: true });

  let existingContent = '';
  try {
    existingContent = await fs.readFile(bootstrapPath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }

  const templateContent = await fs.readFile(templatePath, 'utf8');
  const mergedContent = mergeCodexBootstrap(existingContent, templateContent);
  await fs.writeFile(bootstrapPath, mergedContent, 'utf8');
}

async function installNativeSkills(
  assistant: AssistantRegistry,
  skillDirs: string[],
  skillsDir: string,
  targetDir: string,
  homeDir: string,
  projectDir: string | undefined,
): Promise<void> {
  for (const skillName of skillDirs) {
    const sourceDir = path.join(skillsDir, skillName);
    const skillFile = path.join(sourceDir, 'SKILL.md');
    try {
      await fs.access(skillFile);
    } catch {
      continue;
    }
    await fs.cp(sourceDir, path.join(targetDir, skillName), { recursive: true, force: true });
  }

  if (assistant === 'codex') {
    await syncCodexConfig(homeDir);
    await syncCodexCommands(homeDir);
    await syncCodexBootstrap(homeDir);
  }

  if (assistant === 'claude' && projectDir) {
    try {
      await syncClaudePluginCache(homeDir, projectDir);
    } catch {
      // Plugin cache sync is best-effort — don't block skill installation
    }
  }
}

export async function installAssistantSkills(
  options: InstallAssistantSkillsOptions = {},
): Promise<{ homeDir: string; assistants: AssistantInstallResult[] }> {
  const assistants = options.assistants ?? DEFAULT_GLOBAL_ASSISTANTS;
  const homeDir = options.homeDir ?? process.env.DANTEFORGE_HOME ?? os.homedir();
  const skillsDir = options.skillsDir ?? resolvePackagedSkillsDir();
  const projectDir = options.projectDir ?? process.cwd();

  const skillEntries = await fs.readdir(skillsDir, { withFileTypes: true });
  const skillDirs = skillEntries
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();

  const results: AssistantInstallResult[] = [];
  for (const assistant of assistants) {
    const targetDir = resolveAssistantTargetDir(homeDir, assistant, projectDir);
    await fs.mkdir(targetDir, { recursive: true });

    if (assistant === 'cursor') {
      const bootstrapPath = path.join(targetDir, 'danteforge.mdc');
      await fs.writeFile(bootstrapPath, buildCursorBootstrapRuleV2(), 'utf8');
      await syncToolCommands(targetDir, 'cursor');
      const installed = await fs.readdir(targetDir);
      results.push({
        assistant,
        targetDir,
        installedSkills: installed.filter(f => f.endsWith('.mdc')),
        installMode: 'cursor-rules',
      });
      continue;
    }

    if (assistant === 'windsurf') {
      const filePath = path.join(targetDir, 'danteforge.md');
      await fs.writeFile(filePath, buildWindsurfBootstrapRule(), 'utf8');
      await syncToolCommands(targetDir, 'windsurf');
      const installed = await fs.readdir(targetDir);
      results.push({
        assistant,
        targetDir,
        installedSkills: installed.filter(f => f.endsWith('.md')),
        installMode: 'windsurf-rules',
      });
      continue;
    }

    if (assistant === 'aider') {
      await fs.writeFile(path.join(targetDir, '.aider.conf.yml'), buildAiderConfig(), 'utf8');
      const convPath = path.join(targetDir, 'CONVENTIONS.md');
      try {
        await fs.access(convPath);
      } catch {
        await fs.writeFile(convPath, buildAiderConventions(), 'utf8');
      }
      results.push({ assistant, targetDir, installedSkills: ['.aider.conf.yml', 'CONVENTIONS.md'], installMode: 'aider-config' });
      continue;
    }

    if (assistant === 'openhands') {
      const filePath = path.join(targetDir, 'repo.md');
      await fs.writeFile(filePath, buildOpenHandsMicroagent(), 'utf8');
      results.push({ assistant, targetDir, installedSkills: ['repo.md'], installMode: 'openhands-microagent' });
      continue;
    }

    if (assistant === 'copilot') {
      const filePath = path.join(targetDir, 'copilot-instructions.md');
      await fs.writeFile(filePath, buildCopilotInstructions(), 'utf8');
      results.push({ assistant, targetDir, installedSkills: ['copilot-instructions.md'], installMode: 'copilot-instructions' });
      continue;
    }

    if (assistant === 'continue') {
      await syncContinueConfig(targetDir);
      results.push({ assistant, targetDir, installedSkills: ['config.yaml'], installMode: 'continue-config' });
      continue;
    }

    if (assistant === 'gemini-cli') {
      const filePath = path.join(targetDir, 'GEMINI.md');
      await fs.writeFile(filePath, buildGeminiMd(), 'utf8');
      results.push({ assistant, targetDir, installedSkills: ['GEMINI.md'], installMode: 'gemini-cli' });
      continue;
    }

    await installNativeSkills(assistant, skillDirs, skillsDir, targetDir, homeDir, projectDir);
    results.push({ assistant, targetDir, installedSkills: skillDirs, installMode: 'skills' });
  }

  return { homeDir, assistants: results };
}
