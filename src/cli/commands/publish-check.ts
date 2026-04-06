import { logger } from '../../core/logger.js';
import { withErrorBoundary } from '../../core/cli-error-boundary.js';
import { runPublishCheck, type PublishCheckerDeps } from '../../core/publish-checker.js';
import { renderVerifyResult } from '../../core/diff-formatter.js';

export interface PublishCheckCommandOptions {
  json?: boolean;
  _deps?: PublishCheckerDeps;
}

export async function publishCheck(options: PublishCheckCommandOptions = {}): Promise<void> {
  return withErrorBoundary('publish-check', async () => {
    const result = await runPublishCheck(options._deps);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const passed = result.items.filter(i => i.status === 'pass').map(i => i.label + (i.detail ? ` (${i.detail})` : ''));
    const warnings = result.items.filter(i => i.status === 'warn').map(i => i.label + (i.detail ? ` (${i.detail})` : ''));
    const failures = result.items.filter(i => i.status === 'fail').map(i => i.label + (i.detail ? ` — ${i.detail}` : ''));
    const skipped = result.items.filter(i => i.status === 'skip');

    console.log(renderVerifyResult(passed, warnings, failures));

    if (skipped.length > 0) {
      logger.info(`${skipped.length} check(s) skipped (no exec dependency injected)`);
    }

    if (result.readyToPublish) {
      logger.success('Ready to publish!');
    } else {
      logger.error(`Not ready to publish — ${result.failCount} failure(s) must be resolved.`);
      process.exitCode = 1;
    }
  });
}
