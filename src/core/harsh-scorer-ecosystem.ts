import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'path';

import type { DanteState } from './state.js';

// ─── Ecosystem Check ───────────────────────────────────────────────────────────

export interface EcosystemCheckResult {
  hasPluginManifest: boolean;
  hasMcpTools: boolean;
  hasSkills: boolean;
  skillCount: number;
  mcpToolCount: number;
  integrationScore: number;
}

/**
 * Scan the project at `cwd` for ecosystem and integration signals:
 * - Plugin manifest presence
 * - MCP tools wired in the server file
 * - Skills under known candidate directories
 *
 * Returns an `EcosystemCheckResult` and a numeric `integrationScore` (0–100).
 */
export async function computeEcosystemCheck(cwd?: string): Promise<EcosystemCheckResult> {
  const dir = cwd ?? process.cwd();

  const hasPluginManifest = detectPluginManifestSync(dir);
  const skillCount = detectSkillCountSync(dir);
  const mcpToolCount = detectMcpToolCountSync(dir);

  const hasMcpTools = mcpToolCount > 0;
  const hasSkills = skillCount > 0;

  // Score mirrors computeEcosystemMcpScore logic, returning 0-100
  let score = 30;
  if (skillCount >= 10) score += 25;
  else if (skillCount >= 5) score += 15;
  else if (skillCount > 0) score += 8;

  if (mcpToolCount >= 15) score += 20;
  else if (mcpToolCount >= 5) score += 10;

  if (hasPluginManifest) score += 15;

  const integrationScore = Math.max(0, Math.min(100, score));

  return {
    hasPluginManifest,
    hasMcpTools,
    hasSkills,
    skillCount,
    mcpToolCount,
    integrationScore,
  };
}

/**
 * Map a numeric integration score (0–100) to a letter grade.
 */
export function getIntegrationGrade(score: number): 'A' | 'B' | 'C' | 'D' | 'F' {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}
import type { MaturityAssessment } from './maturity-engine.js';
import { scoreContextEconomySync } from './context-economy/runtime.js';
import type { EnterpriseEvidenceFlags } from './harsh-scorer.js';

const SKILL_DIR_CANDIDATES = [
  'src/harvested/dante-agents/skills',
  '.dantecode/skills',
  'Docs/skills',
  'skills',
];

export function computeContextEconomyScore(cwd: string): number {
  return scoreContextEconomySync(cwd).score;
}

export function detectSkillCountSync(cwd: string): number {
  let count = 0;
  for (const rel of SKILL_DIR_CANDIDATES) {
    const dir = path.join(cwd, rel);
    if (!existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (!e.isDirectory()) continue;
        if (existsSync(path.join(dir, e.name, 'SKILL.md'))) count++;
      }
    } catch { /* ignore */ }
  }

  const pkgsDir = path.join(cwd, 'packages');
  if (existsSync(pkgsDir)) {
    try {
      const entries = readdirSync(pkgsDir, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory() && existsSync(path.join(pkgsDir, e.name, 'SKILL.md'))) count += 1;
      }
    } catch { /* ignore */ }
  }

  return count;
}

export function detectPluginManifestSync(cwd: string): boolean {
  return existsSync(path.join(cwd, '.claude-plugin', 'plugin.json'));
}

export function detectMcpToolCountSync(cwd: string): number {
  const signalFile = path.join(cwd, '.danteforge', 'mcp-tool-count.txt');
  if (existsSync(signalFile)) {
    try {
      const n = parseInt(readFileSync(signalFile, 'utf-8').trim(), 10);
      if (Number.isFinite(n) && n >= 0) return n;
    } catch { /* fall through */ }
  }

  const candidates = [
    path.join(cwd, 'src', 'core', 'mcp-server.ts'),
    path.join(cwd, 'packages', 'mcp', 'src', 'server.ts'),
    path.join(cwd, 'packages', 'mcp-server', 'src', 'index.ts'),
    path.join(cwd, 'packages', 'mcp-server', 'src', 'mcp-server.ts'),
  ];
  for (const c of candidates) {
    if (!existsSync(c)) continue;
    try {
      const text = readFileSync(c, 'utf-8');
      const matches = text.match(/^\s+name:\s*['"][\w_-]+['"]/gm);
      if (matches) return matches.length;
      const regMatches = text.match(/registerTool\s*\(/g);
      if (regMatches && regMatches.length > 0) return regMatches.length;
    } catch { /* ignore */ }
  }
  return 0;
}

/**
 * Check if a fresh integration-health.json exists in .danteforge/ (written by
 * `danteforge integration-health` or the `danteforge_health` MCP tool).
 * A file written within the last 24 hours counts as an active ecosystem signal.
 */
export function detectActiveIntegrationHealthSync(cwd: string): boolean {
  const healthFile = path.join(cwd, '.danteforge', 'integration-health.json');
  if (!existsSync(healthFile)) return false;
  try {
    const { mtimeMs } = statSync(healthFile);
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    return Date.now() - mtimeMs < ONE_DAY_MS;
  } catch {
    return false;
  }
}

export function computeEcosystemMcpScore(state: DanteState, cwd: string): number {
  const s = state as unknown as Record<string, unknown>;
  let score = 30;
  const skillCount = typeof s['skillCount'] === 'number' ? s['skillCount'] : detectSkillCountSync(cwd);
  if (skillCount >= 10) score += 25;
  else if (skillCount >= 5) score += 15;
  else if (skillCount > 0) score += 8;

  const mcpToolCount = typeof s['mcpToolCount'] === 'number' ? s['mcpToolCount'] : detectMcpToolCountSync(cwd);
  if (mcpToolCount >= 15) score += 20;
  else if (mcpToolCount >= 5) score += 10;

  const hasPluginManifest = typeof s['hasPluginManifest'] === 'boolean' ? s['hasPluginManifest'] : detectPluginManifestSync(cwd);
  if (hasPluginManifest) score += 15;

  if ((typeof s['providerCount'] === 'number' ? s['providerCount'] : 5) >= 5) score += 10;

  // Active integration health signal: +5 if integration-health.json was written in the last 24h
  if (detectActiveIntegrationHealthSync(cwd)) score += 5;

  return Math.max(0, Math.min(100, score));
}

export function computeEnterpriseReadinessScore(
  state: DanteState,
  assessment: MaturityAssessment,
  enterpriseFlags?: EnterpriseEvidenceFlags,
): number {
  const s = state as unknown as Record<string, unknown>;
  let score = 15;
  const auditEntries = state.auditLog?.length ?? 0;
  if (auditEntries > 20) score += 20;
  else if (auditEntries > 5) score += 10;
  if (s['selfEditPolicy'] === 'deny' || s['selfEditPolicy'] === 'prompt') score += 15;
  if (assessment.dimensions.security >= 80) score += 20;
  else if (assessment.dimensions.security >= 70) score += 10;
  if (s['lastVerifyReceiptPath']) score += 15;
  if (enterpriseFlags?.hasSecurityPolicy) score += 10;
  if (enterpriseFlags?.hasVersionedChangelog) score += 5;
  if (enterpriseFlags?.hasRunbook) score += 5;
  if (enterpriseFlags?.hasContributing) score += 3;
  return Math.max(0, Math.min(100, score));
}
