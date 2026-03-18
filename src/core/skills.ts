// Skill loader/resolver — discovers SKILL.md files, parses YAML frontmatter, resolves by name
import fs from 'fs/promises';
import fsSync from 'fs';
import os from 'node:os';
import path from 'path';
import yamlParser from 'yaml';
import { logger } from './logger.js';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface Skill {
  name: string;
  description: string;
  content: string;
  filePath: string;
}

export interface SkillDiscoveryOptions {
  homeDir?: string;
  packagedSkillsDir?: string;
}

// Resolve skills directory — works in both dev (src/core/) and bundled (dist/) mode
function resolvePackagedSkillsDir(): string {
  const candidates = [
    // Bundled mode: dist/index.js -> ../src/harvested/dante-agents/skills
    path.resolve(__dirname, '..', 'src', 'harvested', 'dante-agents', 'skills'),
    // Dev mode via tsx: src/core/skills.ts -> ../harvested/dante-agents/skills
    path.resolve(__dirname, '..', 'harvested', 'dante-agents', 'skills'),
  ];
  for (const dir of candidates) {
    try {
      if (fsSync.statSync(dir).isDirectory()) return dir;
    } catch { /* try next */ }
  }
  return candidates[0]!; // fallback — discoverSkills will handle the missing dir gracefully
}

const PACKAGED_SKILLS_DIR = resolvePackagedSkillsDir();

/**
 * Extract YAML frontmatter from a SKILL.md file using the yaml package
 */
function extractFrontmatter(raw: string): { name: string; description: string; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) {
    return { name: 'unknown', description: '', body: raw };
  }

  const frontmatterRaw = match[1]!;
  const body = match[2]!;

  try {
    const parsed = yamlParser.parse(frontmatterRaw) as Record<string, unknown>;
    return {
      name: String(parsed.name ?? 'unknown'),
      description: String(parsed.description ?? ''),
      body,
    };
  } catch {
    logger.warn('Failed to parse SKILL.md frontmatter — falling back to regex');
    let name = 'unknown';
    let description = '';
    for (const line of frontmatterRaw.split('\n')) {
      const nameMatch = line.match(/^name:\s*(.+)$/);
      if (nameMatch) name = nameMatch[1]!.trim().replace(/^["']|["']$/g, '');
      const descMatch = line.match(/^description:\s*(.+)$/);
      if (descMatch) description = descMatch[1]!.trim().replace(/^["']|["']$/g, '');
    }
    return { name, description, body };
  }
}

/**
 * Discover all skills across packaged and user directories.
 */
export async function discoverSkills(options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const mergedSkills = new Map<string, Skill>();
  let foundAnyRoot = false;

  for (const root of resolveSkillRoots(options)) {
    const rootSkills = await loadSkillsFromRoot(root.directory);
    if (rootSkills.length > 0) {
      foundAnyRoot = true;
    }

    for (const skill of rootSkills) {
      mergedSkills.set(skill.name, skill);
    }
  }

  if (!foundAnyRoot) {
    logger.warn('Skills directories not found — no skills loaded');
  }

  return Array.from(mergedSkills.values());
}

/**
 * Resolve a skill by name
 */
export async function resolveSkill(skillName: string, options: SkillDiscoveryOptions = {}): Promise<Skill | null> {
  const skills = await discoverSkills(options);
  return skills.find(s => s.name === skillName) ?? null;
}

/**
 * Get skill names and descriptions (for help/listing)
 */
export async function listSkills(options: SkillDiscoveryOptions = {}): Promise<{ name: string; description: string }[]> {
  const skills = await discoverSkills(options);
  return skills.map(s => ({ name: s.name, description: s.description }));
}

/**
 * Check if any skill is relevant to the given context
 */
export async function findRelevantSkills(context: string, options: SkillDiscoveryOptions = {}): Promise<Skill[]> {
  const skills = await discoverSkills(options);
  const lower = context.toLowerCase();

  return skills.filter(s => {
    const triggers = s.description.toLowerCase();
    // Simple keyword matching against "Use when" triggers
    const keywords = triggers.split('use when').slice(1);
    return keywords.some(kw => {
      const terms = kw.trim().split(/\s+/).filter(t => t.length > 3);
      return terms.some(term => lower.includes(term));
    });
  });
}

function resolveSkillRoots(options: SkillDiscoveryOptions): { directory: string; kind: 'packaged' | 'antigravity' | 'opencode' | 'claude' | 'codex' }[] {
  const homeDir = options.homeDir ?? process.env.DANTEFORGE_HOME ?? os.homedir();
  const configHome = process.platform === 'win32'
    ? path.join(homeDir, '.config')
    : process.env.XDG_CONFIG_HOME ?? path.join(homeDir, '.config');
  return [
    { directory: options.packagedSkillsDir ?? PACKAGED_SKILLS_DIR, kind: 'packaged' },
    { directory: path.join(homeDir, '.gemini', 'antigravity', 'skills'), kind: 'antigravity' },
    { directory: path.join(configHome, 'opencode', 'skills'), kind: 'opencode' },
    { directory: path.join(homeDir, '.codex', 'skills'), kind: 'codex' },
    { directory: path.join(homeDir, '.claude', 'skills'), kind: 'claude' },
  ];
}

async function loadSkillsFromRoot(rootDir: string): Promise<Skill[]> {
  const skillFiles = await findSkillFiles(rootDir);
  const skills: Skill[] = [];

  for (const skillFile of skillFiles) {
    try {
      const raw = await fs.readFile(skillFile, 'utf8');
      const { name, description, body } = extractFrontmatter(raw);
      skills.push({ name, description, content: body, filePath: skillFile });
    } catch {
      // Ignore unreadable skill files.
    }
  }

  return skills;
}

async function findSkillFiles(rootDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    const discovered: string[] = [];

    for (const entry of entries) {
      const entryPath = path.join(rootDir, entry.name);
      if (entry.isDirectory()) {
        discovered.push(...await findSkillFiles(entryPath));
        continue;
      }
      if (entry.isFile() && entry.name === 'SKILL.md') {
        discovered.push(entryPath);
      }
    }

    return discovered;
  } catch {
    return [];
  }
}
