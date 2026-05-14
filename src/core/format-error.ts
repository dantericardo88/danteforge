// Format and log errors in a consistent, user-friendly way.
// Used by CLI commands and error boundaries.

import { DanteError } from './errors.js';
import { GateError } from './gates.js';
import { logger } from './logger.js';

/**
 * Map common error message patterns to a concrete actionable next step.
 * Returns undefined when no specific suggestion applies.
 */
export function suggestNextStep(message: string): string | undefined {
  const m = message.toLowerCase();
  if (m.includes('api key') || m.includes('apikey') || m.includes('unauthorized') || m.includes('authentication')) {
    return 'Check your provider credentials with `danteforge config` or at ~/.danteforge/config.yaml';
  }
  if (m.includes('enoent') || m.includes('no such file') || m.includes('cannot find')) {
    return 'Run `danteforge doctor` to verify your project structure is intact';
  }
  if (m.includes('eacces') || m.includes('permission denied')) {
    return 'Check file permissions; run `danteforge doctor` if the issue persists';
  }
  if (m.includes('network') || m.includes('fetch') || m.includes('econnrefused') || m.includes('timeout')) {
    return 'Check your network connection, then run `danteforge doctor` to confirm provider reachability';
  }
  if (m.includes('rate limit') || m.includes('429') || m.includes('too many requests')) {
    return 'Rate limit hit — wait a moment, or switch providers with `danteforge config --provider`';
  }
  if (m.includes('state') || m.includes('yaml') || m.includes('parse')) {
    return 'Project state may be corrupted. Run `danteforge doctor` or restore from `.danteforge/backups/`';
  }
  if (m.includes('gate') || m.includes('constitution') || m.includes('spec') || m.includes('plan')) {
    return 'Run `danteforge status` to see which workflow gates need attention, or add `--light` to bypass';
  }
  return undefined;
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
    logger.error(`${prefix}${err.message}`);
    if (logger.getLevel() === 'verbose' && err.stack) {
      logger.verbose(err.stack);
    }
    // Surface a concrete next step for common failure patterns
    const suggestion = suggestNextStep(err.message);
    if (suggestion) {
      logger.error(`  Suggestion: ${suggestion}`);
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
    const suggestion = suggestNextStep(err.message);
    return {
      error: true,
      message: err.message,
      name: err.name,
      ...(suggestion ? { suggestion } : {}),
    };
  }
  return { error: true, message: String(err) };
}
