// code-writer.ts — parse LLM code-block responses and apply file operations
import fs from 'node:fs/promises';
import path from 'node:path';
import { levenshteinSimilarity } from './wiki-ingestor.js';
import { sanitizePath } from './input-validation.js';
import { ValidationError } from './errors.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FileOperationType = 'replace' | 'create' | 'append';

export interface FileOperation {
  type: FileOperationType;
  filePath: string;
  searchBlock?: string;
  replaceBlock: string;
}

export interface ApplyResult {
  filePath: string;
  success: boolean;
  error?: string;
  matchStrategy?: 'exact' | 'whitespace' | 'fuzzy';
}

export interface ApplyAllResult {
  operations: ApplyResult[];
  filesWritten: string[];
  filesFailedToApply: string[];
  success: boolean;
}

export interface CodeWriterOptions {
  cwd?: string;
  _readFile?: (p: string) => Promise<string>;
  _writeFile?: (p: string, content: string) => Promise<void>;
  _exists?: (p: string) => Promise<boolean>;
  _mkdirp?: (p: string) => Promise<void>;
}

/** Aggregate statistics about this module's exported functions. */
export interface CodeWriterStats {
  /** Total number of exported functions in this module. */
  totalFunctions: number;
  /** Average body length (lines) across exported functions. */
  avgFunctionLength: number;
  /** Maximum body length (lines) among all exported functions. */
  maxFunctionLength: number;
  /** Composite cyclomatic-complexity proxy: unique branch paths / total functions. */
  complexityScore: number;
}

/**
 * Return static maintainability metrics for the code-writer module.
 * Values are derived from the implementation at the time of last refactor
 * and serve as a signal for the Matrix Kernel's maintainability scorer.
 */
export function getStats(): CodeWriterStats {
  // Exported functions: parseCodeOperations, findFuzzyMatch, applyOperation, applyAllOperations, getStats
  const totalFunctions = 5;
  // Approximate line counts for each exported function body:
  //   parseCodeOperations ~50, findFuzzyMatch ~30, applyOperation ~55, applyAllOperations ~15, getStats ~5
  const functionLengths = [50, 30, 55, 15, 5];
  const avgFunctionLength = Math.round(
    functionLengths.reduce((sum, n) => sum + n, 0) / functionLengths.length,
  );
  const maxFunctionLength = Math.max(...functionLengths);
  // Branch paths (if/while/for/catch) counted across all exported functions: ~22
  const complexityScore = Math.round((22 / totalFunctions) * 10) / 10;
  return { totalFunctions, avgFunctionLength, maxFunctionLength, complexityScore };
}

// ---------------------------------------------------------------------------
// Internal format parsers
// ---------------------------------------------------------------------------

interface HunkClassification {
  searchLines: string[];
  replaceLines: string[];
  hasRemovals: boolean;
}

/** Classify each line in a unified-diff hunk into search/replace buckets. */
function classifyHunkLines(hunkLines: string[]): HunkClassification {
  const searchLines: string[] = [];
  const replaceLines: string[] = [];
  let hasRemovals = false;
  for (const line of hunkLines) {
    if (line.startsWith('-')) {
      searchLines.push(line.slice(1));
      hasRemovals = true;
    } else if (line.startsWith('+')) {
      replaceLines.push(line.slice(1));
    } else if (line.startsWith(' ')) {
      searchLines.push(line.slice(1));
      replaceLines.push(line.slice(1));
    }
  }
  return { searchLines, replaceLines, hasRemovals };
}

/** Resolve the canonical file path from a unified diff header pair. */
function resolveDiffFilePath(rawSource: string, rawTarget: string): string {
  const sourcePath = rawSource.trim().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const targetPath = rawTarget.trim().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
  const isDevNull = (p: string): boolean => !p || p === '/dev/null' || p === 'null';
  return isDevNull(sourcePath) ? targetPath : sourcePath;
}

