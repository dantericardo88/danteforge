// Structured error handling tests — Node built-in test runner (no Jest/Vitest)
// Covers: logStructuredError, getErrorRate, error-rate command, actionable-errors codes,
// circuit-breaker trip logging, and error code derivation.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  logStructuredError,
  getErrorRate,
  clearErrorLog,
  readErrorLogEntries,
  deriveErrorCode,
  type StructuredErrorEntry,
  type ErrorLogOptions,
} from '../src/core/error-log.js';

import { enrichError, ERROR_SUGGESTIONS } from '../src/core/actionable-errors.js';
import { DanteError } from '../src/core/errors.js';
import { errorRate } from '../src/cli/commands/error-rate.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'df-err-test-'));
}

function makeLogPath(dir: string): string {
  return path.join(dir, 'error-log.jsonl');
}

/** In-memory writer for logStructuredError tests */
function makeMemoryWriter(): { write: (f: string, l: string) => void; lines: string[] } {
  const lines: string[] = [];
  return {
    write: (_f: string, l: string) => { lines.push(l); },
    lines,
  };
}

/** In-memory reader for getErrorRate tests */
function makeMemoryReader(content: string): (f: string) => string {
  return () => content;
}

function makeEntry(code: string, command?: string, minutesAgo = 0): string {
  const ts = new Date(Date.now() - minutesAgo * 60_000).toISOString();
  const entry: StructuredErrorEntry = {
    timestamp: ts,
    code,
    message: `Test error: ${code}`,
    ...(command ? { command } : {}),
  };
  return JSON.stringify(entry);
}

// ---------------------------------------------------------------------------
// 1. logStructuredError — JSONL format
// ---------------------------------------------------------------------------

