// integration-wiring.ts — Verifies that modules are not just present but actually
// CALLED from the execution path. Addresses the "code exists ≠ code runs" gap
// where harsh-scorer previously gave full credit for file existence alone.
//
// Pattern: glob all src/**/*.ts files, read content, run regex call-site checks.
// Follows the same precedent as maturity-engine.ts:446-456 (regex on source content).

import fs, { type Dirent } from 'fs';
import { promises as fsp } from 'fs';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface WiringFlags {
  /** circuit-breaker.ts is imported AND its execute/call method is invoked */
  circuitBreakerInvoked: boolean;
  /** Custom error hierarchy from errors.ts is actually thrown in source files */
  errorHierarchyThrown: boolean;
  /** Audit logger or audit log push is called from 2+ files */
  auditLoggerWired: boolean;
  /** Rate limiter / token bucket is invoked (consume/check/acquire pattern) */
  rateLimiterInvoked: boolean;
}

export interface IntegrationWiringResult {
  /** 0-100 composite wiring score: 20 base + 20 per flag */
  wiringScore: number;
  flags: WiringFlags;
  /** Module names that exist as files but have no detected call sites */
  unwiredModules: string[];
}

export interface IntegrationWiringOptions {
  cwd?: string;
  /** Injection seam: returns list of relative source file paths to scan */
  _readSourceFiles?: (cwd: string) => Promise<string[]>;
  /** Injection seam: reads file content by absolute path */
  _readFileContent?: (filePath: string) => Promise<string>;
  /** Injection seam: checks if a file exists */
  _existsFile?: (filePath: string) => Promise<boolean>;
}

// ── Call-site regex patterns ──────────────────────────────────────────────────
// Each pattern detects INVOCATION, not just import.

/** circuit-breaker: the breaker is constructed and its execute/call method used */
const CIRCUIT_BREAKER_CALL_PATTERN = /circuitBreaker[A-Za-z]*\.(execute|call|wrap|recordSuccess|recordFailure)|new CircuitBreaker\s*\(/;

/** errors.ts hierarchy: a custom error class from errors.ts is thrown */
const ERROR_HIERARCHY_THROW_PATTERN = /throw new (LLMError|BudgetError|DanteError|NetworkError|ValidationError|TimeoutError)\s*\(/;

/** audit logging: auditLog is pushed to or logger.audit is called */
const AUDIT_LOGGER_PATTERN = /auditLog\.push\s*\(|logger\.audit\s*\(|appendAudit\s*\(|state\.auditLog/;

/** rate limiter / token bucket: consume, check, or acquire is called on a limiter */
const RATE_LIMITER_PATTERN = /rateLimiter\.(consume|check|acquire)|tokenBucket\.(consume|check|acquire)|\.consume\s*\(1\)/;

// ── Default source file scanner ───────────────────────────────────────────────

async function defaultReadSourceFiles(cwd: string): Promise<string[]> {
  const srcDir = path.join(cwd, 'src');
  const results: string[] = [];
  async function walk(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.isDirectory()) {
        await walk(path.join(dir, e.name));
      } else if (e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts')) {
        results.push(path.relative(cwd, path.join(dir, e.name)));
      }
    }
  }
  await walk(srcDir);
  return results;
}

// ── Main function ─────────────────────────────────────────────────────────────

export async function checkIntegrationWiring(
  opts: IntegrationWiringOptions = {},
): Promise<IntegrationWiringResult> {
  const cwd = opts.cwd ?? process.cwd();
  const readSourceFiles = opts._readSourceFiles ?? defaultReadSourceFiles;
  const readFileContent = opts._readFileContent ?? ((p: string) => fsp.readFile(p, 'utf-8'));
  const existsFile = opts._existsFile ?? (async (p: string) => {
    try { await fsp.access(p); return true; } catch { return false; }
  });

  // Check which modules exist (file-existence baseline)
  const circuitBreakerExists = await existsFile(path.join(cwd, 'src', 'core', 'circuit-breaker.ts'));
  const errorsExists = await existsFile(path.join(cwd, 'src', 'core', 'errors.ts'));

  // Read all source files and concatenate content for pattern scanning
  const sourceFiles = await readSourceFiles(cwd);
  const fileContents: string[] = [];
  let auditPatternFileCount = 0;

  for (const relPath of sourceFiles) {
    let content: string;
    try {
      content = await readFileContent(path.join(cwd, relPath));
    } catch {
      continue;
    }
    fileContents.push(content);
    if (AUDIT_LOGGER_PATTERN.test(content)) {
      auditPatternFileCount++;
    }
  }

  const combinedContent = fileContents.join('\n');

  // Evaluate each wiring flag
  const circuitBreakerInvoked = circuitBreakerExists && CIRCUIT_BREAKER_CALL_PATTERN.test(combinedContent);
  const errorHierarchyThrown = errorsExists && ERROR_HIERARCHY_THROW_PATTERN.test(combinedContent);
  const auditLoggerWired = auditPatternFileCount >= 2; // wired if 2+ files use it
  const rateLimiterInvoked = RATE_LIMITER_PATTERN.test(combinedContent);

  const flags: WiringFlags = {
    circuitBreakerInvoked,
    errorHierarchyThrown,
    auditLoggerWired,
    rateLimiterInvoked,
  };

  // Compute wiring score: 20 base + 20 per true flag
  const trueCount = Object.values(flags).filter(Boolean).length;
  const wiringScore = Math.min(100, 20 + trueCount * 20);

  // Build unwired module list from false flags + module name
  const unwiredModules: string[] = [];
  if (circuitBreakerExists && !circuitBreakerInvoked) {
    unwiredModules.push('circuit-breaker (exists but no call sites detected in src/**)');
  }
  if (errorsExists && !errorHierarchyThrown) {
    unwiredModules.push('errors (custom hierarchy exists but not thrown from src/**)');
  }
  if (!auditLoggerWired) {
    unwiredModules.push('audit-logger (not wired into 2+ files)');
  }

  return { wiringScore, flags, unwiredModules };
}

// ── Scoring helper for harsh-scorer integration ───────────────────────────────

/**
 * Convert wiring result to an error-handling score bonus.
 * Partial credit for file-existence (handled by caller), full credit when wired.
 * Returns a 0-40 bonus to add on top of file-existence partial credit.
 */
export function computeWiringBonus(wiringResult: IntegrationWiringResult): number {
  let bonus = 0;
  if (wiringResult.flags.circuitBreakerInvoked) bonus += 10;  // full credit (was 5 partial)
  if (wiringResult.flags.errorHierarchyThrown) bonus += 10;   // full credit (was 5 partial)
  if (wiringResult.flags.auditLoggerWired) bonus += 10;
  if (wiringResult.flags.rateLimiterInvoked) bonus += 10;
  return bonus;
}
