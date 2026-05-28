/**
 * tsc filter tests — covers detection, filtering, sacred-bypass behavior,
 * and production wiring through defaultRegistry / decidePendingCommand.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tscFilter } from '../src/core/context-economy/filters/tsc.js';
import { defaultRegistry } from '../src/core/context-economy/command-filter-registry.js';
import { decidePendingCommand } from '../src/core/context-economy/pretool-adapter.js';

// ── detect ────────────────────────────────────────────────────────────────────

describe('tscFilter.detect', () => {
  it('detects "tsc" command', () => {
    assert.ok(tscFilter.detect('tsc', []));
  });

  it('detects "tsc --noEmit" args variant', () => {
    assert.ok(tscFilter.detect('tsc', ['--noEmit']));
  });

  it('detects npx tsc', () => {
    assert.ok(tscFilter.detect('npx', ['tsc', '--noEmit']));
  });

  it('detects path-suffixed tsc', () => {
    assert.ok(tscFilter.detect('./node_modules/.bin/tsc', []));
    assert.ok(tscFilter.detect('node_modules\\.bin\\tsc', []));
  });

  it('detects pnpm tsc (command=pnpm, args=[tsc]) — production parsing form', () => {
    assert.ok(tscFilter.detect('pnpm', ['tsc']));
    assert.ok(tscFilter.detect('pnpm', ['tsc', '--noEmit']));
  });

  it('detects yarn tsc (command=yarn, args=[tsc]) — production parsing form', () => {
    assert.ok(tscFilter.detect('yarn', ['tsc']));
    assert.ok(tscFilter.detect('yarn', ['tsc', '--noEmit']));
  });

  it('does not detect unrelated commands', () => {
    assert.ok(!tscFilter.detect('npm', ['run', 'build']));
    assert.ok(!tscFilter.detect('node', ['tsc.js']));
    assert.ok(!tscFilter.detect('npx', ['ts-node', 'file.ts']));
    assert.ok(!tscFilter.detect('pnpm', ['run', 'build']));
    assert.ok(!tscFilter.detect('yarn', ['build']));
  });
});

// ── production wiring through defaultRegistry ────────────────────────────────

describe('defaultRegistry — tsc filter wiring', () => {
  it('includes tsc filterId in registry', () => {
    assert.ok(defaultRegistry.filterIds.includes('tsc'));
  });

  it('lookup("tsc", []) finds tsc filter', () => {
    const result = defaultRegistry.lookup('tsc', []);
    assert.strictEqual(result.filterStatus, 'found');
    assert.strictEqual(result.filter?.filterId, 'tsc');
  });

  it('lookup("npx", ["tsc"]) finds tsc filter', () => {
    const result = defaultRegistry.lookup('npx', ['tsc']);
    assert.strictEqual(result.filterStatus, 'found');
    assert.strictEqual(result.filter?.filterId, 'tsc');
  });

  it('lookup("pnpm", ["tsc"]) finds tsc filter — not passthrough', () => {
    const result = defaultRegistry.lookup('pnpm', ['tsc']);
    assert.strictEqual(result.filterStatus, 'found');
    assert.strictEqual(result.filter?.filterId, 'tsc');
  });

  it('lookup("yarn", ["tsc"]) finds tsc filter — not passthrough', () => {
    const result = defaultRegistry.lookup('yarn', ['tsc']);
    assert.strictEqual(result.filterStatus, 'found');
    assert.strictEqual(result.filter?.filterId, 'tsc');
  });

  it('apply strips tsc boilerplate via "pnpm tsc" command string', () => {
    const output = ['Version 5.4.5', '[2026-05-01 10:00:01] Found 0 errors. Watching for file changes.'].join('\n');
    const result = defaultRegistry.apply(output, 'pnpm', ['tsc']);
    assert.strictEqual(result.filterId, 'tsc');
    assert.ok(!result.output.includes('Version 5'));
  });

  it('apply strips tsc boilerplate via "yarn tsc" command string', () => {
    const output = ['Version 5.4.5', 'Starting compilation in watch mode...'].join('\n');
    const result = defaultRegistry.apply(output, 'yarn', ['tsc']);
    assert.strictEqual(result.filterId, 'tsc');
    assert.ok(!result.output.includes('Starting compilation'));
  });
});

// ── decidePendingCommand wiring ───────────────────────────────────────────────

describe('decidePendingCommand — tsc routing', () => {
  it('routes "tsc --noEmit" to tsc filter', () => {
    const decision = decidePendingCommand('tsc --noEmit');
    assert.strictEqual(decision.action, 'filter');
    assert.strictEqual(decision.filterId, 'tsc');
  });

  it('routes "npx tsc --noEmit" to tsc filter', () => {
    const decision = decidePendingCommand('npx tsc --noEmit');
    assert.strictEqual(decision.action, 'filter');
    assert.strictEqual(decision.filterId, 'tsc');
  });

  it('routes "pnpm tsc" to tsc filter', () => {
    const decision = decidePendingCommand('pnpm tsc');
    assert.strictEqual(decision.action, 'filter');
    assert.strictEqual(decision.filterId, 'tsc');
  });

  it('routes "yarn tsc --noEmit" to tsc filter', () => {
    const decision = decidePendingCommand('yarn tsc --noEmit');
    assert.strictEqual(decision.action, 'filter');
    assert.strictEqual(decision.filterId, 'tsc');
  });

  it('does not route "pnpm run build" to tsc filter', () => {
    const decision = decidePendingCommand('pnpm run build');
    assert.notStrictEqual(decision.filterId, 'tsc');
  });
});

// ── filter: clean output ──────────────────────────────────────────────────────

describe('tscFilter.filter — clean compilation output', () => {
  const cleanOutput = [
    'Version 5.4.5',
    'Starting compilation in watch mode...',
    '[2026-05-01 10:00:00] Starting compilation in watch mode...',
    '[2026-05-01 10:00:01] Found 0 errors. Watching for file changes.',
  ].join('\n');

  it('strips Version/watch mode boilerplate', () => {
    const result = tscFilter.filter(cleanOutput, 'tsc', []);
    // All boilerplate should be stripped
    assert.ok(!result.output.includes('Version 5'));
    assert.ok(!result.output.includes('Starting compilation'));
    assert.ok(!result.output.includes('Found 0 errors'));
  });

  it('returns filtered or low-yield status for clean output', () => {
    const result = tscFilter.filter(cleanOutput, 'tsc', []);
    assert.ok(result.status === 'filtered' || result.status === 'low-yield');
  });

  it('savedTokens >= 0', () => {
    const result = tscFilter.filter(cleanOutput, 'tsc', []);
    assert.ok(result.savedTokens >= 0);
  });

  it('filterId is "tsc"', () => {
    const result = tscFilter.filter(cleanOutput, 'tsc', []);
    assert.strictEqual(result.filterId, 'tsc');
  });
});

// ── filter: error output ──────────────────────────────────────────────────────

describe('tscFilter.filter — error output (sacred-bypass)', () => {
  const errorOutput = [
    'Version 5.4.5',
    'src/core/foo.ts(12,3): error TS2322: Type string is not assignable to type number.',
    'src/core/bar.ts(45,7): error TS2345: Argument of type number is not assignable to parameter of type string.',
    'Found 2 errors.',
  ].join('\n');

  it('returns sacred-bypass when errors are present', () => {
    const result = tscFilter.filter(errorOutput, 'tsc', ['--noEmit']);
    assert.strictEqual(result.status, 'sacred-bypass');
  });

  it('preserves full error output on sacred-bypass', () => {
    const result = tscFilter.filter(errorOutput, 'tsc', ['--noEmit']);
    assert.ok(result.output.includes('TS2322'));
    assert.ok(result.output.includes('TS2345'));
  });

  it('savedTokens = 0 on sacred-bypass', () => {
    const result = tscFilter.filter(errorOutput, 'tsc', ['--noEmit']);
    assert.strictEqual(result.savedTokens, 0);
  });

  it('sacredSpanCount >= 0 on sacred-bypass', () => {
    const result = tscFilter.filter(errorOutput, 'tsc', ['--noEmit']);
    assert.ok(result.sacredSpanCount >= 0);
  });
});

// ── filter: empty output ──────────────────────────────────────────────────────

describe('tscFilter.filter — empty output', () => {
  it('handles empty string without throwing', () => {
    assert.doesNotThrow(() => tscFilter.filter('', 'tsc', []));
  });

  it('outputTokens <= inputTokens for empty output', () => {
    const result = tscFilter.filter('', 'tsc', []);
    assert.ok(result.outputTokens <= result.inputTokens);
  });
});

// ── filter: token savings ──────────────────────────────────────────────────────

describe('tscFilter.filter — token savings shape', () => {
  it('inputTokens is positive for non-empty output', () => {
    const result = tscFilter.filter('Version 5.0.0\nStarting compilation in watch mode...', 'tsc', []);
    assert.ok(result.inputTokens > 0);
  });

  it('outputTokens <= inputTokens', () => {
    const longOutput = Array.from({ length: 50 }, (_, i) =>
      `[2026-05-01 10:${String(i).padStart(2, '0')}:00] Starting compilation in watch mode...`,
    ).join('\n');
    const result = tscFilter.filter(longOutput, 'tsc', []);
    assert.ok(result.outputTokens <= result.inputTokens);
  });
});
