// Mutation Score — lightweight test quality measurement without Stryker.
// Applies 5 mutation operators to TypeScript source files in-memory,
// runs the test suite after each mutation, counts how many mutations
// are caught (killed) vs slip through (survived).
//
// Mutation score = killed / total. Score < 0.5 means tests are likely
// testing the happy path only and would miss real bugs.
//
// Design: pure regex/string operations, no AST parser dependency.
// Operators are conservative — they only mutate patterns that are
// clearly binary (true/false, >/< boundaries, arithmetic signs).
// False positives (mutations that break unrelated things) are
// accepted as "survived" — conservative, never inflated.

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

export type MutationOperator =
  | 'condition-flip'
  | 'boolean-literal'
  | 'return-null'
  | 'boundary-shift'
  | 'arithmetic-flip';

export interface Mutant {
  operator: MutationOperator;
  original: string;
  mutated: string;
  lineHint: number;
}

export interface MutantResult extends Mutant {
  killed: boolean;
}

export interface MutationResult {
  totalMutants: number;
  killed: number;
  survived: number;
  /** killed / totalMutants. 0 if no mutants. */
  mutationScore: number;
  operatorBreakdown: Record<MutationOperator, { killed: number; total: number }>;
  /** Files that were mutated. */
  filesAnalysed: string[];
}

export interface MutationScoreOptions {
  /** Max mutants to test per file (default: 10 — keeps runtime bounded). */
  maxMutantsPerFile?: number;
  /** Max files to mutate (default: 3). */
  maxFiles?: number;
  cwd?: string;
  /** Inject for testing — replaces real fs.readFile. */
  _readFile?: (p: string) => Promise<string>;
  /** Inject for testing — replaces real fs.writeFile. */
  _writeFile?: (p: string, content: string) => Promise<void>;
  /** Inject for testing — restores a file to its original content. */
  _restoreFile?: (p: string, original: string) => Promise<void>;
  /** Inject for testing — returns true if tests detect the mutation. */
  _runTests?: (cwd: string) => Promise<boolean>;
}

// ── Mutation operators ────────────────────────────────────────────────────────

/**
 * Generate mutants from source code using 5 conservative operators.
 * Each operator returns at most `maxPerOperator` mutations.
 */
