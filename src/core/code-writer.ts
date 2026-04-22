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
      // Look backwards up to 5 lines for a filepath: or // filepath:
      for (let j = Math.max(0, i - 5); j < i; j++) {
        const fpMatch = lines[j]?.match(/^(?:\/\/\s*)?filepath:\s*(.+)/);
        if (fpMatch) {
          const fp = fpMatch[1]?.trim() ?? '';
          // Find the corresponding REPLACE block end to get content
          const eqIdx = lines.indexOf('=======', i);
          const repEndIdx = lines.indexOf('>>>>>>> REPLACE', eqIdx);
          if (eqIdx !== -1 && repEndIdx !== -1) {
            // Check if this filepath is already captured by the main regex
            const alreadyCaptured = ops.some(
              (o) => o.filePath === fp && o.searchBlock === lines.slice(i + 1, eqIdx).join('\n'),
            );
            if (!alreadyCaptured) {
              const searchBlock = lines.slice(i + 1, eqIdx).join('\n');
              const replaceBlock = lines.slice(eqIdx + 1, repEndIdx).join('\n');
              ops.push({ type: 'replace', filePath: fp, searchBlock, replaceBlock });
            }
          }
          break;
        }
      }
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
  // Matches the most common LLM deviation from SEARCH/REPLACE format.
  // Negative lookahead prevents consuming the next --- file header as a hunk line
  const diffHeaderRe = /^---[ \t]+(?:a\/)?(.+?)[ \t]*\r?\n\+\+\+[ \t]+(?:b\/)?(.+?)[ \t]*\r?\n((?:(?!---[ \t])(?:@@|[ +\-\\\\])[^\n]*\n?)+)/gm;
  let d: RegExpExecArray | null;
  while ((d = diffHeaderRe.exec(llmResponse)) !== null) {
    // Strip optional timestamp suffix (--- src/foo.ts 2024-01-01 ...)
    const sourcePath = (d[1] ?? '').trim().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
    const targetPath = (d[2] ?? '').trim().replace(/\s+\d{4}-\d{2}-\d{2}.*$/, '').trim();
    // When source is /dev/null (new file), use target path instead
    const filePath = (!sourcePath || sourcePath === '/dev/null' || sourcePath === 'null')
      ? targetPath
      : sourcePath;
    if (!filePath || filePath === '/dev/null' || filePath === 'null') continue;
    const hunksContent = d[3] ?? '';

    // Split on @@ markers to get individual hunks
    const hunkBodyRe = /@@[^\n]*@@\n?([\s\S]*?)(?=@@[^\n]*@@|$)/g;
    let h: RegExpExecArray | null;
    while ((h = hunkBodyRe.exec(hunksContent)) !== null) {
      const hunkBody = h[1] ?? '';
      const hunkLines = hunkBody.split('\n');
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
          // Context line — appears in both search and replace
          searchLines.push(line.slice(1));
          replaceLines.push(line.slice(1));
        }
        // Lines starting with '\' (e.g. "\ No newline at end of file") are skipped
      }

      const searchBlock = searchLines.join('\n').replace(/\n+$/, '');
      const replaceBlock = replaceLines.join('\n').replace(/\n+$/, '');

      if (replaceBlock) {
        if (!hasRemovals) {
          // Pure addition — treat as file creation
          ops.push({ type: 'create', filePath, replaceBlock });
        } else {
          ops.push({ type: 'replace', filePath, searchBlock, replaceBlock });
        }
      }
    }
  }

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
  if (ops.length === 0) {
    // Pass 1: filepath in fence header (```typescript src/foo.ts or ```ts src/foo.ts)
    const fenceHeaderRe = /`{3,4}(?:\w+[ \t]+)?([^\s`]+\.[a-zA-Z0-9]{1,10})\n([\s\S]*?)\n`{3,4}/g;
    let fb: RegExpExecArray | null;
    while ((fb = fenceHeaderRe.exec(llmResponse)) !== null) {
      const candidate = (fb[1] ?? '').trim();
      // Must contain a path separator or look like a real file (not just a word like "json")
      if (candidate.includes('/') || candidate.includes('\\') || /^[a-z][\w-]*\.[a-zA-Z0-9]{1,10}$/.test(candidate)) {
        const replaceBlock = fb[2] ?? '';
        ops.push({ type: 'create', filePath: candidate, replaceBlock });
      }
    }

    // Pass 2: // comment style path (original fallback)
    if (ops.length === 0) {
      const slashCommentRe = /`{3,4}\w*\n(\/\/[ \t]*(?:filepath:[ \t]*)?[^\n]+\.[a-zA-Z0-9]{1,10})\n([\s\S]*?)\n`{3,4}/g;
      let sc: RegExpExecArray | null;
      while ((sc = slashCommentRe.exec(llmResponse)) !== null) {
        const commentLine = (sc[1] ?? '').trim();
        const filePath = commentLine.replace(/^\/\/[ \t]*(?:filepath:[ \t]*)?/, '').trim();
        const replaceBlock = sc[2] ?? '';
        if (filePath) ops.push({ type: 'create', filePath, replaceBlock });
      }
    }

    // Pass 3: # hash comment style path (Python/shell convention)
    if (ops.length === 0) {
      const hashCommentRe = /`{3,4}\w*\n(#[ \t]*[^\n]+\.[a-zA-Z0-9]{1,10})\n([\s\S]*?)\n`{3,4}/g;
      let hc: RegExpExecArray | null;
      while ((hc = hashCommentRe.exec(llmResponse)) !== null) {
        const commentLine = (hc[1] ?? '').trim();
        const filePath = commentLine.replace(/^#[ \t]*/, '').trim();
        const replaceBlock = hc[2] ?? '';
        if (filePath) ops.push({ type: 'create', filePath, replaceBlock });
      }
    }
  }

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
 * Apply all operations sequentially. Returns aggregate result.
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
