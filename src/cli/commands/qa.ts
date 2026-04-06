// QA command — structured QA pass with health score on live app.
// Fail-closed: exits code 1 if browse binary not found or score below threshold.
import fs from 'fs/promises';
import path from 'path';
import { logger } from '../../core/logger.js';
import { loadState, saveState } from '../../core/state.js';
import {
  detectBrowseBinary,
  getBrowseInstallInstructions,
  getBrowsePort,
} from '../../core/browse-adapter.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import {
  runQAPass,
  saveQABaseline,
  type QARunMode,
} from '../../core/qa-runner.js';

export async function qa(options: {
  url: string;
  type?: string;
  baseline?: string;
  saveBaseline?: boolean;
  failBelow?: string;
} = { url: '' }) {
  return withErrorBoundary('qa', async () => {
  // Binary detection — fail-closed
  const binaryPath = await detectBrowseBinary();
  if (!binaryPath) {
    const instructions = getBrowseInstallInstructions(process.platform);
    logger.error(instructions);
    process.exitCode = 1;
    return;
  }

  if (!options.url) {
    logger.error('Usage: danteforge qa --url <url>');
    process.exitCode = 1;
    return;
  }

  const mode = (options.type ?? 'full') as QARunMode;
  const evidenceDir = '.danteforge/evidence';
  const port = getBrowsePort();
  const failBelow = options.failBelow ? parseInt(options.failBelow, 10) : 0;

  logger.info(`Running ${mode} QA pass on ${options.url}...`);

  const report = await runQAPass({
    url: options.url,
    mode,
    baselinePath: options.baseline,
    saveBaseline: options.saveBaseline,
    failBelow,
    evidenceDir,
    browseConfig: { binaryPath, port, evidenceDir },
  });

  // Write report
  const reportPath = path.join('.danteforge', 'qa-report.json');
  await fs.mkdir('.danteforge', { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  logger.info(`Report saved: ${reportPath}`);

  // Save baseline if requested
  if (options.saveBaseline) {
    const baselinePath = path.join('.danteforge', 'qa-baseline.json');
    await saveQABaseline(report, baselinePath);
    logger.info(`Baseline saved: ${baselinePath}`);
  }

  // Print summary
  logger.info(`\nQA Health Score: ${report.score}/100`);
  logger.info(`Issues found: ${report.issues.length}`);

  const critical = report.issues.filter(i => i.severity === 'critical').length;
  const high = report.issues.filter(i => i.severity === 'high').length;
  const medium = report.issues.filter(i => i.severity === 'medium').length;
  const info = report.issues.filter(i => i.severity === 'informational').length;

  if (report.issues.length > 0) {
    logger.info(`  Critical: ${critical} | High: ${high} | Medium: ${medium} | Info: ${info}`);
    logger.info('');
    // Print top issues
    for (const issue of report.issues.slice(0, 5)) {
      const icon = issue.severity === 'critical' ? 'x' : issue.severity === 'high' ? '!' : '-';
      logger.info(`  ${icon} [${issue.severity.toUpperCase()}] ${issue.description}`);
    }
    if (report.issues.length > 5) {
      logger.info(`  ... and ${report.issues.length - 5} more issues`);
    }
  }

  if (report.regressions && report.regressions.length > 0) {
    logger.warn(`\nRegressions detected: ${report.regressions.length} new issue(s) since baseline`);
  }

  // Update state
  try {
    const state = await loadState();
    state.qaHealthScore = report.score;
    state.qaLastRun = report.timestamp;
    state.auditLog.push(
      `${report.timestamp} | qa: ${mode} pass on ${options.url} → score ${report.score}/100 (${report.issues.length} issues)`,
    );
    await saveState(state);
  } catch {
    // State save is best-effort
  }

  // Fail-below gate
  if (failBelow > 0 && report.score < failBelow) {
    logger.error(`\nQA score ${report.score} is below threshold ${failBelow} — failing`);
    process.exitCode = 1;
  }
  });
}
