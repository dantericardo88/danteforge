// Plugin Registry — install and discover community npm skill packages
import path from 'node:path';
import fs from 'node:fs/promises';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import type { SkillRegistryEntry } from './skill-registry.js';
import { classifyDomain } from './skill-registry.js';

export interface PluginEntry {
  name: string;         // npm package name
  version: string;      // installed version
  skillsDir: string;    // resolved absolute path to skills/
  installedAt: string;  // ISO timestamp
}

export interface PluginsManifest {
  plugins: PluginEntry[];
}

export interface PluginRegistryOptions {
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, c: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  _execNpm?: (args: string[], cwd: string) => Promise<{ stdout: string; stderr: string }>;
  _exists?: (p: string) => Promise<boolean>;
  cwd?: string;
}

export class PluginNoSkillsDirError extends Error {
  constructor(
    public readonly packageName: string,
    public readonly checkedPath: string,
  ) {
    super(`Plugin "${packageName}" has no skills/ directory at ${checkedPath}`);
    this.name = 'PluginNoSkillsDirError';
  }
}

function manifestPath(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', 'plugins.yaml');
}

function modulesDir(cwd?: string): string {
  return path.join(cwd ?? process.cwd(), '.danteforge', 'plugin-modules');
}

export async function loadPluginsManifest(opts?: PluginRegistryOptions): Promise<PluginsManifest> {
  const readFile = opts?._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await readFile(manifestPath(opts?.cwd));
    const parsed = parseYaml(raw) as { plugins?: PluginEntry[] } | null;
    return { plugins: parsed?.plugins ?? [] };
  } catch {
    return { plugins: [] };
  }
}

export async function savePluginsManifest(
  manifest: PluginsManifest,
  opts?: PluginRegistryOptions,
): Promise<void> {
  const writeFile = opts?._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const mkdir = opts?._mkdir ?? ((p: string, o?: { recursive?: boolean }) => fs.mkdir(p, o).then(() => {}).catch(() => {}));
  const filePath = manifestPath(opts?.cwd);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, stringifyYaml(manifest));
}

export async function installPlugin(
  packageName: string,
  opts?: PluginRegistryOptions,
): Promise<{ entry: PluginEntry; alreadyInstalled: boolean }> {
  const cwd = opts?.cwd ?? process.cwd();
  const execNpm = opts?._execNpm ?? defaultExecNpm;
  const exists = opts?._exists ?? defaultExists;

  // Check if already installed
  const manifest = await loadPluginsManifest(opts);
  const existing = manifest.plugins.find((p) => p.name === packageName);
  if (existing) {
    return { entry: existing, alreadyInstalled: true };
  }

  // Run npm install into the plugin-modules prefix
  const prefix = modulesDir(cwd);
  await execNpm(['install', '--prefix', prefix, packageName], cwd);

  // Read version from installed package.json
  const pkgJsonPath = path.join(prefix, 'node_modules', packageName, 'package.json');
  let version = 'unknown';
  try {
    const readFile = opts?._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
    const raw = await readFile(pkgJsonPath);
    const pkg = JSON.parse(raw) as { version?: string };
    version = pkg.version ?? 'unknown';
  } catch { /* best-effort */ }

  // Detect skills/ directory
  const skillsDir = path.join(prefix, 'node_modules', packageName, 'skills');
  const skillsDirExists = await exists(skillsDir);
  if (!skillsDirExists) {
    throw new PluginNoSkillsDirError(packageName, skillsDir);
  }

  const entry: PluginEntry = {
    name: packageName,
    version,
    skillsDir,
    installedAt: new Date().toISOString(),
  };

  manifest.plugins.push(entry);
  await savePluginsManifest(manifest, opts);
  return { entry, alreadyInstalled: false };
}

export async function removePlugin(
  packageName: string,
  opts?: PluginRegistryOptions,
): Promise<{ removed: boolean }> {
  const manifest = await loadPluginsManifest(opts);
  const idx = manifest.plugins.findIndex((p) => p.name === packageName);
  if (idx === -1) return { removed: false };
  manifest.plugins.splice(idx, 1);
  await savePluginsManifest(manifest, opts);
  return { removed: true };
}

export async function discoverPluginSkills(
  opts?: PluginRegistryOptions,
): Promise<SkillRegistryEntry[]> {
  const manifest = await loadPluginsManifest(opts);
  if (manifest.plugins.length === 0) return [];

  const readFile = opts?._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const results: SkillRegistryEntry[] = [];

  for (const plugin of manifest.plugins) {
    try {
      // Scan for SKILL.md files in the plugin's skills directory
      const { readdir } = await import('node:fs/promises');
      let entries: string[] = [];
      try {
        entries = await readdir(plugin.skillsDir);
      } catch {
        // Skills dir not accessible — skip
        continue;
      }

      for (const entry of entries) {
        if (!entry.endsWith('.md') && !entry.startsWith('SKILL')) {
          // Try as subdirectory with SKILL.md inside
          const skillMdPath = path.join(plugin.skillsDir, entry, 'SKILL.md');
          try {
            const content = await readFile(skillMdPath);
            const name = entry;
            const descMatch = content.match(/description:\s*(.+)/);
            const description = descMatch?.[1]?.trim() ?? name;
            results.push({
              name,
              description,
              source: 'plugin',
              pluginName: plugin.name,
              domain: classifyDomain(name, description),
              compatibility: { requiredTools: [], requiredFrameworks: [] },
              filePath: skillMdPath,
            });
          } catch { /* no SKILL.md here — skip */ }
        } else if (entry === 'SKILL.md' || entry.endsWith('.md')) {
          const skillMdPath = path.join(plugin.skillsDir, entry);
          try {
            const content = await readFile(skillMdPath);
            const name = path.basename(plugin.skillsDir);
            const descMatch = content.match(/description:\s*(.+)/);
            const description = descMatch?.[1]?.trim() ?? name;
            results.push({
              name,
              description,
              source: 'plugin',
              pluginName: plugin.name,
              domain: classifyDomain(name, description),
              compatibility: { requiredTools: [], requiredFrameworks: [] },
              filePath: skillMdPath,
            });
          } catch { /* skip */ }
        }
      }
    } catch { /* skip malformed plugin */ }
  }

  return results;
}

// ── Default implementations ───────────────────────────────────────────────────

async function defaultExecNpm(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);
  const result = await execFileAsync('npm', args, { cwd });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function defaultExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}
