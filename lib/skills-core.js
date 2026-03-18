// DanteForge Skills Core — runtime skill discovery and resolution
// Pattern from obra/superpowers (MIT). Adapted for DanteForge.
// This is JavaScript (not TypeScript) for direct Claude Code plugin execution.

import { readdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PLUGIN_SKILLS_DIR = join(__dirname, '..', 'src', 'harvested', 'dante-agents', 'skills');
const HOME_DIR = process.env.DANTEFORGE_HOME || process.env.HOME || process.env.USERPROFILE || '~';
const PERSONAL_SKILL_DIRS = [
  { dir: join(HOME_DIR, '.claude', 'skills'), source: 'personal' },
  { dir: join(HOME_DIR, '.codex', 'skills'), source: 'personal' },
  { dir: join(HOME_DIR, '.gemini', 'antigravity', 'skills'), source: 'personal' },
];

/**
 * Extract YAML frontmatter from a SKILL.md file
 */
export function extractFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { name: 'unknown', description: '', body: raw };

  const frontmatter = match[1];
  const body = match[2];

  let name = 'unknown';
  let description = '';

  for (const line of frontmatter.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');

    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  return { name, description, body };
}

/**
 * Find all SKILL.md files in a directory
 */
async function findSkillsInDir(dir, sourceType) {
  const skills = [];
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(dir, entry.name, 'SKILL.md');
      try {
        const raw = await readFile(skillFile, 'utf8');
        const { name, description, body } = extractFrontmatter(raw);
        skills.push({ name, description, body, filePath: skillFile, source: sourceType });
      } catch {
        // No SKILL.md here
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return skills;
}

/**
 * Discover all available skills (personal skills shadow plugin skills)
 */
export async function discoverAllSkills() {
  const pluginSkills = await findSkillsInDir(PLUGIN_SKILLS_DIR, 'danteforge');
  const personalSkills = [];
  for (const root of PERSONAL_SKILL_DIRS) {
    personalSkills.push(...await findSkillsInDir(root.dir, root.source));
  }

  // Personal skills shadow plugin skills with the same name
  const merged = new Map();
  for (const skill of pluginSkills) {
    merged.set(skill.name, skill);
  }
  for (const skill of personalSkills) {
    merged.set(skill.name, skill); // Overwrites plugin skill if same name
  }

  return Array.from(merged.values());
}

/**
 * Resolve a specific skill by name
 * Use "danteforge:" prefix to force plugin namespace
 */
export async function resolveSkillPath(skillName) {
  const forcePlugin = skillName.startsWith('danteforge:');
  const cleanName = skillName.replace(/^danteforge:/, '');

  if (!forcePlugin) {
    for (const root of PERSONAL_SKILL_DIRS) {
      try {
        const skillFile = join(root.dir, cleanName, 'SKILL.md');
        await readFile(skillFile, 'utf8');
        return skillFile;
      } catch {
        // Fall through to the next root.
      }
    }
  }

  // Check plugin skills
  const skillFile = join(PLUGIN_SKILLS_DIR, cleanName, 'SKILL.md');
  try {
    await readFile(skillFile, 'utf8');
    return skillFile;
  } catch {
    return null;
  }
}

/**
 * Strip YAML frontmatter, returning only the markdown body
 */
export function stripFrontmatter(raw) {
  const match = raw.match(/^---\n[\s\S]*?\n---\n([\s\S]*)$/);
  return match ? match[1] : raw;
}
