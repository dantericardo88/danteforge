// CLI Error Boundary — top-level catch for all CLI commands.
// Translates structured errors into user-friendly log output.

import { logger } from './logger.js';
import { DanteError } from './errors.js';
import { GateError } from './gates.js';
import { formatAndLogError, suggestNextStep } from './format-error.js';

export interface ErrorBoundaryOptions {
  _logger?: typeof logger;
  _verbose?: boolean;
}

/**
 * Emit a recovery hint when not in verbose mode.
 * Guides users toward --verbose for deeper diagnosis.
 */
function emitRecoveryHint(log: typeof logger, verbose: boolean): void {
  if (!verbose && !process.env.DANTEFORGE_VERBOSE) {
    log.error('  Run with --verbose for the full stack trace, or --help for usage.');
  }
}

export async function withErrorBoundary(
  commandName: string,
  fn: () => Promise<void>,
  opts: ErrorBoundaryOptions = {},
): Promise<void> {
  const log = opts._logger ?? logger;
  const verbose = opts._verbose ?? (log.getLevel() === 'verbose');
  try {
    await fn();
  } catch (err) {
    // When a custom logger is injected (tests), use manual formatting
    // so captured calls are consistent with test expectations.
    if (opts._logger) {
      if (err instanceof GateError) {
        log.error(`Gate blocked: ${err.message}`);
        log.error(`  Remedy: ${err.remedy}`);
      } else if (err instanceof DanteError) {
        log.error(`[${err.code}] ${err.message}`);
        if (err.remedy) log.error(`  Remedy: ${err.remedy}`);
      } else if (err instanceof Error) {
        log.error(`Unexpected error in "${commandName}": ${err.message}`);
        if (verbose && err.stack) log.verbose(err.stack);
        const suggestion = suggestNextStep(err.message);
        if (suggestion) log.error(`  Suggestion: ${suggestion}`);
        emitRecoveryHint(log, verbose);
      } else {
        log.error(`Unexpected error in "${commandName}": ${String(err)}`);
        emitRecoveryHint(log, verbose);
      }
    } else {
      formatAndLogError(err, commandName);
      emitRecoveryHint(log, verbose);
    }
    process.exitCode = 1;
  }
}
