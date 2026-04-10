// Project Registry — cross-project PDSE benchmarking via ~/.danteforge/projects.json
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import type { ScoredArtifact } from './pdse-config.js';

export interface ProjectRegistryEntry {
  name: string;
  path: string;
  lastSnapshot: string;
  avgScore: number;
  artifactScores: Partial<Record<ScoredArtifact, number>>;
  topArtifact: ScoredArtifact | null;
  bottomArtifact: ScoredArtifact | null;
  registeredAt: string;
}

export interface ProjectsManifest {
  projects: ProjectRegistryEntry[];
  lastUpdated: string;
}

export interface ProjectRegistryOptions {
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, c: string) => Promise<void>;
  _mkdir?: (p: string, opts?: { recursive?: boolean }) => Promise<void>;
  homeDir?: string;
  _now?: () => string;
}

export function defaultProjectsManifestPath(homeDir?: string): string {
  return path.join(homeDir ?? os.homedir(), '.danteforge', 'projects.json');
}

export async function loadProjectsManifest(
  opts?: ProjectRegistryOptions,
): Promise<ProjectsManifest> {
  const readFile = opts?._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  try {
    const raw = await readFile(defaultProjectsManifestPath(opts?.homeDir));
    const parsed = JSON.parse(raw) as Partial<ProjectsManifest>;
    return {
      projects: parsed.projects ?? [],
      lastUpdated: parsed.lastUpdated ?? '',
    };
  } catch {
    return { projects: [], lastUpdated: '' };
  }
}

export async function saveProjectsManifest(
  manifest: ProjectsManifest,
  opts?: ProjectRegistryOptions,
): Promise<void> {
  const writeFile = opts?._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const mkdir = opts?._mkdir ?? ((p: string, o?: { recursive?: boolean }) => fs.mkdir(p, o).then(() => {}).catch(() => {}));
  const filePath = defaultProjectsManifestPath(opts?.homeDir);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(manifest, null, 2));
}

export async function registerProject(
  projectPath: string,
  snapshot: { avgScore: number; scores: Record<string, { score: number }> },
  opts?: ProjectRegistryOptions,
): Promise<ProjectRegistryEntry> {
  const now = opts?._now ?? (() => new Date().toISOString());
  try {
    const manifest = await loadProjectsManifest(opts);

    const artifactScores: Partial<Record<ScoredArtifact, number>> = {};
    for (const [k, v] of Object.entries(snapshot.scores)) {
      artifactScores[k as ScoredArtifact] = v.score;
    }

    // Derive top/bottom artifact
    const entries = Object.entries(artifactScores) as [ScoredArtifact, number][];
    let topArtifact: ScoredArtifact | null = null;
    let bottomArtifact: ScoredArtifact | null = null;
    if (entries.length > 0) {
      entries.sort((a, b) => b[1] - a[1]);
      topArtifact = entries[0][0];
      bottomArtifact = entries[entries.length - 1][0];
    }

    const existing = manifest.projects.findIndex((p) => p.path === projectPath);
    const entry: ProjectRegistryEntry = {
      name: path.basename(projectPath),
      path: projectPath,
      lastSnapshot: now(),
      avgScore: snapshot.avgScore,
      artifactScores,
      topArtifact,
      bottomArtifact,
      registeredAt: existing >= 0 ? manifest.projects[existing].registeredAt : now(),
    };

    if (existing >= 0) {
      manifest.projects[existing] = entry;
    } else {
      manifest.projects.push(entry);
    }
    manifest.lastUpdated = now();

    await saveProjectsManifest(manifest, opts);
    return entry;
  } catch {
    // Best-effort — never throws
    const fallback: ProjectRegistryEntry = {
      name: path.basename(projectPath),
      path: projectPath,
      lastSnapshot: new Date().toISOString(),
      avgScore: snapshot.avgScore,
      artifactScores: {},
      topArtifact: null,
      bottomArtifact: null,
      registeredAt: new Date().toISOString(),
    };
    return fallback;
  }
}

export function formatBenchmarkTable(entries: ProjectRegistryEntry[]): string {
  if (entries.length === 0) {
    return 'No projects registered. Run: danteforge benchmark --register';
  }

  const sorted = [...entries].sort((a, b) => b.avgScore - a.avgScore);
  const lines: string[] = [
    '| # | Project | AvgScore | Top Artifact | Bottom Artifact | Last Run |',
    '|---|---------|----------|--------------|-----------------|----------|',
  ];

  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    lines.push(
      `| ${i + 1} | ${e.name} | ${e.avgScore} | ${e.topArtifact ?? 'N/A'} | ${e.bottomArtifact ?? 'N/A'} | ${e.lastSnapshot.slice(0, 10)} |`,
    );
  }

  return lines.join('\n');
}

export function buildBenchmarkReport(
  entries: ProjectRegistryEntry[],
  generatedAt: string,
): string {
  const sections: string[] = [
    '# DanteForge Benchmark Report',
    '',
    `Generated: ${generatedAt}`,
    `Projects tracked: ${entries.length}`,
    '',
    '## Leaderboard',
    '',
    formatBenchmarkTable(entries),
    '',
  ];

  const sorted = [...entries].sort((a, b) => b.avgScore - a.avgScore);
  if (sorted.length > 0) {
    sections.push('## Per-Project Details');
    sections.push('');
    for (const e of sorted) {
      sections.push(`### ${e.name}`);
      sections.push(`- **Path:** ${e.path}`);
      sections.push(`- **PDSE Score:** ${e.avgScore}/100`);
      sections.push(`- **Top artifact:** ${e.topArtifact ?? 'N/A'}`);
      sections.push(`- **Bottom artifact:** ${e.bottomArtifact ?? 'N/A'}`);
      sections.push(`- **Last run:** ${e.lastSnapshot}`);
      sections.push(`- **Registered:** ${e.registeredAt}`);
      sections.push('');
    }
  }

  return sections.join('\n');
}
