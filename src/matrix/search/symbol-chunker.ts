// Symbol-aware code chunker.
//
// Phase L.3b of docs/PRDs/autonomous-frontier-reaching.md. Chunks source files
// by function/class/method boundaries so search results land on semantic
// units instead of line-windows.
//
// HONEST IMPLEMENTATION NOTES:
//   - TypeScript: uses the existing `buildSymbolGraph` (TS compiler API,
//     already in DanteForge's devDeps via `typescript`). Top-tier accuracy.
//   - Python: regex-based chunker. Good enough to identify `def` and `class`
//     boundaries; not as precise as a real parser would be on edge cases like
//     decorated functions or nested classes.
//   - Other languages: returns a single "whole-file" chunk.
//
// The PRD's stretch goal is full tree-sitter integration covering all major
// languages. That requires a native toolchain (node-gyp + C++ build tools)
// that isn't universally available — particularly on operator Windows
// machines. Deferring native tree-sitter keeps the substrate runnable
// everywhere; an operator who installs the toolchain can replace this module
// without changing any consumer.

import path from 'node:path';
import { buildSymbolGraph } from '../../core/sanitize-boundary.js';

// ── Chunk type ───────────────────────────────────────────────────────────────

export interface SymbolChunk {
  /** File path (relative to cwd, when applicable). */
  file: string;
  /** Symbol name (function/class/method). For whole-file chunks: '<file>'. */
  symbol: string;
  /** What kind of symbol. */
  kind: 'function' | 'class' | 'method' | 'interface' | 'type' | 'enum' | 'const' | 'let' | 'var' | 'whole-file';
  /** 1-indexed start line. */
  startLine: number;
  /** 1-indexed end line (inclusive). */
  endLine: number;
  /** Source content of the chunk. */
  content: string;
  /** Language detected. */
  language: 'typescript' | 'javascript' | 'python' | 'other';
}

// ── Language detection ──────────────────────────────────────────────────────

export function detectLanguage(filePath: string): SymbolChunk['language'] {
  const ext = path.extname(filePath).toLowerCase();
  if (['.ts', '.tsx', '.mts', '.cts'].includes(ext)) return 'typescript';
  if (['.js', '.jsx', '.mjs', '.cjs'].includes(ext)) return 'javascript';
  if (ext === '.py') return 'python';
  return 'other';
}

// ── TypeScript chunker (uses existing buildSymbolGraph) ─────────────────────

function chunkTypeScript(filePath: string, content: string): SymbolChunk[] {
  let graph;
  try {
    graph = buildSymbolGraph(content, filePath);
  } catch {
    return [wholeFile(filePath, content, 'typescript')];
  }
  const lines = content.split(/\r?\n/);
  const chunks: SymbolChunk[] = [];
  for (const [name, node] of graph.nodes) {
    if (!['function', 'class', 'interface', 'type', 'enum', 'const'].includes(node.kind)) continue;
    const startIdx = Math.max(0, node.startLine - 1);
    const endIdx = Math.min(lines.length, node.endLine);
    const body = lines.slice(startIdx, endIdx).join('\n');
    chunks.push({
      file: filePath,
      symbol: name,
      kind: node.kind as SymbolChunk['kind'],
      startLine: node.startLine,
      endLine: node.endLine,
      content: body,
      language: 'typescript',
    });
  }
  if (chunks.length === 0) {
    return [wholeFile(filePath, content, 'typescript')];
  }
  return chunks;
}

// ── Python chunker (regex-based) ────────────────────────────────────────────

const PYTHON_DEF_RE = /^([ \t]*)(?:async\s+)?(def|class)\s+(\w+)/;

function chunkPython(filePath: string, content: string): SymbolChunk[] {
  const lines = content.split(/\r?\n/);
  // Pass 1: locate every `def` / `class` declaration and its indent level.
  interface PyDecl {
    name: string;
    kind: 'function' | 'class' | 'method';
    indent: number;
    line: number;
  }
  const decls: PyDecl[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i]!.match(PYTHON_DEF_RE);
    if (!m) continue;
    const indent = m[1]!.length;
    const kind = m[2] === 'class' ? 'class' : (indent > 0 ? 'method' : 'function');
    decls.push({
      name: m[3]!,
      kind: kind as PyDecl['kind'],
      indent,
      line: i + 1,
    });
  }
  if (decls.length === 0) {
    return [wholeFile(filePath, content, 'python')];
  }

  // Pass 2: derive end-line for each decl by finding the next line at
  // indent <= decl.indent (de-indent or end-of-file).
  const chunks: SymbolChunk[] = [];
  for (let i = 0; i < decls.length; i++) {
    const decl = decls[i]!;
    let endLine = lines.length;
    for (let j = decl.line; j < lines.length; j++) {
      const line = lines[j]!;
      if (line.trim() === '') continue;
      const leading = (line.match(/^[ \t]*/)?.[0] ?? '').length;
      if (leading <= decl.indent) {
        endLine = j;  // 1-indexed exclusive of this line; so j (the 0-indexed line number) is the new endLine inclusive of prev
        break;
      }
    }
    const startIdx = decl.line - 1;
    const endIdx = endLine;
    const body = lines.slice(startIdx, endIdx).join('\n');
    chunks.push({
      file: filePath,
      symbol: decl.name,
      kind: decl.kind,
      startLine: decl.line,
      endLine,
      content: body,
      language: 'python',
    });
  }
  return chunks;
}

// ── Whole-file fallback ─────────────────────────────────────────────────────

function wholeFile(
  filePath: string,
  content: string,
  language: SymbolChunk['language'],
): SymbolChunk {
  const lines = content.split(/\r?\n/);
  return {
    file: filePath,
    symbol: '<file>',
    kind: 'whole-file',
    startLine: 1,
    endLine: lines.length,
    content,
    language,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Chunk a source file by symbol boundaries. Returns at least one chunk:
 *   - TypeScript / JavaScript: one chunk per top-level declaration
 *   - Python: one chunk per top-level `def`/`class` + methods inside classes
 *   - Other languages: a single whole-file chunk
 *
 * Pure function: no I/O. Caller passes content. Tests pass fixture strings.
 */
export function chunkFile(filePath: string, content: string): SymbolChunk[] {
  const lang = detectLanguage(filePath);
  switch (lang) {
    case 'typescript':
    case 'javascript':
      return chunkTypeScript(filePath, content);
    case 'python':
      return chunkPython(filePath, content);
    default:
      return [wholeFile(filePath, content, 'other')];
  }
}
