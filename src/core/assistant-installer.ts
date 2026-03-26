import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type AssistantRegistry = 'claude' | 'codex' | 'antigravity' | 'opencode' | 'cursor';

export interface AssistantInstallResult {
  assistant: AssistantRegistry;
  targetDir: string;
  installedSkills: string[];
  installMode?: 'skills' | 'cursor-rules';
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
  'magic',
  'blaze',
  'nova',
  'inferno',
  'danteforge',
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
  'local-harvest',
  'qa',
  'ship',
  'retro',
  'lessons',
  'debug',
  'browse',
  'oss',
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
  }
}

function compareSemver(a: string, b: string): number {
  const aParts = a.split('.').map(part => Number.parseInt(part, 10) || 0);
  const bParts = b.split('.').map(part => Number.parseInt(part, 10) || 0);
  const max = Math.max(aParts.length, bParts.length);

  for (let index = 0; index < max; index++) {
    const left = aParts[index] ?? 0;
    const right = bParts[index] ?? 0;
    if (left !== right) {
      return left - right;
    }
  }

  return 0;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function syncClaudePluginCache(homeDir: string, projectDir: string): Promise<void> {
  const pluginsRoot = path.join(homeDir, '.claude', 'plugins');
  const installedPluginsPath = path.join(pluginsRoot, 'installed_plugins.json');
  const cacheRoot = path.join(pluginsRoot, 'cache', 'danteforge-dev', 'danteforge');

  if (!await pathExists(pluginsRoot)) {
    return;
  }

  const pkgPath = path.join(projectDir, 'package.json');
  if (!await pathExists(pkgPath)) {
    return;
  }

  const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf8')) as {
    version: string;
    files?: string[];
  };
  const version = pkg.version;
  const targetDir = path.join(cacheRoot, version);

  await fs.mkdir(cacheRoot, { recursive: true });

  if (!await pathExists(targetDir)) {
    const cacheEntries = await fs.readdir(cacheRoot, { withFileTypes: true }).catch(() => []);
    const priorVersions = cacheEntries
      .filter(entry => entry.isDirectory() && entry.name !== version)
      .map(entry => entry.name)
      .sort((left, right) => compareSemver(right, left));
    const priorVersion = priorVersions[0];

    if (priorVersion) {
      await fs.cp(path.join(cacheRoot, priorVersion), targetDir, { recursive: true, force: true });
    } else {
      await fs.mkdir(targetDir, { recursive: true });
    }
  }

  const packageFiles = new Set<string>([
    'package.json',
    'package-lock.json',
    ...(pkg.files ?? []),
  ]);

  for (const relativePath of packageFiles) {
    const sourcePath = path.join(projectDir, relativePath);
    if (!await pathExists(sourcePath)) {
      continue;
    }

    const destinationPath = path.join(targetDir, relativePath);
    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
    } else {
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      await fs.copyFile(sourcePath, destinationPath);
    }
  }

  const targetNodeModules = path.join(targetDir, 'node_modules');
  const projectNodeModules = path.join(projectDir, 'node_modules');
  if (!await pathExists(targetNodeModules) && await pathExists(projectNodeModules)) {
    await fs.cp(projectNodeModules, targetNodeModules, { recursive: true, force: true });
  }

  let installedPlugins: {
    version: number;
    plugins: Record<string, Array<{
      scope: string;
      installPath: string;
      version: string;
      installedAt: string;
      lastUpdated: string;
    }>>;
  } = {
    version: 2,
    plugins: {},
  };

  if (await pathExists(installedPluginsPath)) {
    installedPlugins = JSON.parse(await fs.readFile(installedPluginsPath, 'utf8')) as typeof installedPlugins;
  }

  const pluginKey = 'danteforge@danteforge-dev';
  const now = new Date().toISOString();
  const existingInstall = installedPlugins.plugins[pluginKey]?.[0];
  installedPlugins.version = installedPlugins.version || 2;
  installedPlugins.plugins[pluginKey] = [{
    scope: existingInstall?.scope ?? 'user',
    installPath: targetDir,
    version,
    installedAt: existingInstall?.installedAt ?? now,
    lastUpdated: now,
  }];

  await fs.mkdir(path.dirname(installedPluginsPath), { recursive: true });
  await fs.writeFile(installedPluginsPath, JSON.stringify(installedPlugins, null, 2), 'utf8');
}

