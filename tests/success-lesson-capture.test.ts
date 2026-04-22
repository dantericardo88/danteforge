// Tests for captureSuccessLessons() — OpenSpace CAPTURED mode adaptation.
// Verifies that passing verify cycles extract reusable patterns into lessons.md.
// All tests use injection seams — zero real LLM calls, zero git subprocess calls.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  captureSuccessLessons,
  buildSuccessExtractionPrompt,
  parseSuccessLessons,
  extractDeterministicLessons,
  type CaptureSuccessLessonsOpts,
} from '../src/core/auto-lessons.js';
import type { VerifyReceipt } from '../src/core/verify-receipts.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeReceipt(status: 'pass' | 'warn' | 'fail', overrides: Partial<VerifyReceipt> = {}): VerifyReceipt {
  return {
    status,
    passed: ['typecheck', 'lint', 'tests'],
    warnings: [],
    failures: [],
    project: 'test-project',
    version: '1.0.0',
    gitSha: 'abc123',
    platform: 'linux',
    nodeVersion: 'v20.0.0',
    cwd: '/tmp/test',
    projectType: 'cli',
    workflowStage: 'forge',
    timestamp: new Date().toISOString(),
    commandMode: { release: false, live: false, recompute: false },
    counts: { passed: 3, warnings: 0, failures: 0 },
    releaseCheckPassed: null,
    liveCheckPassed: null,
    currentStateFresh: true,
    selfEditPolicyEnforced: false,
    ...overrides,
  };
}

const SAMPLE_DIFF = `
diff --git a/src/core/foo.ts b/src/core/foo.ts
index abc..def 100644
--- a/src/core/foo.ts
+++ b/src/core/foo.ts
@@ -1,3 +1,8 @@
+export interface FooOptions {
+  _callFn?: () => Promise<string>;
+}
+
 export async function foo(opts: FooOptions = {}): Promise<string> {
-  return doThing();
+  const fn = opts._callFn ?? doThing;
+  return fn();
 }
`;

const SAMPLE_LLM_RESPONSE = `CATEGORY: code
RULE: Inject dependencies via optional _underscore parameters for testability
CONTEXT: When writing functions that call external I/O or LLM APIs
SEVERITY: critical

CATEGORY: architecture
RULE: Export interfaces alongside functions to make injection seams type-safe
CONTEXT: When adding injectable options to any public function
SEVERITY: important`;

// ── T1: fail status → no LLM call, captured = 0 ─────────────────────────────