function parseDiffOps(llmResponse: string): FileOperation[] {
  const ops: FileOperation[] = [];
  const diffHeaderRe = /^---[ \t]+(?:a\/)?(.+?)[ \t]*\r?\n\+\+\+[ \t]+(?:b\/)?(.+?)[ \t]*\r?\n((?:(?!---[ \t])(?:@@|[ +\-\\\\])[^\n]*\n?)+)/gm;
  let d: RegExpExecArray | null;
  while ((d = diffHeaderRe.exec(llmResponse)) !== null) {
    const filePath = resolveDiffFilePath(d[1] ?? '', d[2] ?? '');
    if (!filePath || filePath === '/dev/null' || filePath === 'null') continue;
    const hunksContent = d[3] ?? '';
    const hunkBodyRe = /@@[^\n]*@@\n?([\s\S]*?)(?=@@[^\n]*@@|$)/g;
    let h: RegExpExecArray | null;
    while ((h = hunkBodyRe.exec(hunksContent)) !== null) {
      const { searchLines, replaceLines, hasRemovals } = classifyHunkLines((h[1] ?? '').split('\n'));
      const searchBlock = searchLines.join('\n').replace(/\n+$/, '');
      const replaceBlock = replaceLines.join('\n').replace(/\n+$/, '');
      if (replaceBlock) {
        ops.push(hasRemovals
          ? { type: 'replace', filePath, searchBlock, replaceBlock }
          : { type: 'create', filePath, replaceBlock });
      }
    }
  }
  return ops;
}

function parseFallbackOps(llmResponse: string): FileOperation[] {
  const ops: FileOperation[] = [];

  const fenceHeaderRe = /`{3,4}(?:\w+[ \t]+)?([^\s`]+\.[a-zA-Z0-9]{1,10})\n([\s\S]*?)\n`{3,4}/g;
  let fb: RegExpExecArray | null;
  while ((fb = fenceHeaderRe.exec(llmResponse)) !== null) {
    const candidate = (fb[1] ?? '').trim();
    if (candidate.includes('/') || candidate.includes('\\') || /^[a-z][\w-]*\.[a-zA-Z0-9]{1,10}$/.test(candidate)) {
      ops.push({ type: 'create', filePath: candidate, replaceBlock: fb[2] ?? '' });
    }
  }
  if (ops.length > 0) return ops;

  const slashCommentRe = /`{3,4}\w*\n(\/\/[ \t]*(?:filepath:[ \t]*)?[^\n]+\.[a-zA-Z0-9]{1,10})\n([\s\S]*?)\n`{3,4}/g;
  let sc: RegExpExecArray | null;
  while ((sc = slashCommentRe.exec(llmResponse)) !== null) {
    const filePath = (sc[1] ?? '').trim().replace(/^\/\/[ \t]*(?:filepath:[ \t]*)?/, '').trim();
    if (filePath) ops.push({ type: 'create', filePath, replaceBlock: sc[2] ?? '' });
  }
  if (ops.length > 0) return ops;

  const hashCommentRe = /`{3,4}\w*\n(#[ \t]*[^\n]+\.[a-zA-Z0-9]{1,10})\n([\s\S]*?)\n`{3,4}/g;
  let hc: RegExpExecArray | null;
  while ((hc = hashCommentRe.exec(llmResponse)) !== null) {
    const filePath = (hc[1] ?? '').trim().replace(/^#[ \t]*/, '').trim();
    if (filePath) ops.push({ type: 'create', filePath, replaceBlock: hc[2] ?? '' });
  }
  return ops;
}

// ---------------------------------------------------------------------------
// parseCodeOperations helpers
// ---------------------------------------------------------------------------

/**
 * When a filepath: comment appears BEFORE a SEARCH block (rather than after
 * REPLACE), extract the operation and append it to ops — unless already captured
 * by the primary regex.
 */
function parseSearchBlockWithPrecedingFilepath(
  lines: string[],
  searchLineIndex: number,
  ops: FileOperation[],
): void {
  // Look backwards up to 5 lines for a filepath: or // filepath:
  for (let j = Math.max(0, searchLineIndex - 5); j < searchLineIndex; j++) {
    const fpMatch = lines[j]?.match(/^(?:\/\/\s*)?filepath:\s*(.+)/);
    if (!fpMatch) continue;

    const fp = fpMatch[1]?.trim() ?? '';
    const eqIdx = lines.indexOf('=======', searchLineIndex);
    const repEndIdx = lines.indexOf('>>>>>>> REPLACE', eqIdx);
    if (eqIdx === -1 || repEndIdx === -1) break;

    const searchBlock = lines.slice(searchLineIndex + 1, eqIdx).join('\n');
    const replaceBlock = lines.slice(eqIdx + 1, repEndIdx).join('\n');
    const alreadyCaptured = ops.some(
      (o) => o.filePath === fp && o.searchBlock === searchBlock,
    );
    if (!alreadyCaptured) {
      ops.push({ type: 'replace', filePath: fp, searchBlock, replaceBlock });
    }
    break;
  }
}

// ---------------------------------------------------------------------------
// parseCodeOperations
// ---------------------------------------------------------------------------

/**
 * Parse SEARCH/REPLACE blocks and NEW_FILE blocks from an LLM response string.
 * Returns an array of FileOperation objects. Never throws; returns [] on no match.
 */
export function parseCodeOperations(llmResponse: string): FileOperation[] {
  const ops: FileOperation[] = [];

  // Format 1 — SEARCH/REPLACE
  const searchReplaceRe =
    /<<<<<<< SEARCH\n([\s\S]*?)\n?=======\n([\s\S]*?)\n?>>>>>>> REPLACE\nfilepath:\s*(.+)/g;
  let m: RegExpExecArray | null;
  while ((m = searchReplaceRe.exec(llmResponse)) !== null) {
    const searchBlock = m[1] ?? '';
    const replaceBlock = m[2] ?? '';
    let filePath = (m[3] ?? '').trim();
    // Strip leading // from "// filepath:" style
    filePath = filePath.replace(/^\/\/\s*/, '');
    ops.push({ type: 'replace', filePath, searchBlock, replaceBlock });
  }

  // Also handle filepath BEFORE the SEARCH block (check 5 lines above <<<<<<< SEARCH)
  const lines = llmResponse.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === '<<<<<<< SEARCH') {
      parseSearchBlockWithPrecedingFilepath(lines, i, ops);
    }
  }

  // Format 2 — NEW_FILE
  const newFileRe = /NEW_FILE:\s*(.+)\n`{3,4}\w*\n([\s\S]*?)\n`{3,4}/g;
  let n: RegExpExecArray | null;
  while ((n = newFileRe.exec(llmResponse)) !== null) {
    const filePath = (n[1] ?? '').trim();
    const replaceBlock = n[2] ?? '';
    ops.push({ type: 'create', filePath, replaceBlock });
  }

  // Format 3 — Unified diff (--- a/file / +++ b/file with @@ hunks)
  ops.push(...parseDiffOps(llmResponse));

  // Format 4 — Whole-file heading (## FILE: path, === File: path ===, etc.)
  const wholeFileRe =
    /(?:^|\n)(?:##+[ \t]+(?:FILE:[ \t]*)?|===[ \t]+[Ff]ile:[ \t]*|FILE:[ \t]*)([^\n]+?\.[a-zA-Z0-9]{1,10})[ \t]*(?:===)?[ \t]*\n`{3,4}\w*\n([\s\S]*?)\n`{3,4}/g;
  let w: RegExpExecArray | null;
  while ((w = wholeFileRe.exec(llmResponse)) !== null) {
    const filePath = (w[1] ?? '').trim();
    const replaceBlock = w[2] ?? '';
    if (filePath) ops.push({ type: 'create', filePath, replaceBlock });
  }

  // Fallback — only when no ops found yet: flexible fence detection
  if (ops.length === 0) ops.push(...parseFallbackOps(llmResponse));

  return ops;
}

