// court-feedback.ts — close the verdict→builder loop.
//
// Self-challenge finding (2026-06-12, live): when the frontier court REJECTED a dim, two judges
// wrote detailed reasons — and the next build attempt was dispatched with the same generic goal
// ("Close frontier_spec for <dim>"). The dissent died in the audit ledger; the retry was roulette,
// not iteration. This module persists each court verdict's reasons per dim and composes the next
// attempt's build goal from THE BAR the judges judge against (the frozen spec's ladder-seeded
// leader_target) plus THE JUDGES' OWN WORDS — so every rejection becomes a course correction.

import fs from 'node:fs/promises';
import path from 'node:path';
import { TODO_RE, type FrontierSpec } from './frontier-spec.js';

export interface CourtFeedback {
  dimId: string;
  verdict: string;
  /** The court's vote summary line (e.g. "FAIL: 0% weighted pass (2 judge(s)...)"). */
  summary: string;
  /** Judges' dissent/reason lines, verbatim. */
  dissent: string[];
  recordedAt: string;
}

const FEEDBACK_DIR = path.join('.danteforge', 'court-feedback');

function feedbackPath(cwd: string, dimId: string): string {
  return path.join(cwd, FEEDBACK_DIR, `${dimId.replace(/[^\w-]/g, '_')}.json`);
}

export async function recordCourtFeedback(cwd: string, fb: CourtFeedback): Promise<void> {
  const p = feedbackPath(cwd, fb.dimId);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(fb, null, 2), 'utf8');
}

export async function loadCourtFeedback(cwd: string, dimId: string): Promise<CourtFeedback | null> {
  try {
    const fb = JSON.parse(await fs.readFile(feedbackPath(cwd, dimId), 'utf8')) as CourtFeedback;
    return fb?.dimId === dimId ? fb : null;
  } catch {
    return null;
  }
}

/** Extract summary + dissent from `frontier-review --json` stdout (lenient: absent fields → empty). */
export function parseCourtFeedback(stdout: string, dimId: string, verdict: string): CourtFeedback {
  let summary = '';
  let dissent: string[] = [];
  try {
    const brace = stdout.indexOf('{');
    if (brace >= 0) {
      const j = JSON.parse(stdout.slice(brace)) as { result?: { vote?: { summary?: string }; dissent?: unknown[] } };
      summary = typeof j.result?.vote?.summary === 'string' ? j.result.vote.summary : '';
      dissent = Array.isArray(j.result?.dissent) ? j.result.dissent.map(String) : [];
    }
  } catch { /* lenient — feedback is best-effort, never blocks the loop */ }
  return { dimId, verdict, summary, dissent, recordedAt: new Date().toISOString() };
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length <= n ? one : one.slice(0, n - 1) + '…';
}

/**
 * The build goal for a push attempt: the dim, THE BAR (what the judges actually judge against —
 * the frozen spec's ladder-seeded category_delta, falling back to observed_capability), and the
 * court's last verdict verbatim so the builder addresses the judges' specific objections instead
 * of guessing. Self-challenge findings #1 (blind retry) and #2 (bar↔goal disconnect) in one place.
 */
export function composeBuildGoal(dimId: string, spec: FrontierSpec | undefined, feedback: CourtFeedback | null): string {
  const parts: string[] = [`Close frontier_spec for ${dimId} — build the capability the frontier-review court judges against.`];
  const lt = spec?.leader_target;
  const bar = lt && lt.category_delta && !TODO_RE.test(lt.category_delta) ? lt.category_delta
    : lt && lt.observed_capability && !TODO_RE.test(lt.observed_capability) ? lt.observed_capability
    : '';
  if (bar) parts.push(`THE BAR (competitor-grounded, frozen — the court validates ONLY genuine progress toward this): ${clip(bar, 600)}`);
  if (feedback && feedback.verdict !== 'VALIDATED' && (feedback.summary || feedback.dissent.length > 0)) {
    parts.push(`THE COURT'S LAST VERDICT on this dim: ${feedback.verdict}${feedback.summary ? ` — ${clip(feedback.summary, 200)}` : ''}`);
    if (feedback.dissent.length > 0) {
      parts.push('JUDGES\' REASONS — address these SPECIFICALLY (do not repeat the rejected approach):');
      for (const d of feedback.dissent.slice(0, 4)) parts.push(`- ${clip(d, 500)}`);
    }
  }
  return parts.join('\n');
}