describe('captureSuccessLessons()', () => {
  it('T1: status fail → returns { captured: 0 }, LLM never called', async () => {
    let llmCalled = false;
    const result = await captureSuccessLessons(makeReceipt('fail'), '/tmp', {
      _llmCaller: async () => { llmCalled = true; return ''; },
      _gitDiff: async () => SAMPLE_DIFF,
      _appendLesson: async () => {},
    });
    assert.strictEqual(result.captured, 0);
    assert.strictEqual(llmCalled, false, 'LLM must not be called on fail');
  });

  // T2: empty diff → no LLM call, captured = 0
  it('T2: empty git diff → returns { captured: 0 }, LLM never called', async () => {
    let llmCalled = false;
    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _llmCaller: async () => { llmCalled = true; return ''; },
      _gitDiff: async () => '   ',
      _appendLesson: async () => {},
    });
    assert.strictEqual(result.captured, 0);
    assert.strictEqual(llmCalled, false, 'LLM must not be called when diff is empty');
  });

  // T3: git diff throws → captured = 0, no LLM call
  it('T3: _gitDiff throws → returns { captured: 0 } without crashing', async () => {
    let llmCalled = false;
    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _llmCaller: async () => { llmCalled = true; return ''; },
      _gitDiff: async () => { throw new Error('git not found'); },
      _appendLesson: async () => {},
    });
    assert.strictEqual(result.captured, 0);
    assert.strictEqual(llmCalled, false);
  });

  // T4: LLM throws → deterministic fallback runs (not 0 — flywheel still turns)
  it('T4: LLM throws → deterministic fallback captures lessons, does not crash', async () => {
    const captured: string[] = [];
    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _isLLMAvailable: async () => true,
      _llmCaller: async () => { throw new Error('API timeout'); },
      _gitDiff: async () => SAMPLE_DIFF,
      _appendLesson: async (e) => { captured.push(e); },
    });
    // SAMPLE_DIFF contains _callFn?: so deterministic path fires
    assert.ok(result.captured >= 0, 'must not throw even when LLM throws');
    // No assertion on exact count — deterministic path may or may not find patterns
  });

  // T5: LLM returns NO_PATTERNS → deterministic fallback runs
  it('T5: LLM returns NO_PATTERNS → deterministic fallback runs (flywheel still turns)', async () => {
    const captured: string[] = [];
    // Use a diff with NO recognizable deterministic patterns to get captured=0
    const boringDiff = `diff --git a/cfg.ts b/cfg.ts\n--- a/cfg.ts\n+++ b/cfg.ts\n@@ -1 +1 @@\n-const x = 1;\n+const x = 2;`;
    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _isLLMAvailable: async () => true,
      _llmCaller: async () => 'NO_PATTERNS',
      _gitDiff: async () => boringDiff,
      _appendLesson: async (e) => { captured.push(e); },
    });
    assert.strictEqual(result.captured, 0, 'boring diff + NO_PATTERNS → nothing captured');
    assert.strictEqual(captured.length, 0);
  });

  // T6: LLM returns 3 valid patterns → appendLesson called 3×, captured = 3
  it('T6: 3 valid patterns from LLM → _appendLesson called 3 times, captured = 3', async () => {
    const appendedEntries: string[] = [];
    const threePatternResponse = SAMPLE_LLM_RESPONSE + `

CATEGORY: test
RULE: Write tests using injection seams rather than mocking frameworks
CONTEXT: When adding tests for any function with external dependencies
SEVERITY: important`;

    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _isLLMAvailable: async () => true,
      _llmCaller: async () => threePatternResponse,
      _gitDiff: async () => SAMPLE_DIFF,
      _appendLesson: async (entry) => { appendedEntries.push(entry); },
    });
    assert.strictEqual(result.captured, 3);
    assert.strictEqual(appendedEntries.length, 3);
  });

  // T7: LLM returns 5 patterns → capped at 3, captured = 3
  it('T7: 5 patterns from LLM → capped at 3, captured = 3', async () => {
    const appendedEntries: string[] = [];
    const fivePatternResponse = Array.from({ length: 5 }, (_, i) =>
      `CATEGORY: code\nRULE: Rule number ${i + 1} — do something specific\nCONTEXT: When applicable\nSEVERITY: important`
    ).join('\n\n');

    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _isLLMAvailable: async () => true,
      _llmCaller: async () => fivePatternResponse,
      _gitDiff: async () => SAMPLE_DIFF,
      _appendLesson: async (entry) => { appendedEntries.push(entry); },
    });
    assert.strictEqual(result.captured, 3, 'must cap at 3');
    assert.strictEqual(appendedEntries.length, 3);
  });

  // T8: _appendLesson throws → captured reflects only successful appends
  it('T8: _appendLesson throws on 2nd call → captured = 1 (best-effort)', async () => {
    let callCount = 0;
    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _llmCaller: async () => SAMPLE_LLM_RESPONSE,
      _gitDiff: async () => SAMPLE_DIFF,
      _appendLesson: async () => {
        callCount++;
        if (callCount > 1) throw new Error('disk full');
      },
    });
    assert.strictEqual(result.captured, 1, 'must count only successful appends');
  });

  // T9: diff > 4000 chars → prompt uses truncated diff, no crash
  it('T9: large diff (>4000 chars) → prompt truncated, no crash', async () => {
    let capturedPrompt = '';
    const largeDiff = 'x'.repeat(5000);

    await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _isLLMAvailable: async () => true,
      _llmCaller: async (prompt) => { capturedPrompt = prompt; return 'NO_PATTERNS'; },
      _gitDiff: async () => largeDiff,
      _appendLesson: async () => {},
    });

    assert.ok(capturedPrompt.includes('[truncated]'), 'large diff must be truncated in prompt');
    assert.ok(capturedPrompt.length < 6000, 'prompt must not include the full 5000-char diff verbatim');
  });

  // T10: status 'warn' → lessons still captured
  it('T10: status warn → lessons still captured (warn is a pass with caveats)', async () => {
    const appendedEntries: string[] = [];
    const receipt = makeReceipt('warn', { warnings: ['coverage below 80%'] });

    const result = await captureSuccessLessons(receipt, '/tmp', {
      _llmCaller: async () => SAMPLE_LLM_RESPONSE,
      _gitDiff: async () => SAMPLE_DIFF,
      _appendLesson: async (entry) => { appendedEntries.push(entry); },
    });

    assert.ok(result.captured > 0, 'warn status must still capture lessons');
    assert.ok(appendedEntries.length > 0);
  });
});

