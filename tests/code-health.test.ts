import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyzeCodeHealth,
  formatCodeHealthReport,
} from '../src/cli/commands/code-health.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeFs(files: Record<string, string>) {
  return {
    _readdir: async () => Object.keys(files).map(k => k.split('/').pop()!),
    _readFile: async (p: string) => {
      const key = Object.keys(files).find(k => p.endsWith(k.split('/').pop()!));
      if (!key) throw new Error(`ENOENT: ${p}`);
      return files[key]!;
    },
  };
}

// ── analyzeCodeHealth ─────────────────────────────────────────────────────────

describe('analyzeCodeHealth', () => {
  it('returns CLEAN verdict for a small clean file', async () => {
    const content = `
/** A documented function */
export function foo() { return 1; }
`;
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      _readdir: async () => ['a.ts'],
      _isDirectory: async () => false,
      _readFile: async () => content,
    });
    assert.equal(report.verdict, 'CLEAN');
    assert.equal(report.totalFiles, 1);
    assert.equal(report.exportedTotal, 1);
    assert.equal(report.documentedTotal, 1);
    assert.equal(report.jsdocCoveragePercent, 100);
  });

  it('flags FAIL when a file exceeds hard cap', async () => {
    const content = Array.from({ length: 800 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      hardCap: 750,
      softCap: 500,
      _readdir: async () => ['big.ts'],
      _isDirectory: async () => false,
      _readFile: async () => content,
    });
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.filesOver750.length, 1);
  });

  it('flags WARN when a file is between soft and hard cap', async () => {
    const content = Array.from({ length: 600 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      hardCap: 750,
      softCap: 500,
      _readdir: async () => ['med.ts'],
      _isDirectory: async () => false,
      _readFile: async () => content,
    });
    assert.equal(report.verdict, 'WARN');
    assert.equal(report.filesOver500.length, 1);
    assert.equal(report.filesOver750.length, 0);
  });

  it('flags FAIL when JSDoc coverage below threshold', async () => {
    const content = `
export function a() { return 1; }
export function b() { return 2; }
export function c() { return 3; }
`;
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      jsdocMinPercent: 60,
      _readdir: async () => ['undocumented.ts'],
      _isDirectory: async () => false,
      _readFile: async () => content,
    });
    assert.equal(report.verdict, 'FAIL');
    assert.equal(report.jsdocCoveragePercent, 0);
  });

  it('counts TODO/FIXME/HACK markers', async () => {
    const content = `
// TODO: refactor this
// FIXME: broken edge case
// HACK: temporary workaround
/** A function */
export function foo() { return 1; }
`;
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      _readdir: async () => ['todos.ts'],
      _isDirectory: async () => false,
      _readFile: async () => content,
    });
    assert.equal(report.todoTotal, 3);
  });

  it('counts non-blank lines correctly', async () => {
    const content = `line one\n\n\nline two\n\nline three`;
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      _readdir: async () => ['t.ts'],
      _isDirectory: async () => false,
      _readFile: async () => content,
    });
    assert.equal(report.totalLines, 3);
  });

  it('CLEAN when no source files exist', async () => {
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      _readdir: async () => [],
      _isDirectory: async () => false,
      _readFile: async () => { throw new Error('ENOENT'); },
    });
    assert.equal(report.verdict, 'CLEAN');
    assert.equal(report.totalFiles, 0);
    assert.equal(report.jsdocCoveragePercent, 100);
  });
});

// ── formatCodeHealthReport ────────────────────────────────────────────────────

describe('formatCodeHealthReport', () => {
  it('produces a non-empty report string', async () => {
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      _readdir: async () => ['a.ts'],
      _isDirectory: async () => false,
      _readFile: async () => '/** doc */\nexport function a() {}',
    });
    const text = formatCodeHealthReport(report);
    assert.ok(text.length > 100);
    assert.ok(text.includes('Code Health Report'));
    assert.ok(text.includes('JSDoc coverage'));
  });

  it('includes verdict in output', async () => {
    const content = Array.from({ length: 800 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const report = await analyzeCodeHealth({
      srcDir: '/fake',
      hardCap: 750,
      _readdir: async () => ['big.ts'],
      _isDirectory: async () => false,
      _readFile: async () => content,
    });
    const text = formatCodeHealthReport(report);
    // Strip ANSI codes that chalk may inject
    // eslint-disable-next-line no-control-regex
    const stripped = text.replace(/\x1b\[[0-9;]*m/g, '');
    assert.equal(report.verdict, 'FAIL');
    assert.ok(stripped.includes('FAIL'), `Expected FAIL in output:\n${stripped}`);
  });
});
