// Local Transforms — code transforms for DanteForge.
// Pure functions: content in, content out. add-types uses TypeScript AST; all others are regex-based.

import { logger } from './logger.js';
import { createRequire } from 'node:module';

// TypeScript compiler API — loaded once for add-types AST transform
let tsModule: typeof import('typescript') | null = null;
try {
  const require = createRequire(import.meta.url);
  tsModule = require('typescript') as typeof import('typescript');
} catch {
  // TypeScript not available — add-types will be a no-op
}

// --- Types -------------------------------------------------------------------

export type TransformType =
  | 'add-types'
  | 'add-error-handling'
  | 'add-jsdoc'
  | 'fix-imports'
  | 'var-to-const'
  | 'add-logging'
  | 'remove-console'
  | 'async-await-conversion'
  | 'add-null-checks';

export interface TransformResult {
  applied: boolean;
  transform: TransformType;
  filePath: string;
  originalContent: string;
  transformedContent: string;
  linesChanged: number;
  error?: string;
}

// --- Helpers -----------------------------------------------------------------

function countChangedLines(original: string, transformed: string): number {
  const origLines = original.split('\n');
  const newLines = transformed.split('\n');
  let changed = 0;
  const maxLen = Math.max(origLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if ((origLines[i] ?? '') !== (newLines[i] ?? '')) changed++;
  }
  return changed;
}

function buildResult(
  transform: TransformType,
  filePath: string,
  originalContent: string,
  transformedContent: string,
  error?: string,
): TransformResult {
  const applied = !error && transformedContent !== originalContent;
  return {
    applied,
    transform,
    filePath,
    originalContent,
    transformedContent: error ? originalContent : transformedContent,
    linesChanged: applied ? countChangedLines(originalContent, transformedContent) : 0,
    error,
  };
}

/** Consume a block comment starting at `start` (the position after the opening `/*`).
 *  Returns `{ endIdx, newlines }` where `endIdx` is the index past the closing `* /`
 *  and `newlines` is the newline characters to preserve for line-number alignment. */
function consumeBlockComment(content: string, start: number): { endIdx: number; newlines: string } {
  const len = content.length;
  let i = start;
  let newlines = '';
  while (i < len - 1) {
    if (content[i] === '*' && content[i + 1] === '/') { i += 2; break; }
    if (content[i] === '\n') newlines += '\n';
    i++;
  }
  // Handle unclosed block comment at EOF
  if (i >= len - 1 && !(content[len - 2] === '*' && content[len - 1] === '/')) {
    while (i < len) {
      if (content[i] === '\n') newlines += '\n';
      i++;
    }
  }
  return { endIdx: i, newlines };
}

/** Strip string literals and comments to avoid false regex matches.
 *  Uses a character-by-character state machine to correctly handle:
 *  - Escaped quotes inside strings
 *  - Template literals with nested ${...} expressions (brace-depth tracking)
 *  - Block comments and line comments
 *  - URLs like https:// (colon before // is not a comment)
 */
export function stripStringsAndComments(content: string): string {
  let result = '';
  let i = 0;
  const len = content.length;

  while (i < len) {
    const ch = content[i];
    const next = i + 1 < len ? content[i + 1] : '';

    // Block comment: /*
    if (ch === '/' && next === '*') {
      const { endIdx, newlines } = consumeBlockComment(content, i + 2);
      result += newlines;
      i = endIdx;
      continue;
    }

    // Line comment: // but NOT when preceded by : (URLs like https://)
    if (ch === '/' && next === '/') {
      const prev = i > 0 ? content[i - 1] : '';
      if (prev !== ':') {
        // Skip to end of line
        i += 2;
        while (i < len && content[i] !== '\n') i++;
        continue;
      }
    }

    // Single or double quoted string: ' or "
    if (ch === "'" || ch === '"') {
      const quote = ch;
      result += '""';
      i++; // skip opening quote
      while (i < len) {
        if (content[i] === '\\') {
          i += 2; // skip escaped char
          continue;
        }
        if (content[i] === quote) {
          i++; // skip closing quote
          break;
        }
        // Preserve newlines inside strings (shouldn't normally occur in ' or " but be safe)
        if (content[i] === '\n') result += '\n';
        i++;
      }
      continue;
    }

    // Template literal: `
    if (ch === '`') {
      result += '""';
      const bodyStart = i + 1;
      i++; // skip opening backtick
      i = skipTemplateLiteralBody(content, i, len);
      // Preserve newlines from inside the template so line numbers stay aligned
      for (let k = bodyStart; k < i; k++) {
        if (content[k] === '\n') result += '\n';
      }
      continue;
    }

    // Default: emit the character as-is
    result += ch;
    i++;
  }

  // Line-count invariant — transformRemoveConsole depends on index alignment
  // between stripped and original lines. If something broke the alignment,
  // fall back to returning original content rather than producing misaligned output.
  const origLineCount = content.split('\n').length;
  const resultLineCount = result.split('\n').length;
  if (origLineCount !== resultLineCount) {
    return content;
  }

  return result;
}

