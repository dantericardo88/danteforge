// ci-report command — run CI attribution gate from the CLI.
// Used in GitHub Actions / pre-push hooks to detect quality regressions
// and attribute them to recently adopted patterns.
//
// Exit codes:
//   0 — PASS (no regressions above threshold)
//   1 — FAIL (regressions detected)

import { logger } from '../../core/logger.js';
import { runCIAttribution, type CIAttributionOptions } from '../../core/ci-attribution.js';

export interface CIReportCommandOptions {
  cwd?: string;
  /** Days back to attribute regressions. Default 7. */
  window?: number;
  /** Score drop that triggers failure. Default 0.5. */
  threshold?: number;
  /** Do not update the baseline after running. */
  noUpdate?: boolean;
  /** Inject for testing. */
  _ciAttribution?: (opts: CIAttributionOptions) => ReturnType<typeof runCIAttribution>;
}

export async function runCIReportCommand(opts: CIReportCommandOptions = {}): Promise<void> {
  const cwd = opts.cwd ?? process.cwd();

  const ciOpts: CIAttributionOptions = {
    cwd,
    attributionWindow: opts.window ?? 7,
    regressionThreshold: opts.threshold ?? 0.5,
    updateBaseline: !opts.noUpdate,
  };

  const runCI = opts._ciAttribution ?? runCIAttribution;
  const report = await runCI(ciOpts);

  for (const line of report.summary) {
    if (line.includes('GATE: FAIL') || line.includes('Regressions')) {
      logger.warn(line);
    } else {
      logger.info(line);
    }
  }

  if (report.shouldFail) {
    logger.warn('\nCI gate FAILED. Recent patterns that may have caused regressions:');
    for (const p of report.suspectPatterns) {
      logger.warn(`  - ${p.patternName} (adopted ${p.adoptedAt}, delta=${p.scoreDelta.toFixed(2)})`);
    }
    process.exitCode = 1;
  }
}