describe('logStructuredError — JSONL output', () => {
  it('writes a valid JSON line per call', () => {
    const mem = makeMemoryWriter();
    const opts: ErrorLogOptions = { _writeFile: mem.write };
    logStructuredError(new Error('something broke'), { command: 'forge' }, opts);
    assert.equal(mem.lines.length, 1, 'should write exactly one line');
    const parsed = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    assert.ok(parsed.timestamp, 'entry must have timestamp');
    assert.ok(parsed.code, 'entry must have code');
    assert.equal(parsed.message, 'something broke');
    assert.equal(parsed.command, 'forge');
  });

  it('includes ISO 8601 timestamp', () => {
    const mem = makeMemoryWriter();
    const opts: ErrorLogOptions = { _writeFile: mem.write };
    logStructuredError(new Error('ts test'), {}, opts);
    const parsed = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(parsed.timestamp), 'timestamp must be ISO 8601');
  });

  it('includes phase when provided', () => {
    const mem = makeMemoryWriter();
    logStructuredError(new Error('phase test'), { phase: 'verify' }, { _writeFile: mem.write });
    const parsed = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    assert.equal(parsed.phase, 'verify');
  });

  it('includes cwd when provided', () => {
    const mem = makeMemoryWriter();
    logStructuredError(new Error('cwd test'), { cwd: '/project' }, { _writeFile: mem.write });
    const parsed = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    assert.equal(parsed.cwd, '/project');
  });

  it('truncates stack to first 3 lines', () => {
    const err = new Error('stack test');
    err.stack = 'Error: stack test\n  at fn1\n  at fn2\n  at fn3\n  at fn4\n  at fn5';
    const mem = makeMemoryWriter();
    logStructuredError(err, {}, { _writeFile: mem.write });
    const parsed = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    assert.ok(parsed.stack, 'stack should be present');
    const stackLines = parsed.stack!.split('\n');
    assert.ok(stackLines.length <= 3, `stack should have at most 3 lines, got ${stackLines.length}`);
  });

  it('never throws even if writer throws', () => {
    const badWriter = () => { throw new Error('disk full'); };
    // Must not throw
    assert.doesNotThrow(() => {
      logStructuredError(new Error('test'), {}, { _writeFile: badWriter });
    });
  });

  it('writes multiple independent entries for multiple calls', () => {
    const mem = makeMemoryWriter();
    const opts: ErrorLogOptions = { _writeFile: mem.write };
    logStructuredError(new Error('err1'), { command: 'cmd1' }, opts);
    logStructuredError(new Error('err2'), { command: 'cmd2' }, opts);
    assert.equal(mem.lines.length, 2);
    const e1 = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    const e2 = JSON.parse(mem.lines[1]!) as StructuredErrorEntry;
    assert.equal(e1.command, 'cmd1');
    assert.equal(e2.command, 'cmd2');
  });

  it('derives the log code from nested causes and records the cause chain', () => {
    const mem = makeMemoryWriter();
    const err = new Error('startup failed', {
      cause: new Error('provider bootstrap failed', {
        cause: new Error('config.yaml missing'),
      }),
    });

    logStructuredError(err, { command: 'forge' }, { _writeFile: mem.write });

    const parsed = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    assert.equal(parsed.code, 'ERR_CONFIG_MISSING');
    assert.ok(Array.isArray(parsed.causes), 'causes should be recorded');
    assert.deepEqual(
      parsed.causes?.map(cause => cause.message),
      ['provider bootstrap failed', 'config.yaml missing'],
    );
  });

  it('uses a wrapped DanteError cause code when no message pattern matches', () => {
    const mem = makeMemoryWriter();
    const err = new Error('startup failed', {
      cause: new DanteError('opaque provider boot failure', 'PROVIDER_BOOT_FAILED', 'restart provider'),
    });

    logStructuredError(err, { command: 'forge' }, { _writeFile: mem.write });

    const parsed = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    assert.equal(parsed.code, 'PROVIDER_BOOT_FAILED');
    assert.equal(parsed.causes?.[0]?.code, 'PROVIDER_BOOT_FAILED');
  });

  it('redacts secrets before writing structured error logs', () => {
    const mem = makeMemoryWriter();
    const err = new Error('request failed for key=ABCDEFGHIJKLMNOPQRST', {
      cause: new Error('Authorization: Bearer abcdefghijklmnopqrstuvwxyz123456'),
    });
    err.stack = 'Error: request failed for key=ABCDEFGHIJKLMNOPQRST\n  at callProvider\n  at main';

    logStructuredError(err, { command: 'forge' }, { _writeFile: mem.write });

    const parsed = JSON.parse(mem.lines[0]!) as StructuredErrorEntry;
    assert.equal(parsed.message, 'request failed for key=****');
    assert.ok(parsed.stack?.includes('key=****'));
    assert.ok(!parsed.stack?.includes('ABCDEFGHIJKLMNOPQRST'));
    assert.equal(parsed.causes?.[0]?.message, 'Authorization: Bearer ****');
  });
});

// ---------------------------------------------------------------------------
// 2. getErrorRate — windowed counts
// ---------------------------------------------------------------------------

