// supervisor-notify.ts — the tiered-autonomy notification sink. When the Supervisor pauses (capability
// ceiling, policy/budget block) or escalates (circuit breaker), the operator must SEE it — a silent pause is
// just the old "it stopped and nobody knew" failure in a new coat. This appends a durable, dated entry to
// `.danteforge/ESCALATIONS.md` (the human-readable queue) so an AFK operator returns to a worklist, not a
// mystery. Best-effort: a notification failure never crashes a campaign.

import fs from 'node:fs/promises';
import path from 'node:path';
import { logger } from './logger.js';

export const ESCALATIONS_FILE = '.danteforge/ESCALATIONS.md';

const HEADER = `# Supervisor Escalations — campaigns that need an operator

> The auto-reengage Supervisor handles transient stops itself. Entries here are the stops it does NOT
> self-solve: real capability ceilings, policy/budget blocks, and circuit-breaker escalations. Each is a
> DEFINED next problem (the no-walls invariant), not a dead end.

`;

type AppendFn = (p: string, d: string) => Promise<void>;

/** Append a dated escalation/pause entry. Levels: 'pause' (human-in-loop), 'escalate' (ceiling → worklist),
 *  'done' (campaign succeeded — logged for the audit trail). Best-effort; never throws. */
export async function writeEscalation(
  cwd: string,
  level: 'pause' | 'escalate' | 'done',
  reason: string,
  _append?: AppendFn,
  nowIso: string = new Date().toISOString(),
): Promise<void> {
  const append = _append ?? (async (p: string, d: string) => {
    await fs.mkdir(path.dirname(p), { recursive: true });
    let existing = '';
    try { existing = await fs.readFile(p, 'utf8'); } catch { existing = ''; }
    await fs.writeFile(p, existing || HEADER, 'utf8');
    await fs.appendFile(p, d, 'utf8');
  });
  const icon = level === 'done' ? '✅' : level === 'escalate' ? '🧩' : '⏸️';
  const entry = `\n## ${icon} ${level.toUpperCase()} — ${nowIso}\n\n${reason}\n`;
  try {
    await append(path.join(cwd, ESCALATIONS_FILE), entry);
    if (level !== 'done') logger.info(`[supervise] ${level} recorded to ${ESCALATIONS_FILE}`);
  } catch {
    // best-effort
  }
}