/** Skip the body of a template literal, handling ${...} with brace-depth tracking.
 *  Returns the index just past the closing backtick (or len if unclosed). */
function skipTemplateLiteralBody(content: string, start: number, len: number): number {
  let i = start;
  while (i < len) {
    if (content[i] === '\\') {
      i += 2; // skip escaped char
      continue;
    }
    // Nested expression: ${
    if (content[i] === '$' && i + 1 < len && content[i + 1] === '{') {
      i += 2; // skip ${
      let braceDepth = 1;
      while (i < len && braceDepth > 0) {
        if (content[i] === '\\') {
          i += 2;
          continue;
        }
        if (content[i] === '{') braceDepth++;
        else if (content[i] === '}') {
          braceDepth--;
          if (braceDepth === 0) { i++; break; }
        }
        // Nested template literal inside expression
        else if (content[i] === '`') {
          i++;
          i = skipTemplateLiteralBody(content, i, len);
          continue;
        }
        // Nested strings inside expression
        else if (content[i] === "'" || content[i] === '"') {
          const q = content[i];
          i++;
          while (i < len) {
            if (content[i] === '\\') { i += 2; continue; }
            if (content[i] === q) { i++; break; }
            i++;
          }
          continue;
        }
        i++;
      }
      continue;
    }
    // Closing backtick
    if (content[i] === '`') {
      i++; // skip closing backtick
      return i;
    }
    i++;
  }
  return i;
}

// --- Transform: var-to-const -------------------------------------------------

function transformVarToConst(content: string): string {
  const lines = content.split('\n');
  return lines.map((line) => {
    // Skip lines that are entirely inside a comment or string
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return line;
    // Only replace `var ` at a word boundary, not inside strings
    // Check if the var keyword appears outside of quotes on this line
    const stripped = stripStringsAndComments(line);
    if (!/\bvar\s/.test(stripped)) return line;
    // Replace `var ` while preserving indentation — only the first occurrence per line
    return line.replace(/\bvar\s/, 'const ');
  }).join('\n');
}

// --- Transform: remove-console -----------------------------------------------

