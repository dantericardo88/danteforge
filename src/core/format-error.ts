// Format and log errors in a consistent, user-friendly way.
// Used by CLI commands and error boundaries.

import { DanteError } from './errors.js';
import { GateError } from './gates.js';
import { logger } from './logger.js';
import { enrichError } from './actionable-errors.js';
import {
  collectErrorCauses,
  safeErrorMessage,
  safeErrorStack,
} from './error-normalization.js';
import { deriveErrorCode } from './error-log.js';

/**
 * Map common error message patterns to a concrete actionable next step.
 * Delegates to enrichError for a unified, richer suggestion map.
 * Returns undefined only for truly unrecognized patterns.
 */
export function suggestNextStep(message: string): string | undefined {
  const ae = enrichError(new Error(message));
  return ae.code !== 'ERR_UNKNOWN' ? ae.suggestion : undefined;
}

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
    logger.error(`${prefix}${safeErrorMessage(err)}`);
    if (logger.getLevel() === 'verbose' && err.stack) {
      logger.verbose(safeErrorStack(err) ?? err.stack);
    }
    const ae = enrichError(err, { command: context });
    if (ae.code !== 'ERR_UNKNOWN') {
      logger.error(`  → ${ae.suggestion}`);
      if (ae.docsRef) logger.error(`  Docs: ${ae.docsRef}`);
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
      message: safeErrorMessage(err),
      remedy: safeErrorMessage(err.remedy),
      name: err.name,
    };
  }
  if (err instanceof Error) {
    const ae = enrichError(err);
    const causes = collectErrorCauses(err).map(cause => ({
      ...cause,
      code: cause.code ?? deriveErrorCode(new Error(cause.message)),
    }));
    const code = deriveErrorCode(err);
    return {
      error: true,
      code: code !== 'ERR_UNKNOWN' ? code : (ae.code !== 'ERR_UNKNOWN' ? ae.code : undefined),
      message: safeErrorMessage(err),
      name: err.name,
      ...(ae.code !== 'ERR_UNKNOWN' ? { suggestion: ae.suggestion } : {}),
      ...(causes.length > 0 ? { causes } : {}),
    };
  }
  return { error: true, message: safeErrorMessage(err) };
}