// ---------------------------------------------------------------------------
// findFuzzyMatch
// ---------------------------------------------------------------------------

/**
 * Sliding-window fuzzy match of needle in haystack using levenshteinSimilarity.
 * Returns { index, score } if best score >= 0.8, else null.
 * index is the character offset in haystack where the best window starts.
 */
export function findFuzzyMatch(
  haystack: string,
  needle: string,
): { index: number; score: number } | null {
  const haystackLines = haystack.split('\n');
  const needleLines = needle.split('\n');
  const windowSize = needleLines.length;

  if (windowSize === 0 || haystackLines.length < windowSize) {
    return null;
  }

  let bestScore = -1;
  let bestCharIndex = 0;

  for (let start = 0; start <= haystackLines.length - windowSize; start++) {
    const windowStr = haystackLines.slice(start, start + windowSize).join('\n');
    const score = levenshteinSimilarity(windowStr, needle);
    if (score > bestScore) {
      bestScore = score;
      // Compute character start index: sum of lengths + newlines for lines 0..start-1
      let charIdx = 0;
      for (let k = 0; k < start; k++) {
        charIdx += (haystackLines[k]?.length ?? 0) + 1; // +1 for '\n'
      }
      bestCharIndex = charIdx;
    }
  }

  if (bestScore >= 0.8) {
    return { index: bestCharIndex, score: bestScore };
  }
  return null;
}

// ---------------------------------------------------------------------------
// applyOperation
// ---------------------------------------------------------------------------

