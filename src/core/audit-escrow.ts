// audit-escrow.ts — non-blocking human spot-audit queue for the autonomous frontier loop.
//
// The frontier-review-court is automated, but it cannot distinguish a perfectly-prepared fixture
// from genuine frontier capability — that calibration is irreducibly human. To get it WITHOUT
// interrupting the loop, every court decision (a validated 9.0 or a court ceiling) is sampled into
// this queue with everything a reviewer needs to replay it. The orchestrator keeps running. A human
// reviews the queue whenever; a FAILED audit downgrades the dim and writes a lesson into the next
// cycle. This is what makes "no interruptions" honest rather than blind.

import fs from 'node:fs/promises';
import path from 'node:path';

const QUEUE_DIR_REL = path.join('.danteforge', 'human-audit-queue');

export interface AuditEscrowEntry {
  dimId: string;
  kind: 'validated-9.0' | 'ceiling';
  /** Everything needed to independently replay the evidence. */
  replayCommand: string;
  artifacts: string[];
  frontierSpecHash: string;
  receipts: Array<{ sessionId: string; passed: boolean; tier: string }>;
  councilVote: { pass: number; fail: number; summary: string };
  dissent: string[];
  enqueuedAt: string;
  status: 'pending' | 'confirmed' | 'failed';
  resolvedAt?: string;
  reviewer?: string;
  resolutionNote?: string;
}

function entryPath(cwd: string, dimId: string): string {
  return path.join(cwd, QUEUE_DIR_REL, `${dimId}.json`);
}

export async function enqueueAudit(
  cwd: string,
  entry: AuditEscrowEntry,
  _write: (p: string, c: string) => Promise<void> = async (p, c) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, c, 'utf8');
  },
): Promise<void> {
  await _write(entryPath(cwd, entry.dimId), JSON.stringify(entry, null, 2) + '\n');
}

export async function loadAuditQueue(
  cwd: string,
  _readdir: (p: string) => Promise<string[]> = (p) => fs.readdir(p),
  _read: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf8'),
): Promise<AuditEscrowEntry[]> {
  let entries: string[];
  try { entries = await _readdir(path.join(cwd, QUEUE_DIR_REL)); } catch { return []; }
  const out: AuditEscrowEntry[] = [];
  for (const e of entries) {
    if (!e.endsWith('.json')) continue;
    try { out.push(JSON.parse(await _read(path.join(cwd, QUEUE_DIR_REL, e))) as AuditEscrowEntry); } catch { /* skip */ }
  }
  return out;
}

export interface AuditResolution {
  outcome: 'confirmed' | 'failed';
  reviewer: string;
  note?: string;
  nowIso: string;
}

/**
 * Record a human verdict on a queued entry. Returns the updated entry (the CALLER is responsible
 * for any matrix downgrade on `failed` — this module only owns the queue). Throws if not queued.
 */
export async function resolveAudit(
  cwd: string,
  dimId: string,
  res: AuditResolution,
  io: { _read?: (p: string) => Promise<string>; _write?: (p: string, c: string) => Promise<void> } = {},
): Promise<AuditEscrowEntry> {
  const read = io._read ?? ((p: string) => fs.readFile(p, 'utf8'));
  const write = io._write ?? (async (p: string, c: string) => { await fs.writeFile(p, c, 'utf8'); });
  let entry: AuditEscrowEntry;
  try { entry = JSON.parse(await read(entryPath(cwd, dimId))) as AuditEscrowEntry; }
  catch { throw new Error(`No audit-queue entry for "${dimId}".`); }
  entry.status = res.outcome;
  entry.resolvedAt = res.nowIso;
  entry.reviewer = res.reviewer;
  entry.resolutionNote = res.note;
  await write(entryPath(cwd, dimId), JSON.stringify(entry, null, 2) + '\n');
  return entry;
}