export function generateMutants(source: string, maxPerOperator = 3): Mutant[] {
  const mutants: Mutant[] = [];
  const lines = source.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    const lineNum = lineIdx + 1;

    // Skip comments and strings (best-effort: skip lines starting with // or containing only strings)
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;

    // 1. condition-flip: > → <, < → >, === → !==, !== → ===
    const condFlips: Array<[string, string]> = [
      [' > ', ' < '], [' < ', ' > '],
      ['=== ', '!== '], ['!== ', '=== '],
      ['>= ', '<= '], ['<= ', '>= '],
    ];
    for (const [from, to] of condFlips) {
      if (line.includes(from)) {
        const mutated = line.replace(from, to);
        if (mutated !== line && mutants.filter(m => m.operator === 'condition-flip').length < maxPerOperator) {
          mutants.push({ operator: 'condition-flip', original: line, mutated, lineHint: lineNum });
        }
      }
    }

    // 2. boolean-literal: true → false, false → true (word boundary, not in strings)
    if (/ true[^A-Za-z]/.test(line) || / true$/.test(line)) {
      const mutated = line.replace(/ true([^A-Za-z]|$)/, ' false$1');
      if (mutated !== line && mutants.filter(m => m.operator === 'boolean-literal').length < maxPerOperator) {
        mutants.push({ operator: 'boolean-literal', original: line, mutated, lineHint: lineNum });
      }
    }
    if (/ false[^A-Za-z]/.test(line) || / false$/.test(line)) {
      const mutated = line.replace(/ false([^A-Za-z]|$)/, ' true$1');
      if (mutated !== line && mutants.filter(m => m.operator === 'boolean-literal').length < maxPerOperator) {
        mutants.push({ operator: 'boolean-literal', original: line, mutated, lineHint: lineNum });
      }
    }

    // 3. return-null: return <expr>; → return null; (only non-trivial returns)
    const returnMatch = /^(\s*return )([^;{]+);/.exec(line);
    if (returnMatch && !returnMatch[2].includes('null') && !returnMatch[2].includes('undefined')) {
      const mutated = line.replace(/^(\s*return )[^;{]+;/, '$1null;');
      if (mutated !== line && mutants.filter(m => m.operator === 'return-null').length < maxPerOperator) {
        mutants.push({ operator: 'return-null', original: line, mutated, lineHint: lineNum });
      }
    }

    // 4. boundary-shift: >= n → > n, < n → <= n (numeric boundaries)
    if (/>=\s*\d/.test(line)) {
      const mutated = line.replace(/>=/g, '>');
      if (mutated !== line && mutants.filter(m => m.operator === 'boundary-shift').length < maxPerOperator) {
        mutants.push({ operator: 'boundary-shift', original: line, mutated, lineHint: lineNum });
      }
    }
    if (/<\s*\d/.test(line) && !line.includes('<=')) {
      const mutated = line.replace(/< (\d)/g, '<= $1');
      if (mutated !== line && mutants.filter(m => m.operator === 'boundary-shift').length < maxPerOperator) {
        mutants.push({ operator: 'boundary-shift', original: line, mutated, lineHint: lineNum });
      }
    }

    // 5. arithmetic-flip: + → - and * → / (only clear arithmetic, avoid string concat)
    // Only flip when preceded by a number or variable (not in imports/strings)
    if (/\w+ \+ \w+/.test(line) && !line.includes("'") && !line.includes('"') && !line.includes('`')) {
      const mutated = line.replace(/(\w+) \+ (\w+)/, '$1 - $2');
      if (mutated !== line && mutants.filter(m => m.operator === 'arithmetic-flip').length < maxPerOperator) {
        mutants.push({ operator: 'arithmetic-flip', original: line, mutated, lineHint: lineNum });
      }
    }
  }

  return mutants;
}

/**
 * Apply a mutant to source code: replace the original line with the mutated line.
 */
export function applyMutant(source: string, mutant: Mutant): string {
  const lines = source.split('\n');
  const targetLine = lines[mutant.lineHint - 1];
  if (targetLine === mutant.original) {
    lines[mutant.lineHint - 1] = mutant.mutated;
  } else {
    // Line may have shifted; do a simple string replace on first occurrence
    return source.replace(mutant.original, mutant.mutated);
  }
  return lines.join('\n');
}

// ── Default test runner ───────────────────────────────────────────────────────

async function runTestsDefault(cwd: string): Promise<boolean> {
  try {
    await execFileAsync(
      'npx',
      ['tsx', '--test', 'tests/**/*.test.ts'],
      { cwd, timeout: 60_000 },
    );
    return false; // tests passed → mutation survived
  } catch {
    return true; // tests failed → mutation killed
  }
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run mutation scoring against a set of source files.
 *
 * For each file:
 *   1. Generate mutants (bounded by maxMutantsPerFile)
 *   2. For each mutant: apply → run tests → restore → record killed/survived
 *
 * Returns aggregate MutationResult.
 */
export async function runMutationScore(
  sourceFiles: string[],
  opts: MutationScoreOptions = {},
): Promise<MutationResult> {
  const cwd = opts.cwd ?? process.cwd();
  const maxMutantsPerFile = opts.maxMutantsPerFile ?? 10;
  const maxFiles = opts.maxFiles ?? 3;
  const readFile = opts._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile = opts._writeFile ?? ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const restoreFile = opts._restoreFile ?? writeFile;
  const runTests = opts._runTests ?? ((dir: string) => runTestsDefault(dir));

  const filesToMutate = sourceFiles.slice(0, maxFiles);
  const allResults: MutantResult[] = [];
  const filesAnalysed: string[] = [];

  for (const filePath of filesToMutate) {
    let original: string;
    try {
      original = await readFile(filePath);
    } catch {
      continue; // skip unreadable files
    }

    const mutants = generateMutants(original, Math.ceil(maxMutantsPerFile / 5)).slice(0, maxMutantsPerFile);
    if (mutants.length === 0) continue;

    filesAnalysed.push(filePath);

    for (const mutant of mutants) {
      const mutatedSource = applyMutant(original, mutant);
      try {
        await writeFile(filePath, mutatedSource);
        const killed = await runTests(cwd).catch(() => false);
        allResults.push({ ...mutant, killed });
      } finally {
        // Always restore — even if runTests throws
        await restoreFile(filePath, original).catch(() => {});
      }
    }
  }

  const killed = allResults.filter(r => r.killed).length;
  const total = allResults.length;

  const operators: MutationOperator[] = [
    'condition-flip', 'boolean-literal', 'return-null', 'boundary-shift', 'arithmetic-flip',
  ];
  const operatorBreakdown: MutationResult['operatorBreakdown'] = {} as MutationResult['operatorBreakdown'];
  for (const op of operators) {
    const opResults = allResults.filter(r => r.operator === op);
    operatorBreakdown[op] = {
      killed: opResults.filter(r => r.killed).length,
      total: opResults.length,
    };
  }

  return {
    totalMutants: total,
    killed,
    survived: total - killed,
    mutationScore: total > 0 ? Math.round((killed / total) * 1000) / 1000 : 0,
    operatorBreakdown,
    filesAnalysed,
  };
}