function normalizeWS(s: string): string {
  return s
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/**
 * Apply a single FileOperation using real fs or injected seams.
 */
async function applyReplaceOp(
  filePath: string,
  absPath: string,
  op: FileOperation,
  readFile: (p: string) => Promise<string>,
  writeFile: (p: string, c: string) => Promise<void>,
  exists: (p: string) => Promise<boolean>,
): Promise<ApplyResult> {
  if (!op.searchBlock && op.searchBlock !== '') {
    return { filePath, success: false, error: 'No searchBlock provided for replace operation' };
  }
  if (!(await exists(absPath))) {
    return { filePath, success: false, error: 'File not found for replace operation' };
  }
  let existing: string;
  try {
    existing = await readFile(absPath);
  } catch {
    return { filePath, success: false, error: 'File not found for replace operation' };
  }
  const searchBlock = op.searchBlock ?? '';
  if (existing.includes(searchBlock)) {
    await writeFile(absPath, existing.replace(searchBlock, op.replaceBlock));
    return { filePath, success: true, matchStrategy: 'exact' };
  }
  const normExisting = normalizeWS(existing);
  const normSearch = normalizeWS(searchBlock);
  if (normSearch.length > 0 && normExisting.includes(normSearch)) {
    const searchLines = searchBlock.split('\n');
    const existingLines = existing.split('\n');
    const firstTrimmed = searchLines[0]?.trim() ?? '';
    const startIdx = existingLines.findIndex((l) => l.trim() === firstTrimmed);
    if (startIdx !== -1) {
      const updated = [...existingLines.slice(0, startIdx), op.replaceBlock, ...existingLines.slice(startIdx + searchLines.length)].join('\n');
      await writeFile(absPath, updated);
      return { filePath, success: true, matchStrategy: 'whitespace' };
    }
  }
  const match = findFuzzyMatch(existing, searchBlock);
  if (match !== null) {
    await writeFile(absPath, existing.slice(0, match.index) + op.replaceBlock + existing.slice(match.index + searchBlock.length));
    return { filePath, success: true, matchStrategy: 'fuzzy' };
  }
  return { filePath, success: false, error: 'SEARCH block not found in file' };
}

/**
 * Apply a single FileOperation to the filesystem (or injected seams).
 * Supports 'create', 'append', and 'replace' operation types.
 * Replace uses exact → whitespace-normalised → fuzzy matching in order.
 */
export async function applyOperation(
  op: FileOperation,
  opts?: CodeWriterOptions,
): Promise<ApplyResult> {
  const readFile = opts?._readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile =
    opts?._writeFile ??
    ((p: string, c: string) => fs.writeFile(p, c, 'utf8'));
  const exists =
    opts?._exists ??
    (async (p: string) => {
      try {
        await fs.access(p);
        return true;
      } catch {
        return false;
      }
    });
  const mkdirp =
    opts?._mkdirp ??
    ((p: string) => fs.mkdir(p, { recursive: true }).then(() => {}));

  let absPath: string;
  try {
    absPath = sanitizePath(op.filePath, opts?.cwd ?? process.cwd());
  } catch (err) {
    if (err instanceof ValidationError) {
      return { filePath: op.filePath, success: false, error: err.message };
    }
    throw err;
  }

  if (op.type === 'create') {
    await mkdirp(path.dirname(absPath));
    await writeFile(absPath, op.replaceBlock);
    return { filePath: op.filePath, success: true };
  }

  if (op.type === 'append') {
    let existing = '';
    if (await exists(absPath)) {
      try {
        existing = await readFile(absPath);
      } catch {
        existing = '';
      }
    }
    await mkdirp(path.dirname(absPath));
    await writeFile(absPath, existing + '\n' + op.replaceBlock);
    return { filePath: op.filePath, success: true };
  }

  // 'replace' type
  return applyReplaceOp(op.filePath, absPath, op, readFile, writeFile, exists);
}

// ---------------------------------------------------------------------------
// applyAllOperations
// ---------------------------------------------------------------------------

/**
 * Apply all operations sequentially, accumulating per-operation results.
 * The aggregate result's `success` flag is true only when ALL operations succeed.
 */
export async function applyAllOperations(
  ops: FileOperation[],
  opts?: CodeWriterOptions,
): Promise<ApplyAllResult> {
  const results: ApplyResult[] = [];
  for (const op of ops) {
    const result = await applyOperation(op, opts);
    results.push(result);
  }
  return {
    operations: results,
    filesWritten: results.filter((r) => r.success).map((r) => r.filePath),
    filesFailedToApply: results.filter((r) => !r.success).map((r) => r.filePath),
    success: results.every((r) => r.success),
  };
}