function buildCursorBootstrapRule(): string {
  return [
    '---',
    'description: Follow DanteForge workflow and repo instructions when working in this project',
    'alwaysApply: true',
    '---',
    '',
    'Use `AGENTS.md` as the canonical instruction file when it exists.',
    '',
    'When working in this repository:',
    '- Prefer the DanteForge workflow artifacts under `.danteforge/`.',
    '- Follow the pipeline order:',
    '  `review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship`',
    '- Use `danteforge <command>` for any workflow step. Key commands:',
    '  - `danteforge review` — Scan repo, generate CURRENT_STATE.md',
    '  - `danteforge constitution` — Define project principles',
    '  - `danteforge specify <idea>` — Idea to spec artifacts',
    '  - `danteforge clarify` — Q&A on spec, identify gaps',
    '  - `danteforge tech-decide` — Guided tech stack selection',
    '  - `danteforge plan` — Spec to implementation plan',
    '  - `danteforge tasks` — Plan to executable task list',
    '  - `danteforge design <prompt>` — Design artifacts via OpenPencil',
    '  - `danteforge forge` — Execute development waves',
    '  - `danteforge ux-refine` — Refine UI/UX after forge',
    '  - `danteforge verify` — Run all verification checks',
    '  - `danteforge synthesize` — Generate UPR.md',
    '  - `danteforge party --isolation` — Multi-agent collaboration',
    '  - `danteforge autoforge [goal] --dry-run` — Inspect deterministic next steps',
    '  - `danteforge spark [goal]` — Zero-token planning preset',
    '  - `danteforge ember [goal]` — Very low-token preset for quick follow-up work',
    '  - `danteforge canvas [goal]` — Design-first frontend preset',
    '  - `danteforge magic [goal]` — Balanced default preset for daily gap-closing',
    '  - `danteforge blaze [goal]` — High-power preset with full party escalation',
    '  - `danteforge nova [goal]` — Very-high-power preset: planning prefix + deep execution (no OSS)',
    '  - `danteforge inferno [goal]` — Maximum-power preset with OSS discovery and evolution',
    '  - `danteforge party --isolation` — Multi-agent collaboration',
    '  - `danteforge autoforge [goal] --dry-run` — Inspect deterministic next steps',
    '  - `danteforge local-harvest [paths...]` — Harvest patterns from local repos/folders',
    '  - `danteforge qa --url <url>` — Structured QA pass',
    '  - `danteforge ship` — Release review and planning guidance',
    '  - `danteforge retro` — Project retrospective',
    '  - `danteforge lessons` — Capture corrections as rules',
    '  - `danteforge debug <issue>` — 4-phase debugging',
    '  - `danteforge browse` — Browser automation',
    '  - `danteforge oss` — Discover OSS patterns with license gates',
    '  - `danteforge harvest <system>` — Titan Harvest V2 pattern extraction',
    '  - `danteforge awesome-scan` — Discover and import skills',
    '- Preset usage rule:',
    '  `danteforge inferno [goal]` for first-pass matrix expansion, `danteforge magic [goal]` for follow-up gap closing.',
    '- Use `--light` to bypass gates for simple changes.',
    '- Before claiming release readiness, run `npm run verify`, `npm run check:cli-smoke`, and `npm run release:check`.',
    '- For design-heavy work, use `danteforge design` and `danteforge ux-refine --openpencil`.',
    '',
    'If Figma MCP is needed in Cursor, configure `.cursor/mcp.json` via `danteforge setup figma`.',
    '',
  ].join('\n');
}

