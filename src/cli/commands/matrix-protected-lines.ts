// matrix protect / protected-lines / unprotect — Fix C commands
import { logger } from '../../core/logger.js';
import {
  readProtectedLines,
  addProtection,
  removeProtection,
  type AddProtectionOptions,
  type RemoveProtectionOptions,
} from '../../matrix/engines/protected-lines.js';

// ── matrix protect <file:start-end> <dimensionId> ────────────────────────────

export interface ProtectOptions {
  cwd?: string;
  reason?: string;
  capabilityTest?: string;
  _now?: () => string;
}

/**
 * Parse "file:start-end" format, e.g. "src/core/feature.ts:42-80"
 * Returns null if format is invalid.
 */
export function parseFileRange(raw: string): { file: string; startLine: number; endLine: number } | null {
  const match = /^(.+):(\d+)-(\d+)$/.exec(raw);
  if (!match) return null;
  const [, file, startStr, endStr] = match;
  const startLine = parseInt(startStr!, 10);
  const endLine = parseInt(endStr!, 10);
  if (startLine < 1 || endLine < startLine) return null;
  return { file: file!, startLine, endLine };
}

export async function matrixProtect(
  fileRange: string,
  dimensionId: string,
  options: ProtectOptions = {},
): Promise<void> {
  const parsed = parseFileRange(fileRange);
  if (!parsed) {
    logger.error(`Invalid file:range format: "${fileRange}". Expected format: "src/file.ts:42-80"`);
    process.exitCode = 1;
    return;
  }
  const opts: AddProtectionOptions = {
    ...parsed,
    dimensionId,
    reason: options.reason,
    capability_test: options.capabilityTest,
    cwd: options.cwd,
    _now: options._now,
  };
  const data = await addProtection(opts);
  logger.success(`Protected ${parsed.file}:${parsed.startLine}-${parsed.endLine} (dimension: ${dimensionId})`);
  logger.info(`Total protections: ${data.protections.length}`);
}

// ── matrix protected-lines ────────────────────────────────────────────────────

export async function matrixProtectedLines(options: { cwd?: string } = {}): Promise<void> {
  const data = await readProtectedLines(options.cwd);
  if (data.protections.length === 0) {
    logger.info('No protected line ranges recorded.');
    logger.info('Protections are added automatically when a capability_test passes, or via:');
    logger.info('  danteforge matrix-kernel protect <file:start-end> <dimensionId>');
    return;
  }
  logger.info(`Protected line ranges (${data.protections.length}):`);
  for (const p of data.protections) {
    logger.info(`  ${p.file}:${p.startLine}-${p.endLine}  [${p.dimensionId}]  ${p.reason ?? ''}`);
  }
}

// ── matrix unprotect <file:start-end> ────────────────────────────────────────

export interface UnprotectOptions {
  cwd?: string;
  reason?: string;
}

export async function matrixUnprotect(
  fileRange: string,
  options: UnprotectOptions = {},
): Promise<void> {
  const parsed = parseFileRange(fileRange);
  if (!parsed) {
    logger.error(`Invalid file:range format: "${fileRange}". Expected format: "src/file.ts:42-80"`);
    process.exitCode = 1;
    return;
  }
  try {
    const opts: RemoveProtectionOptions = {
      ...parsed,
      reason: options.reason,
      cwd: options.cwd,
    };
    const data = await removeProtection(opts);
    logger.success(`Unprotected ${parsed.file}:${parsed.startLine}-${parsed.endLine}`);
    logger.info(`Remaining protections: ${data.protections.length}`);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
