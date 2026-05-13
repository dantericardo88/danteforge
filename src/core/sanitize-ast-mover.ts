// DanteSanitize — AST-based deterministic symbol mover (Sprint 3 — Tier 1)
//
// Extracts top-level interface/type/enum/function/class declarations from a
// source file into a new file, preserving leading JSDoc and updating imports.
//
// This is the deterministic Tier 1 mover. When it succeeds, no LLM call is
// needed. When it cannot handle a symbol (decorators, complex consts, etc.),
// it returns success: false and the engine falls back to LLM (Tier 2).
import { createRequire } from 'module';
import path from 'path';

const require_ = createRequire(import.meta.url);

export interface AstMoveResult {
  success: boolean;
  rewrittenOriginal?: string;
  newFileContent?: string;
  reason?: string;
}

export interface AstMoveOptions {
  /** Names of symbols to move (must all be top-level in the source). */
  symbols: string[];
  /** Imported-name list for the new file's content — usually matches `symbols`. */
  newFileName: string;
  /** Original file's content. */
  content: string;
  /** Original file's path (relative is fine; only used for messages). */
  filePath: string;
}

/**
 * Move a list of top-level symbols from a source file into a new file.
 * The returned `rewrittenOriginal` removes those symbols and adds an import
 * pointing at the new file. The returned `newFileContent` contains the
 * extracted symbols plus any imports they depend on.
 */
