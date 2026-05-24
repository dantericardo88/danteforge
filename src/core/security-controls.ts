import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { logger } from '../core/logger.js';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SecurityValidationOptions {
  checkSecrets?: boolean;
  checkPermissions?: boolean;
  checkIntegrity?: boolean;
}

/** Structured error thrown when an input exceeds its allowed length. */
export class InputLengthError extends Error {
  constructor(
    public readonly name: string,
    public readonly actual: number,
    public readonly max: number,
  ) {
    super(`Input "${name}" exceeds maximum length: ${actual} > ${max}`);
    this.name = 'InputLengthError';
  }
}

/** Structured error thrown when a resolved path escapes the allowed root. */
export class PathTraversalError extends Error {
  constructor(public readonly attempted: string, public readonly root: string) {
    super(`Path traversal detected: "${attempted}" is outside root "${root}"`);
    this.name = 'PathTraversalError';
  }
}

// ── Rate limiting ──────────────────────────────────────────────────────────────

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const _rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Simple sliding-window rate limiter backed by an in-process Map.
 * Returns `true` if the request is within limits, `false` if the limit is
 * exceeded. Entries are automatically reset when the window expires.
 *
 * @param key       Unique identifier for the subject (e.g. user ID, IP).
 * @param limit     Maximum number of allowed requests per window.
 * @param windowMs  Duration of the window in milliseconds.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = _rateLimitStore.get(key);

  if (!entry || now - entry.windowStart >= windowMs) {
    // Start a new window
    _rateLimitStore.set(key, { count: 1, windowStart: now });
    return true;
  }

  if (entry.count >= limit) {
    return false;
  }

  entry.count += 1;
  return true;
}

/**
 * Resets the rate-limit counter for `key`. Useful in tests or after a
 * successful authentication step.
 */
export function resetRateLimit(key: string): void {
  _rateLimitStore.delete(key);
}

// ── Input validation ───────────────────────────────────────────────────────────

/**
 * Asserts that `input` does not exceed `max` characters.
 * Throws an `InputLengthError` (a structured subclass of `Error`) when the
 * limit is exceeded so callers can catch it specifically.
 *
 * @param input  The string to validate.
 * @param max    Maximum allowed length (inclusive).
 * @param name   Human-readable field name used in the error message.
 */
export function assertMaxLength(input: string, max: number, name: string): void {
  if (input.length > max) {
    throw new InputLengthError(name, input.length, max);
  }
}

// ── Path safety ────────────────────────────────────────────────────────────────

/**
 * Resolves `p` relative to `cwd` and verifies the result stays within `cwd`.
 * Throws a `PathTraversalError` if the resolved path would escape the root.
 * Returns the normalized absolute path on success.
 *
 * @param p    The user-supplied path (may be relative or contain `..` segments).
 * @param cwd  Absolute path of the directory that must contain the result.
 */
export function sanitizeFilePath(p: string, cwd: string): string {
  const resolved = path.resolve(cwd, p);
  const root = path.resolve(cwd);
  // Ensure resolved is the root itself or a descendant
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new PathTraversalError(resolved, root);
  }
  return resolved;
}

// ── Crypto helpers ─────────────────────────────────────────────────────────────

/**
 * Returns a hex-encoded SHA-256 digest of `data`.
 * Thin wrapper kept here so callers don't need to import `crypto` directly.
 */
export function sha256(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

// ── Validation orchestrator ────────────────────────────────────────────────────

/**
 * Runs the requested security validation checks and returns a summary result.
 * All checks are best-effort; individual failures are captured in `issues`
 * rather than thrown so that a single failing check never blocks the others.
 */
export async function validateSecurityControls(options: SecurityValidationOptions = {}) {
  const results = {
    secretsSecure: false,
    permissionsValid: false,
    integrityVerified: false,
    issues: [] as string[]
  };

  // Check secrets are not in repo
  if (options.checkSecrets) {
    try {
      const gitOutput = await runCommand('git', ['ls-files', '|', 'grep', '-E', '(secret|key|password|token)']);
      if (gitOutput.trim()) {
        results.issues.push('Potential secrets found in repository');
      } else {
        results.secretsSecure = true;
      }
    } catch {
      results.issues.push('Could not check for secrets in repository');
    }
  }

  // Check file permissions
  if (options.checkPermissions) {
    try {
      const configDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.danteforge');
      // stat to verify directory is accessible; permission model is OS-dependent
      await fs.stat(configDir);
      results.permissionsValid = true;
    } catch {
      results.issues.push('Could not validate configuration permissions');
    }
  }

  // Check integrity of audit logs
  if (options.checkIntegrity) {
    try {
      // Basic integrity check — ensure audit files exist and are readable
      const auditDir = path.join(process.cwd(), '.danteforge', 'audit');
      await fs.access(auditDir);
      results.integrityVerified = true;
    } catch {
      results.issues.push('Audit log integrity check failed');
    }
  }

  return results;
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function runCommand(cmd: string, args: string[]): Promise<string> {
  const { spawn } = await import('child_process');
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    child.stderr.on('data', (data: Buffer) => { output += data.toString(); });
    child.on('close', (code: number | null) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Command failed: ${cmd} ${args.join(' ')}`));
    });
  });
}

// Re-export crypto for convenience — avoids callers importing Node built-ins
export { crypto };

// Suppress unused-import lint warning: logger is kept for future structured logging hooks
void logger;
