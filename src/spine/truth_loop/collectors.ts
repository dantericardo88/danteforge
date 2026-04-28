/**
 * Repo / test / artifact collectors for the truth loop.
 * Keep IO behind injection seams so tests can substitute fakes.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { Artifact } from './types.js';
import { newArtifactId, sha256 } from './ids.js';

const execFileAsync = promisify(execFile);

export interface ExecFn {
  (cmd: string, args: string[], opts: { cwd: string }): Promise<{ stdout: string; stderr: string }>;
}

const defaultExec: ExecFn = async (cmd, args, opts) => {
  const { stdout, stderr } = await execFileAsync(cmd, args, { cwd: opts.cwd, encoding: 'utf-8' });
  return { stdout, stderr };
};

export interface CollectorOptions {
  repo: string;
  runId: string;
  exec?: ExecFn;
  testCommand?: { cmd: string; args: string[] };
  /** Suppress test execution; useful in pilots where running the suite is overkill. */
  skipTests?: boolean;
}

export interface RepoSnapshot {
  branch: string;
  commit: string;
  dirtyFiles: number;
  fileCount: number;
}

export async function collectRepoState(opts: CollectorOptions): Promise<{ artifact: Artifact; snapshot: RepoSnapshot }> {
  const exec = opts.exec ?? defaultExec;
  const branch = (await safeExec(exec, 'git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts.repo)).stdout.trim() || 'unknown';
  const commit = (await safeExec(exec, 'git', ['rev-parse', 'HEAD'], opts.repo)).stdout.trim() || '0000000';
  const status = (await safeExec(exec, 'git', ['status', '--porcelain'], opts.repo)).stdout;
  const dirtyFiles = status.split('\n').filter(line => line.trim().length > 0).length;
  const fileCount = countFiles(opts.repo);

  const snapshot: RepoSnapshot = { branch, commit, dirtyFiles, fileCount };
  const body = JSON.stringify(snapshot);

  const artifact: Artifact = {
    artifactId: newArtifactId(),
    runId: opts.runId,
    type: 'repo_snapshot',
    source: 'repo',
    createdAt: new Date().toISOString(),
    uri: `inline://repo_snapshot/${opts.runId}`,
    hash: sha256(body),
    label: `repo_snapshot:${branch}@${commit.slice(0, 7)}`
  };
  return { artifact, snapshot };
}

export interface TestSummary {
  attempted: boolean;
  passed: number;
  failed: number;
  total: number;
  raw: string;
}

export async function collectTestState(opts: CollectorOptions): Promise<{ artifact: Artifact; summary: TestSummary }> {
  if (opts.skipTests) {
    const summary: TestSummary = { attempted: false, passed: 0, failed: 0, total: 0, raw: 'tests skipped by collector' };
    return { artifact: testArtifact(opts.runId, summary), summary };
  }
  const exec = opts.exec ?? defaultExec;
  const cmd = opts.testCommand ?? { cmd: 'npm', args: ['run', 'test', '--silent'] };
  const result = await safeExec(exec, cmd.cmd, cmd.args, opts.repo);
  const raw = `${result.stdout}\n${result.stderr}`;
  const summary = parseTestOutput(raw);
  return { artifact: testArtifact(opts.runId, summary), summary };
}

function testArtifact(runId: string, summary: TestSummary): Artifact {
  const body = JSON.stringify({ ...summary, raw: summary.raw.slice(0, 4096) });
  return {
    artifactId: newArtifactId(),
    runId,
    type: 'test_result',
    source: 'tests',
    createdAt: new Date().toISOString(),
    uri: `inline://test_result/${runId}`,
    hash: sha256(body),
    label: `tests:${summary.passed}/${summary.total}`
  };
}

export function parseTestOutput(raw: string): TestSummary {
  let passed = 0;
  let failed = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (/^(?:ok|pass)\b/i.test(trimmed)) passed++;
    else if (/^(?:not ok|fail)\b/i.test(trimmed)) failed++;
  }
  const totalMatch = /tests\s+(\d+)/i.exec(raw);
  const total = totalMatch ? Number.parseInt(totalMatch[1] ?? '0', 10) : passed + failed;
  return {
    attempted: true,
    passed,
    failed,
    total,
    raw
  };
}

export interface PriorArtifactsSummary {
  hasState: boolean;
  hasConstitution: boolean;
  priorRunCount: number;
  scoreHistoryLines: number;
}

export function collectPriorArtifacts(repo: string, runId: string): { artifact: Artifact; summary: PriorArtifactsSummary } {
  const dfg = resolve(repo, '.danteforge');
  const summary: PriorArtifactsSummary = {
    hasState: existsSync(resolve(dfg, 'STATE.yaml')),
    hasConstitution: existsSync(resolve(dfg, 'CONSTITUTION.md')),
    priorRunCount: countPriorRuns(dfg),
    scoreHistoryLines: countScoreHistory(dfg)
  };
  const body = JSON.stringify(summary);
  const artifact: Artifact = {
    artifactId: newArtifactId(),
    runId,
    type: 'static_analysis',
    source: 'repo',
    createdAt: new Date().toISOString(),
    uri: `inline://prior_artifacts/${runId}`,
    hash: sha256(body),
    label: `prior:${summary.priorRunCount}-runs`
  };
  return { artifact, summary };
}

function countPriorRuns(dfg: string): number {
  const truth = resolve(dfg, 'truth-loop');
  if (!existsSync(truth)) return 0;
  return readdirSync(truth).filter(name => name.startsWith('run_') && statSync(resolve(truth, name)).isDirectory()).length;
}

function countScoreHistory(dfg: string): number {
  const path = resolve(dfg, 'assessment-history.json');
  if (!existsSync(path)) return 0;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

function countFiles(dir: string, depth = 0): number {
  if (depth > 6) return 0;
  if (!existsSync(dir)) return 0;
  let count = 0;
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
    const full = resolve(dir, entry);
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) count += countFiles(full, depth + 1);
    else count++;
  }
  return count;
}

async function safeExec(exec: ExecFn, cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string }> {
  try {
    return await exec(cmd, args, { cwd });
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? e.message ?? '' };
  }
}
