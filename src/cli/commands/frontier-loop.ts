// frontier-loop.ts (CLI) — run the convergent court-feedback loop autonomously:
//
//   danteforge frontier-loop <dim> --config <evidence-config.json> --builder <memberId> --max-iters N
//
// Each iteration authors a clean T7 ladder (evidence-ladder), runs the court, and — on REJECTED — composes a
// re-author goal from the judges' own words and dispatches a builder to author NEW evidence exercising the
// named capability, then re-judges. Stops on VALIDATED (the 9), an honest ceiling (the same objection twice),
// or maxIters. This is the loop the diagnosis showed was missing: it re-authors the EVIDENCE the court judges,
// using the working evidence-ladder, not the auto-prober that gave up.

import { execFileSync } from 'node:child_process';
import { logger } from '../../core/logger.js';
import { runFrontierLoop, classifyCourtOutput, type FrontierLoopSeams } from '../../core/frontier-loop.js';
import { signBuilderProvenance } from '../../core/frontier-spec.js';

export interface FrontierLoopCliOptions {
  dimId: string;
  config: string;
  builder: string;
  maxIters: number;
  cwd?: string;
  json?: boolean;
}

function looseJson(s: string): Record<string, unknown> {
  const i = s.indexOf('{'); const j = s.lastIndexOf('}');
  if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)) as Record<string, unknown>; } catch { /* fall through */ } }
  return {};
}

export async function runFrontierLoopCli(opts: FrontierLoopCliOptions): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();
  const token = signBuilderProvenance(opts.dimId, [opts.builder]); // kernel-signed: seats peer judges, never forgeable

  const seams: FrontierLoopSeams = {
    authorLadder: async (dimId, configPath) => {
      let out = '';
      try {
        out = execFileSync('node', ['dist/index.js', 'evidence-ladder', dimId, '--config', configPath, '--json'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 300_000 });
      } catch (e) { out = (e as { stdout?: string }).stdout || ''; } // exits 1 when not court-ready — still emits JSON
      const r = looseJson(out) as { ok?: boolean; tier?: string; reason?: string };
      return { courtReady: !!r.ok && r.tier === 'T7', tier: r.tier ?? 'none', reason: r.reason ?? 'evidence-ladder produced no result' };
    },
    runCourt: async (dimId) => {
      let stdout = '';
      try {
        stdout = execFileSync('node', ['dist/index.js', 'frontier-review', dimId, '--write', '--json', '--builder', opts.builder, '--builder-provenance-token', token, '--min-judges', '2'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900_000 });
      } catch (e) { stdout = (e as { stdout?: string }).stdout || ''; } // exits 1 on REJECTED — verdict is in the JSON
      // Hardened: a VALIDATED is real ONLY when validatedWritten && !ceilingWritten (a CIP-blocked pass writes a
      // ceiling, not a 9). classifyCourtOutput refuses to trust a bare textual "VALIDATED".
      return { verdict: classifyCourtOutput(stdout), stdout };
    },
    reauthor: async (dimId, goal) => {
      // Dispatch a builder to author NEW evidence toward the court's objection. Quality is the irreducible
      // engineering step; the loop guarantees the cycle re-judges whatever it produces.
      logger.info(`[frontier-loop] re-authoring toward the court's objection:\n  ${goal.slice(0, 400)}`);
      try {
        execFileSync('node', ['dist/index.js', 'council-crusade', '--focus-dims', dimId, '--goal', goal], { cwd, encoding: 'utf8', stdio: 'inherit', timeout: 1_800_000 });
      } catch { /* best-effort — the loop re-authors the ladder + re-judges regardless of the build's exit */ }
    },
  };

  // Load the frozen frontier_spec (the bar the judges judge against) so the re-author goal cites it, not only the dissent.
  let spec;
  try {
    const { loadMatrix } = await import('../../core/compete-matrix.js');
    const m = await loadMatrix(cwd);
    spec = (m?.dimensions.find(d => d.id === opts.dimId) as { frontier_spec?: unknown } | undefined)?.frontier_spec as Parameters<typeof runFrontierLoop>[0]['spec'];
  } catch { spec = undefined; }

  const result = await runFrontierLoop({ dimId: opts.dimId, configPath: opts.config, maxIters: opts.maxIters, cwd, spec }, seams);

  if (opts.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    if (!result.validated) process.exitCode = 1;
    return;
  }
  logger.info('');
  if (result.validated) {
    logger.info(`✓ frontier-loop: "${opts.dimId}" VALIDATED at the frontier (9.0) after ${result.iterations.length} iteration(s).`);
  } else {
    logger.error(`✗ frontier-loop: "${opts.dimId}" did not validate — ${result.stoppedReason}`);
    if (result.nextGoal) logger.info(`  next re-author goal: ${result.nextGoal.slice(0, 400)}`);
    process.exitCode = 1;
  }
  for (const it of result.iterations) {
    logger.info(`  iter ${it.iter}: tier ${it.tier}, court ${it.verdict}${it.objection ? ` — ${it.objection.slice(0, 140)}` : ''}`);
  }
}
