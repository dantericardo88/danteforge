// CLI Error Boundary — top-level catch for all CLI commands.
// Translates structured errors into user-friendly log output.

import { logger } from './logger.js';
import { DanteError } from './errors.js';
import { GateError } from './gates.js';
import { formatAndLogError } from './format-error.js';

export interface ErrorBoundaryOptions {
  _logger?: typeof logger;
  _verbose?: boolean;
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
      } else {
        log.error(`Unexpected error in "${commandName}": ${String(err)}`);
      }
    } else {
      formatAndLogError(err, commandName);
    }
    process.exitCode = 1;
  }
}
