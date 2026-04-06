// Format and log errors in a consistent, user-friendly way.
// Used by CLI commands and error boundaries.

import { DanteError } from './errors.js';
import { GateError } from './gates.js';
import { logger } from './logger.js';

/**
 * Format and log an error in a consistent, user-friendly way.
 * Used by CLI commands and error boundaries.
 */
export function formatAndLogError(err: unknown, context?: string): void {
  if (err instanceof GateError) {
    logger.errorWithRemedy(
      `Gate blocked: ${err.message}`,
      err.remedy,
    );
    return;
  }

  if (err instanceof DanteError) {
    logger.errorWithRemedy(
      `[${err.code}] ${err.message}`,
      err.remedy,
    );
    return;
  }

  if (err instanceof Error) {
    const prefix = context ? `Error in ${context}: ` : '';
    logger.error(`${prefix}${err.message}`);
    if (logger.getLevel() === 'verbose' && err.stack) {
      logger.verbose(err.stack);
    }
    return;
  }

  logger.error(context ? `Error in ${context}: ${String(err)}` : String(err));
}

/**
 * Format an error into a structured object for JSON output.
 */
export function errorToJson(err: unknown): Record<string, unknown> {
  if (err instanceof DanteError) {
    return {
      error: true,
      code: err.code,
      message: err.message,
      remedy: err.remedy,
      name: err.name,
    };
  }
  if (err instanceof Error) {
    return {
      error: true,
      message: err.message,
      name: err.name,
    };
  }
  return { error: true, message: String(err) };
}
