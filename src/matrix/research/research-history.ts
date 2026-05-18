// Matrix Research — read-only research history.
//
// Phase Q of docs/PRDs/autonomous-frontier-reaching.md.
//
// Pure-read functions over `.danteforge/research/<wave-id>/`. Safe-empty:
// returns sensible defaults when no waves have ever run. The substrate calls
// these on every research wave's first action to ensure compound learning
// (PRD section 8: "First action of every research wave: read prior research").

import fs from 'node:fs/promises';
import path from 'node:path';
import type { FailedHypothesis, ResearchWaveOutcome } from './types.js';

const RESEARCH_DIR = path.join('.danteforge', 'research');

// ── Wave summary (what one prior wave produced) ─────────────────────────────

export interface PriorResearchSummary {
  waveId: string;
  dimensionId: string;
  startedAt: string;
  outcome: ResearchWaveOutcome;
  /** Path on disk to wave's root for forensic access. */
  rootPath: string;
  /** Reason from synthesis recommendation (cap reason, conflict description, promotion target). */
  reason?: string;
}

// ── Project-wide summary ────────────────────────────────────────────────────

export interface ResearchProjectSummary {
  totalWaves: number;
  byOutcome: Record<NonNullable<ResearchWaveOutcome>, number>;
  capDims: Array<{ dimensionId: string; reason: string }>;
  pendingConflicts: string[];
  inProgress: string[];
}

// ── Internal helpers ────────────────────────────────────────────────────────

async function readJsonSafe<T>(p: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

async function listWaveDirs(cwd: string): Promise<string[]> {
  const dir = path.join(cwd, RESEARCH_DIR);
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter(e => e.isDirectory()).map(e => e.name);
  } catch {
    return [];
  }
}

interface RawManifest {
  waveId?: string;
  dimensionId?: string;
  startedAt?: string;
  outcome?: ResearchWaveOutcome;
  reason?: string;
}

async function readWave(cwd: string, waveId: string): Promise<PriorResearchSummary | null> {
  const rootPath = path.join(cwd, RESEARCH_DIR, waveId);
  // Try manifest.json first (canonical), then synthesis-recommendation.md as a fallback.
  const manifest = await readJsonSafe<RawManifest>(path.join(rootPath, 'manifest.json'));
  if (manifest) {
    return {
      waveId: manifest.waveId ?? waveId,
      dimensionId: manifest.dimensionId ?? '',
      startedAt: manifest.startedAt ?? '',
      outcome: manifest.outcome ?? null,
      rootPath,
      ...(manifest.reason ? { reason: manifest.reason } : {}),
    };
  }
  // No manifest yet — wave hasn't completed or never wrote one. Skip silently.
  return null;
}

// ── Public read API ─────────────────────────────────────────────────────────

/**
 * Returns every prior research wave for the given dim, in chronological order.
 * Safe-empty when `.danteforge/research/` does not exist or no waves match.
 */
export async function getPriorResearch(
  cwd: string,
  dimensionId: string,
): Promise<PriorResearchSummary[]> {
  const waveIds = await listWaveDirs(cwd);
  const waves: PriorResearchSummary[] = [];
  for (const id of waveIds) {
    const summary = await readWave(cwd, id);
    if (summary && summary.dimensionId === dimensionId) waves.push(summary);
  }
  waves.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  return waves;
}

/**
 * Returns every dim currently marked architecturally capped (via wave outcome).
 * Pulls cap reasons from synthesis recommendations.
 */
export async function getStructuralCaps(cwd: string): Promise<Array<{ dimensionId: string; reason: string }>> {
  const waveIds = await listWaveDirs(cwd);
  const capsByDim = new Map<string, string>();
  for (const id of waveIds) {
    const summary = await readWave(cwd, id);
    if (!summary) continue;
    if (summary.outcome === 'cap' && summary.reason) {
      // Latest cap wins.
      capsByDim.set(summary.dimensionId, summary.reason);
    }
  }
  return Array.from(capsByDim.entries()).map(([dimensionId, reason]) => ({ dimensionId, reason }));
}

/**
 * Failed-hypothesis tracking. PRD section 8.3: if a hypothesis has been tried
 * 2+ times and failed, the substrate refuses to spawn it again.
 *
 * For now this reads `failed-hypotheses.json` per wave when present. The Phase
 * O agent execution will write to it; until Phase O ships this returns empty.
 */
