import fs from 'fs/promises';
import path from 'path';

interface PackageMetadata {
  name?: unknown;
  bin?: unknown;
}

export interface CommunityOnboardingReport {
  docsScanned: string[];
  copyPasteCommandCount: number;
  installCommands: string[];
  firstRunCommands: string[];
  verificationCommands: string[];
  packageManagers: string[];
  supportReferences: string[];
  hasCommandReference: boolean;
  hasTroubleshooting: boolean;
  hasOnboardingGuide: boolean;
}

const DOC_CANDIDATES = [
  'README.md',
  path.join('docs', 'ONBOARDING.md'),
  path.join('docs', 'QUICKSTART.md'),
  path.join('docs', 'COMMANDS.md'),
  path.join('docs', 'TROUBLESHOOTING.md'),
  'CONTRIBUTING.md',
  'COMMUNITY.md',
];

async function readText(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return '';
  }
}

async function readPackage(cwd: string): Promise<PackageMetadata> {
  try {
    return JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8')) as PackageMetadata;
  } catch {
    return {};
  }
}

function packageCommandNames(pkg: PackageMetadata): string[] {
  const names = new Set<string>();
  if (typeof pkg.name === 'string' && pkg.name.trim()) names.add(pkg.name.trim());
  if (typeof pkg.bin === 'string' && typeof pkg.name === 'string') names.add(pkg.name);
  if (pkg.bin && typeof pkg.bin === 'object') {
    for (const key of Object.keys(pkg.bin as Record<string, unknown>)) {
      if (key.trim()) names.add(key.trim());
    }
  }
  return [...names];
}

function normalizeCommand(line: string): string {
  return line
    .replace(/^\s*(?:\$|>)\s*/, '')
    .replace(/\s+#.*$/, '')
    .trim();
}

function extractCodeBlockCommands(markdown: string): string[] {
  const commands: string[] = [];
  const blockPattern = /```(?:bash|sh|shell|zsh)?\s*\r?\n([\s\S]*?)```/gi;
  let match: RegExpExecArray | null;
  while ((match = blockPattern.exec(markdown)) !== null) {
    const body = match[1] ?? '';
    for (const rawLine of body.split(/\r?\n/)) {
      const command = normalizeCommand(rawLine);
      if (!command || command.startsWith('#') || /^[A-Z_]+=/.test(command)) continue;
      commands.push(command);
    }
  }
  return commands;
}

function extractInlineCommands(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\r\n]+)`/g)]
    .map((match) => normalizeCommand(match[1] ?? ''))
    .filter((command) => command.length > 0);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function detectPackageManagers(text: string, commands: string[]): string[] {
  const combined = `${text}\n${commands.join('\n')}`;
  const managers: string[] = [];
  if (/\bnpm\s+(?:install|i)\b/i.test(combined)) managers.push('npm');
  if (/\bnpx\b/i.test(combined)) managers.push('npx');
  if (/\bpnpm\s+(?:add|dlx|install)\b/i.test(combined)) managers.push('pnpm');
  if (/\byarn\s+(?:add|dlx|global|install)\b/i.test(combined)) managers.push('yarn');
  if (/\b(?:bun\s+(?:add|install|x)|bunx)\b/i.test(combined)) managers.push('bun');
  return unique(managers);
}

function isInstallCommand(command: string): boolean {
  return /\b(?:npm\s+(?:install|i)|npx|pnpm\s+(?:add|dlx|install)|yarn\s+(?:add|dlx|global|install)|bun\s+(?:add|install|x)|bunx)\b/i.test(command);
}

function commandMentionsTool(command: string, toolNames: string[]): boolean {
  if (toolNames.length === 0) return /\bdanteforge\b/i.test(command);
  return toolNames.some((name) => new RegExp(`(^|\\s)${escapeRegExp(name)}(?:\\s|$)`, 'i').test(command));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function commandReferenceReady(commandDoc: string, allCommands: string[], toolNames: string[]): boolean {
  if (!commandDoc.trim()) return false;
  const docCommands = allCommands.filter((command) => commandMentionsTool(command, toolNames));
  const tableRows = commandDoc.split(/\r?\n/).filter((line) => /^\|\s*`?[\w-]+/.test(line)).length;
  return /command reference|commands/i.test(commandDoc) && (docCommands.length >= 3 || tableRows >= 3);
}

