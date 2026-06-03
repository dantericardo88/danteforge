// evidence-novelty.ts — anti-manufacture ledger for the autonomous frontier loop.
//
// The orchestrator pushes each dim toward 9.0 in attempts. Without a novelty rule an agent
// (or a stuck loop) could re-submit the SAME evidence — same command, same artifact, same code
// SHA — over and over, and a flaky court might eventually pass it. That is manufactured
// progress. This ledger records a fingerprint per attempt and refuses to count a repeat: a
// genuine retry MUST change something real (the code → a new git SHA, or the evidence design →
// a new command/artifact). An identical re-run cannot create new progress.
//
// NOTE: this gates ORCHESTRATOR RETRIES, not session-record's two-session protocol. The two
// validate sessions of a single attempt legitimately run the same command twice (different
// session_ids); that is one attempt with one fingerprint, recorded once when the attempt resolves.

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const LEDGER_REL = path.join('.danteforge', 'evidence-novelty.json');

export interface AttemptFingerprint {
  dimId: string;
  /** The real-user-path run_command exercised this attempt. */
  command: string;
  /** The observable artifact the run produced. */
  artifactPath: string;
  /** HEAD at the time of the attempt (null if unavailable). */
  gitSha: string | null;
}

export type AttemptOutcome = 'validated' | 'rejected' | 'ceiling';

export interface AttemptRecord extends AttemptFingerprint {
  hash: string;
  outcome: AttemptOutcome;
  recordedAt: string;
}

/** Stable content hash of the fingerprint — the identity of "this exact attempt". */
export function fingerprintHash(fp: AttemptFingerprint): string {
  const canon = JSON.stringify([fp.dimId, fp.command.trim(), fp.artifactPath.trim(), fp.gitSha ?? '']);
  return createHash('sha256').update(canon).digest('hex').slice(0, 16);
}

/**
 * A new attempt is novel iff no PRIOR attempt for this dim shares its fingerprint. A retry that
 * changed neither the code (SHA) nor the evidence design (command/artifact) is NOT novel — it
 * cannot produce a different court verdict, so it must not count as progress.
 */
export function isNovelAttempt(prior: AttemptRecord[], fp: AttemptFingerprint): boolean {
  const h = fingerprintHash(fp);
  return !prior.some(p => p.dimId === fp.dimId && p.hash === h);
}

export async function loadAttemptLedger(
  cwd: string,
  _read: (p: string) => Promise<string> = (p) => fs.readFile(p, 'utf8'),
): Promise<AttemptRecord[]> {
  try {
    const raw = await _read(path.join(cwd, LEDGER_REL));
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as AttemptRecord[] : [];
  } catch {
    return [];
  }
}

export async function recordAttempt(
  cwd: string,
  fp: AttemptFingerprint,
  outcome: AttemptOutcome,
  now: string,
  io: {
    _read?: (p: string) => Promise<string>;
    _write?: (p: string, c: string) => Promise<void>;
  } = {},
): Promise<AttemptRecord> {
  const read = io._read ?? ((p: string) => fs.readFile(p, 'utf8'));
  const write = io._write ?? (async (p: string, c: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, c, 'utf8');
  });
  const ledger = await loadAttemptLedger(cwd, read);
  const record: AttemptRecord = { ...fp, hash: fingerprintHash(fp), outcome, recordedAt: now };
  ledger.push(record);
  await write(path.join(cwd, LEDGER_REL), JSON.stringify(ledger, null, 2) + '\n');
  return record;
}
