// Skill Registry — external skill discovery, domain taxonomy, compatibility checking
import fs from 'fs/promises';
import path from 'path';
import { discoverSkills, type Skill, type SkillDiscoveryOptions } from './skills.js';
import { logger } from './logger.js';

export type SkillDomain =
  | 'security' | 'fullstack' | 'devops' | 'ux' | 'backend'
  | 'frontend' | 'data' | 'testing' | 'architecture' | 'general';

export interface SkillRegistryEntry {
  name: string;
  description: string;
  source: 'packaged' | 'user' | 'antigravity' | 'external' | 'plugin';
  domain: SkillDomain;
  compatibility: {
    requiredTools: string[];
    requiredFrameworks: string[];
    platforms?: string[];
  };
  filePath: string;
  importedAt?: string;
  pluginName?: string;  // set when source === 'plugin'
}

// Domain classification keywords
const DOMAIN_KEYWORDS: Record<SkillDomain, string[]> = {
  security: ['security', 'auth', 'authentication', 'authorization', 'encryption', 'csrf', 'xss', 'owasp', 'vulnerability', 'penetration', 'firewall'],
  fullstack: ['fullstack', 'full-stack', 'end-to-end', 'senior-fullstack', 'next.js', 'react', 'node'],
  devops: ['devops', 'ci/cd', 'docker', 'kubernetes', 'deploy', 'infrastructure', 'pipeline', 'monitoring', 'terraform'],
  ux: ['ux', 'user experience', 'usability', 'accessibility', 'a11y', 'design system', 'figma', 'visual', 'ui design'],
  backend: ['backend', 'api', 'database', 'server', 'rest', 'graphql', 'microservice', 'redis', 'postgres', 'prisma'],
  frontend: ['frontend', 'react', 'vue', 'svelte', 'css', 'tailwind', 'component', 'responsive', 'browser'],
  data: ['data', 'analytics', 'machine learning', 'ml', 'ai', 'etl', 'pipeline', 'bigquery', 'pandas'],
  testing: ['test', 'tdd', 'bdd', 'unit test', 'integration test', 'e2e', 'cypress', 'playwright', 'jest', 'vitest'],
  architecture: ['architecture', 'design pattern', 'system design', 'scalability', 'microservices', 'monolith', 'ddd'],
  general: ['debug', 'git', 'documentation', 'refactor', 'code review', 'performance', 'optimization'],
};

/**
 * Classify a skill into a domain based on name + description keyword matching.
 */
export function classifyDomain(name: string, description: string): SkillDomain {
  const text = `${name} ${description}`.toLowerCase();
  let bestDomain: SkillDomain = 'general';
  let bestScore = 0;

  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS) as [SkillDomain, string[]][]) {
    const score = keywords.reduce((sum, kw) => sum + (text.includes(kw) ? 1 : 0), 0);
    if (score > bestScore) {
      bestScore = score;
      bestDomain = domain;
    }
  }

  return bestDomain;
}

/**
 * Determine source type from file path.
 * Uses forward-slash normalisation so Windows backslash paths match correctly.
 */
function resolveSource(filePath: string): 'packaged' | 'user' | 'antigravity' | 'external' {
  const normalised = filePath.split('\\').join('/');
  if (normalised.includes('dante-agents/skills')) return 'packaged';
  if (normalised.includes('.gemini/antigravity')) return 'antigravity';
  if (normalised.includes('.codex') || normalised.includes('.claude')) return 'user';
  return 'external';
}

/**
 * Extract compatibility requirements from skill content.
 */
function extractCompatibility(content: string): SkillRegistryEntry['compatibility'] {
  const tools: string[] = [];
  const frameworks: string[] = [];

  // Look for tool/framework mentions in content
  const toolPatterns = ['git', 'npm', 'docker', 'kubectl', 'terraform', 'gh', 'node'];
  const frameworkPatterns = ['react', 'next.js', 'vue', 'svelte', 'express', 'fastify', 'prisma', 'tailwind', 'stripe'];
  const lower = content.toLowerCase();

  for (const t of toolPatterns) {
    if (lower.includes(t)) tools.push(t);
  }
  for (const f of frameworkPatterns) {
    if (lower.includes(f)) frameworks.push(f);
  }

  return { requiredTools: tools, requiredFrameworks: frameworks };
}

export interface BuildRegistryOptions extends SkillDiscoveryOptions {
  includePlugins?: boolean;  // default: true
  _pluginDiscovery?: () => Promise<SkillRegistryEntry[]>;
  cwd?: string;
}