export function moveSymbolsViaAst(opts: AstMoveOptions): AstMoveResult {
  let ts: typeof import('typescript');
  try {
    ts = require_('typescript');
  } catch {
    return { success: false, reason: 'typescript module not available' };
  }

  const sf = ts.createSourceFile(
    path.basename(opts.filePath),
    opts.content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  // Find target statements
  const targetSet = new Set(opts.symbols);
  const targets: { stmt: import('typescript').Statement; name: string }[] = [];
  const remainingStatements: import('typescript').Statement[] = [];

  for (const stmt of sf.statements) {
    const name = extractStmtName(ts, stmt);
    if (name && targetSet.has(name)) {
      if (!isMoveable(ts, stmt)) {
        return { success: false, reason: `Symbol "${name}" has unsupported kind (e.g. namespace, decorator)` };
      }
      targets.push({ stmt, name });
    } else {
      remainingStatements.push(stmt);
    }
  }

  if (targets.length === 0) {
    return { success: false, reason: 'No matching symbols found in source' };
  }
  if (targets.length < opts.symbols.length) {
    const found = new Set(targets.map(t => t.name));
    const missing = opts.symbols.filter(s => !found.has(s));
    return { success: false, reason: `Symbols not found: ${missing.join(', ')}` };
  }

  // Collect original imports — both new file and rewritten original may need them
  const originalImports: string[] = [];
  for (const stmt of sf.statements) {
    if (ts.isImportDeclaration(stmt)) {
      originalImports.push(extractText(opts.content, stmt));
    }
  }

  // Build new file: imports + extracted statements
  const extractedTexts = targets.map(t => extractTextWithJsDoc(opts.content, t.stmt, sf, ts));
  // Determine which original imports are used by the extracted code
  const extractedBlob = extractedTexts.join('\n');
  const relevantImports = originalImports.filter(imp =>
    importIsReferencedBy(imp, extractedBlob),
  );

  const newFileContent = [
    ...relevantImports,
    '',
    ...extractedTexts,
  ].join('\n').trim() + '\n';

  // Build rewritten original: remove target statements, add import for moved symbols
  const removedRanges = targets.map(t => getStmtRangeWithJsDoc(t.stmt, sf, ts));
  const rewrittenOriginal = removeRangesAndAddImport(
    opts.content,
    removedRanges,
    opts.symbols,
    opts.newFileName,
  );

  return {
    success: true,
    rewrittenOriginal,
    newFileContent,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractStmtName(ts: typeof import('typescript'), stmt: import('typescript').Statement): string | null {
  if (ts.isInterfaceDeclaration(stmt) || ts.isTypeAliasDeclaration(stmt) || ts.isEnumDeclaration(stmt)) {
    return stmt.name.text;
  }
  if (ts.isClassDeclaration(stmt) && stmt.name) return stmt.name.text;
  if (ts.isFunctionDeclaration(stmt) && stmt.name) return stmt.name.text;
  if (ts.isVariableStatement(stmt)) {
    const first = stmt.declarationList.declarations[0];
    if (first && ts.isIdentifier(first.name)) return first.name.text;
  }
  return null;
}

function isMoveable(ts: typeof import('typescript'), stmt: import('typescript').Statement): boolean {
  if (ts.isInterfaceDeclaration(stmt)) return true;
  if (ts.isTypeAliasDeclaration(stmt)) return true;
  if (ts.isEnumDeclaration(stmt)) return true;
  if (ts.isFunctionDeclaration(stmt)) return true;
  if (ts.isClassDeclaration(stmt)) {
    // Skip classes with decorators (move semantics are unsafe)
    const modifiers = (stmt as { modifiers?: readonly import('typescript').ModifierLike[] }).modifiers;
    if (modifiers?.some(m => m.kind === ts.SyntaxKind.Decorator)) return false;
    return true;
  }
  if (ts.isVariableStatement(stmt)) {
    // Only single-declaration consts are safe to move atomically
    if (stmt.declarationList.declarations.length !== 1) return false;
    return (stmt.declarationList.flags & ts.NodeFlags.Const) !== 0;
  }
  return false;
}

function extractText(content: string, node: import('typescript').Node): string {
  return content.slice(node.pos, node.end);
}

function extractTextWithJsDoc(
  content: string,
  stmt: import('typescript').Statement,
  sf: import('typescript').SourceFile,
  ts: typeof import('typescript'),
): string {
  // node.pos includes leading trivia (whitespace + comments + JSDoc).
  // We trim leading whitespace but keep comments.
  const fullTrivia = content.slice(stmt.pos, stmt.end);
  return fullTrivia.replace(/^[\r\n]+/, '');
}

function getStmtRangeWithJsDoc(
  stmt: import('typescript').Statement,
  sf: import('typescript').SourceFile,
  ts: typeof import('typescript'),
): { start: number; end: number } {
  // Include leading trivia (JSDoc / line comments) in the removal range
  return { start: stmt.pos, end: stmt.end };
}

function removeRangesAndAddImport(
  content: string,
  ranges: { start: number; end: number }[],
  symbols: string[],
  newFileName: string,
): string {
  // Sort ranges descending so removals don't shift offsets
  const sorted = [...ranges].sort((a, b) => b.start - a.start);
  let result = content;
  for (const r of sorted) {
    result = result.slice(0, r.start) + result.slice(r.end);
  }
  // Insert import after the last existing import (or at top)
  const importPath = `./${newFileName.replace(/\.ts$/, '.js')}`;
  const importStmt = `import { ${symbols.join(', ')} } from '${importPath}';\n`;
  const lastImportRegex = /^(import[^;]+;\r?\n)+/m;
  const m = result.match(lastImportRegex);
  if (m) {
    const insertAt = (m.index ?? 0) + m[0].length;
    result = result.slice(0, insertAt) + importStmt + result.slice(insertAt);
  } else {
    result = importStmt + '\n' + result.trimStart();
  }
  // Clean up blank-line accumulation
  return result.replace(/\n{3,}/g, '\n\n');
}

function importIsReferencedBy(importStmt: string, code: string): boolean {
  // Extract imported names: import { A, B as C } from '...' or import D from '...'
  const namedMatch = importStmt.match(/import\s+(?:type\s+)?\{([^}]+)\}/);
  if (namedMatch) {
    const names = namedMatch[1]!.split(',').map(s => s.trim().split(/\s+as\s+/)[0]!.trim());
    return names.some(n => new RegExp(`\\b${n}\\b`).test(code));
  }
  const defaultMatch = importStmt.match(/import\s+(\w+)\s+from/);
  if (defaultMatch) return new RegExp(`\\b${defaultMatch[1]}\\b`).test(code);
  return true; // side-effect imports — keep them
}
