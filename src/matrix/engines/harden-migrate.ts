// harden-migrate.ts — Infer capability_callsite for each dim from its
// capability_test.command and produce a diff the operator can apply.
//
// The crusade gate only has teeth once every dim declares where its capability
// actually lives in production code. This module makes that declaration cheap:
// for each dim, parse the capability_test command, extract the file path it
// references, and propose a callsite. The operator reviews + accepts the diff.
//
// Inference rules (in priority order):
//  1. Look for an `--cwd <path>` or a file path argument in capability_test.command
//  2. Look for a `node dist/index.js <subcommand>` pattern → infer src/cli/commands/<subcommand>.ts
//  3. Look for an `npm run <script>` pattern → grep package.json scripts
//  4. Fall back to a guess based on dim.id (e.g. dim 'security' → src/core/security.ts)
//
// All inferences are MARKED CONFIDENCE so the operator can sort by trustworthiness.
// The operator must explicitly --apply to write to matrix.json.

import fs from 'node:fs/promises';
import path from 'node:path';
import type { MatrixDimension } from '../../core/compete-matrix.js';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InferredCallsite {
  file: string;
  symbol: string;
  lineHint?: number;
}

export type Confidence = 'high' | 'medium' | 'low';

export interface MigrationProposal {
  dimensionId: string;
  alreadyDeclared: boolean;
  inferred: InferredCallsite | null;
  inferredTest: { file: string; symbol: string } | null;
  confidence: Confidence;
  reason: string;
}

export interface MigrationResult {
  cwd: string;
  totalDimensions: number;
  alreadyDeclared: number;
  inferredHigh: number;
  inferredMedium: number;
  inferredLow: number;
  unableToInfer: number;
  proposals: MigrationProposal[];
}

export interface MigrateOptions {
  cwd?: string;
  // Injection seams
  _readFile?: (p: string) => Promise<string>;
  _exists?: (p: string) => Promise<boolean>;
  _readdir?: (p: string) => Promise<string[]>;
}

// ── Inference rules ──────────────────────────────────────────────────────────

const CLI_SUBCOMMAND_RE = /node\s+dist\/index\.js\s+([\w-]+)/;
const NPM_RUN_RE = /npm\s+run\s+([\w:-]+)/;
const FILE_PATH_RE = /\b(src\/[a-zA-Z0-9_./-]+\.tsx?)\b/g;
const CWD_FLAG_RE = /--cwd\s+([^\s]+)/;

function symbolFromFilename(file: string): string {
  // src/cli/commands/probe.ts → probe
  const stem = path.basename(file).replace(/\.tsx?$/, '');
  return stem.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase());
}

async function fileExists(p: string, io: { exists: (p: string) => Promise<boolean> }): Promise<boolean> {
  return io.exists(p);
}

async function findFirstMatch(
  candidates: string[],
  cwd: string,
  io: { exists: (p: string) => Promise<boolean> },
): Promise<string | null> {
  for (const c of candidates) {
    if (await fileExists(path.join(cwd, c), io)) return c;
  }
  return null;
}

/** Infer the callsite for a single dimension. */
export async function inferCallsite(
  dim: MatrixDimension,
  cwd: string,
  io: { exists: (p: string) => Promise<boolean>; readFile: (p: string) => Promise<string> },
): Promise<{ inferred: InferredCallsite | null; confidence: Confidence; reason: string }> {
  const capTest = (dim as unknown as Record<string, unknown>)['capability_test'] as
    | { command?: string; no_capability_test?: boolean } | undefined;

  if (!capTest || (capTest as { no_capability_test?: boolean }).no_capability_test) {
    return { inferred: null, confidence: 'low', reason: 'no capability_test or marker dim' };
  }

  const command = capTest.command ?? '';

  // Rule 1: explicit file path in the command
  const fileMatches = [...command.matchAll(FILE_PATH_RE)];
  for (const m of fileMatches) {
    const filePath = m[1];
    if (!filePath) continue;
    if (await io.exists(path.join(cwd, filePath))) {
      return {
        inferred: { file: filePath, symbol: symbolFromFilename(filePath) },
        confidence: 'high',
        reason: `command references ${filePath}`,
      };
    }
  }

  // Rule 2: node dist/index.js <subcommand>
  const cliMatch = command.match(CLI_SUBCOMMAND_RE);
  if (cliMatch && cliMatch[1]) {
    const sub = cliMatch[1];
    const candidates = [
      `src/cli/commands/${sub}.ts`,
      `src/core/${sub}.ts`,
      `src/cli/commands/${sub.replace(/_/g, '-')}.ts`,
    ];
    const match = await findFirstMatch(candidates, cwd, io);
    if (match) {
      return {
        inferred: { file: match, symbol: sub.replace(/-/g, '') },
        confidence: 'high',
        reason: `CLI subcommand "${sub}" mapped to ${match}`,
      };
    }
  }

  // Rule 3: npm run <script> — look up in package.json
  const npmMatch = command.match(NPM_RUN_RE);
  if (npmMatch && npmMatch[1]) {
    const script = npmMatch[1];
    try {
      const pkg = JSON.parse(await io.readFile(path.join(cwd, 'package.json')));
      const scriptCmd = pkg.scripts?.[script] as string | undefined;
      if (scriptCmd) {
        const subInScript = scriptCmd.match(FILE_PATH_RE);
        if (subInScript && subInScript[0]) {
          return {
            inferred: { file: subInScript[0], symbol: symbolFromFilename(subInScript[0]) },
            confidence: 'medium',
            reason: `npm run ${script} → ${subInScript[0]}`,
          };
        }
      }
    } catch { /* no package.json or unparseable */ }
  }

  // Rule 4: guess from dim.id
  const idLower = dim.id.toLowerCase();
  const idCandidates = [
    `src/core/${idLower}.ts`,
    `src/cli/commands/${idLower}.ts`,
    `src/core/${idLower.replace(/_/g, '-')}.ts`,
    `src/cli/commands/${idLower.replace(/_/g, '-')}.ts`,
  ];
  const match = await findFirstMatch(idCandidates, cwd, io);
  if (match) {
    return {
      inferred: { file: match, symbol: symbolFromFilename(match) },
      confidence: 'low',
      reason: `guessed from dim.id "${dim.id}" → ${match}`,
    };
  }

  return { inferred: null, confidence: 'low', reason: 'no inference rule matched' };
}