describe('getErrorRate — windowed rate analysis', () => {
  it('counts all errors within the default 1-hour window', () => {
    const content = [
      makeEntry('ERR_LLM_TIMEOUT', 'forge', 5),
      makeEntry('ERR_LLM_TIMEOUT', 'forge', 30),
      makeEntry('ERR_CONFIG_MISSING', 'init', 59),
    ].join('\n');

    const result = getErrorRate(60 * 60_000, { _readFile: makeMemoryReader(content) });
    assert.equal(result.total, 3);
    assert.equal(result.byCode['ERR_LLM_TIMEOUT'], 2);
    assert.equal(result.byCode['ERR_CONFIG_MISSING'], 1);
  });

  it('excludes entries older than the window', () => {
    const content = [
      makeEntry('ERR_LLM_TIMEOUT', 'forge', 5),   // in window
      makeEntry('ERR_GATE_FAILED', 'verify', 90), // outside 60-min window
    ].join('\n');

    const result = getErrorRate(60 * 60_000, { _readFile: makeMemoryReader(content) });
    assert.equal(result.total, 1, 'should count only in-window entries');
    assert.ok(!result.byCode['ERR_GATE_FAILED'], 'old entry code should not appear');
  });

  it('returns zero total for empty log', () => {
    const result = getErrorRate(3_600_000, { _readFile: makeMemoryReader('') });
    assert.equal(result.total, 0);
    assert.deepEqual(result.byCode, {});
  });

  it('skips malformed JSON lines', () => {
    const content = [
      'not valid json',
      makeEntry('ERR_BUILD_FAILED', 'build', 1),
      '{broken',
    ].join('\n');

    const result = getErrorRate(3_600_000, { _readFile: makeMemoryReader(content) });
    assert.equal(result.total, 1, 'should count only valid parseable entries');
  });

  it('aggregates byCommand correctly', () => {
    const content = [
      makeEntry('ERR_LLM_TIMEOUT', 'forge', 1),
      makeEntry('ERR_LLM_RATE_LIMIT', 'forge', 2),
      makeEntry('ERR_CONFIG_MISSING', 'init', 3),
    ].join('\n');

    const result = getErrorRate(3_600_000, { _readFile: makeMemoryReader(content) });
    assert.equal(result.byCommand['forge'], 2);
    assert.equal(result.byCommand['init'], 1);
  });

  it('uses 5-minute window when specified', () => {
    const content = [
      makeEntry('ERR_LLM_TIMEOUT', 'forge', 3),  // 3 min ago = in window
      makeEntry('ERR_GATE_FAILED', 'verify', 10), // 10 min ago = outside 5-min window
    ].join('\n');

    const result = getErrorRate(5 * 60_000, { _readFile: makeMemoryReader(content) });
    assert.equal(result.total, 1);
  });

  it('formats windowLabel as hours when >= 60 min', () => {
    const result = getErrorRate(2 * 3_600_000, { _readFile: makeMemoryReader('') });
    assert.ok(result.windowLabel.includes('h'), `windowLabel should say hours, got: ${result.windowLabel}`);
  });

  it('formats windowLabel as minutes when < 60 min', () => {
    const result = getErrorRate(30 * 60_000, { _readFile: makeMemoryReader('') });
    assert.ok(result.windowLabel.includes('m'), `windowLabel should say minutes, got: ${result.windowLabel}`);
  });
});

// ---------------------------------------------------------------------------
// 3. deriveErrorCode — pattern matching
// ---------------------------------------------------------------------------

describe('deriveErrorCode — canonical code derivation', () => {
  const cases: Array<[string, string]> = [
    ['state.yaml is not valid yaml', 'ERR_STATE_CORRUPT'],
    ['state file corrupted: .danteforge/STATE.yaml', 'ERR_STATE_CORRUPT'],
    ['config.yaml not found at ~/.danteforge', 'ERR_CONFIG_MISSING'],
    ['LLM timeout after 30s', 'ERR_LLM_TIMEOUT'],
    ['request timed out for provider: claude', 'ERR_LLM_TIMEOUT'],
    ['Rate limit exceeded for provider: openai', 'ERR_LLM_RATE_LIMIT'],
    ['HTTP 429 too many requests', 'ERR_LLM_RATE_LIMIT'],
    ['budget exceeded: $0.50 spent, limit $0.25', 'ERR_BUDGET_EXCEEDED'],
    ['gate failed: tests required', 'ERR_GATE_FAILED'],
    ['working tree is dirty — please commit changes', 'ERR_WORKTREE_DIRTY'],
    ['No spec found in .danteforge/', 'ERR_NO_SPEC'],
    ['spec.md missing from project', 'ERR_NO_SPEC'],
    ['build failed: 3 TypeScript errors', 'ERR_BUILD_FAILED'],
    ['no tests found in tests/ directory', 'ERR_NO_TESTS'],
    ['circuit breaker open for provider: grok', 'ERR_CIRCUIT_OPEN'],
    ['circuit breaker reset for provider: ollama', 'ERR_CIRCUIT_RESET'],
  ];

  for (const [message, expectedCode] of cases) {
    it(`maps "${message.slice(0, 40)}..." → ${expectedCode}`, () => {
      const err = new Error(message);
      const code = deriveErrorCode(err);
      assert.equal(code, expectedCode, `Expected ${expectedCode} for message: ${message}`);
    });
  }

  it('returns ERR_UNKNOWN for unrecognized messages', () => {
    const code = deriveErrorCode(new Error('xyzzy plugh twisty maze'));
    assert.equal(code, 'ERR_UNKNOWN');
  });

  it('uses .code property from DanteError when pattern does not match', () => {
    const err = new Error('completely unrecognized error');
    (err as Record<string, unknown>)['code'] = 'MY_CUSTOM_CODE';
    const code = deriveErrorCode(err);
    assert.equal(code, 'MY_CUSTOM_CODE');
  });
});

