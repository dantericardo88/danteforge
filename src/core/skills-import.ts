import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import yamlParser from 'yaml';

export const ANTIGRAVITY_REPO_URL = 'https://github.com/sickn33/antigravity-awesome-skills.git';
export const DEFAULT_ANTIGRAVITY_BUNDLE = 'Essentials';

export interface AntigravityBundle {
  name: string;
  skills: string[];
}

export interface HarvestAntigravityBundleOptions {
  allowOverwrite?: boolean;
  bundle?: string;
  enhance?: boolean;
  outputDir?: string;
  sourceDir?: string;
  cwd?: string;
}

export interface HarvestAntigravityBundleResult {
  bundle: string;
  importedSkills: string[];
  manifestPath: string;
  outputDir: string;
  sourceMethod: 'local' | 'git' | 'npx';
}

interface SkillsImportManifest {
  imports: Array<{
    bundle: string;
    imported_at: string;
    skills: string[];
    source: 'antigravity';
    source_method: 'local' | 'git' | 'npx';
    upstream_repo: string;
  }>;
}

interface ParsedSkillMarkdown {
  body: string;
  frontmatter: Record<string, unknown>;
}

interface PreparedSource {
  cleanup: () => Promise<void>;
  rootDir: string;
  sourceMethod: 'local' | 'git' | 'npx';
}

export function buildAntigravityGitCloneArgs(platform: NodeJS.Platform, cloneDir: string): string[] {
  return platform === 'win32'
    ? ['-c', 'core.symlinks=false', 'clone', '--depth', '1', ANTIGRAVITY_REPO_URL, cloneDir]
    : ['clone', '--depth', '1', ANTIGRAVITY_REPO_URL, cloneDir];
}

export function parseBundlesMarkdown(markdown: string): AntigravityBundle[] {
  const bundles: AntigravityBundle[] = [];
  let currentBundle: AntigravityBundle | null = null;

  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    const headingMatch = rawLine.match(/^### .*?"([^"]+)"/);
    if (headingMatch) {
      currentBundle = { name: headingMatch[1]!, skills: [] };
      bundles.push(currentBundle);
      continue;
    }

    if (!currentBundle) continue;

    const skillMatch = line.match(/^- \[`[^`]+`\]\((?:\.\.\/)+skills\/(.+?)\/\)/);
    if (skillMatch) {
      currentBundle.skills.push(skillMatch[1]!);
    }
  }

  return bundles;
}

function extractBundlesRedirect(markdown: string): string | null {
  const redirectMatch = markdown.match(/moved to \[`[^`]+`\]\(([^)]+)\)/i);
  return redirectMatch?.[1] ?? null;
}

export function sanitizeImportedSkillDirName(skillName: string): string {
  return skillName.trim().replace(/[\\/]+/g, '--').replace(/\s+/g, '-');
}

export function enhanceSkillMarkdown(
  raw: string,
  context: { bundle: string; skillPath: string },
): string {
  const parsed = parseSkillMarkdown(raw);
  const frontmatter = {
    ...parsed.frontmatter,
    source: 'antigravity-awesome-skills',
    danteforge_enhanced: true,
    danteforge_bundle: context.bundle,
    upstream_repo: ANTIGRAVITY_REPO_URL,
    upstream_skill_path: context.skillPath,
  };

  const wrapper = [
    '> Imported from Antigravity and wrapped for the DanteForge workflow.',
    '',
    '## DanteForge Wrapper',
    '',
    '- Constitution check: confirm the project constitution is active before applying this skill.',
    '- Gate reminders: respect `specify -> clarify -> plan -> tasks -> forge`; use `--light` only when the scope is genuinely small.',
    '- STATE.yaml integration: keep `.danteforge/STATE.yaml` aligned with the current phase, task list, and audit log while using this skill.',
    '- TDD hook: start with a failing test and keep the change on the RED -> GREEN -> REFACTOR path.',
    '- Verify hook: finish with `npm run verify` and `npm run build` before claiming completion.',
    '- Party mode hook: if the work splits cleanly, prefer DanteForge party mode for parallel execution.',
    '- Worktree note: risky or parallel work should run in an isolated git worktree.',
    '',
    '## Upstream Skill',
    '',
  ].join('\n');

  return [
    '---',
    yamlParser.stringify(frontmatter).trim(),
    '---',
    '',
    wrapper,
    parsed.body.trim(),
    '',
  ].join('\n');
}