export async function getFailedHypotheses(
  cwd: string,
  dimensionId: string,
): Promise<FailedHypothesis[]> {
  const waves = await getPriorResearch(cwd, dimensionId);
  const collected: FailedHypothesis[] = [];
  for (const wave of waves) {
    const list = await readJsonSafe<FailedHypothesis[]>(
      path.join(wave.rootPath, 'failed-hypotheses.json'),
    );
    if (Array.isArray(list)) collected.push(...list);
  }
  return collected;
}

/**
 * Phase Q.4 (PRD section 8.4): append a research lesson to `.danteforge/lessons.md`.
 * Tagged with `[Research]` so future agents can filter feed-forward.
 *
 * Idempotent within a wave: re-appending the same lesson is OK (lessons.md is
 * an audit log, not a deduplicated store). Operator review tooling can dedup
 * if needed.
 */
export async function appendResearchLesson(
  cwd: string,
  waveId: string,
  dimensionId: string,
  outcome: ResearchWaveOutcome,
  lesson: string,
): Promise<void> {
  const ts = new Date().toISOString();
  const entry = `\n## [Research] ${ts} — ${dimensionId} — wave ${waveId} (${outcome ?? 'unknown'})\n\n${lesson.trim()}\n`;
  const lessonsPath = path.join(cwd, '.danteforge', 'lessons.md');
  try {
    await fs.mkdir(path.dirname(lessonsPath), { recursive: true });
    // Append; create the file if it doesn't exist.
    await fs.appendFile(lessonsPath, entry, 'utf8');
  } catch {
    // best-effort; lessons append never blocks the wave
  }
}

/**
 * Phase Q.2 (PRD section 8.2): produce a feed-forward summary for the NEXT
 * wave on this dim. The wave's coordinator includes this in the shared
 * context so every agent sees what's been tried.
 *
 * Returns a markdown string ready to write to `shared/prior-research-summary.md`.
 * Safe-empty: returns an "(no prior research)" stub when no waves exist.
 */
export async function buildPriorResearchSummary(
  cwd: string,
  dimensionId: string,
): Promise<string> {
  const waves = await getPriorResearch(cwd, dimensionId);
  if (waves.length === 0) {
    return `# Prior research on ${dimensionId}\n\n(no prior research waves)\n`;
  }
  const lines: string[] = [
    `# Prior research on ${dimensionId}`,
    '',
    `${waves.length} prior wave(s):`,
    '',
  ];
  for (const w of waves) {
    lines.push(`## Wave ${w.waveId} — ${w.startedAt} — outcome: ${w.outcome ?? 'unknown'}`);
    if (w.reason) lines.push('', w.reason);
    lines.push('');
  }
  const failedHypotheses = await getFailedHypotheses(cwd, dimensionId);
  if (failedHypotheses.length > 0) {
    lines.push('## Failed hypotheses (DO NOT re-attempt without operator override)');
    lines.push('');
    for (const fh of failedHypotheses) {
      lines.push(`- **${fh.description}** (wave ${fh.waveId}, ${fh.failedAt}): ${fh.failureReason}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * Project-wide research summary. Aggregates wave counts and current state.
 */
export async function getResearchSummary(cwd: string): Promise<ResearchProjectSummary> {
  const waveIds = await listWaveDirs(cwd);
  const summary: ResearchProjectSummary = {
    totalWaves: 0,
    byOutcome: { promote: 0, conflict: 0, cap: 0, 'in-progress': 0 },
    capDims: [],
    pendingConflicts: [],
    inProgress: [],
  };
  for (const id of waveIds) {
    const w = await readWave(cwd, id);
    if (!w) continue;
    summary.totalWaves++;
    if (w.outcome && w.outcome !== null) {
      summary.byOutcome[w.outcome] = (summary.byOutcome[w.outcome] ?? 0) + 1;
    }
    if (w.outcome === 'cap' && w.reason) {
      summary.capDims.push({ dimensionId: w.dimensionId, reason: w.reason });
    }
    if (w.outcome === 'conflict') summary.pendingConflicts.push(w.dimensionId);
    if (w.outcome === 'in-progress') summary.inProgress.push(w.dimensionId);
  }
  return summary;
}