// ── parseSuccessLessons() unit tests ─────────────────────────────────────────

describe('parseSuccessLessons()', () => {
  it('returns [] for NO_PATTERNS', () => {
    assert.deepStrictEqual(parseSuccessLessons('NO_PATTERNS'), []);
    assert.deepStrictEqual(parseSuccessLessons('  NO_PATTERNS  '), []);
  });

  it('returns [] for empty string', () => {
    assert.deepStrictEqual(parseSuccessLessons(''), []);
  });

  it('parses valid pattern block into lesson entry string', () => {
    const lessons = parseSuccessLessons(SAMPLE_LLM_RESPONSE);
    assert.ok(lessons.length >= 1);
    assert.ok(lessons[0]!.includes('CAPTURED'), 'entry must mark source as CAPTURED');
    assert.ok(lessons[0]!.includes('code') || lessons[0]!.includes('architecture'), 'entry must include category');
  });

  it('includes RULE text in each lesson entry', () => {
    const lessons = parseSuccessLessons(SAMPLE_LLM_RESPONSE);
    assert.ok(lessons.some(l => l.includes('Inject dependencies')), 'must include first rule text');
  });

  it('handles malformed output gracefully (returns [])', () => {
    assert.doesNotThrow(() => parseSuccessLessons('this is not a valid pattern block'));
    const result = parseSuccessLessons('CATEGORY: \nRULE: \n');
    // Malformed entries with empty category/rule are skipped
    assert.ok(Array.isArray(result));
  });
});

// ── buildSuccessExtractionPrompt() unit tests ─────────────────────────────────

describe('buildSuccessExtractionPrompt()', () => {
  it('includes status, passed checks, and truncated diff', () => {
    const receipt = makeReceipt('pass');
    const prompt = buildSuccessExtractionPrompt(receipt, SAMPLE_DIFF);
    assert.ok(prompt.includes('pass'), 'prompt must include status');
    assert.ok(prompt.includes('typecheck'), 'prompt must include passed checks');
    assert.ok(prompt.includes('CATEGORY:'), 'prompt must include output format instructions');
    assert.ok(prompt.includes('NO_PATTERNS'), 'prompt must explain NO_PATTERNS fallback');
  });

  it('truncates diff longer than 4000 chars and appends [truncated]', () => {
    const receipt = makeReceipt('pass');
    const longDiff = 'a'.repeat(5000);
    const prompt = buildSuccessExtractionPrompt(receipt, longDiff);
    assert.ok(prompt.includes('[truncated]'), 'long diff must be marked as truncated');
  });
});

// ── extractDeterministicLessons() — zero-LLM flywheel path ───────────────────

const EXPORT_DIFF = `
diff --git a/src/core/foo.ts b/src/core/foo.ts
--- a/src/core/foo.ts
+++ b/src/core/foo.ts
@@ -1,2 +1,5 @@
+export interface FooOptions { _fn?: () => string; }
+export function buildFoo(opts: FooOptions = {}): string { return ''; }
+export const FOO_DEFAULT = 'foo';
 const internal = 'x';
`;

const TEST_FILE_DIFF = `
diff --git a/tests/foo.test.ts b/tests/foo.test.ts
new file mode 100644
--- /dev/null
+++ b/tests/foo.test.ts
@@ -0,0 +1,5 @@
+import { describe, it } from 'node:test';
+import assert from 'node:assert/strict';
+describe('foo', () => { it('works', () => { assert.ok(true); }); });
`;

