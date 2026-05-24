// test-coverage-analyzer.ts — Detect uncovered src/core modules.
// For each src/core/*.ts file, checks if a matching test file exists
// or if the module is imported in any test file.
import path from 'node:path';
import fsModule from 'node:fs/promises';

type FsPromises = typeof fsModule;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CoverageGapReport {
  covered: string[];
  uncovered: string[];
  coveragePercent: number;
  suggestions: string[];
}

export type GlobFn = (pattern: string, options?: { cwd?: string }) => Promise<string[]>;

// ── analyzeTestCoverage ───────────────────────────────────────────────────────

/**
 * Analyze test coverage for `src/core/*.ts` modules.
 *
 * A module is considered covered when:
 *  1. A `tests/<name>.test.ts` file exists, OR
 *  2. Any test file imports the module by name (regex scan).
 *
 * @param srcDir  Root src directory (e.g. `"src"`).
 * @param testDir Root test directory (e.g. `"tests"`).
 * @param _glob   Injectable glob function for unit testing.
 * @param cwd     Working directory for resolving paths.
 */
export async function analyzeTestCoverage(
  srcDir: string,
  testDir: string,
  _glob?: GlobFn,
  cwd = process.cwd(),
): Promise<CoverageGapReport> {
  const fs = fsModule;

  const globFn: GlobFn = _glob ?? defaultGlob;

  // Discover all src/core/*.ts source files (excluding test helpers and type-only files)
  const srcPattern = path.posix.join(srcDir.replace(/\\/g, '/'), 'core', '*.ts');
  const srcFiles = await globFn(srcPattern, { cwd });

  // Discover all test files
  const testPattern = path.posix.join(testDir.replace(/\\/g, '/'), '*.test.ts');
  const testFiles = await globFn(testPattern, { cwd });

  // Build a set of module names referenced in test files (import scan)
  const importedModules = new Set<string>();
  for (const testFile of testFiles) {
    try {
      const content = await fs.readFile(path.join(cwd, testFile), 'utf8');
      // Match: from '../src/core/<name>.js' or from '../src/core/<name>'
      const importRegex = /from\s+['"](?:\.\.\/)*src\/core\/([^/'"]+?)(?:\.js)?['"]/g;
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(content)) !== null) {
        if (match[1]) importedModules.add(match[1]);
      }
    } catch {
      // skip unreadable test files
    }
  }

  // Build a set of test file base names (without path + .test.ts)
  const testBaseNames = new Set<string>(
    testFiles.map(f => path.basename(f, '.test.ts')),
  );

  const covered: string[] = [];
  const uncovered: string[] = [];

  for (const srcFile of srcFiles) {
    const baseName = path.basename(srcFile, '.ts');
    const hasDedicatedTest = testBaseNames.has(baseName);
    const isImported = importedModules.has(baseName);

    if (hasDedicatedTest || isImported) {
      covered.push(baseName);
    } else {
      uncovered.push(baseName);
    }
  }

  const total = covered.length + uncovered.length;
  const coveragePercent = total === 0 ? 100 : Math.round((covered.length / total) * 100);

  const suggestions = buildSuggestions(uncovered, srcDir, cwd, fs);

  return {
    covered,
    uncovered,
    coveragePercent,
    suggestions: await suggestions,
  };
}

async function buildSuggestions(
  uncovered: string[],
  srcDir: string,
  cwd: string,
  fs: FsPromises,
): Promise<string[]> {
  const top5 = uncovered.slice(0, 5);
  const suggestions: string[] = [];

  for (const name of top5) {
    const filePath = path.join(cwd, srcDir, 'core', `${name}.ts`);
    const exports = await extractExportNames(filePath, fs);
    const exportList = exports.length > 0 ? exports.join(', ') : '(no exports found)';
    suggestions.push(`Write tests for \`${srcDir}/core/${name}.ts\` — exports: [${exportList}]`);
  }

  return suggestions;
}

async function extractExportNames(
  filePath: string,
  fs: FsPromises,
): Promise<string[]> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const names: string[] = [];
    // Match: export function foo, export class Foo, export const foo, export async function foo
    const exportRegex = /^export\s+(?:async\s+)?(?:function|class|const|let|var|type|interface|enum)\s+(\w+)/gm;
    let match: RegExpExecArray | null;
    while ((match = exportRegex.exec(content)) !== null) {
      if (match[1]) names.push(match[1]);
    }
    return names.slice(0, 8); // cap at 8 to avoid overly long suggestions
  } catch {
    return [];
  }
}

async function defaultGlob(pattern: string, options?: { cwd?: string }): Promise<string[]> {
  // Simple filesystem-based glob for *.ts patterns
  const fs = fsModule;
  const cwd = options?.cwd ?? process.cwd();

  // Parse pattern: split on last '*' wildcard segment
  const parts = pattern.split('/');
  const dir = parts.slice(0, -1).join('/');
  const ext = parts[parts.length - 1]?.replace('*', '') ?? '.ts';

  try {
    const entries = await fs.readdir(path.join(cwd, dir), { withFileTypes: true });
    return entries
      .filter(e => e.isFile() && e.name.endsWith(ext))
      .map(e => path.posix.join(dir, e.name));
  } catch {
    return [];
  }
}
