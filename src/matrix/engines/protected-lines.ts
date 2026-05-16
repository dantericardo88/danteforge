// Matrix Kernel — Protected Lines engine (Fix C)
//
// When a capability_test passes for a dimension, the kernel records the file:line
// ranges responsible for the passing capability into protected-lines.json.
// Future waves cannot regress those lines without re-running the test.
import fs from 'node:fs/promises';
import path from 'node:path';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ProtectedLineRange {
  file: string;           // relative to project root, forward-slash normalized
  startLine: number;
  endLine: number;
  dimensionId: string;
  reason?: string;
  protectedAt: string;    // ISO timestamp
  capability_test?: string; // command that proved this range
}

export interface ProtectedLinesFile {
  version: number;
  description: string;
  protections: ProtectedLineRange[];
}

const PROTECTED_LINES_PATH = '.danteforge/protected-lines.json';

// ── Read / write ─────────────────────────────────────────────────────────────

export async function readProtectedLines(cwd?: string): Promise<ProtectedLinesFile> {
  const root = cwd ?? process.cwd();
  const fullPath = path.join(root, PROTECTED_LINES_PATH);
  try {
    const raw = await fs.readFile(fullPath, 'utf8');
    const data = JSON.parse(raw) as ProtectedLinesFile;
    return { version: data.version ?? 1, description: data.description ?? '', protections: data.protections ?? [] };
  } catch {
    return { version: 1, description: '', protections: [] };
  }
}

export async function writeProtectedLines(data: ProtectedLinesFile, cwd?: string): Promise<string> {
  const root = cwd ?? process.cwd();
  const fullPath = path.join(root, PROTECTED_LINES_PATH);
  await fs.mkdir(path.join(root, '.danteforge'), { recursive: true });
  await fs.writeFile(fullPath, JSON.stringify(data, null, 2), 'utf8');
  return fullPath;
}

// ── Public operations ─────────────────────────────────────────────────────────

export interface AddProtectionOptions {
  file: string;
  startLine: number;
  endLine: number;
  dimensionId: string;
  reason?: string;
  capability_test?: string;
  cwd?: string;
  _now?: () => string;
}

/** Record a protected line range after a capability_test passes. */
export async function addProtection(options: AddProtectionOptions): Promise<ProtectedLinesFile> {
  const now = options._now ?? (() => new Date().toISOString());
  const data = await readProtectedLines(options.cwd);
  const normalized = options.file.replace(/\\/g, '/');

  // De-duplicate: remove any existing protection for the same file+range+dimension
  data.protections = data.protections.filter(p =>
    !(p.file === normalized && p.startLine === options.startLine
      && p.endLine === options.endLine && p.dimensionId === options.dimensionId),
  );

  data.protections.push({
    file: normalized,
    startLine: options.startLine,
    endLine: options.endLine,
    dimensionId: options.dimensionId,
    reason: options.reason ?? 'capability proven by passing capability_test',
    protectedAt: now(),
    capability_test: options.capability_test,
  });

  await writeProtectedLines(data, options.cwd);
  return data;
}

export interface RemoveProtectionOptions {
  file: string;
  startLine: number;
  endLine: number;
  reason?: string;
  cwd?: string;
}

/** Remove a protected line range (explicit unprotect). */
export async function removeProtection(options: RemoveProtectionOptions): Promise<ProtectedLinesFile> {
  const data = await readProtectedLines(options.cwd);
  const normalized = options.file.replace(/\\/g, '/');
  const before = data.protections.length;
  data.protections = data.protections.filter(p =>
    !(p.file === normalized && p.startLine === options.startLine && p.endLine === options.endLine),
  );
  if (data.protections.length === before) {
    throw new Error(`No protection found for ${normalized}:${options.startLine}-${options.endLine}`);
  }
  await writeProtectedLines(data, options.cwd);
  return data;
}

/** Check whether a staged file list intersects any protected range. */
export function findViolations(
  stagedFiles: string[],
  protections: ProtectedLineRange[],
): ProtectedLineRange[] {
  const normalizedStaged = stagedFiles.map(f => f.replace(/\\/g, '/'));
  return protections.filter(p => normalizedStaged.includes(p.file));
}
