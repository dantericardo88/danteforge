// evidence-ladder.ts — CLI for the once-and-for-all evidence-ladder author (council 2026-06-23).
//
//   danteforge evidence-ladder <dimId> --config <path.json>
//
// The config declares the wired callsite + >=3 genuinely-distinct product demonstrations:
//   { "callsite": "src/core/frontier-spec.ts",
//     "rungs": [ { "command": "node dist/index.js …", "artifact": "out/x.json", "description": "…" }, … ] }
//
// It authors a clean, contiguous, integrity-passing push-tier ladder BY REAL EXECUTION and reports either a
// court-ready T7 or the precise integrity violation that still blocks it (never a fabricated pass).

import fs from 'node:fs';
import { logger } from '../../core/logger.js';
import { authorEvidenceLadder, type LadderRung } from '../../core/evidence-ladder-author.js';

export interface EvidenceLadderCliOptions {
  dimId: string;
  config: string;
  cwd?: string;
  json?: boolean;
}

export async function runEvidenceLadderCli(opts: EvidenceLadderCliOptions): Promise<void> {
  const raw = fs.readFileSync(opts.config, 'utf8');
  const cfg = JSON.parse(raw) as { callsite?: string; rungs?: LadderRung[] };
  if (!cfg.callsite || !Array.isArray(cfg.rungs)) {
    throw new Error(`config must declare { callsite: string, rungs: [{command, artifact, description}] } — got ${raw.slice(0, 80)}`);
  }

  const result = await authorEvidenceLadder({
    dimId: opts.dimId,
    callsite: cfg.callsite,
    rungs: cfg.rungs,
    cwd: opts.cwd,
  });

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.ok) process.exitCode = 1;
    return;
  }

  if (result.ok) {
    logger.info(
      `✓ evidence-ladder: "${opts.dimId}" reached ${result.tier} (derived ${result.derived?.toFixed(1)}) — ` +
      `${result.authored} rung(s), ${result.distinctSessions} distinct session(s), ${result.distinctCommands} distinct command(s), ` +
      `no integrity violations. COURT-READY.`,
    );
  } else {
    logger.error(`✗ evidence-ladder: "${opts.dimId}" did not reach a clean T7 — ${result.reason}`);
    for (const v of result.violations) logger.error(`    • ${v}`);
    logger.info(
      `  (authored ${result.authored} rung(s) → tier ${result.tier}, ${result.distinctSessions} session(s), ${result.distinctCommands} command(s)). ` +
      `Fix the violation above and re-run — the tool never fabricates a pass.`,
    );
    process.exitCode = 1;
  }
}
