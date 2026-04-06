// Context Compressor tests — per-agent compression strategies, individual transforms, pipeline
import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  stripComments,
  collapseWhitespace,
  summarizeImports,
  truncateFileBlocks,
  summarizeTestBodies,
  compressContext,
  getAgentCompressionConfig,
} from '../src/core/context-compressor.js';
import type { CompressionConfig } from '../src/core/context-compressor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Full-blast config that enables every compression strategy. */
function allOnConfig(overrides: Partial<CompressionConfig> = {}): CompressionConfig {
  return {
    stripComments: true,
    collapseWhitespace: true,
    truncateFileContent: true,
    maxFileLines: 5,
    stripImports: true,
    summarizeTests: true,
    maxContextTokens: 100_000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// stripComments
// ---------------------------------------------------------------------------

describe('stripComments', () => {
  it('removes single-line comments', () => {
    const input = [
      'const x = 1; // set x',
      '// standalone comment',
      'const y = 2;',
    ].join('\n');

    const result = stripComments(input);

    assert.ok(!result.includes('// set x'), 'trailing comment should be removed');
    assert.ok(!result.includes('// standalone comment'), 'standalone comment should be removed');
    assert.ok(result.includes('const x = 1;'), 'code before comment should remain');
    assert.ok(result.includes('const y = 2;'), 'non-comment line should remain');
  });

  it('removes multi-line block comments', () => {
    const input = [
      '/**',
      ' * This is a JSDoc block',
      ' * with multiple lines',
      ' */',
      'function main() {}',
    ].join('\n');

    const result = stripComments(input);

    assert.ok(!result.includes('JSDoc block'), 'block comment content should be removed');
    assert.ok(!result.includes('multiple lines'), 'block comment continuation should be removed');
    assert.ok(result.includes('function main() {}'), 'code after block comment should remain');
  });

  it('removes inline block comments on a single line', () => {
    const input = 'const x = /* inline */ 42;';
    const result = stripComments(input);
    assert.ok(result.includes('const x ='));
    assert.ok(result.includes('42;'));
    assert.ok(!result.includes('inline'));
  });

  it('preserves URLs containing ://', () => {
    const input = [
      "const url = 'https://example.com/api';",
      "const other = \"http://localhost:3000\";",
      'fetch(url);',
    ].join('\n');

    const result = stripComments(input);

    assert.ok(result.includes('https://example.com/api'), 'https URL should be preserved');
    assert.ok(result.includes('http://localhost:3000'), 'http URL should be preserved');
  });

  it('preserves // inside string literals', () => {
    const input = `const path = "file://some/path";`;
    const result = stripComments(input);
    assert.ok(result.includes('file://some/path'), 'string with // should be preserved');
  });
});

// ---------------------------------------------------------------------------
// collapseWhitespace
// ---------------------------------------------------------------------------

describe('collapseWhitespace', () => {
  it('collapses 3+ blank lines to exactly 2', () => {
    const input = 'line1\n\n\n\nline2\n\n\n\n\nline3';
    const result = collapseWhitespace(input);

    // Between line1 and line2 there should be exactly one blank line separator
    // (i.e., \n\n which is two newlines = one blank line between text)
    assert.ok(!result.includes('\n\n\n'), 'should not have 3+ consecutive newlines');
    assert.ok(result.includes('line1'), 'line1 should remain');
    assert.ok(result.includes('line2'), 'line2 should remain');
    assert.ok(result.includes('line3'), 'line3 should remain');
  });

  it('preserves 2 or fewer consecutive blank lines', () => {
    const input = 'a\n\nb';
    const result = collapseWhitespace(input);
    assert.strictEqual(result, 'a\n\nb');
  });

  it('trims trailing whitespace on each line', () => {
    const input = 'hello   \nworld\t\t\nfoo  ';
    const result = collapseWhitespace(input);

    const lines = result.split('\n');
    for (const line of lines) {
      assert.strictEqual(line, line.trimEnd(), `line "${line}" should have no trailing whitespace`);
    }
  });
});

// ---------------------------------------------------------------------------
// summarizeImports
// ---------------------------------------------------------------------------

describe('summarizeImports', () => {
  it('replaces named import statements with summaries', () => {
    const input = "import { foo, bar, baz } from './module.js';";
    const result = summarizeImports(input);

    assert.ok(result.includes('// imports:'), 'should produce an import comment');
    assert.ok(result.includes('foo'), 'should mention imported name');
    assert.ok(result.includes('bar'), 'should mention imported name');
    assert.ok(result.includes('module'), 'should mention module name');
    assert.ok(!result.startsWith('import '), 'original import line should be gone');
  });

  it('replaces default imports with summaries', () => {
    const input = "import MyModule from '../utils/helper.js';";
    const result = summarizeImports(input);

    assert.ok(result.includes('// imports: MyModule'), 'should mention default import name');
    assert.ok(result.includes('utils/helper'), 'should mention module path');
  });

  it('replaces namespace imports with summaries', () => {
    const input = "import * as utils from './utils.js';";
    const result = summarizeImports(input);

    assert.ok(result.includes('// imports: utils (namespace)'), 'should mark namespace import');
  });

  it('replaces side-effect imports with summaries', () => {
    const input = "import './polyfill.js';";
    const result = summarizeImports(input);

    assert.ok(result.includes('(side-effect)'), 'should mark side-effect import');
    assert.ok(result.includes('polyfill'), 'should mention module name');
  });

  it('handles multiline imports by collapsing them first', () => {
    const input = [
      'import {',
      '  alpha,',
      '  beta,',
      '  gamma,',
      "} from './lib.js';",
    ].join('\n');

    const result = summarizeImports(input);

    assert.ok(result.includes('// imports:'), 'should produce summary comment');
    assert.ok(result.includes('alpha'), 'should include first imported name');
    assert.ok(result.includes('gamma'), 'should include last imported name');
  });

  it('preserves non-import lines', () => {
    const input = [
      "import { x } from './x.js';",
      '',
      'const y = 42;',
      'export function main() {}',
    ].join('\n');

    const result = summarizeImports(input);

    assert.ok(result.includes('const y = 42;'), 'non-import code should remain');
    assert.ok(result.includes('export function main() {}'), 'exports should remain');
  });
});

// ---------------------------------------------------------------------------
// truncateFileBlocks
// ---------------------------------------------------------------------------

describe('truncateFileBlocks', () => {
  it('keeps first N + last N lines with omission marker for large blocks', () => {
    const bodyLines: string[] = [];
    for (let i = 1; i <= 30; i++) {
      bodyLines.push(`  line ${i}`);
    }
    const input = [
      '```typescript',
      ...bodyLines,
      '```',
    ].join('\n');

    const result = truncateFileBlocks(input, 5);

    assert.ok(result.includes('line 1'), 'first line of body should remain');
    assert.ok(result.includes('line 5'), 'line at maxLines boundary should remain');
    assert.ok(result.includes('line 30'), 'last line of body should remain');
    assert.ok(result.includes('line 26'), 'line near end should remain');
    assert.ok(result.includes('lines omitted'), 'omission marker should be present');
    assert.ok(!result.includes('line 15'), 'middle content should be omitted');
  });

  it('does not truncate small code blocks', () => {
    const input = [
      '```ts',
      'const a = 1;',
      'const b = 2;',
      '```',
    ].join('\n');

    const result = truncateFileBlocks(input, 5);
    assert.strictEqual(result, input, 'small blocks should be unchanged');
  });

  it('preserves text outside code fences', () => {
    const input = 'Some text before\n\n```js\ncode\n```\n\nSome text after';
    const result = truncateFileBlocks(input, 5);

    assert.ok(result.includes('Some text before'), 'text before fence should remain');
    assert.ok(result.includes('Some text after'), 'text after fence should remain');
  });
});

// ---------------------------------------------------------------------------
// summarizeTestBodies
// ---------------------------------------------------------------------------

describe('summarizeTestBodies', () => {
  it('replaces multi-line test implementations with signatures', () => {
    const input = [
      "it('should calculate total', () => {",
      '  const result = calc(1, 2);',
      '  assert.strictEqual(result, 3);',
      '  assert.ok(result > 0);',
      '});',
    ].join('\n');

    const result = summarizeTestBodies(input);

    assert.ok(result.includes('should calculate total'), 'test name should be preserved');
    assert.ok(result.includes('/* ... */'), 'body should be replaced with stub');
    assert.ok(!result.includes('assert.strictEqual'), 'original assertions should be removed');
  });

  it('handles async test functions', () => {
    const input = [
      "test('fetches data', async () => {",
      '  const data = await fetch(url);',
      '  assert.ok(data);',
      '});',
    ].join('\n');

    const result = summarizeTestBodies(input);

    assert.ok(result.includes('fetches data'), 'async test name should be preserved');
    assert.ok(result.includes('/* ... */'), 'body should be replaced with stub');
    assert.ok(!result.includes('await fetch'), 'original async body should be removed');
  });

  it('preserves non-test code', () => {
    const input = [
      'function helper() {',
      '  return 42;',
      '}',
      '',
      "it('uses helper', () => {",
      '  const v = helper();',
      '  assert.ok(v);',
      '});',
    ].join('\n');

    const result = summarizeTestBodies(input);

    assert.ok(result.includes('function helper()'), 'helper function should remain');
    assert.ok(result.includes('return 42;'), 'helper body should remain');
    assert.ok(result.includes('uses helper'), 'test name should be preserved');
  });
});

// ---------------------------------------------------------------------------
// compressContext (pipeline)
// ---------------------------------------------------------------------------

describe('compressContext', () => {
  const typicalCode = [
    '// Main application entry point',
    "import { createApp } from './app.js';",
    "import { configLoader } from '../config/loader.js';",
    "import { logger } from '../utils/logger.js';",
    '',
    '/**',
    ' * Initialize the application with the given configuration.',
    ' * This handles database connections, middleware setup,',
    ' * and route registration.',
    ' */',
    'export async function initialize(env: string) {',
    '  const config = await configLoader.load(env);',
    '  const app = createApp(config);',
    '  logger.info("App initialized");',
    '  return app;',
    '}',
    '',
    '',
    '',
    '',
    '// Helper to validate configuration',
    'function validateConfig(config: Record<string, unknown>) {',
    '  if (!config.port) throw new Error("Missing port");',
    '  if (!config.host) throw new Error("Missing host");',
    '  return true;',
    '}',
    '',
    "it('should initialize app', () => {",
    '  const app = initialize("test");',
    '  assert.ok(app);',
    '  assert.strictEqual(typeof app, "object");',
    '  assert.ok(app.listen);',
    '});',
    '',
    "it('validates config correctly', () => {",
    '  const valid = validateConfig({ port: 3000, host: "localhost" });',
    '  assert.strictEqual(valid, true);',
    '  const invalid = () => validateConfig({});',
    '  assert.throws(invalid);',
    '});',
  ].join('\n');

  it('achieves >= 20% reduction on typical code', () => {
    const config = allOnConfig();
    const result = compressContext(typicalCode, config);

    assert.ok(
      result.reductionPercent >= 20,
      `Expected >= 20% reduction but got ${result.reductionPercent}%`
    );
    assert.ok(result.compressedTokens < result.originalTokens, 'compressed should be fewer tokens');
  });

  it('respects maxContextTokens hard cap', () => {
    // Create a very long string that exceeds the token cap
    const longText = 'a '.repeat(5000); // ~10000 chars => ~2500 tokens
    const config = allOnConfig({ maxContextTokens: 100 });

    const result = compressContext(longText, config);

    // estimateTokens = Math.ceil(text.length / 4)
    assert.ok(
      result.compressedTokens <= 110,
      `Expected <= 110 tokens but got ${result.compressedTokens}`
    );
    assert.ok(result.compressed.includes('[context truncated'), 'truncation notice should appear');
  });

  it('handles empty input without error', () => {
    const config = allOnConfig();
    const result = compressContext('', config);

    assert.strictEqual(result.compressed, '');
    assert.strictEqual(result.originalTokens, 0);
    assert.strictEqual(result.compressedTokens, 0);
    assert.strictEqual(result.reductionPercent, 0);
  });

  it('lists applied strategies in the result', () => {
    const config = allOnConfig();
    const result = compressContext(typicalCode, config);

    assert.ok(Array.isArray(result.strategies), 'strategies should be an array');
    assert.ok(result.strategies.length > 0, 'at least one strategy should have been applied');
    // The typical code has comments, whitespace, imports, and tests — all should trigger
    assert.ok(
      result.strategies.includes('collapseWhitespace'),
      'collapseWhitespace should appear (multiple blank lines in input)'
    );
    assert.ok(
      result.strategies.includes('stripComments'),
      'stripComments should appear (comments in input)'
    );
    assert.ok(
      result.strategies.includes('summarizeImports'),
      'summarizeImports should appear (import lines in input)'
    );
    assert.ok(
      result.strategies.includes('summarizeTestBodies'),
      'summarizeTestBodies should appear (test bodies in input)'
    );
  });

  it('skips strategies that are disabled in config', () => {
    const config: CompressionConfig = {
      stripComments: false,
      collapseWhitespace: false,
      truncateFileContent: false,
      maxFileLines: 50,
      stripImports: false,
      summarizeTests: false,
      maxContextTokens: 100_000,
    };

    const result = compressContext(typicalCode, config);

    assert.strictEqual(result.strategies.length, 0, 'no strategies should be applied');
    assert.strictEqual(result.compressed, typicalCode, 'text should be unchanged');
  });

  it('returns original and compressed text in result', () => {
    const config = allOnConfig();
    const result = compressContext(typicalCode, config);

    assert.strictEqual(result.original, typicalCode, 'original text should be preserved');
    assert.ok(result.compressed.length > 0, 'compressed text should not be empty');
    assert.ok(result.compressed !== typicalCode, 'compressed text should differ from original');
  });
});

// ---------------------------------------------------------------------------
// getAgentCompressionConfig
// ---------------------------------------------------------------------------

describe('getAgentCompressionConfig', () => {
  it('pm has lowest maxContextTokens (3000)', () => {
    const pmConfig = getAgentCompressionConfig('pm');
    assert.strictEqual(pmConfig.maxContextTokens, 3000);
  });

  it('dev has highest maxContextTokens (8000)', () => {
    const devConfig = getAgentCompressionConfig('dev');
    assert.strictEqual(devConfig.maxContextTokens, 8000);

    // Verify dev is truly the highest among all known roles
    const roles = ['pm', 'architect', 'dev', 'ux', 'design', 'scrum-master', 'reviewer'] as const;
    for (const role of roles) {
      const cfg = getAgentCompressionConfig(role);
      assert.ok(
        cfg.maxContextTokens <= 8000,
        `${role} maxContextTokens (${cfg.maxContextTokens}) should not exceed dev's 8000`
      );
    }
  });

  it('architect has maxContextTokens of 5000', () => {
    const cfg = getAgentCompressionConfig('architect');
    assert.strictEqual(cfg.maxContextTokens, 5000);
  });

  it('reviewer does not strip comments (needs full code review context)', () => {
    const cfg = getAgentCompressionConfig('reviewer');
    assert.strictEqual(cfg.stripComments, false);
    assert.strictEqual(cfg.stripImports, false);
    assert.strictEqual(cfg.summarizeTests, false);
  });

  it('pm enables all compression strategies', () => {
    const cfg = getAgentCompressionConfig('pm');
    assert.strictEqual(cfg.stripComments, true);
    assert.strictEqual(cfg.collapseWhitespace, true);
    assert.strictEqual(cfg.truncateFileContent, true);
    assert.strictEqual(cfg.stripImports, true);
    assert.strictEqual(cfg.summarizeTests, true);
  });

  it('returns a copy, not a reference (mutations do not affect internal config)', () => {
    const cfg1 = getAgentCompressionConfig('dev');
    cfg1.maxContextTokens = 999;

    const cfg2 = getAgentCompressionConfig('dev');
    assert.strictEqual(cfg2.maxContextTokens, 8000, 'second call should return the original value');
  });
});