export async function harvestAntigravityBundle(
  options: HarvestAntigravityBundleOptions = {},
): Promise<HarvestAntigravityBundleResult> {
  const preparedSource = await prepareAntigravitySource(options.sourceDir);

  try {
    const bundlesMarkdown = await loadBundlesMarkdown(preparedSource.rootDir);
    const bundles = parseBundlesMarkdown(bundlesMarkdown);
    const selectedBundle = resolveBundle(bundles, options.bundle);
    const outputDir = options.outputDir ?? path.join(options.cwd ?? process.cwd(), 'src', 'harvested', 'dante-agents', 'skills');
    const enhance = options.enhance !== false;

    await fs.mkdir(outputDir, { recursive: true });

    const collisions = await findExistingSkillCollisions(preparedSource.rootDir, outputDir, selectedBundle.skills);
    if (collisions.length > 0 && !options.allowOverwrite) {
      throw new Error(`Import would overwrite existing packaged skills: ${collisions.join(', ')}. Re-run with --allow-overwrite only if replacement is intentional.`);
    }

    const importedSkills: string[] = [];
    for (const skillPath of selectedBundle.skills) {
      const skillFile = await resolveSkillFile(preparedSource.rootDir, skillPath);
      const raw = await fs.readFile(skillFile, 'utf8');
      const parsed = parseSkillMarkdown(raw);
      const skillName = String(parsed.frontmatter.name ?? skillPath);
      const destinationDir = path.join(outputDir, sanitizeImportedSkillDirName(skillName));
      const destinationFile = path.join(destinationDir, 'SKILL.md');

      await fs.mkdir(destinationDir, { recursive: true });
      await fs.writeFile(
        destinationFile,
        enhance ? enhanceSkillMarkdown(raw, { bundle: selectedBundle.name, skillPath }) : raw,
        'utf8',
      );
      importedSkills.push(skillName);
    }

    const manifestPath = await updateImportManifest(outputDir, {
      bundle: selectedBundle.name,
      imported_at: new Date().toISOString(),
      skills: importedSkills,
      source: 'antigravity',
      source_method: preparedSource.sourceMethod,
      upstream_repo: ANTIGRAVITY_REPO_URL,
    });

    return {
      bundle: selectedBundle.name,
      importedSkills,
      manifestPath,
      outputDir,
      sourceMethod: preparedSource.sourceMethod,
    };
  } finally {
    await preparedSource.cleanup();
  }
}

async function loadBundlesMarkdown(sourceDir: string): Promise<string> {
  const rootBundlesPath = path.join(sourceDir, 'docs', 'BUNDLES.md');
  const initialMarkdown = await fs.readFile(rootBundlesPath, 'utf8');
  const initialBundles = parseBundlesMarkdown(initialMarkdown);
  if (initialBundles.length > 0) {
    return initialMarkdown;
  }

  const redirectTarget = extractBundlesRedirect(initialMarkdown);
  if (!redirectTarget) {
    return initialMarkdown;
  }

  const redirectedPath = path.join(path.dirname(rootBundlesPath), redirectTarget);
  return fs.readFile(redirectedPath, 'utf8');
}

