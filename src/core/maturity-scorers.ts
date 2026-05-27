// maturity-scorers.ts — Shared helper utilities for maturity-engine dimension scorers.
// Split from maturity-engine.ts to keep files under the 750-LOC hard cap.
import fs from 'fs/promises';
import path from 'path';

// ── Helper Functions ───────────────────────────────────────────────────────

export async function defaultCollectFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: import('fs').Dirent[] = [];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const sub = await defaultCollectFiles(full);
      results.push(...sub);
    } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

let _tsModule: typeof import('typescript') | null = null;
try {
  const { createRequire } = await import('node:module');
  const require = createRequire(import.meta.url);
  _tsModule = require('typescript') as typeof import('typescript');
} catch { /* TypeScript not available — fall back to regex */ }

export function extractFunctions(content: string): string[] {
  if (_tsModule) {
    try {
      const ts = _tsModule;
      const sf = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
      const results: string[] = [];
      // Only collect top-level declarations — avoids counting nested callbacks
      for (const stmt of sf.statements) {
        if (ts.isFunctionDeclaration(stmt)) {
          results.push(stmt.getFullText(sf));
        } else if (ts.isVariableStatement(stmt)) {
          for (const decl of stmt.declarationList.declarations) {
            if (decl.initializer && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
              results.push(stmt.getFullText(sf));
            }
          }
        }
      }
      return results;
    } catch { /* fall through to regex */ }
  }
  // Fallback: top-level declarations only with declaration-distance sizing
  const regex = /^(?:export\s+)?(?:async\s+)?function\s+\w+\s*\([^)]*\)[^{]*\{|^(?:export\s+)?const\s+\w+\s*=\s*(?:async\s+)?\([^)]*\)\s*=>\s*\{/gm;
  const lines = content.split('\n');
  const matchLines: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
    matchLines.push(content.slice(0, match.index).split('\n').length - 1);
  }
  return matchLines.map((start, i) => {
    const end = i + 1 < matchLines.length ? matchLines[i + 1] : lines.length;
    return lines.slice(start, end).join('\n');
  });
}

export function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
