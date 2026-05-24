// Spec drift detector — detects when the spec has changed since the last plan was generated.
// Uses SHA-256 hash of normalized spec text for deterministic comparison.

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SpecDriftResult {
  drifted: boolean;
  lastHash: string | null;
  currentHash: string;
  /** ISO timestamp when the spec hash was last recorded (from STATE.yaml) */
  recordedAt: string | null;
  /** Message suitable for display */
  message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STATE_FILE = path.join('.danteforge', 'STATE.yaml');
const SPEC_CANDIDATES = [
  path.join('.danteforge', 'SPEC.md'),
  'SPEC.md',
];

// ---------------------------------------------------------------------------
// Hash computation
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic SHA-256 hash of spec text.
 *
 * Normalises the text before hashing so minor formatting differences
 * (trailing spaces, CRLF line endings, extra blank lines) do not
 * produce false-positive drift signals:
 * - Lowercased
 * - `\r\n` → `\n`
 * - Horizontal whitespace collapsed to a single space
 * - Three or more consecutive newlines collapsed to two
 * - Leading and trailing whitespace trimmed
 *
 * @param specText - Raw spec content to hash.
 * @returns 64-character lowercase hex SHA-256 digest.
 *
 * @example
 * const hash = computeSpecHash(specText);
 * // '3a7f1d...' (64 hex chars)
 */
export function computeSpecHash(specText: string): string {
  const normalized = specText
    .toLowerCase()
    .replace(/\r\n/g, '\n')    // normalize line endings
    .replace(/[ \t]+/g, ' ')   // collapse horizontal whitespace
    .replace(/\n{3,}/g, '\n\n') // collapse excess blank lines
    .trim();

  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Spec file loader
// ---------------------------------------------------------------------------

/** Reads the spec file from the project, trying candidates in order. */
async function readSpecFile(
  cwd: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<string | null> {
  const reader = _fsRead ?? ((p: string) => readFile(p, 'utf8'));

  for (const candidate of SPEC_CANDIDATES) {
    try {
      const full = path.join(cwd, candidate);
      return await reader(full);
    } catch {
      // try next candidate
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// State reader (minimal — only extracts specHash)
// ---------------------------------------------------------------------------

interface SpecHashState {
  specHash?: string;
  specHashRecordedAt?: string;
}

async function readSpecHashFromState(
  cwd: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<SpecHashState> {
  const reader = _fsRead ?? ((p: string) => readFile(p, 'utf8'));

  try {
    const full = path.join(cwd, STATE_FILE);
    const raw = await reader(full);
    const parsed = yaml.parse(raw) as Record<string, unknown>;

    return {
      specHash: typeof parsed.specHash === 'string' ? parsed.specHash : undefined,
      specHashRecordedAt: typeof parsed.specHashRecordedAt === 'string'
        ? parsed.specHashRecordedAt
        : undefined,
    };
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks whether the current spec file has changed since the last plan run.
 *
 * Returns a SpecDriftResult.  If no spec file is found, drifted=false and
 * the result explains that there is nothing to compare.
 *
 * @param cwd     Project root (defaults to process.cwd())
 * @param _fsRead Injection seam for testing
 */
export async function checkSpecDrift(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
): Promise<SpecDriftResult> {
  const dir = cwd ?? process.cwd();

  const [specText, stateHashes] = await Promise.all([
    readSpecFile(dir, _fsRead),
    readSpecHashFromState(dir, _fsRead),
  ]);

  // No spec file — nothing to drift
  if (specText === null) {
    return {
      drifted: false,
      lastHash: stateHashes.specHash ?? null,
      currentHash: '',
      recordedAt: stateHashes.specHashRecordedAt ?? null,
      message: 'No spec file found — run "danteforge specify" to create one.',
    };
  }

  const currentHash = computeSpecHash(specText);
  const lastHash = stateHashes.specHash ?? null;

  // No recorded hash — first time plan runs
  if (lastHash === null) {
    return {
      drifted: false,
      lastHash: null,
      currentHash,
      recordedAt: null,
      message: 'No spec hash recorded yet — will be saved after next plan run.',
    };
  }

  const drifted = lastHash !== currentHash;

  return {
    drifted,
    lastHash,
    currentHash,
    recordedAt: stateHashes.specHashRecordedAt ?? null,
    message: drifted
      ? 'Warning: spec has changed since last plan. Run "danteforge clarify" and "danteforge plan" to realign.'
      : 'Spec is in sync with last plan.',
  };
}

/**
 * Saves the current spec hash into STATE.yaml.
 * Call this after a successful plan run.
 *
 * @param cwd     Project root
 * @param _fsRead Injection seam for reading files
 * @param _fsWrite Injection seam for writing files
 */
export async function saveSpecHash(
  cwd?: string,
  _fsRead?: (p: string) => Promise<string>,
  _fsWrite?: (p: string, content: string) => Promise<void>,
): Promise<void> {
  const dir = cwd ?? process.cwd();
  const reader = _fsRead ?? ((p: string) => readFile(p, 'utf8'));

  const { writeFile, mkdir } = await import('node:fs/promises');
  const writer = _fsWrite ?? ((p: string, c: string) => writeFile(p, c, 'utf8'));

  // Read current spec text
  const specText = await readSpecFile(dir, _fsRead);
  if (specText === null) return; // nothing to hash

  const currentHash = computeSpecHash(specText);
  const stateFilePath = path.join(dir, STATE_FILE);

  // Read existing state YAML to merge
  let parsed: Record<string, unknown> = {};
  try {
    const raw = await reader(stateFilePath);
    parsed = (yaml.parse(raw) as Record<string, unknown>) ?? {};
  } catch {
    // State doesn't exist yet — will create a minimal record
  }

  parsed.specHash = currentHash;
  parsed.specHashRecordedAt = new Date().toISOString();

  if (!_fsWrite) {
    await mkdir(path.join(dir, '.danteforge'), { recursive: true });
  }

  await writer(stateFilePath, yaml.stringify(parsed));
}