function buildCursorBootstrapRuleV2(): string {
  return [
    '---',
    'description: Follow DanteForge workflow and repo instructions when working in this project',
    'alwaysApply: true',
    '---',
    '',
    'Use `AGENTS.md` as the canonical instruction file when it exists.',
    '',
    'When working in this repository:',
    '- Prefer the DanteForge workflow artifacts under `.danteforge/`.',
    '- Follow the pipeline order:',
    '  `review -> constitution -> specify -> clarify -> tech-decide -> plan -> tasks -> design -> forge -> ux-refine -> verify -> synthesize -> retro -> ship`',
    '- Use `danteforge <command>` for any workflow step. Key commands:',
    '  - `danteforge review` - Scan repo, generate CURRENT_STATE.md',
    '  - `danteforge constitution` - Define project principles',
    '  - `danteforge specify <idea>` - Idea to spec artifacts',
    '  - `danteforge clarify` - Q&A on spec, identify gaps',
    '  - `danteforge tech-decide` - Guided tech stack selection',
    '  - `danteforge plan` - Spec to implementation plan',
    '  - `danteforge tasks` - Plan to executable task list',
    '  - `danteforge design <prompt>` - Design artifacts via OpenPencil',
    '  - `danteforge forge` - Execute development waves',
    '  - `danteforge ux-refine` - Refine UI/UX after forge',
    '  - `danteforge verify` - Run all verification checks',
    '  - `danteforge synthesize` - Generate UPR.md',
    '  - `danteforge spark [goal]` - Zero-token planning preset',
    '  - `danteforge ember [goal]` - Very low-token preset for quick follow-up work',
    '  - `danteforge canvas [goal]` - Design-first frontend preset',
    '  - `danteforge magic [goal]` - Balanced default preset for daily gap-closing',
    '  - `danteforge blaze [goal]` - High-power preset with full party escalation',
    '  - `danteforge nova [goal]` - Very-high-power preset: planning prefix + deep execution (no OSS)',
    '  - `danteforge inferno [goal]` - Maximum-power preset with OSS discovery and evolution',
    '  - `danteforge party --isolation` - Multi-agent collaboration',
    '  - `danteforge autoforge [goal] --dry-run` - Inspect deterministic next steps',
    '  - `danteforge local-harvest [paths...]` - Harvest patterns from local repos/folders',
    '  - `danteforge qa --url <url>` - Structured QA pass',
    '  - `danteforge ship` - Release review and planning guidance',
    '  - `danteforge retro` - Project retrospective',
    '  - `danteforge lessons` - Capture corrections as rules',
    '  - `danteforge debug <issue>` - 4-phase debugging',
    '  - `danteforge browse` - Browser automation',
    '  - `danteforge oss` - Discover OSS patterns with license gates',
    '  - `danteforge harvest <system>` - Titan Harvest V2 pattern extraction',
    '  - `danteforge awesome-scan` - Discover and import skills',
    '- Preset usage rule:',
    '  `danteforge inferno [goal]` for first-pass matrix expansion, `danteforge magic [goal]` for follow-up gap closing.',
    '- Use `--light` to bypass gates for simple changes.',
    '- Before claiming release readiness, run `npm run verify`, `npm run check:cli-smoke`, and `npm run release:check`.',
    '- For design-heavy work, use `danteforge design` and `danteforge ux-refine --openpencil`.',
    '',
    'If Figma MCP is needed in Cursor, configure `.cursor/mcp.json` via `danteforge setup figma`.',
    '',
  ].join('\n');
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
      results.push({
        assistant,
        targetDir,
        installedSkills: ['danteforge.mdc'],
        installMode: 'cursor-rules',
      });
      continue;
    }

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

    if (assistant === 'claude') {
      await syncClaudePluginCache(homeDir, projectDir);
    }

    results.push({ assistant, targetDir, installedSkills: skillDirs, installMode: 'skills' });
  }

  return { homeDir, assistants: results };
}