async function inferTestCallsite(
  inferred: InferredCallsite | null,
  cwd: string,
  io: { exists: (p: string) => Promise<boolean> },
): Promise<{ file: string; symbol: string } | null> {
  if (!inferred) return null;
  const baseName = path.basename(inferred.file).replace(/\.tsx?$/, '');
  const candidates = [
    `tests/${baseName}.test.ts`,
    `tests/${baseName}.spec.ts`,
    `src/cli/commands/${baseName}.test.ts`,
  ];
  for (const c of candidates) {
    if (await fileExists(path.join(cwd, c), io)) {
      return { file: c, symbol: `tests for ${inferred.symbol}` };
    }
  }
  return null;
}

// ── Main: build the migration proposal list ──────────────────────────────────

export async function buildMigrationProposals(
  matrix: { dimensions: MatrixDimension[] },
  options: MigrateOptions = {},
): Promise<MigrationResult> {
  const cwd = options.cwd ?? process.cwd();
  const io = {
    exists: options._exists ?? (async (p: string) => {
      try { await fs.access(p); return true; } catch { return false; }
    }),
    readFile: options._readFile ?? ((p: string) => fs.readFile(p, 'utf8')),
  };

  const result: MigrationResult = {
    cwd,
    totalDimensions: matrix.dimensions.length,
    alreadyDeclared: 0,
    inferredHigh: 0,
    inferredMedium: 0,
    inferredLow: 0,
    unableToInfer: 0,
    proposals: [],
  };

  for (const dim of matrix.dimensions) {
    const existing = (dim as unknown as Record<string, unknown>)['capability_callsite'];
    if (existing) {
      result.alreadyDeclared++;
      result.proposals.push({
        dimensionId: dim.id,
        alreadyDeclared: true,
        inferred: existing as InferredCallsite,
        inferredTest: ((dim as unknown as Record<string, unknown>)['test_callsite'] as { file: string; symbol: string } | undefined) ?? null,
        confidence: 'high',
        reason: 'already declared',
      });
      continue;
    }

    const { inferred, confidence, reason } = await inferCallsite(dim, cwd, io);
    const inferredTest = await inferTestCallsite(inferred, cwd, io);
    if (!inferred) {
      result.unableToInfer++;
    } else if (confidence === 'high') {
      result.inferredHigh++;
    } else if (confidence === 'medium') {
      result.inferredMedium++;
    } else {
      result.inferredLow++;
    }

    result.proposals.push({
      dimensionId: dim.id,
      alreadyDeclared: false,
      inferred,
      inferredTest,
      confidence,
      reason,
    });
  }

  return result;
}

/** Apply the proposals to matrix.json: write capability_callsite + test_callsite into each dim.
 *  Returns the count of dims modified. Only writes for proposals where alreadyDeclared=false AND inferred!=null. */
export function applyMigrationProposals(
  matrix: { dimensions: MatrixDimension[] },
  result: MigrationResult,
  acceptConfidence: Confidence[] = ['high', 'medium'],
): number {
  let count = 0;
  for (const proposal of result.proposals) {
    if (proposal.alreadyDeclared) continue;
    if (!proposal.inferred) continue;
    if (!acceptConfidence.includes(proposal.confidence)) continue;
    const dim = matrix.dimensions.find(d => d.id === proposal.dimensionId);
    if (!dim) continue;
    (dim as unknown as Record<string, unknown>)['capability_callsite'] = proposal.inferred;
    if (proposal.inferredTest) {
      (dim as unknown as Record<string, unknown>)['test_callsite'] = proposal.inferredTest;
    }
    count++;
  }
  return count;
}
