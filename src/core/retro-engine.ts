// Retro Engine — project retrospective with metrics, delta scoring, trend tracking.
// No PII — no author names or emails. Only commit hashes (truncated to 8 chars) and aggregate metrics.
import fs from 'fs/promises';
import path from 'path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface RetroMetrics {
  commitCount: number;
  locAdded: number;
  locRemoved: number;
  testCoveragePercent: number | null;
  lessonsAdded: number;
  wavesCompleted: number;
}

export interface RetroReport {
  timestamp: string;
  metrics: RetroMetrics;
  score: number;          // 0–100 composite
  delta: number | null;   // null if no prior retro
  praise: string[];       // 2–4 bullet points
  growthAreas: string[];  // 2–4 bullet points
  priorRetroPath: string | null;
}

// ── Main retro function ─────────────────────────────────────────────────────

export async function runRetro(cwd: string): Promise<RetroReport> {
  const metrics = await gatherMetrics(cwd);
  const score = computeRetroScore(metrics);

  const retroDir = path.join(cwd, '.danteforge', 'retros');
  const priorRetro = await loadPriorRetro(retroDir);
  const delta = priorRetro ? computeRetroDelta(score, priorRetro.score) : null;

  const praise = generatePraise(metrics);
  const growthAreas = generateGrowthAreas(metrics);

  return {
    timestamp: new Date().toISOString(),
    metrics,
    score,
    delta,
    praise,
    growthAreas,
    priorRetroPath: priorRetro ? path.join(retroDir, 'latest.json') : null,
  };
}

// ── Git metrics gathering (no PII) ──────────────────────────────────────────

async function gatherMetrics(cwd: string): Promise<RetroMetrics> {
  let commitCount = 0;
  let locAdded = 0;
  let locRemoved = 0;

  try {
    // Count commits (no author info)
    const { stdout: logOut } = await execFileAsync('git', ['log', '--oneline', '--format=%h'], { cwd });
    commitCount = logOut.trim().split('\n').filter(l => l.trim()).length;
  } catch {
    // Not a git repo or no commits
  }

  try {
    // Get diff stats (no author info, just line counts)
    // For young repos with < 10 commits, diff from first commit instead
    let diffRange = 'HEAD~10..HEAD';
    if (commitCount > 0 && commitCount < 10) {
      try {
        const { stdout: rootOut } = await execFileAsync('git', ['rev-list', '--max-parents=0', 'HEAD'], { cwd });
        const rootCommit = rootOut.trim().split('\n')[0];
        if (rootCommit) diffRange = `${rootCommit}..HEAD`;
      } catch { /* fall through to HEAD~10 */ }
    }
    const { stdout: diffOut } = await execFileAsync('git', ['diff', '--numstat', diffRange], { cwd });
    for (const line of diffOut.split('\n')) {
      const match = line.match(/^(\d+)\s+(\d+)/);
      if (match) {
        locAdded += parseInt(match[1], 10);
        locRemoved += parseInt(match[2], 10);
      }
    }
  } catch {
    // No commits or other git error
  }

  // Check for lessons
  let lessonsAdded = 0;
  try {
    const lessonsPath = path.join(cwd, '.danteforge', 'lessons.md');
    const content = await fs.readFile(lessonsPath, 'utf8');
    lessonsAdded = (content.match(/^##\s/gm) ?? []).length;
  } catch {
    // No lessons file
  }

  // Check waves completed from state
  let wavesCompleted = 0;
  try {
    const statePath = path.join(cwd, '.danteforge', 'STATE.yaml');
    const stateContent = await fs.readFile(statePath, 'utf8');
    const waveMatches = stateContent.match(/forge: wave/g);
    wavesCompleted = waveMatches?.length ?? 0;
  } catch {
    // No state file
  }

  // Try to read test coverage from c8/nyc/istanbul coverage-summary.json
  let testCoveragePercent: number | null = null;
  try {
    const coveragePath = path.join(cwd, 'coverage', 'coverage-summary.json');
    const coverageContent = await fs.readFile(coveragePath, 'utf8');
    const summary = JSON.parse(coverageContent) as Record<string, { lines?: { pct?: number } }>;
    if (summary.total?.lines?.pct !== undefined) {
      testCoveragePercent = Math.round(summary.total.lines.pct);
    }
  } catch {
    // No coverage report available
  }

  return {
    commitCount,
    locAdded,
    locRemoved,
    testCoveragePercent,
    lessonsAdded,
    wavesCompleted,
  };
}

// ── Score computation ───────────────────────────────────────────────────────

export function computeRetroScore(metrics: RetroMetrics): number {
  let score = 0;

  // Commit activity (0–30)
  if (metrics.commitCount >= 20) score += 30;
  else if (metrics.commitCount >= 10) score += 20;
  else if (metrics.commitCount >= 5) score += 10;
  else if (metrics.commitCount > 0) score += 5;

  // Code volume (0–25)
  const netLoc = metrics.locAdded - metrics.locRemoved;
  if (netLoc > 500) score += 25;
  else if (netLoc > 200) score += 20;
  else if (netLoc > 50) score += 15;
  else if (netLoc > 0) score += 10;

  // Test coverage (0–20)
  if (metrics.testCoveragePercent !== null) {
    if (metrics.testCoveragePercent >= 80) score += 20;
    else if (metrics.testCoveragePercent >= 60) score += 15;
    else if (metrics.testCoveragePercent >= 40) score += 10;
    else score += 5;
  }

  // Lessons captured (0–15)
  if (metrics.lessonsAdded >= 5) score += 15;
  else if (metrics.lessonsAdded >= 3) score += 10;
  else if (metrics.lessonsAdded >= 1) score += 5;

  // Waves completed (0–10)
  if (metrics.wavesCompleted >= 3) score += 10;
  else if (metrics.wavesCompleted >= 1) score += 5;

  return Math.min(100, score);
}

// ── Delta computation ───────────────────────────────────────────────────────

export function computeRetroDelta(currentScore: number, priorScore: number): number {
  return currentScore - priorScore;
}

// ── Prior retro loading ─────────────────────────────────────────────────────

export async function loadPriorRetro(retroDir: string): Promise<RetroReport | null> {
  try {
    const entries = await fs.readdir(retroDir);
    const jsonFiles = entries
      .filter(e => e.startsWith('retro-') && e.endsWith('.json'))
      .sort()
      .reverse();

    if (jsonFiles.length === 0) return null;

    const content = await fs.readFile(path.join(retroDir, jsonFiles[0]), 'utf8');
    return JSON.parse(content) as RetroReport;
  } catch {
    return null;
  }
}

// ── File writing ────────────────────────────────────────────────────────────

export async function writeRetroFiles(
  report: RetroReport,
  retroDir: string,
): Promise<{ jsonPath: string; mdPath: string }> {
  await fs.mkdir(retroDir, { recursive: true });

  const timestamp = report.timestamp.replace(/[:.]/g, '-');
  const jsonPath = path.join(retroDir, `retro-${timestamp}.json`);
  const mdPath = path.join(retroDir, `retro-${timestamp}.md`);

  await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));
  await fs.writeFile(mdPath, formatRetroMarkdown(report));

  return { jsonPath, mdPath };
}

