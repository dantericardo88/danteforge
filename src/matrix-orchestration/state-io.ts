// Matrix Orchestration — state I/O helpers
//
// Mirrors src/matrix/engines/matrix-state.ts. Centralizes JSON read/write
// under .danteforge/matrix-orchestration/ so every module hits the same
// canonical paths and append-only audit log.

import fs from 'node:fs/promises';
import path from 'node:path';
import { ORCH_DIR, ORCH_REPORT_PATHS } from './types.js';
import type { AuditEvent, OrchReportName, RunState } from './types.js';

/** Load a canonical orchestration artifact. Returns null when absent. */
export async function loadOrch<T>(
  cwd: string,
  reportName: OrchReportName,
): Promise<T | null> {
  const filePath = path.join(cwd, ORCH_REPORT_PATHS[reportName]);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Save a canonical orchestration artifact. Creates the dir if missing. */
export async function saveOrch<T>(
  cwd: string,
  reportName: OrchReportName,
  data: T,
): Promise<string> {
  const filePath = path.join(cwd, ORCH_REPORT_PATHS[reportName]);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  // For markdown reports we accept either a string body or stringify JSON.
  if (filePath.endsWith('.md') && typeof data === 'string') {
    await fs.writeFile(filePath, data, 'utf8');
  } else if (filePath.endsWith('.jsonl')) {
    // jsonl is append-only via appendAudit, but allow overwrite for testing.
    const body = Array.isArray(data)
      ? (data as unknown[]).map(d => JSON.stringify(d)).join('\n') + '\n'
      : JSON.stringify(data) + '\n';
    await fs.writeFile(filePath, body, 'utf8');
  } else {
    await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
  }
  return filePath;
}

/** Patch top-level fields of an existing artifact. Creates if missing. */
export async function patchOrch<T extends Record<string, unknown>>(
  cwd: string,
  reportName: OrchReportName,
  patch: Partial<T>,
): Promise<void> {
  const existing = (await loadOrch<Record<string, unknown>>(cwd, reportName)) ?? {};
  for (const [k, v] of Object.entries(patch)) existing[k] = v as unknown;
  existing.generatedAt = new Date().toISOString();
  await saveOrch(cwd, reportName, existing);
}

/** Ensure the orchestration scaffolding directory exists. */
export async function ensureOrchDir(cwd: string): Promise<string> {
  const dir = path.join(cwd, ORCH_DIR);
  await fs.mkdir(dir, { recursive: true });
  await fs.mkdir(path.join(dir, 'social-cache'), { recursive: true });
  return dir;
}

/** Append a single event to the audit log (jsonl, append-only). */
export async function appendAudit(cwd: string, event: AuditEvent): Promise<void> {
  await ensureOrchDir(cwd);
  const filePath = path.join(cwd, ORCH_REPORT_PATHS.auditLog);
  const line = JSON.stringify(event) + '\n';
  await fs.appendFile(filePath, line, 'utf8');
}

/** Load + patch the orchestrator run state in one shot. */
export async function patchRunState(
  cwd: string,
  patch: Partial<RunState>,
): Promise<RunState> {
  const existing = await loadOrch<RunState>(cwd, 'runState');
  if (!existing) {
    throw new Error('run state not initialized — call initRunState first');
  }
  const next: RunState = { ...existing, ...patch, updatedAt: new Date().toISOString() };
  if (patch.stage && !existing.completedStages.includes(patch.stage)) {
    // Track completion when stage transitions are observed.
    if (patch.stage === 'completed') next.completedStages = [...existing.completedStages, patch.stage];
  }
  await saveOrch(cwd, 'runState', next);
  return next;
}

/** Initialize a fresh run state. Overwrites any prior partial run. */
export async function initRunState(
  cwd: string,
  init: Pick<RunState, 'runId' | 'prdPath' | 'target' | 'overrides'>,
): Promise<RunState> {
  const now = new Date().toISOString();
  const state: RunState = {
    runId: init.runId,
    startedAt: now,
    updatedAt: now,
    prdPath: init.prdPath,
    target: init.target,
    stage: 'not_started',
    completedStages: [],
    costSpentUsd: 0,
    overrides: init.overrides,
  };
  await ensureOrchDir(cwd);
  await saveOrch(cwd, 'runState', state);
  return state;
}

/** Read the entire audit log; returns [] when missing. */
export async function readAuditLog(cwd: string): Promise<AuditEvent[]> {
  const filePath = path.join(cwd, ORCH_REPORT_PATHS.auditLog);
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return raw
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as AuditEvent);
  } catch {
    return [];
  }
}

/** Mark a completed stage on the run state and audit it. */
export async function markStageCompleted(
  cwd: string,
  runId: string,
  stage: RunState['stage'],
): Promise<RunState> {
  const existing = await loadOrch<RunState>(cwd, 'runState');
  if (!existing) throw new Error('run state not initialized');
  const completed = existing.completedStages.includes(stage)
    ? existing.completedStages
    : [...existing.completedStages, stage];
  const next: RunState = {
    ...existing,
    completedStages: completed,
    updatedAt: new Date().toISOString(),
  };
  await saveOrch(cwd, 'runState', next);
  await appendAudit(cwd, {
    ts: next.updatedAt,
    runId,
    kind: 'stage_completed',
    stage,
  });
  return next;
}