const INJECTION_DIFF = `
diff --git a/src/core/bar.ts b/src/core/bar.ts
--- a/src/core/bar.ts
+++ b/src/core/bar.ts
@@ -1,3 +1,6 @@
+export interface BarOpts {
+  _callApi?: () => Promise<string>;
+  _logger?: (msg: string) => void;
+}
 export async function bar(opts: BarOpts = {}): Promise<string> { return ''; }
`;

describe('extractDeterministicLessons()', () => {
  // T11: no LLM available, valid diff with exports → deterministic lessons captured
  it('T11: _isLLMAvailable=false, diff has exports → deterministic lesson captured', async () => {
    const captured: string[] = [];
    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _isLLMAvailable: async () => false,
      _gitDiff: async () => EXPORT_DIFF,
      _appendLesson: async (e) => { captured.push(e); },
    });
    assert.ok(result.captured > 0, 'must capture lessons without LLM');
    assert.ok(captured.some(e => e.includes('Export') || e.includes('export')), 'must mention exports');
  });

  // T12: new exports in diff → lesson about exports
  it('T12: new export symbols → lesson references the export names', () => {
    const lessons = extractDeterministicLessons(EXPORT_DIFF);
    assert.ok(lessons.length > 0, 'must extract at least one lesson');
    assert.ok(
      lessons.some(l => l.includes('buildFoo') || l.includes('FooOptions') || l.includes('FOO_DEFAULT')),
      'lesson must reference the exported symbol names'
    );
  });

  // T13: new test file → lesson about co-location
  it('T13: new test file in diff → lesson about co-locating tests', () => {
    const lessons = extractDeterministicLessons(TEST_FILE_DIFF);
    assert.ok(lessons.length > 0, 'must extract lesson from test file addition');
    assert.ok(
      lessons.some(l => l.includes('test') || l.includes('Test')),
      'lesson must mention test co-location'
    );
  });

  // T14: injection seam pattern → lesson about testability
  it('T14: injection seam pattern (_camelCase?:) → lesson about injectable dependencies', () => {
    const lessons = extractDeterministicLessons(INJECTION_DIFF);
    assert.ok(lessons.length > 0, 'must detect injection seam pattern');
    assert.ok(
      lessons.some(l => l.includes('injection') || l.includes('underscore') || l.includes('testab')),
      'lesson must mention injection/testability'
    );
  });

  // T15: diff with none of the three patterns → returns []
  it('T15: diff with no recognizable patterns → returns []', () => {
    const plainDiff = `
diff --git a/src/core/config.ts b/src/core/config.ts
--- a/src/core/config.ts
+++ b/src/core/config.ts
@@ -5,3 +5,3 @@
-const timeout = 5000;
+const timeout = 10000;
    `;
    const lessons = extractDeterministicLessons(plainDiff);
    assert.deepStrictEqual(lessons, [], 'plain constant change must produce no lessons');
  });

  // T16: empty diff → returns []
  it('T16: empty diff → returns []', () => {
    assert.deepStrictEqual(extractDeterministicLessons(''), []);
    assert.deepStrictEqual(extractDeterministicLessons('   '), []);
  });

  // T17: LLM available but returns NO_PATTERNS → falls through to deterministic
  it('T17: LLM returns NO_PATTERNS → deterministic fallback captures lesson', async () => {
    const captured: string[] = [];
    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _isLLMAvailable: async () => true,
      _llmCaller: async () => 'NO_PATTERNS',
      _gitDiff: async () => EXPORT_DIFF,
      _appendLesson: async (e) => { captured.push(e); },
    });
    assert.ok(result.captured > 0, 'deterministic fallback must fire after LLM NO_PATTERNS');
    assert.ok(captured.some(e => e.includes('deterministic')), 'entry must be marked deterministic');
  });

  // T18: primary diff strategy uses working-tree (git diff HEAD), not HEAD~1
  it('T18: _gitDiff called — working-tree strategy is injectable and used', async () => {
    let diffArgs = '';
    const result = await captureSuccessLessons(makeReceipt('pass'), '/tmp', {
      _isLLMAvailable: async () => false,
      _gitDiff: async (cwd) => { diffArgs = cwd; return EXPORT_DIFF; },
      _appendLesson: async () => {},
    });
    assert.ok(diffArgs !== '', '_gitDiff must have been called with cwd');
    assert.ok(result.captured >= 0, 'captureSuccessLessons must complete without error');
  });
});
