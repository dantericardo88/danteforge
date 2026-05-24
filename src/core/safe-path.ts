// safe-path.ts — Path traversal protection utilities.
// All functions are synchronous and pure (no IO).

import path from 'path';
import { logSecurityEvent } from './security-audit-log.js';

// ── Error type ────────────────────────────────────────────────────────────────

/** Thrown when a resolved path escapes the allowed base directory. */
export class SecurityError extends Error {
  public readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Resolves `userInput` relative to `baseDir` and ensures the result stays
 * within `baseDir`. Throws a `SecurityError` (code: `ERR_PATH_TRAVERSAL`) if
 * the resolved path would escape the base directory.
 *
 * Logs a `path_traversal_attempt` event to the security audit log on failure.
 *
 * @param userInput  User-supplied path (may be relative or contain `..`).
 * @param baseDir    Absolute base directory that must contain the result.
 * @returns          The normalized absolute path on success.
 */
export function resolveSafePath(userInput: string, baseDir: string): string {
  if (typeof userInput !== 'string' || userInput.includes('\0')) {
    logSecurityEvent({
      type: 'path_traversal_attempt',
      severity: 'critical',
      detail: `Null byte or non-string input detected: ${String(userInput).slice(0, 80)}`,
      timestamp: new Date().toISOString(),
    });
    throw new SecurityError(
      `Invalid path input: null bytes or non-string are not allowed`,
      'ERR_PATH_TRAVERSAL',
    );
  }

  const resolvedBase = path.resolve(baseDir);
  const resolved = path.resolve(baseDir, userInput);

  // A safe path must be the base dir itself or a descendant
  const isSafe =
    resolved === resolvedBase ||
    resolved.startsWith(resolvedBase + path.sep);

  if (!isSafe) {
    logSecurityEvent({
      type: 'path_traversal_attempt',
      severity: 'critical',
      detail: `Traversal attempt: "${userInput}" resolved to "${resolved}" outside base "${resolvedBase}"`,
      timestamp: new Date().toISOString(),
    });
    throw new SecurityError(
      `Path traversal detected: "${userInput}" resolves outside base directory "${resolvedBase}"`,
      'ERR_PATH_TRAVERSAL',
    );
  }

  return resolved;
}

/**
 * Non-throwing version of `resolveSafePath`.
 * Returns `true` if the path is safe (within `baseDir`), `false` otherwise.
 */
export function isSafePath(userInput: string, baseDir: string): boolean {
  try {
    resolveSafePath(userInput, baseDir);
    return true;
  } catch {
    return false;
  }
}

/**
 * Sanitizes a filename (not a full path) by stripping characters that are
 * unsafe regardless of operating system:
 * - Null bytes (`\0`)
 * - Path separators (`/`, `\`)
 * - `..` sequences (directory traversal)
 * - Leading dots (hidden file markers on Unix)
 * - Windows reserved characters (`< > : " | ? *`)
 * - Control characters (ASCII < 32)
 *
 * Returns the sanitized filename. If the result is empty, returns `_`.
 *
 * @param name  Raw filename from user input.
 */
export function sanitizeFilename(name: string): string {
  if (typeof name !== 'string') return '_';

  let result = name
    // Remove null bytes
    .replace(/\0/g, '')
    // Remove path separators
    .replace(/[/\\]/g, '')
    // Remove Windows reserved chars
    .replace(/[<>:"|?*]/g, '')
    // Remove control characters (0x00–0x1f)
    .replace(/[\x00-\x1f]/g, '');

  // Remove leading dots
  result = result.replace(/^\.+/, '');

  // Remove traversal sequences that could survive encoding
  result = result.replace(/\.\./g, '');

  return result || '_';
}