// ---------------------------------------------------------------------------
// 4. actionable-errors.ts — 10 required error codes with non-trivial suggestions
// ---------------------------------------------------------------------------

describe('actionable-errors — required error codes have non-trivial suggestions', () => {
  const requiredMappings: Array<{ description: string; msg: string; codeFragment: string; suggestionMustInclude: string }> = [
    {
      description: 'ERR_STATE_CORRUPT',
      msg: 'state file corrupted',
      codeFragment: 'STATE',
      suggestionMustInclude: 'ERR_STATE_CORRUPT',
    },
    {
      description: 'ERR_CONFIG_MISSING',
      msg: 'config.yaml missing',
      codeFragment: 'CONFIG',
      suggestionMustInclude: 'ERR_CONFIG_MISSING',
    },
    {
      description: 'ERR_LLM_TIMEOUT',
      msg: 'LLM timeout after 30s',
      codeFragment: 'TIMEOUT',
      suggestionMustInclude: 'ollama',
    },
    {
      description: 'ERR_LLM_RATE_LIMIT',
      msg: 'rate limit exceeded',
      codeFragment: 'RATE',
      suggestionMustInclude: 'ERR_LLM_RATE_LIMIT',
    },
    {
      description: 'ERR_BUDGET_EXCEEDED',
      msg: 'budget exceeded: cost limit reached',
      codeFragment: 'BUDGET',
      suggestionMustInclude: 'ERR_BUDGET_EXCEEDED',
    },
    {
      description: 'ERR_GATE_FAILED',
      msg: 'gate failed: tests required',
      codeFragment: 'GATE',
      suggestionMustInclude: 'ERR_GATE_FAILED',
    },
    {
      description: 'ERR_WORKTREE_DIRTY',
      msg: 'working tree is dirty',
      codeFragment: 'WORKTREE',
      suggestionMustInclude: 'ERR_WORKTREE_DIRTY',
    },
    {
      description: 'ERR_NO_SPEC',
      msg: 'No spec found in .danteforge/',
      codeFragment: 'SPEC',
      suggestionMustInclude: 'ERR_NO_SPEC',
    },
    {
      description: 'ERR_BUILD_FAILED',
      msg: 'build failed: TypeScript errors',
      codeFragment: 'BUILD',
      suggestionMustInclude: 'ERR_BUILD_FAILED',
    },
    {
      description: 'ERR_NO_TESTS',
      msg: 'no tests found in tests/ directory',
      codeFragment: 'TESTS',
      suggestionMustInclude: 'ERR_NO_TESTS',
    },
  ];

  for (const { description, msg, suggestionMustInclude } of requiredMappings) {
    it(`${description} has a non-trivial actionable suggestion`, () => {
      const ae = enrichError(new Error(msg));
      assert.ok(ae.suggestion.length > 20, `suggestion for ${description} too short: "${ae.suggestion}"`);
      assert.ok(
        ae.suggestion.includes(suggestionMustInclude),
        `suggestion for ${description} should mention "${suggestionMustInclude}", got: "${ae.suggestion}"`,
      );
    });
  }

  it('ERROR_SUGGESTIONS has at least 30 patterns', () => {
    const count = Object.keys(ERROR_SUGGESTIONS).length;
    assert.ok(count >= 30, `Expected at least 30 patterns, got ${count}`);
  });

  it('all suggestions in ERROR_SUGGESTIONS are non-trivial (>20 chars)', () => {
    for (const [pattern, suggestion] of Object.entries(ERROR_SUGGESTIONS)) {
      assert.ok(
        suggestion.length > 20,
        `Suggestion for "${pattern}" is too short: "${suggestion}"`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 5. error-rate command — output format
// ---------------------------------------------------------------------------

describe('error-rate command — output format', () => {
  let tmpDir: string;
  let logPath: string;

  before(() => {
    tmpDir = makeTmpDir();
    logPath = makeLogPath(tmpDir);
    // Write some test entries
    const lines = [
      makeEntry('ERR_LLM_TIMEOUT', 'forge', 2),
      makeEntry('ERR_LLM_TIMEOUT', 'forge', 5),
      makeEntry('ERR_BUILD_FAILED', 'verify', 10),
    ];
    fs.writeFileSync(logPath, lines.join('\n') + '\n', 'utf8');
  });

  after(() => {
    try { fs.rmSync(tmpDir, { recursive: true }); } catch { /* cleanup */ }
  });

  /** Capture stdout during an async call */
  async function captureStdout(fn: () => Promise<void>): Promise<string> {
    const out: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      out.push(typeof chunk === 'string' ? chunk : chunk.toString());
      return true;
    };
    try {
      await fn();
    } finally {
      process.stdout.write = origWrite as typeof process.stdout.write;
    }
    return out.join('');
  }

  it('table output includes total count', async () => {
    const captured = await captureStdout(() =>
      errorRate({ window: 60, json: false, _logFilePath: logPath }),
    );
    assert.ok(captured.includes('Total errors:'), `output should contain "Total errors:"; got: "${captured}"`);
  });

  it('table output shows error codes', async () => {
    const captured = await captureStdout(() =>
      errorRate({ window: 60, json: false, _logFilePath: logPath }),
    );
    assert.ok(
      captured.includes('ERR_LLM_TIMEOUT') || captured.includes('Top error codes'),
      `output should show error codes or section header`,
    );
  });

  it('json output is valid JSON with required fields', async () => {
    const jsonStr = await captureStdout(() =>
      errorRate({ window: 60, json: true, _logFilePath: logPath }),
    );
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    assert.ok('total' in parsed, 'JSON output must have "total"');
    assert.ok('byCode' in parsed, 'JSON output must have "byCode"');
    assert.ok('byCommand' in parsed, 'JSON output must have "byCommand"');
    assert.ok('windowLabel' in parsed, 'JSON output must have "windowLabel"');
    assert.ok(typeof parsed.total === 'number', '"total" must be a number');
  });

  it('json output has correct total count', async () => {
    const jsonStr = await captureStdout(() =>
      errorRate({ window: 60, json: true, _logFilePath: logPath }),
    );
    const parsed = JSON.parse(jsonStr) as { total: number };
    assert.ok(parsed.total >= 3, `total should be >= 3, got ${parsed.total}`);
  });

  it('--clear resets the log and reports removal count', async () => {
    const clearDir = makeTmpDir();
    const clearPath = path.join(clearDir, 'error-log.jsonl');
    fs.writeFileSync(clearPath, [makeEntry('ERR_A'), makeEntry('ERR_B')].join('\n') + '\n', 'utf8');

    const output = await captureStdout(() =>
      errorRate({ clear: true, _logFilePath: clearPath }),
    );

    assert.ok(output.includes('Cleared'), `output should mention "Cleared", got: "${output}"`);
    // File should now be empty
    const remaining = fs.readFileSync(clearPath, 'utf8').trim();
    assert.equal(remaining, '', 'log file should be empty after --clear');
    try { fs.rmSync(clearDir, { recursive: true }); } catch { /* cleanup */ }
  });
});

// ---------------------------------------------------------------------------
// 6. readErrorLogEntries — pagination for watch mode
// ---------------------------------------------------------------------------

describe('readErrorLogEntries — tail / pagination', () => {
  it('returns entries after a given line offset', () => {
    const line0 = makeEntry('ERR_A', 'cmd', 1);
    const line1 = makeEntry('ERR_B', 'cmd', 2);
    const line2 = makeEntry('ERR_C', 'cmd', 3);
    const content = [line0, line1, line2].join('\n');

    const { entries, totalLines } = readErrorLogEntries(1, { _readFile: makeMemoryReader(content) });
    assert.equal(totalLines, 3);
    assert.equal(entries.length, 2, 'should return entries after offset 1');
    assert.equal(entries[0]!.code, 'ERR_B');
    assert.equal(entries[1]!.code, 'ERR_C');
  });

  it('returns all entries when offset is 0', () => {
    const content = [makeEntry('ERR_A'), makeEntry('ERR_B')].join('\n');
    const { entries } = readErrorLogEntries(0, { _readFile: makeMemoryReader(content) });
    assert.equal(entries.length, 2);
  });

  it('returns empty array when offset equals totalLines', () => {
    const content = [makeEntry('ERR_A'), makeEntry('ERR_B')].join('\n');
    const { entries, totalLines } = readErrorLogEntries(2, { _readFile: makeMemoryReader(content) });
    assert.equal(totalLines, 2);
    assert.equal(entries.length, 0);
  });
});

// ---------------------------------------------------------------------------
// 7. clearErrorLog — filesystem integration
// ---------------------------------------------------------------------------

describe('clearErrorLog — filesystem integration', () => {
  it('returns 0 when the log file does not exist', () => {
    const dir = makeTmpDir();
    const logFilePath = path.join(dir, 'nonexistent-dir', 'error-log.jsonl');
    const count = clearErrorLog({ logFilePath });
    assert.equal(count, 0);
    try { fs.rmSync(dir, { recursive: true }); } catch { /* cleanup */ }
  });

  it('clears the file and returns the number of entries', () => {
    const dir = makeTmpDir();
    const logFilePath = path.join(dir, 'error-log.jsonl');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(logFilePath, [makeEntry('ERR_A'), makeEntry('ERR_B')].join('\n') + '\n', 'utf8');

    const count = clearErrorLog({ logFilePath });
    assert.equal(count, 2);
    assert.equal(fs.readFileSync(logFilePath, 'utf8').trim(), '');
    try { fs.rmSync(dir, { recursive: true }); } catch { /* cleanup */ }
  });
});

// ---------------------------------------------------------------------------
// 8. logStructuredError file integration (real fs)
// ---------------------------------------------------------------------------

describe('logStructuredError — real file integration', () => {
  let dir: string;
  let logFilePath: string;

  before(() => {
    dir = makeTmpDir();
    logFilePath = path.join(dir, '.danteforge', 'error-log.jsonl');
    fs.mkdirSync(path.dirname(logFilePath), { recursive: true });
  });

  after(() => {
    try { fs.rmSync(dir, { recursive: true }); } catch { /* cleanup */ }
  });

  it('creates the file and appends entries', () => {
    logStructuredError(new Error('real fs test'), { command: 'test' }, { logFilePath });
    assert.ok(fs.existsSync(logFilePath), 'log file should exist');
    const raw = fs.readFileSync(logFilePath, 'utf8').trim();
    const entry = JSON.parse(raw) as StructuredErrorEntry;
    assert.equal(entry.message, 'real fs test');
    assert.equal(entry.command, 'test');
  });

  it('appends multiple entries (each is one line)', () => {
    logStructuredError(new Error('err1'), {}, { logFilePath });
    logStructuredError(new Error('err2'), {}, { logFilePath });
    const raw = fs.readFileSync(logFilePath, 'utf8');
    const lines = raw.trim().split('\n').filter(l => l.trim());
    assert.ok(lines.length >= 3, 'should have at least 3 lines total');
  });
});
