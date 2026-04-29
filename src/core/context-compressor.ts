// Per-agent context compression for DanteForge.
// Applies cascading string-based strategies to shrink LLM context windows per role.

import { estimateTokens } from './token-estimator.js';
import type { AgentRole } from './subagent-isolator.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CompressionResult {
  original: string;
  compressed: string;
  originalTokens: number;
  compressedTokens: number;
  reductionPercent: number;
  strategies: string[];
}

export interface CompressionConfig {
  stripComments: boolean;
  collapseWhitespace: boolean;
  truncateFileContent: boolean;
  maxFileLines: number;
  stripImports: boolean;
  summarizeTests: boolean;
  maxContextTokens: number;
}

// ---------------------------------------------------------------------------
// Individual strategy functions
// ---------------------------------------------------------------------------

/**
 * Remove single-line (//) and block comments without damaging URLs or
 * string literals that contain slashes.
 *
 * Approach: process line-by-line.
 *  - Block comments: track open/close state across lines.
 *  - Single-line: strip `//` only when it is NOT preceded by `:` (catches
 *    http:// and https://) and NOT inside a quoted string on that line.
 */
export function stripComments(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inBlock = false;

  for (const line of lines) {
    let processed = '';

    if (inBlock) {
      const endIdx = line.indexOf('*/');
      if (endIdx === -1) {
        // entire line is inside a block comment — skip it
        continue;
      }
      // block comment ends on this line; keep the remainder
      processed = line.slice(endIdx + 2);
      inBlock = false;
    } else {
      processed = line;
    }

    // Handle block comment openings (possibly multiple on one line)
    let safetyLimit = 50;
    while (!inBlock && processed.includes('/*') && safetyLimit-- > 0) {
      const startIdx = processed.indexOf('/*');
      // Check if the /* is inside a string literal on this line
      if (isInsideString(processed, startIdx)) {
        break;
      }
      const endIdx = processed.indexOf('*/', startIdx + 2);
      if (endIdx === -1) {
        // block comment starts but does not close on this line
        processed = processed.slice(0, startIdx);
        inBlock = true;
      } else {
        // block comment opens and closes on the same line
        processed = processed.slice(0, startIdx) + processed.slice(endIdx + 2);
      }
    }

    // Handle single-line comments (//) — but not URLs or string contents
    if (!inBlock) {
      processed = removeSingleLineComment(processed);
    }

    out.push(processed);
  }

  return out.join('\n');
}

/**
 * Strip a trailing single-line comment (`// ...`) from a line, but only when
 * the `//` is not part of a URL (`://`) and not inside a string literal.
 */
function removeSingleLineComment(line: string): string {
  let searchFrom = 0;
  while (searchFrom < line.length) {
    const idx = line.indexOf('//', searchFrom);
    if (idx === -1) break;

    // Skip URLs — the char before `//` would be `:`
    if (idx > 0 && line[idx - 1] === ':') {
      searchFrom = idx + 2;
      continue;
    }

    // Skip if inside a string literal
    if (isInsideString(line, idx)) {
      searchFrom = idx + 2;
      continue;
    }

    // Genuine comment — strip everything from here
    return line.slice(0, idx);
  }
  return line;
}

/**
 * Naive check: count unescaped single and double quotes before `pos`.
 * If either count is odd the position is inside that string literal.
 */
function isInsideString(line: string, pos: number): boolean {
  let singleQuotes = 0;
  let doubleQuotes = 0;
  let backticks = 0;
  for (let i = 0; i < pos; i++) {
    if (line[i] === '\\') {
      i++; // skip escaped char
      continue;
    }
    if (line[i] === "'") singleQuotes++;
    if (line[i] === '"') doubleQuotes++;
    if (line[i] === '`') backticks++;
  }
  return singleQuotes % 2 === 1 || doubleQuotes % 2 === 1 || backticks % 2 === 1;
}

// ---------------------------------------------------------------------------

/**
 * Collapse runs of 3+ blank lines to exactly 2 blank lines.
 * Trim trailing whitespace on every line.
 */