function transformRemoveConsole(content: string): string {
  // Remove console.log / console.debug / console.info statements (may span multiple lines)
  // Preserve console.error and console.warn
  // Strip full content ONCE so multi-line template literals are correctly handled,
  // then use stripped lines for detection/paren-counting and original lines for output.
  const fullStripped = stripStringsAndComments(content);
  const strippedLines = fullStripped.split('\n');
  const originalLines = content.split('\n');
  const result: string[] = [];
  let i = 0;
  while (i < originalLines.length) {
    const match = strippedLines[i]?.match(/^\s*console\.(log|debug|info)\s*\(/);
    if (!match) { result.push(originalLines[i]); i++; continue; }
    // Paren-count on stripped lines to find end of statement
    let depth = 0;
    let found = false;
    for (let j = i; j < strippedLines.length && !found; j++) {
      for (const ch of strippedLines[j]) {
        if (ch === '(') depth++;
        if (ch === ')') { depth--; if (depth === 0) { found = true; i = j + 1; break; } }
      }
      if (!found && j === strippedLines.length - 1) {
        // Malformed statement — keep original line, move on
        result.push(originalLines[i]); i++; found = true;
      }
    }
  }
  return result.join('\n');
}

// --- Transform: fix-imports --------------------------------------------------

function transformFixImports(content: string): string {
  // Add .js to relative imports that lack an extension
  // Matches: from './foo' or from '../bar/baz' but NOT from 'lodash' or from './foo.js'
  return content.replace(
    /(from\s+['"])(\.\.?\/[^'"]+?)(?<!\.[a-zA-Z]{1,5})(['"])/g,
    (match, prefix: string, importPath: string, quote: string) => {
      // Already has an extension
      if (/\.\w{1,5}$/.test(importPath)) return match;
      return `${prefix}${importPath}.js${quote}`;
    },
  );
}

// --- Transform: add-null-checks ----------------------------------------------

function transformAddNullChecks(content: string): string {
  // Convert deep property access chains (3+ levels) to optional chaining
  // e.g., obj.prop.method() -> obj?.prop?.method()
  // Skip lines in comments/strings; skip common safe patterns like `this.x.y`
  const lines = content.split('\n');
  return lines.map((line) => {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return line;
    // Strip guard: only transform if the chain pattern exists outside strings/comments
    if (!/\b[a-zA-Z_$]\w*\.[a-zA-Z_$]\w*\.[a-zA-Z_$]\w*/.test(stripStringsAndComments(line))) return line;
    // Match chains of 3+ property accesses: a.b.c or a.b.c.d(...)
    // Replace interior dots with ?. except after `this` and known safe prefixes
    return line.replace(
      /\b([a-zA-Z_$]\w*)\.([a-zA-Z_$]\w*)\.([a-zA-Z_$]\w*(?:\.[a-zA-Z_$]\w*)*)/g,
      (match, root: string, second: string, rest: string) => {
        // Skip safe patterns: this, Math, JSON, Object, Array, Number, String, console, process
        const safeRoots = ['this', 'Math', 'JSON', 'Object', 'Array', 'Number', 'String', 'console', 'process', 'Date', 'Promise', 'Buffer', 'globalThis'];
        if (safeRoots.includes(root)) return match;
        // Skip if already using optional chaining
        if (match.includes('?.')) return match;
        const chainedRest = rest.replace(/\./g, '?.');
        return `${root}?.${second}?.${chainedRest}`;
      },
    );
  }).join('\n');
}

// --- Transform: add-types (AST-based) ----------------------------------------
// Uses TypeScript compiler API to walk the AST and add `: unknown` to untyped
// function parameters. Only targets FunctionDeclaration, ArrowFunction, and
// FunctionExpression nodes — never touches call expressions.

function transformAddTypes(content: string): string {
  if (!tsModule) return content; // TypeScript not available — best-effort no-op

  try {
    const ts = tsModule;
    const sf = ts.createSourceFile('temp.ts', content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const edits: Array<{ pos: number; text: string }> = [];

    function visit(node: import('typescript').Node) {
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isArrowFunction(node) ||
        ts.isFunctionExpression(node) ||
        ts.isMethodDeclaration(node)
      ) {
        for (const param of node.parameters) {
          // Skip params that already have types, destructured params, rest params, 'this' param
          if (param.type) continue;
          if (param.dotDotDotToken) continue;
          if (!ts.isIdentifier(param.name)) continue;
          if (param.name.text === 'this') continue;
          // Skip params with initializers (default values provide implicit type)
          if (param.initializer) continue;

          edits.push({ pos: param.name.getEnd(), text: ': unknown' });
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(sf);

    if (edits.length === 0) return content;

    // Apply in reverse position order to preserve offsets
    let result = content;
    for (const edit of edits.sort((a, b) => b.pos - a.pos)) {
      result = result.slice(0, edit.pos) + edit.text + result.slice(edit.pos);
    }
    return result;
  } catch {
    return content; // Best-effort — if AST parsing fails, return unchanged
  }
}

// --- Transform: add-error-handling -------------------------------------------

function transformAddErrorHandling(content: string): string {
  // Wrap bare async function bodies with try/catch if they lack one
  // First pass: async function name(...) { body }
  let result = content.replace(
    /(async\s+function\s+\w+\s*\([^)]*\)\s*(?::\s*\w[^{]*)?\{)([\s\S]*?)(\n\})/g,
    (match, header: string, body: string, closing: string) => {
      // Skip if already has try/catch
      if (/\btry\s*\{/.test(body)) return match;
      // Skip empty or trivial bodies
      const trimmedBody = body.trim();
      if (!trimmedBody || trimmedBody.split('\n').length < 2) return match;
      const indented = body.split('\n').map((l) => l ? `  ${l}` : l).join('\n');
      return `${header}\n  try {${indented}\n  } catch (err: unknown) {\n    const message = err instanceof Error ? err.message : String(err);\n    throw new Error(\`Unhandled error: \${message}\`);\n  }${closing}`;
    },
  );
  // Second pass: const name = async (...) => { body }
  result = result.replace(
    /((?:export\s+)?const\s+\w+\s*=\s*async\s*\([^)]*\)\s*(?::\s*[^=>{]*)?\s*=>\s*\{)([\s\S]*?)(\n\})/g,
    (match, header: string, body: string, closing: string) => {
      if (/\btry\s*\{/.test(body)) return match;
      const trimmedBody = body.trim();
      if (!trimmedBody || trimmedBody.split('\n').length < 2) return match;
      const indented = body.split('\n').map((l) => l ? `  ${l}` : l).join('\n');
      return `${header}\n  try {${indented}\n  } catch (err: unknown) {\n    const message = err instanceof Error ? err.message : String(err);\n    throw new Error(\`Unhandled error: \${message}\`);\n  }${closing}`;
    },
  );
  return result;
}

// --- Transform: add-jsdoc ----------------------------------------------------

function transformAddJsdoc(content: string): string {
  // Add JSDoc block above exported functions that lack one
  const lines = content.split('\n');
  const result: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match exported function declarations or arrow function exports
    const funcMatch = line.match(/^export\s+(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)/);
    const arrowMatch = line.match(/^(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::\s*[^=]*)?=>/);
    const theMatch = funcMatch || arrowMatch;
    if (theMatch) {
      // Check if previous non-empty line is already a JSDoc closing tag
      let prevIdx = i - 1;
      while (prevIdx >= 0 && lines[prevIdx].trim() === '') prevIdx--;
      const prevLine = prevIdx >= 0 ? lines[prevIdx].trim() : '';
      if (!prevLine.endsWith('*/')) {
        const fnName = theMatch[1];
        const params = theMatch[2]
          .split(',')
          .map((p) => p.trim().split(/[:\s=]/)[0].trim())
          .filter(Boolean);
        const indent = line.match(/^(\s*)/)?.[1] ?? '';
        result.push(`${indent}/** ${fnName} */`);
        if (params.length > 0) {
          // Replace the simple doc with a param-aware one
          result.pop();
          const paramLines = params.map((p) => `${indent} * @param ${p}`).join('\n');
          result.push(`${indent}/**`);
          result.push(`${indent} * ${fnName}`);
          result.push(paramLines);
          result.push(`${indent} */`);
        }
      }
    }
    result.push(line);
  }
  return result.join('\n');
}

// --- Transform: add-logging --------------------------------------------------

function transformAddLogging(content: string): string {
  // Insert logger.info at the start of exported function bodies
  return content.replace(
    /(export\s+(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*(?::\s*[^{]*)?\{)([ \t]*\n)/g,
    (match, header: string, fnName: string, whitespace: string) => {
      // Detect indentation from the next line
      const bodyIndent = whitespace.match(/^([ \t]*)/)?.[1] ?? '  ';
      return `${header}\n${bodyIndent}  logger.info('[${fnName}] called');\n`;
    },
  );
}

// --- Transform: async-await-conversion ---------------------------------------

function transformAsyncAwait(content: string): string {
  // Convert simple .then() chains to await
  // Pattern: somePromise.then(result => { ... }) -> const result = await somePromise; ...
  // Only handle simple single-arg arrow callbacks
  // Strip guard: pre-compute stripped version and verify .then( exists outside strings/comments
  const stripped = stripStringsAndComments(content);
  return content.replace(
    /(\b\w[\w.]*(?:\([^)]*\))?)\s*\.then\(\s*(?:\(?\s*(\w+)\s*\)?\s*=>\s*\{([^}]*)\}|\(?\s*(\w+)\s*\)?\s*=>\s*([^\n,)]+))\s*\)/g,
    (match, promise: string, blockParam: string | undefined, blockBody: string | undefined, exprParam: string | undefined, exprBody: string | undefined, offset: number) => {
      // Verify .then( appears in the stripped version near this offset
      const strippedSlice = stripped.slice(Math.max(0, offset - 5), offset + match.length + 5);
      if (!strippedSlice.includes('.then(')) return match;
      const param = blockParam ?? exprParam;
      const body = blockBody ?? exprBody;
      if (!param || !body) return match;
      const trimmedBody = body.trim();
      if (!trimmedBody) return match;
      // If the body is a single expression
      if (!trimmedBody.includes('\n') && !blockBody) {
        return `const ${param} = await ${promise};\n${trimmedBody}`;
      }
      return `const ${param} = await ${promise};\n${trimmedBody}`;
    },
  );
}

// --- Registry ----------------------------------------------------------------

const TRANSFORM_FNS: Record<TransformType, (content: string) => string> = {
  'var-to-const': transformVarToConst,
  'remove-console': transformRemoveConsole,
  'fix-imports': transformFixImports,
  'add-null-checks': transformAddNullChecks,
  'add-types': transformAddTypes,
  'add-error-handling': transformAddErrorHandling,
  'add-jsdoc': transformAddJsdoc,
  'add-logging': transformAddLogging,
  'async-await-conversion': transformAsyncAwait,
};

// --- Detection patterns ------------------------------------------------------

const DETECTION_PATTERNS: Record<TransformType, (content: string, filePath: string) => boolean> = {
  'var-to-const': (content) => {
    const stripped = stripStringsAndComments(content);
    return /\bvar\s/.test(stripped);
  },
  'remove-console': (content) => /console\.(log|debug|info)\s*\(/.test(content),
  'fix-imports': (content, filePath) => {
    if (!filePath.match(/\.[cm]?[jt]sx?$/)) return false;
    // Check for relative imports missing extensions
    return /from\s+['"]\.\.?\/[^'"]+(?<!\.\w{1,5})['"]/.test(content);
  },
  'add-null-checks': (content) => {
    const stripped = stripStringsAndComments(content);
    // Look for 3+ level deep property chains excluding safe roots
    const safePrefix = /\b(?:this|Math|JSON|Object|Array|Number|String|console|process|Date|Promise|Buffer|globalThis)\./;
    const chains = stripped.match(/\b[a-zA-Z_$]\w*\.\w+\.\w+/g) ?? [];
    return chains.some((chain) => !safePrefix.test(chain) && !chain.includes('?.'));
  },
  'add-types': (content) => {
    // Requires TypeScript compiler API — if unavailable, skip detection
    if (!tsModule) return false;
    // Quick heuristic: look for function declarations/arrows with untyped params
    return /(?:function\s+\w+|=>\s*\{|const\s+\w+\s*=\s*(?:async\s*)?\()/.test(content)
      && /\(\s*[a-zA-Z_$]\w*\s*[,)]/.test(content);
  },
  'add-error-handling': (content) => {
    // Detect async functions without try/catch
    const asyncFuncs = content.match(/async\s+function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]*)?\{[\s\S]*?\n\}/g) ?? [];
    return asyncFuncs.some((fn) => !(/\btry\s*\{/.test(fn)) && fn.split('\n').length > 3);
  },
  'add-jsdoc': (content) => {
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (/^export\s+(?:async\s+)?function\s+\w+/.test(lines[i])) {
        let prevIdx = i - 1;
        while (prevIdx >= 0 && lines[prevIdx].trim() === '') prevIdx--;
        if (prevIdx < 0 || !lines[prevIdx].trim().endsWith('*/')) return true;
      }
    }
    return false;
  },
  'add-logging': (content) => {
    // Exported functions that lack a logger.info call as their first statement
    return /export\s+(?:async\s+)?function\s+\w+/.test(content)
      && !/export\s+(?:async\s+)?function\s+\w+\s*\([^)]*\)\s*(?::\s*[^{]*)?\{\s*\n\s*logger\.info/.test(content);
  },
  'async-await-conversion': (content) => /\.\s*then\s*\(\s*\(?\s*\w+\s*\)?\s*=>/.test(content),
};

// --- Public API --------------------------------------------------------------

/** Apply a single transform to file content. Pure function, no fs access. */
export function applyLocalTransform(
  filePath: string,
  content: string,
  transform: TransformType,
): TransformResult {
  const fn = TRANSFORM_FNS[transform];
  try {
    const transformed = fn(content);
    const result = buildResult(transform, filePath, content, transformed);
    if (result.applied) {
      logger.info(`[local-transforms] Applied ${transform} to ${filePath} (${result.linesChanged} lines changed)`);
    }
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[local-transforms] Failed to apply ${transform} to ${filePath}: ${message}`);
    return buildResult(transform, filePath, content, content, message);
  }
}

/** Detect which transforms would actually change the file. */
export function detectApplicableTransforms(content: string, filePath: string): TransformType[] {
  const applicable: TransformType[] = [];
  for (const [type, detect] of Object.entries(DETECTION_PATTERNS) as Array<[TransformType, (c: string, f: string) => boolean]>) {
    try {
      if (detect(content, filePath)) {
        // Verify the transform actually changes something
        const fn = TRANSFORM_FNS[type];
        const transformed = fn(content);
        if (transformed !== content) applicable.push(type);
      }
    } catch {
      // Detection failed — skip this transform
    }
  }
  return applicable;
}

/** Apply all applicable transforms in sequence, piping output through each. */
export function applyAllApplicable(filePath: string, content: string): TransformResult[] {
  const applicable = detectApplicableTransforms(content, filePath);
  if (applicable.length === 0) return [];

  const results: TransformResult[] = [];
  let current = content;

  for (const transform of applicable) {
    const result = applyLocalTransform(filePath, current, transform);
    results.push(result);
    if (result.applied) {
      current = result.transformedContent;
    }
  }

  return results;
}