function troubleshootingReady(text: string): boolean {
  return /troubleshooting|support|report/i.test(text)
    && /doctor|diagnose|logs?|reproduc|issue|node version|operating system|os/i.test(text);
}

export async function analyzeCommunityOnboarding(cwd: string = process.cwd()): Promise<CommunityOnboardingReport> {
  const pkg = await readPackage(cwd);
  const toolNames = packageCommandNames(pkg);
  const docs = await Promise.all(DOC_CANDIDATES.map(async (relPath) => ({
    relPath,
    text: await readText(path.join(cwd, relPath)),
  })));
  const presentDocs = docs.filter((doc) => doc.text.trim().length > 0);
  const combinedText = presentDocs.map((doc) => doc.text).join('\n\n');
  const commands = unique([
    ...presentDocs.flatMap((doc) => extractCodeBlockCommands(doc.text)),
    ...presentDocs.flatMap((doc) => extractInlineCommands(doc.text)),
  ]);
  const installCommands = commands.filter(isInstallCommand);
  const firstRunCommands = commands.filter((command) =>
    commandMentionsTool(command, toolNames) && !isInstallCommand(command));
  const verificationCommands = firstRunCommands.filter((command) =>
    /\b(?:--help|help|doctor|verify|test|check)\b/i.test(command));
  const commandDoc = docs.find((doc) => doc.relPath === path.join('docs', 'COMMANDS.md'))?.text ?? '';
  const troubleshootingText = [
    docs.find((doc) => doc.relPath === path.join('docs', 'TROUBLESHOOTING.md'))?.text ?? '',
    combinedText,
  ].join('\n');

  return {
    docsScanned: presentDocs.map((doc) => doc.relPath),
    copyPasteCommandCount: commands.length,
    installCommands,
    firstRunCommands,
    verificationCommands,
    packageManagers: detectPackageManagers(combinedText, commands),
    supportReferences: unique([
      ...combinedText.matchAll(/\b(?:issue|discussion|support|security|report|reproduction|logs?)\b/gi),
    ].map((match) => match[0].toLowerCase())),
    hasCommandReference: commandReferenceReady(commandDoc, commands, toolNames),
    hasTroubleshooting: troubleshootingReady(troubleshootingText),
    hasOnboardingGuide: presentDocs.some((doc) =>
      /(?:README|ONBOARDING|QUICKSTART)\.md$/i.test(doc.relPath)
      && /quick\s*start|getting started|onboarding|first run|install/i.test(doc.text)),
  };
}

async function writeIfMissing(filePath: string, content: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return false;
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf8');
    return true;
  }
}

export async function writeCommunityOnboardingDocs(cwd: string): Promise<void> {
  await writeIfMissing(path.join(cwd, 'docs', 'ONBOARDING.md'), `# Onboarding

## Install

\`\`\`bash
npm install -g danteforge
danteforge --help
danteforge doctor
\`\`\`

## First Workflow

\`\`\`bash
danteforge constitution
danteforge specify "Build a small task tracker"
danteforge plan
danteforge tasks
danteforge forge
danteforge verify
\`\`\`

## Support

When something fails, run \`danteforge doctor\` and include the command, Node version, operating system, expected behavior, and logs with secrets removed in the issue.
`);

  await writeIfMissing(path.join(cwd, 'docs', 'COMMANDS.md'), `# Command Reference

| Command | Purpose |
| --- | --- |
| \`danteforge doctor\` | Diagnose local setup and provider configuration. |
| \`danteforge verify\` | Run project verification checks. |
| \`danteforge go\` | Start the guided daily workflow. |
| \`danteforge help <command>\` | Show command-specific help. |

\`\`\`bash
danteforge doctor
danteforge verify
danteforge help forge
\`\`\`
`);

  await writeIfMissing(path.join(cwd, 'docs', 'TROUBLESHOOTING.md'), `# Troubleshooting

## First Checks

\`\`\`bash
danteforge doctor
danteforge --help
danteforge verify
\`\`\`

## Reporting Issues

Open an issue with reproduction steps, the exact command, expected behavior, actual behavior, Node version, operating system, and logs with secrets removed.
`);
}