export function collapseWhitespace(text: string): string {
  // Trim trailing whitespace on each line
  const trimmed = text
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n');

  // Collapse 3+ consecutive blank lines (\n\n\n+) down to 2 (\n\n)
  return trimmed.replace(/\n{3,}/g, '\n\n');
}

// ---------------------------------------------------------------------------

/**
 * Replace ES module import statements with a compact comment summary.
 *
 * Handles:
 *   import { A, B, C } from './module.js';
 *   import A from './module.js';
 *   import * as A from './module.js';
 *   import './module.js';          (side-effect import)
 *   import type { T } from '...';
 *
 * Multiline imports (opening `{` on one line, closing `}` further down) are
 * collapsed first, then processed.
 */
export function summarizeImports(text: string): string {
  // First, collapse multiline import statements into single lines
  const collapsed = collapseMultilineImports(text);

  const lines = collapsed.split('\n');
  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('import ')) {
      out.push(line);
      continue;
    }

    // Side-effect import: import './polyfill.js';
    const sideEffect = trimmed.match(/^import\s+['"](.+?)['"]\s*;?\s*$/);
    if (sideEffect) {
      const mod = extractModuleName(sideEffect[1]);
      out.push(`// imports: (side-effect) from ${mod}`);
      continue;
    }

    // Named / type imports: import { A, B } from '...'
    const named = trimmed.match(
      /^import\s+(?:type\s+)?\{\s*(.+?)\s*\}\s+from\s+['"](.+?)['"]\s*;?\s*$/
    );
    if (named) {
      const names = named[1]
        .split(',')
        .map((n) => n.trim().split(/\s+as\s+/).pop()!.trim())
        .filter(Boolean)
        .join(', ');
      const mod = extractModuleName(named[2]);
      out.push(`// imports: ${names} from ${mod}`);
      continue;
    }

    // Default import: import Foo from '...'
    const defaultImport = trimmed.match(
      /^import\s+(\w+)\s+from\s+['"](.+?)['"]\s*;?\s*$/
    );
    if (defaultImport) {
      const mod = extractModuleName(defaultImport[2]);
      out.push(`// imports: ${defaultImport[1]} from ${mod}`);
      continue;
    }

    // Namespace import: import * as X from '...'
    const nsImport = trimmed.match(
      /^import\s+\*\s+as\s+(\w+)\s+from\s+['"](.+?)['"]\s*;?\s*$/
    );
    if (nsImport) {
      const mod = extractModuleName(nsImport[2]);
      out.push(`// imports: ${nsImport[1]} (namespace) from ${mod}`);
      continue;
    }

    // Unrecognised import shape — keep as-is
    out.push(line);
  }

  return out.join('\n');
}

/**
 * Collapse multiline import statements that span several lines, e.g.:
 *   import {
 *     A,
 *     B,
 *   } from './mod.js';
 * into a single line.
 */
function collapseMultilineImports(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let collecting = false;
  let buffer = '';

  for (const line of lines) {
    if (!collecting) {
      const trimmed = line.trimStart();
      // Detect start of multiline import: has `import` and `{` but no closing `}`
      if (
        trimmed.startsWith('import ') &&
        trimmed.includes('{') &&
        !trimmed.includes('}')
      ) {
        collecting = true;
        buffer = trimmed;
        continue;
      }
      out.push(line);
    } else {
      buffer += ' ' + line.trim();
      if (line.includes('}')) {
        // Normalize internal whitespace
        out.push(buffer.replace(/\s+/g, ' '));
        collecting = false;
        buffer = '';
      }
    }
  }

  // If we were still collecting (malformed import), flush as-is
  if (collecting && buffer) {
    out.push(buffer);
  }

  return out.join('\n');
}

/** Strip path prefix and extension to produce a short module name. */
function extractModuleName(specifier: string): string {
  // Remove leading ./ or ../
  let name = specifier.replace(/^\.\.?\//, '');
  // Remove trailing .js / .ts / .mjs / .cjs extensions
  name = name.replace(/\.(m?[jt]s|cjs)$/, '');
  return name;
}

// ---------------------------------------------------------------------------

/**
 * For fenced code blocks (``` ... ```) longer than `maxLines * 2`, keep the
 * first `maxLines` and last `maxLines` with an omission marker in between.
 */
export function truncateFileBlocks(text: string, maxLines: number): string {
  const threshold = maxLines * 2;
  const parts = text.split(/(```[^\n]*\n[\s\S]*?```)/g);

  return parts
    .map((part) => {
      // Only process fenced code blocks
      if (!part.startsWith('```')) return part;

      const lines = part.split('\n');
      // First line is the opening fence, last line is the closing fence
      const openFence = lines[0];
      const closeFence = lines[lines.length - 1];
      const bodyLines = lines.slice(1, -1);

      if (bodyLines.length <= threshold) return part;

      const head = bodyLines.slice(0, maxLines);
      const tail = bodyLines.slice(-maxLines);
      const omitted = bodyLines.length - maxLines * 2;

      return [
        openFence,
        ...head,
        `// ... (${omitted} lines omitted)`,
        ...tail,
        closeFence,
      ].join('\n');
    })
    .join('');
}

// ---------------------------------------------------------------------------

/**
 * Replace the bodies of test cases (`it(...)`, `test(...)`) with a brief
 * marker so the test name is preserved but the implementation is dropped.
 *
 * Targets patterns like:
 *   it('name', () => { ...multi-line... })
 *   test("name", async () => { ...multi-line... })
 *   it('name', function() { ...multi-line... })
 */
export function summarizeTestBodies(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let depth = 0;
  let capturing = false;
  let openLine = '';

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    const indent = lines[i].length - lines[i].trimStart().length;
    const indentStr = lines[i].slice(0, indent);

    if (!capturing) {
      // Detect the start of a test case
      const testStart = trimmed.match(
        /^(it|test)\s*\(\s*(['"`])(.*?)\2\s*,\s*(async\s+)?(\([^)]*\)|[^=]*)?\s*=>\s*\{/
      ) || trimmed.match(
        /^(it|test)\s*\(\s*(['"`])(.*?)\2\s*,\s*(async\s+)?function\s*\([^)]*\)\s*\{/
      );

      if (testStart) {
        // Check if it closes on the same line
        const braceCount = countBraces(lines[i]);
        if (braceCount <= 0) {
          // Single-line test — keep as-is
          out.push(lines[i]);
          continue;
        }
        // Multi-line test body — start capturing
        capturing = true;
        depth = braceCount;
        openLine = `${indentStr}${testStart[1]}('${testStart[3]}', () => { /* ... */ })`;
        continue;
      }
      out.push(lines[i]);
    } else {
      // We are inside a test body — count braces to find the end
      depth += countBraces(lines[i]);
      if (depth <= 0) {
        // Reached the closing — emit the summarised line
        out.push(openLine);
        capturing = false;
        depth = 0;
        openLine = '';
      }
    }
  }

  // If still capturing at EOF (malformed), flush what we have
  if (capturing && openLine) {
    out.push(openLine);
  }

  return out.join('\n');
}

/**
 * Count net opening braces on a line: each `{` is +1, each `}` is -1.
 */
function countBraces(line: string): number {
  let count = 0;
  for (const ch of line) {
    if (ch === '{') count++;
    if (ch === '}') count--;
  }
  return count;
}

// ---------------------------------------------------------------------------

/**
 * Hard-truncate text to fit within a token budget. Keeps the first N
 * characters that correspond to `maxTokens` and appends a truncation notice.
 */
function hardTokenCap(text: string, maxTokens: number): string {
  const current = estimateTokens(text, 'code-aware');
  if (current <= maxTokens) return text;

  // code-aware uses ~2.5 chars/token for code — use conservative budget
  const charBudget = maxTokens * 3;
  const notice = '\n\n// [context truncated to fit token budget]';
  const truncated = text.slice(0, Math.max(0, charBudget - notice.length));
  return truncated + notice;
}

// ---------------------------------------------------------------------------
// Main compression pipeline
// ---------------------------------------------------------------------------

function applyStep(
  text: string,
  enabled: boolean,
  fn: (s: string) => string,
  label: string,
  strategies: string[]
): string {
  if (!enabled) return text;
  const next = fn(text);
  if (next !== text) strategies.push(label);
  return next;
}

/**
 * Apply compression strategies in sequence based on the provided config.
 * Order: whitespace -> comments -> imports -> file truncation -> test bodies -> hard cap.
 */
export function compressContext(
  context: string,
  config: CompressionConfig
): CompressionResult {
  const originalTokens = estimateTokens(context);
  const strategies: string[] = [];
  let compressed = context;

  compressed = applyStep(compressed, config.collapseWhitespace, collapseWhitespace, 'collapseWhitespace', strategies);
  compressed = applyStep(compressed, config.stripComments, stripComments, 'stripComments', strategies);
  compressed = applyStep(compressed, config.stripImports, summarizeImports, 'summarizeImports', strategies);
  compressed = applyStep(compressed, config.truncateFileContent, (s) => truncateFileBlocks(s, config.maxFileLines), 'truncateFileBlocks', strategies);
  compressed = applyStep(compressed, config.summarizeTests, summarizeTestBodies, 'summarizeTestBodies', strategies);
  compressed = applyStep(compressed, true, (s) => hardTokenCap(s, config.maxContextTokens), 'hardTokenCap', strategies);

  const compressedTokens = estimateTokens(compressed);
  const reductionPercent =
    originalTokens > 0
      ? Math.round(((originalTokens - compressedTokens) / originalTokens) * 100)
      : 0;

  return {
    original: context,
    compressed,
    originalTokens,
    compressedTokens,
    reductionPercent,
    strategies,
  };
}

// ---------------------------------------------------------------------------
// Role-specific configuration
// ---------------------------------------------------------------------------

type ExtendedRole = AgentRole | 'reviewer';

const AGENT_CONFIGS: Record<ExtendedRole, CompressionConfig> = {
  pm: {
    stripComments: true,
    collapseWhitespace: true,
    truncateFileContent: true,
    maxFileLines: 30,
    stripImports: true,
    summarizeTests: true,
    maxContextTokens: 3000,
  },
  architect: {
    stripComments: false,
    collapseWhitespace: true,
    truncateFileContent: true,
    maxFileLines: 50,
    stripImports: true,
    summarizeTests: true,
    maxContextTokens: 5000,
  },
  dev: {
    stripComments: false,
    collapseWhitespace: true,
    truncateFileContent: true,
    maxFileLines: 100,
    stripImports: false,
    summarizeTests: false,
    maxContextTokens: 8000,
  },
  ux: {
    stripComments: true,
    collapseWhitespace: true,
    truncateFileContent: true,
    maxFileLines: 30,
    stripImports: true,
    summarizeTests: true,
    maxContextTokens: 3000,
  },
  design: {
    stripComments: true,
    collapseWhitespace: true,
    truncateFileContent: true,
    maxFileLines: 30,
    stripImports: true,
    summarizeTests: true,
    maxContextTokens: 3000,
  },
  'scrum-master': {
    stripComments: true,
    collapseWhitespace: true,
    truncateFileContent: true,
    maxFileLines: 20,
    stripImports: true,
    summarizeTests: true,
    maxContextTokens: 4000,
  },
  reviewer: {
    stripComments: false,
    collapseWhitespace: true,
    truncateFileContent: true,
    maxFileLines: 80,
    stripImports: false,
    summarizeTests: false,
    maxContextTokens: 6000,
  },
};

/**
 * Return the compression configuration tuned for a given agent role.
 * Falls back to the `dev` profile for unrecognised roles (widest context).
 */
export function getAgentCompressionConfig(role: ExtendedRole): CompressionConfig {
  const config = AGENT_CONFIGS[role];
  if (config) {
    return { ...config };
  }
  // Fallback: dev profile (most permissive)
  return { ...AGENT_CONFIGS.dev };
}