// ── Markdown formatting ─────────────────────────────────────────────────────

function formatRetroMarkdown(report: RetroReport): string {
  const lines: string[] = [
    '# Project Retrospective',
    '',
    `**Date:** ${report.timestamp}`,
    `**Score:** ${report.score}/100`,
  ];

  if (report.delta !== null) {
    const arrow = report.delta > 0 ? '↑' : report.delta < 0 ? '↓' : '→';
    lines.push(`**Delta:** ${arrow} ${report.delta > 0 ? '+' : ''}${report.delta} from prior retro`);
  }

  lines.push('');
  lines.push('## Metrics');
  lines.push(`- Commits: ${report.metrics.commitCount}`);
  lines.push(`- Lines added: ${report.metrics.locAdded}`);
  lines.push(`- Lines removed: ${report.metrics.locRemoved}`);
  lines.push(`- Lessons captured: ${report.metrics.lessonsAdded}`);
  lines.push(`- Waves completed: ${report.metrics.wavesCompleted}`);
  if (report.metrics.testCoveragePercent !== null) {
    lines.push(`- Test coverage: ${report.metrics.testCoveragePercent}%`);
  }

  lines.push('');
  lines.push('## Praise');
  for (const item of report.praise) {
    lines.push(`- ${item}`);
  }

  lines.push('');
  lines.push('## Growth Areas');
  for (const item of report.growthAreas) {
    lines.push(`- ${item}`);
  }

  return lines.join('\n');
}

// ── Praise / growth area generation ─────────────────────────────────────────

function generatePraise(metrics: RetroMetrics): string[] {
  const praise: string[] = [];
  if (metrics.commitCount >= 10) praise.push('Strong commit cadence — consistent development activity');
  if (metrics.locAdded > 200) praise.push('Significant new code written');
  if (metrics.lessonsAdded >= 3) praise.push('Multiple lessons captured — continuous learning');
  if (metrics.wavesCompleted >= 2) praise.push('Multiple forge waves completed — good execution momentum');
  if (metrics.testCoveragePercent !== null && metrics.testCoveragePercent >= 80) {
    praise.push('Test coverage above 80% — strong quality discipline');
  }
  if (praise.length === 0) praise.push('Project in early stages — foundation being laid');
  return praise.slice(0, 4);
}

function generateGrowthAreas(metrics: RetroMetrics): string[] {
  const areas: string[] = [];
  if (metrics.commitCount < 5) areas.push('Increase commit frequency — smaller, more frequent commits improve bisectability');
  if (metrics.lessonsAdded === 0) areas.push('Capture lessons from mistakes and corrections');
  if (metrics.testCoveragePercent !== null && metrics.testCoveragePercent < 60) {
    areas.push('Improve test coverage — target 80%+');
  }
  if (metrics.locRemoved === 0 && metrics.locAdded > 100) {
    areas.push('Consider refactoring — only adding code without removal may indicate growing tech debt');
  }
  if (areas.length === 0) areas.push('Maintain current momentum and quality standards');
  return areas.slice(0, 4);
}
