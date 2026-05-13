// DanteSanitize — Validation hardening (Sprint 5)
//
// AST-delta validator: parses original + post-split files, asserts the
// union of all top-level exported symbols is identical to the original.
// Catches LLM behavior drift that typecheck misses (dropped/renamed/invented symbols).
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildSymbolGraph } from './sanitize-boundary.js';

export interface AstDeltaResult {
  ok: boolean;
  missing: string[];      // symbols present in original but absent from union
  invented: string[];     // symbols present post-split but absent from original
  renamed: string[];      // symbols whose kind changed
  reason?: string;
}

export interface AstDeltaInput {
  originalContent: string;
  originalPath: string;
  rewrittenOriginal: string;
  newFiles: Map<string, string>;  // filename → content (sibling of originalPath)
}

/**
 * Compute the symbol-delta between the pre-split file and the union of post-split files.
 * Returns ok=true only if the exported-symbol set is identical (no symbols lost or invented).
 */
export function checkAstDelta(input: AstDeltaInput): AstDeltaResult {
  const before = buildSymbolGraph(input.originalContent, input.originalPath);
  const beforeExports = exportedSymbolMap(before);

  const afterExports = new Map<string, string>();
  const afterMain = buildSymbolGraph(input.rewrittenOriginal, input.originalPath);
  for (const [id, kind] of exportedSymbolMap(afterMain)) afterExports.set(id, kind);
  for (const [name, content] of input.newFiles) {
    const g = buildSymbolGraph(content, name);
    for (const [id, kind] of exportedSymbolMap(g)) afterExports.set(id, kind);
  }

  const missing: string[] = [];
  const invented: string[] = [];
  const renamed: string[] = [];

  for (const [id, kind] of beforeExports) {
    if (!afterExports.has(id)) missing.push(id);
    else if (afterExports.get(id) !== kind) renamed.push(`${id} (${kind} → ${afterExports.get(id)})`);
  }
  for (const id of afterExports.keys()) {
    if (!beforeExports.has(id)) invented.push(id);
  }

  return {
    ok: missing.length === 0 && invented.length === 0 && renamed.length === 0,
    missing,
    invented,
    renamed,
    reason: missing.length > 0 ? `Missing symbols: ${missing.join(', ')}`
      : invented.length > 0 ? `Invented symbols: ${invented.join(', ')}`
      : renamed.length > 0 ? `Renamed/kind-changed: ${renamed.join(', ')}`
      : undefined,
  };
}

function exportedSymbolMap(graph: ReturnType<typeof buildSymbolGraph>): Map<string, string> {
  const m = new Map<string, string>();
  for (const node of graph.nodes.values()) {
    if (node.exported) m.set(node.id, node.kind);
  }
  return m;
}

// ── Affected-tests detector ─────────────────────────────────────────────────

export interface AffectedTestsInput {
  /** Original file's path (cwd-relative, with .ts extension). */
  filePath: string;
  /** Project root. */
  cwd: string;
  /** Glob of tests to consider. Defaults to tests/**\/*.test.ts */
  testGlob?: string;
}

/**
 * Find test files that import from the source file being split.
 * Returns relative paths of test files that would be affected.
 */
export async function findAffectedTests(input: AffectedTestsInput): Promise<string[]> {
  const testsDir = path.join(input.cwd, 'tests');
  const affected: string[] = [];

  // Compute possible import patterns
  // For a file like 'src/core/foo.ts', tests import via '../src/core/foo.js'
  const stem = path.basename(input.filePath, path.extname(input.filePath));
  // The test would import via a relative path ending in '/foo.js' or '/foo'
  const importPatterns = [
    `/${stem}.js`,
    `/${stem}'`,    // unquoted closing
    `/${stem}"`,
  ];

  try {
    const entries = await fs.readdir(testsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.test.ts')) continue;
      const fullPath = path.join(testsDir, entry.name);
      const content = await fs.readFile(fullPath, 'utf8').catch(() => '');
      if (importPatterns.some(p => content.includes(p))) {
        affected.push(path.relative(input.cwd, fullPath));
      }
    }
  } catch { /* no tests dir; return empty */ }

  return affected;
}

// ── Combined post-split validation ──────────────────────────────────────────

export interface PostSplitValidationInput {
  cwd: string;
  originalContent: string;
  originalPath: string;
  rewrittenOriginal: string;
  newFiles: Map<string, string>;
  /** When provided, runs affected tests in addition to AST-delta check. */
  runAffectedTests?: boolean;
  /** Injection seam: replaces the actual `tsx --test` runner for testing. */
  _runTests?: (testFiles: string[], cwd: string) => Promise<{ success: boolean; output: string }>;
}

export interface PostSplitValidationResult {
  ok: boolean;
  astDelta: AstDeltaResult;
  affectedTests?: string[];
  testResult?: { success: boolean; output: string };
  reason?: string;
}

export async function validatePostSplit(
  input: PostSplitValidationInput,
): Promise<PostSplitValidationResult> {
  const astDelta = checkAstDelta({
    originalContent: input.originalContent,
    originalPath: input.originalPath,
    rewrittenOriginal: input.rewrittenOriginal,
    newFiles: input.newFiles,
  });

  if (!astDelta.ok) {
    return { ok: false, astDelta, reason: astDelta.reason };
  }

  if (!input.runAffectedTests) {
    return { ok: true, astDelta };
  }

  const affected = await findAffectedTests({
    cwd: input.cwd,
    filePath: input.originalPath,
  });

  if (affected.length === 0) {
    return { ok: true, astDelta, affectedTests: [] };
  }

  const runner = input._runTests ?? defaultTestRunner;
  const testResult = await runner(affected, input.cwd);

  return {
    ok: testResult.success,
    astDelta,
    affectedTests: affected,
    testResult,
    reason: testResult.success ? undefined : `Affected tests failed: ${affected.join(', ')}`,
  };
}

async function defaultTestRunner(
  testFiles: string[],
  cwd: string,
): Promise<{ success: boolean; output: string }> {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const execFileAsync = promisify(execFile);

  try {
    const { stdout, stderr } = await execFileAsync(
      'npx',
      ['tsx', '--test', ...testFiles],
      { cwd, timeout: 120_000 },
    );
    return { success: true, output: stdout + stderr };
  } catch (err: unknown) {
    const output = err instanceof Error && 'stdout' in err
      ? String((err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout ?? '') +
        String((err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stderr ?? '')
      : String(err);
    return { success: false, output };
  }
}
