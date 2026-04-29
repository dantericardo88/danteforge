/**
 * `danteforge truth-loop list` — enumerates prior truth-loop runs in
 * `.danteforge/truth-loop/` with a brief summary line per run.
 *
 * Real engineering deliverable produced by the /dante-to-prd → /dante-grill-me →
 * /dante-design-an-interface → /dante-tdd skill chain (PRD-MASTER §7.5 #1
 * closure: skills running on a real engineering task).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { logger } from '../../core/logger.js';

export interface TruthLoopListFlags {
  json?: boolean;
  repo?: string;
  limit?: string;
}

interface RunSummary {
  runId: string;
  startedAt: string | null;
  finalStatus: string | null;
  score: number | null;
  objective: string | null;
  hasReport: boolean;
  hasVerdict: boolean;
  hasNextAction: boolean;
}

export async function truthLoopList(flags: TruthLoopListFlags): Promise<{ exitCode: number }> {
  const repo = resolve(flags.repo ?? process.cwd());
  const truthLoopDir = resolve(repo, '.danteforge', 'truth-loop');

  if (!existsSync(truthLoopDir)) {
    if (flags.json) {
      process.stdout.write(JSON.stringify({ truthLoopDir, runs: [], reason: 'truth-loop directory does not exist yet' }, null, 2) + '\n');
    } else {
      logger.info('No truth-loop runs yet. Run `danteforge truth-loop run` to create one.');
    }
    return { exitCode: 0 };
  }

  const runs = readdirSync(truthLoopDir)
    .filter(name => /^run_\d{8}_\d{3}$/.test(name))
    .filter(name => {
      const full = resolve(truthLoopDir, name);
      try { return statSync(full).isDirectory(); } catch { return false; }
    })
    .sort()
    .reverse()  // newest first
    .map((runId): RunSummary => summarizeRun(resolve(truthLoopDir, runId), runId));

  const limit = flags.limit ? Number.parseInt(flags.limit, 10) : runs.length;
  const trimmed = Number.isFinite(limit) && limit > 0 ? runs.slice(0, limit) : runs;

  if (flags.json) {
    process.stdout.write(JSON.stringify({ truthLoopDir, count: trimmed.length, totalCount: runs.length, runs: trimmed }, null, 2) + '\n');
    return { exitCode: 0 };
  }

  if (trimmed.length === 0) {
    logger.info('No truth-loop runs yet.');
    return { exitCode: 0 };
  }

  logger.info(`${trimmed.length} truth-loop run(s)${trimmed.length < runs.length ? ` (of ${runs.length} total)` : ''}:`);
  for (const r of trimmed) {
    const status = r.finalStatus ?? '?';
    const score = r.score !== null ? r.score.toFixed(2) : '—';
    const obj = r.objective ? ` — ${r.objective.slice(0, 60)}${r.objective.length > 60 ? '…' : ''}` : '';
    logger.info(`  ${r.runId}  [${status}, score ${score}]${obj}`);
  }
  return { exitCode: 0 };
}

function summarizeRun(runDir: string, runId: string): RunSummary {
  const runJsonPath = resolve(runDir, 'run.json');
  const verdictJsonPath = resolve(runDir, 'verdict', 'verdict.json');
  const nextActionPath = resolve(runDir, 'next_action', 'next_action.json');
  const reportPath = resolve(runDir, 'report.md');

  let startedAt: string | null = null;
  let objective: string | null = null;
  if (existsSync(runJsonPath)) {
    try {
      const run = JSON.parse(readFileSync(runJsonPath, 'utf-8'));
      startedAt = typeof run.startedAt === 'string' ? run.startedAt : null;
      objective = typeof run.objective === 'string' ? run.objective : null;
    } catch { /* malformed — leave nulls */ }
  }

  let finalStatus: string | null = null;
  let score: number | null = null;
  if (existsSync(verdictJsonPath)) {
    try {
      const verdict = JSON.parse(readFileSync(verdictJsonPath, 'utf-8'));
      finalStatus = typeof verdict.finalStatus === 'string' ? verdict.finalStatus : null;
      score = typeof verdict.score === 'number' ? verdict.score : null;
    } catch { /* malformed */ }
  }

  return {
    runId,
    startedAt,
    finalStatus,
    score,
    objective,
    hasReport: existsSync(reportPath),
    hasVerdict: existsSync(verdictJsonPath),
    hasNextAction: existsSync(nextActionPath)
  };
}