/**
 * Build a complete registry from all discovered skills, including plugin skills.
 */
export async function buildRegistry(options?: BuildRegistryOptions): Promise<SkillRegistryEntry[]> {
  const skills = await discoverSkills(options);
  const entries = skills.map(skillToEntry);

  if (options?.includePlugins !== false) {
    try {
      const pluginFn = options?._pluginDiscovery ?? (async () => {
        const { discoverPluginSkills } = await import('./plugin-registry.js');
        return discoverPluginSkills({ cwd: options?.cwd as string | undefined });
      });
      const pluginEntries = await pluginFn();
      // Deduplicate by filePath — plugin skills don't overwrite packaged skills,
      // and duplicate plugin entries (same filePath) are also deduplicated.
      const existingPaths = new Set(entries.map((e) => e.filePath));
      for (const pe of pluginEntries) {
        if (!existingPaths.has(pe.filePath)) {
          entries.push(pe);
          existingPaths.add(pe.filePath);
        }
      }
    } catch { /* plugin discovery failure never blocks main registry */ }
  }

  return entries;
}

function skillToEntry(skill: Skill): SkillRegistryEntry {
  return {
    name: skill.name,
    description: skill.description,
    source: resolveSource(skill.filePath),
    domain: classifyDomain(skill.name, skill.description),
    compatibility: extractCompatibility(skill.content),
    filePath: skill.filePath,
  };
}

/**
 * Check if current environment satisfies a skill's requirements.
 */
export async function checkCompatibility(
  entry: SkillRegistryEntry,
): Promise<{ compatible: boolean; missing: string[] }> {
  const missing: string[] = [];

  for (const tool of entry.compatibility.requiredTools) {
    try {
      const { execSync } = await import('child_process');
      execSync(`which ${tool} 2>/dev/null || where ${tool} 2>NUL`, { stdio: 'pipe' });
    } catch {
      missing.push(`tool:${tool}`);
    }
  }

  return { compatible: missing.length === 0, missing };
}

/**
 * Scan an external directory for SKILL.md files.
 */
export async function scanExternalSource(source: string): Promise<SkillRegistryEntry[]> {
  const entries: SkillRegistryEntry[] = [];

  try {
    const files = await findSkillFilesRecursive(source);
    for (const filePath of files) {
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = parseSkillFrontmatter(raw);
        entries.push({
          name: parsed.name,
          description: parsed.description,
          source: 'external',
          domain: classifyDomain(parsed.name, parsed.description),
          compatibility: extractCompatibility(raw),
          filePath,
        });
      } catch {
        logger.warn(`Skipping unreadable skill file: ${filePath}`);
      }
    }
  } catch {
    logger.warn(`External source not accessible: ${source}`);
  }

  return entries;
}

/**
 * Import an external skill into the user skills directory.
 */
export async function importExternalSkill(
  entry: SkillRegistryEntry,
  targetDir?: string,
): Promise<{ success: boolean; path?: string; error?: string }> {
  const target = targetDir ?? path.join(process.cwd(), '.danteforge', 'skills', entry.name);

  try {
    await fs.mkdir(target, { recursive: true });
    const content = await fs.readFile(entry.filePath, 'utf8');
    const destPath = path.join(target, 'SKILL.md');
    await fs.writeFile(destPath, content);
    logger.info(`Imported skill "${entry.name}" to ${destPath}`);
    return { success: true, path: destPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}

/**
 * Group registry entries by domain.
 */
export function groupByDomain(entries: SkillRegistryEntry[]): Record<SkillDomain, SkillRegistryEntry[]> {
  const grouped = {} as Record<SkillDomain, SkillRegistryEntry[]>;
  for (const entry of entries) {
    if (!grouped[entry.domain]) grouped[entry.domain] = [];
    grouped[entry.domain].push(entry);
  }
  return grouped;
}

// Helpers

async function findSkillFilesRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...await findSkillFilesRecursive(fullPath));
      } else if (entry.name === 'SKILL.md') {
        results.push(fullPath);
      }
    }
  } catch { /* directory not accessible */ }
  return results;
}

function parseSkillFrontmatter(raw: string): { name: string; description: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return { name: 'unknown', description: '' };

  const fm = match[1]!;
  let name = 'unknown';
  let description = '';

  for (const line of fm.split('\n')) {
    const nameMatch = line.match(/^name:\s*(.+)$/);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '');
    const descMatch = line.match(/^description:\s*(.+)$/);
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  return { name, description };
}