function normalizeBundleName(name: string): string {
  return name.trim().toLowerCase().replace(/["']/g, '');
}

function resolveBundle(bundles: AntigravityBundle[], requestedBundle?: string): AntigravityBundle {
  const targetName = normalizeBundleName(requestedBundle ?? DEFAULT_ANTIGRAVITY_BUNDLE);
  const bundle = bundles.find(entry => normalizeBundleName(entry.name) === targetName);
  if (bundle) return bundle;

  const availableBundles = bundles.map(entry => entry.name).join(', ');
  throw new Error(`Unknown Antigravity bundle "${requestedBundle ?? DEFAULT_ANTIGRAVITY_BUNDLE}". Available bundles: ${availableBundles}`);
}

function parseSkillMarkdown(raw: string): ParsedSkillMarkdown {
  const normalized = raw.replace(/^\uFEFF/, '');
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return {
      body: normalized,
      frontmatter: {},
    };
  }

  try {
    return {
      frontmatter: (yamlParser.parse(match[1]!) as Record<string, unknown>) ?? {},
      body: match[2]!,
    };
  } catch {
    return {
      frontmatter: {},
      body: match[2]!,
    };
  }
}

async function resolveSkillFile(sourceDir: string, skillPath: string): Promise<string> {
  const candidates = [
    path.join(sourceDir, 'skills', skillPath, 'SKILL.md'),
    path.join(sourceDir, skillPath, 'SKILL.md'),
  ];

  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(`Could not find upstream SKILL.md for "${skillPath}"`);
}

async function findExistingSkillCollisions(sourceDir: string, outputDir: string, skillPaths: string[]): Promise<string[]> {
  const collisions: string[] = [];

  for (const skillPath of skillPaths) {
    const skillFile = await resolveSkillFile(sourceDir, skillPath);
    const raw = await fs.readFile(skillFile, 'utf8');
    const parsed = parseSkillMarkdown(raw);
    const skillName = String(parsed.frontmatter.name ?? skillPath);
    const destinationFile = path.join(outputDir, sanitizeImportedSkillDirName(skillName), 'SKILL.md');

    try {
      await fs.access(destinationFile);
      collisions.push(skillName);
    } catch {
      // No collision for this skill.
    }
  }

  return collisions;
}

async function prepareAntigravitySource(sourceDir?: string): Promise<PreparedSource> {
  const overrideDir = sourceDir ?? process.env.DANTEFORGE_ANTIGRAVITY_SOURCE_DIR;
  if (overrideDir) {
    return {
      rootDir: overrideDir,
      sourceMethod: 'local',
      cleanup: async () => {},
    };
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-antigravity-'));
  const cleanup = async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  };

  const cloneDir = path.join(tempRoot, 'repo');
  const cloneArgs = buildAntigravityGitCloneArgs(process.platform, cloneDir);

  try {
    await runCommand('git', cloneArgs);
    return { rootDir: cloneDir, sourceMethod: 'git', cleanup };
  } catch (gitError) {
    const installDir = path.join(tempRoot, 'install');
    try {
      await runCommand('npx', ['--yes', 'antigravity-awesome-skills', '--path', installDir, '--antigravity']);
      return { rootDir: installDir, sourceMethod: 'npx', cleanup };
    } catch (npxError) {
      await cleanup();
      throw new Error([
        'Failed to acquire Antigravity skills via git clone and npx fallback.',
        `git: ${stringifyError(gitError)}`,
        `npx: ${stringifyError(npxError)}`,
      ].join(' '));
    }
  }
}

async function runCommand(command: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const executable = process.platform === 'win32' && command === 'npx'
      ? 'npx.cmd'
      : command;

    const child = spawn(executable, args, {
      stdio: 'pipe',
      shell: false,
    });

    let stderr = '';

    child.stderr.on('data', chunk => {
      stderr += String(chunk);
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
  });
}

function stringifyError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function updateImportManifest(
  outputDir: string,
  entry: SkillsImportManifest['imports'][number],
): Promise<string> {
  const manifestPath = path.join(outputDir, 'IMPORT_MANIFEST.yaml');
  const manifest = await loadImportManifest(manifestPath);
  const nextImports = manifest.imports.filter(item => item.bundle !== entry.bundle);
  nextImports.push(entry);

  nextImports.sort((left, right) => left.bundle.localeCompare(right.bundle));
  await fs.writeFile(manifestPath, yamlParser.stringify({ imports: nextImports }), 'utf8');
  return manifestPath;
}

async function loadImportManifest(manifestPath: string): Promise<SkillsImportManifest> {
  try {
    const raw = await fs.readFile(manifestPath, 'utf8');
    const parsed = yamlParser.parse(raw) as Partial<SkillsImportManifest>;
    return {
      imports: Array.isArray(parsed?.imports) ? parsed.imports : [],
    };
  } catch {
    return { imports: [] };
  }
}
