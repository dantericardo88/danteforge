// self-challenge.ts — gap-finding as DanteForge DNA (operator doctrine, 2026-06-12):
// "We should always be looking for gaps, problems or holes in whatever we're building —
//  and the minute we define the problem, we can solve it."
//
// This is the structural half of that doctrine: a durable, append-only CHALLENGE LEDGER
// (.danteforge/challenges.md + challenges.json) where every named problem lives until it is
// solved-with-a-commit or explicitly retired with a reason. The honesty rules of the rest of the
// system apply: a challenge is DEFINED (problem + evidence + opportunity, no vague "improve X"),
// solving requires a commit reference, and nothing is ever silently deleted. The cultural half
// lives in CLAUDE.md (every substantial review/build names at least one unresolved gap) and in
// the autopilot report's LANDMINES section. Council-driven automatic gap-finding can layer on
// top later — the ledger is the substrate either way.

import fs from 'node:fs/promises';
import path from 'node:path';

export interface Challenge {
  id: string;
  title: string;
  /** The precisely DEFINED problem — what is wrong/missing, observably. */
  problem: string;
  /** Where it was seen: a run, a log line, a file, a measurement. */
  evidence: string;
  /** What solving it unlocks. */
  opportunity: string;
  status: 'open' | 'solved' | 'retired';
  openedAt: string;
  /** Commit (or receipt) that solved it / reason it was retired. */
  resolution?: string;
  resolvedAt?: string;
}

const JSON_REL = path.join('.danteforge', 'challenges.json');
const MD_REL = path.join('.danteforge', 'challenges.md');

export async function loadChallenges(cwd: string): Promise<Challenge[]> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(cwd, JSON_REL), 'utf8')) as Challenge[];
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

async function persist(cwd: string, all: Challenge[]): Promise<void> {
  const jsonPath = path.join(cwd, JSON_REL);
  await fs.mkdir(path.dirname(jsonPath), { recursive: true });
  await fs.writeFile(jsonPath, JSON.stringify(all, null, 2), 'utf8');
  await fs.writeFile(path.join(cwd, MD_REL), renderLedger(all), 'utf8');
}

export function renderLedger(all: Challenge[]): string {
  const lines: string[] = [
    '# Challenge Ledger — gaps we have named and therefore own',
    '',
    '> Doctrine: always look for the gaps, problems, and holes in whatever we are building.',
    '> The minute a problem is DEFINED — observably, with evidence — it becomes solvable.',
    '> Entries are never silently deleted: a challenge is open, solved (with the commit), or',
    '> retired (with the reason). An empty OPEN section is a smell, not an achievement.',
    '',
  ];
  const open = all.filter(c => c.status === 'open');
  const closed = all.filter(c => c.status !== 'open');
  lines.push(`## Open (${open.length})`, '');
  for (const c of open) {
    lines.push(`### ${c.id}: ${c.title}`);
    lines.push(`- **Problem:** ${c.problem}`);
    lines.push(`- **Evidence:** ${c.evidence}`);
    lines.push(`- **Opportunity:** ${c.opportunity}`);
    lines.push(`- Opened: ${c.openedAt.slice(0, 10)}`, '');
  }
  lines.push(`## Resolved (${closed.length})`, '');
  for (const c of closed) {
    lines.push(`- **${c.id}: ${c.title}** — ${c.status} ${c.resolvedAt?.slice(0, 10) ?? ''}: ${c.resolution ?? ''}`);
  }
  lines.push('');
  return lines.join('\n');
}

export async function addChallenge(
  cwd: string,
  entry: { title: string; problem: string; evidence: string; opportunity: string },
): Promise<Challenge> {
  for (const [k, v] of Object.entries(entry)) {
    if (!v || v.trim().length < 8) throw new Error(`challenge ${k} must be a real, defined statement (got "${v}") — vague problems are not yet problems.`);
  }
  const all = await loadChallenges(cwd);
  const id = `CH-${String(all.length + 1).padStart(3, '0')}`;
  const c: Challenge = { id, ...entry, status: 'open', openedAt: new Date().toISOString() };
  all.push(c);
  await persist(cwd, all);
  return c;
}

export async function resolveChallenge(
  cwd: string,
  id: string,
  resolution: string,
  status: 'solved' | 'retired' = 'solved',
): Promise<Challenge> {
  if (!resolution || resolution.trim().length < 7) {
    throw new Error(`a ${status} challenge needs a real resolution reference (commit sha / receipt / reason).`);
  }
  const all = await loadChallenges(cwd);
  const c = all.find(x => x.id === id);
  if (!c) throw new Error(`challenge "${id}" not found.`);
  if (c.status !== 'open') throw new Error(`challenge "${id}" is already ${c.status} (${c.resolution ?? ''}).`);
  c.status = status;
  c.resolution = resolution;
  c.resolvedAt = new Date().toISOString();
  await persist(cwd, all);
  return c;
}
