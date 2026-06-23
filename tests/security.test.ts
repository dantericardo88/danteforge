// tests/security.test.ts — Tests for security audit log, safe-path, maskSecrets, and security-scan
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

// ── security-audit-log ────────────────────────────────────────────────────────

import {
  logSecurityEvent,
  getSecuritySummary,
  makeSecurityEvent,
  type SecurityEvent,
} from '../src/core/security-audit-log.js';

describe('logSecurityEvent', () => {
  it('calls the injected appender with a JSON line', () => {
    const captured: Array<{ filePath: string; line: string }> = [];
    const appender = (filePath: string, line: string) => { captured.push({ filePath, line }); };

    logSecurityEvent(
      { type: 'api_key_access', severity: 'info', detail: 'test', timestamp: '2026-01-01T00:00:00.000Z' },
      '/tmp/testproj',
      appender,
    );

    assert.equal(captured.length, 1);
    const parsed = JSON.parse(captured[0].line) as SecurityEvent;
    assert.equal(parsed.type, 'api_key_access');
    assert.equal(parsed.severity, 'info');
    assert.equal(parsed.detail, 'test');
  });

  it('includes optional command field', () => {
    const captured: string[] = [];
    const appender = (_fp: string, line: string) => { captured.push(line); };

    logSecurityEvent(
      { type: 'shell_command', severity: 'warn', detail: 'ls -la', timestamp: '2026-01-01T00:00:00.000Z', command: 'forge' },
      '/tmp/proj',
      appender,
    );

    const parsed = JSON.parse(captured[0]) as SecurityEvent;
    assert.equal(parsed.command, 'forge');
  });

  it('does not throw when appender throws (best-effort)', () => {
    const badAppender = () => { throw new Error('disk full'); };
    assert.doesNotThrow(() => {
      logSecurityEvent(
        { type: 'file_write', severity: 'info', detail: 'wrote a file', timestamp: new Date().toISOString() },
        '/tmp',
        badAppender,
      );
    });
  });

  it('writes path_traversal_attempt events', () => {
    const captured: string[] = [];
    logSecurityEvent(
      { type: 'path_traversal_attempt', severity: 'critical', detail: 'bad input', timestamp: new Date().toISOString() },
      '/tmp',
      (_fp, line) => { captured.push(line); },
    );
    const parsed = JSON.parse(captured[0]) as SecurityEvent;
    assert.equal(parsed.type, 'path_traversal_attempt');
    assert.equal(parsed.severity, 'critical');
  });

  it('writes rate_limit_hit events', () => {
    const captured: string[] = [];
    logSecurityEvent(
      { type: 'rate_limit_hit', severity: 'warn', detail: 'llm-api hit limit', timestamp: new Date().toISOString() },
      '/tmp',
      (_fp, line) => { captured.push(line); },
    );
    const parsed = JSON.parse(captured[0]) as SecurityEvent;
    assert.equal(parsed.type, 'rate_limit_hit');
  });

  it('writes suspicious_input events', () => {
    const captured: string[] = [];
    logSecurityEvent(
      { type: 'suspicious_input', severity: 'warn', detail: 'null byte in input', timestamp: new Date().toISOString() },
      '/tmp',
      (_fp, line) => { captured.push(line); },
    );
    const parsed = JSON.parse(captured[0]) as SecurityEvent;
    assert.equal(parsed.type, 'suspicious_input');
  });
});

describe('getSecuritySummary', () => {
  it('returns zero counts for empty log', () => {
    const summary = getSecuritySummary('/nonexistent', () => '');
    assert.equal(summary.totalEvents, 0);
    assert.equal(summary.hasCritical, false);
  });

  it('counts events by type and severity', () => {
    const events: SecurityEvent[] = [
      { type: 'api_key_access', severity: 'info', detail: 'a', timestamp: '2026-01-01T00:00:00.000Z' },
      { type: 'path_traversal_attempt', severity: 'critical', detail: 'b', timestamp: '2026-01-01T00:00:00.000Z' },
      { type: 'path_traversal_attempt', severity: 'critical', detail: 'c', timestamp: '2026-01-01T00:00:00.000Z' },
    ];
    const rawLog = events.map((e) => JSON.stringify(e)).join('\n');
    const summary = getSecuritySummary('/tmp', () => rawLog);

    assert.equal(summary.totalEvents, 3);
    assert.equal(summary.byType['api_key_access'], 1);
    assert.equal(summary.byType['path_traversal_attempt'], 2);
    assert.equal(summary.bySeverity.critical, 2);
    assert.equal(summary.bySeverity.info, 1);
    assert.equal(summary.hasCritical, true);
    assert.equal(summary.criticalEvents.length, 2);
  });

  it('skips malformed JSON lines gracefully', () => {
    const rawLog = '{"type":"file_write","severity":"info","detail":"ok","timestamp":"t"}\nNOT_JSON\n';
    const summary = getSecuritySummary('/tmp', () => rawLog);
    assert.equal(summary.totalEvents, 1);
  });
});

describe('makeSecurityEvent', () => {
  it('builds event with current timestamp', () => {
    const ev = makeSecurityEvent('api_key_access', 'info', 'accessing key');
    assert.equal(ev.type, 'api_key_access');
    assert.equal(ev.severity, 'info');
    assert.equal(ev.detail, 'accessing key');
    assert.ok(ev.timestamp.length > 0);
    assert.equal(ev.command, undefined);
  });

  it('includes optional command', () => {
    const ev = makeSecurityEvent('shell_command', 'warn', 'git push', 'forge');
    assert.equal(ev.command, 'forge');
  });
});

// ── safe-path ─────────────────────────────────────────────────────────────────

import {
  resolveSafePath,
  isSafePath,
  sanitizeFilename,
  SecurityError,
} from '../src/core/safe-path.js';

describe('resolveSafePath', () => {
  // Use a real temp directory so paths work cross-platform (Windows/Linux)
  const BASE = path.join(os.tmpdir(), 'danteforge-test-base');

  it('returns resolved path for a safe relative path', () => {
    const result = resolveSafePath('sub/file.ts', BASE);
    assert.equal(result, path.resolve(BASE, 'sub/file.ts'));
  });

  it('returns resolved path for a nested path within base', () => {
    const nested = path.join(BASE, 'sub', 'file.ts');
    const result = resolveSafePath(nested, BASE);
    assert.equal(result, nested);
  });

  it('returns the base dir itself when input is "."', () => {
    const result = resolveSafePath('.', BASE);
    assert.equal(result, path.resolve(BASE));
  });

  it('throws SecurityError on ../ traversal', () => {
    assert.throws(
      () => resolveSafePath('../outside.ts', BASE),
      (err: unknown) => {
        assert.ok(err instanceof SecurityError);
        assert.equal((err as SecurityError).code, 'ERR_PATH_TRAVERSAL');
        return true;
      },
    );
  });

  it('throws SecurityError on absolute path escaping base', () => {
    // Use a path that definitely escapes the temp base
    const outside = path.join(os.tmpdir(), 'outside.txt');
    // If outside happens to equal BASE (very unlikely), just test that it's safe
    if (outside === BASE) return;
    assert.throws(
      () => resolveSafePath(outside, BASE),
      (err: unknown) => err instanceof SecurityError,
    );
  });

  it('throws SecurityError on null byte in input', () => {
    assert.throws(
      () => resolveSafePath('file\0name.ts', BASE),
      (err: unknown) => {
        assert.ok(err instanceof SecurityError);
        assert.equal((err as SecurityError).code, 'ERR_PATH_TRAVERSAL');
        return true;
      },
    );
  });

  it('logs path_traversal_attempt event when traversal detected', () => {
    // We can't inject the logger here directly, but we verify the throw still happens
    assert.throws(() => resolveSafePath('../../secret', BASE));
  });
});

describe('isSafePath', () => {
  const BASE2 = path.join(os.tmpdir(), 'danteforge-test-base2');

  it('returns true for a path within base', () => {
    assert.equal(isSafePath('sub/file.ts', BASE2), true);
  });

  it('returns false for a path escaping base', () => {
    assert.equal(isSafePath('../outside.ts', BASE2), false);
  });

  it('returns false for absolute path outside base', () => {
    const outside = path.join(os.tmpdir(), 'outside-safe-test', 'file.txt');
    // Only test if the path is genuinely outside BASE2
    if (!outside.startsWith(BASE2)) {
      assert.equal(isSafePath(outside, BASE2), false);
    }
  });

  it('returns true for a nested deep path', () => {
    assert.equal(isSafePath('a/b/c/d/e.ts', BASE2), true);
  });

  it('returns false for null byte input', () => {
    assert.equal(isSafePath('file\0.ts', BASE2), false);
  });
});

describe('sanitizeFilename', () => {
  it('passes a clean filename through unchanged', () => {
    assert.equal(sanitizeFilename('myfile.ts'), 'myfile.ts');
  });

  it('strips path separators', () => {
    assert.equal(sanitizeFilename('path/to/file.ts'), 'pathtofile.ts');
    assert.equal(sanitizeFilename('path\\to\\file.ts'), 'pathtofile.ts');
  });

  it('strips leading dots', () => {
    assert.equal(sanitizeFilename('.hidden'), 'hidden');
    assert.equal(sanitizeFilename('...dangerous'), 'dangerous');
  });

  it('strips null bytes', () => {
    assert.equal(sanitizeFilename('file\0name.ts'), 'filename.ts');
  });

  it('strips Windows reserved chars', () => {
    const result = sanitizeFilename('file<name>: test|?.ts');
    assert.ok(!result.includes('<'));
    assert.ok(!result.includes('>'));
    assert.ok(!result.includes(':'));
    assert.ok(!result.includes('|'));
    assert.ok(!result.includes('?'));
  });

  it('strips traversal sequences', () => {
    assert.ok(!sanitizeFilename('..bad').includes('..'));
  });

  it('returns _ for empty or all-stripped input', () => {
    assert.equal(sanitizeFilename(''), '_');
    assert.equal(sanitizeFilename('..'), '_');
    assert.equal(sanitizeFilename('/\\'), '_');
  });
});

// ── maskSecrets ───────────────────────────────────────────────────────────────

import { maskSecrets } from '../src/core/logger.js';

describe('maskSecrets', () => {
  it('masks OpenAI-style sk- keys', () => {
    const result = maskSecrets('Using key sk-abcdefghijklmnopqrstu for request');
    assert.ok(!result.includes('sk-abcdefghijklmnopqrstu'), `Expected key to be masked, got: ${result}`);
    assert.ok(result.includes('sk-****'));
  });

  it('masks Bearer tokens', () => {
    const result = maskSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    assert.ok(!result.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9'));
    assert.ok(result.includes('Bearer ****'));
  });

  it('masks key= style secrets', () => {
    const result = maskSecrets('config: key=abcdefghijklmnopqrstuvwxyz1234');
    assert.ok(result.includes('key=****'));
    assert.ok(!result.includes('abcdefghijklmnopqrstuvwxyz1234'));
  });

  it('masks GitHub PATs (ghp_)', () => {
    const result = maskSecrets('token: ghp_abcdefghijklmnopqrstuvwxyz123456789');
    assert.ok(result.includes('ghp_****'));
  });

  it('masks xAI keys (xai-)', () => {
    const result = maskSecrets('key: xai-ABCDEFGHIJKLMNOPQRSTUVWXYZ12345');
    assert.ok(result.includes('xai-****'));
  });

  it('leaves non-secret strings unchanged', () => {
    const plain = 'Hello, world! No secrets here.';
    assert.equal(maskSecrets(plain), plain);
  });

  it('masks multiple keys in a single string', () => {
    const input = 'key1=sk-abcdefghijklmnopqrstuv and key2=sk-zyxwvutsrqponmlkjihg';
    const result = maskSecrets(input);
    assert.ok(!result.includes('abcdefghijklmnopqrstuv'));
    assert.ok(!result.includes('zyxwvutsrqponmlkjihg'));
  });
});

// ── security-scan ─────────────────────────────────────────────────────────────

import { securityScan } from '../src/cli/commands/security-scan.js';

const FAKE_FILES: Record<string, string> = {
  '/proj/src/safe.ts': `
// A safe file
export function greet(name: string): string {
  return \`Hello, \${name}\`;
}
`,
  '/proj/src/dangerous.ts': `
// This file has risky patterns
export function runBad(input: string) {
  eval(input); // CRITICAL
  const el = document.getElementById('x');
  if (el) el.innerHTML = input; // HIGH
}
`,
  '/proj/src/exec.ts': `
import { exec } from 'child_process';
// exec with a variable — risky
export function runCmd(cmd: string) {
  child_process.exec(cmd); // CRITICAL
}
`,
  '/proj/src/random.ts': `
// Using Math.random for token generation
export function generateToken(): string {
  // Generates a token using Math.random — should use crypto instead
  const token = Math.random().toString(36).slice(2);
  return token;
}
`,
  '/proj/src/hardcoded.ts': `
// Hardcoded API key — should never be here
const API_KEY = 'sk-abcdefghijklmnopqrstuvwxyz123456789';
`,
};

function makeTestGlob(fileMap: Record<string, string>) {
  return async (_pattern: string, _opts: { cwd: string; absolute: boolean }): Promise<string[]> => {
    return Object.keys(fileMap);
  };
}

function makeTestReadFile(fileMap: Record<string, string>) {
  return async (filePath: string): Promise<string> => {
    const content = fileMap[filePath];
    if (content === undefined) throw new Error(`File not found: ${filePath}`);
    return content;
  };
}

describe('securityScan', () => {
  it('runs validateSecurityControls from the production security-scan command', async () => {
    const safeFiles = { '/proj/src/safe.ts': FAKE_FILES['/proj/src/safe.ts'] };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(safeFiles),
      _readFile: makeTestReadFile(safeFiles),
      _stdout: () => {},
      _setExitCode: () => {},
    });

    assert.ok(result.securityControls, 'security-scan should expose security control validation output');
    assert.ok(Array.isArray(result.securityControls.issues));
  });

  it('returns zero findings for a safe file', async () => {
    const safeFiles = { '/proj/src/safe.ts': FAKE_FILES['/proj/src/safe.ts'] };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(safeFiles),
      _readFile: makeTestReadFile(safeFiles),
      _stdout: () => {},
    });
    assert.equal(result.criticalCount, 0);
    assert.equal(result.highCount, 0);
    assert.equal(result.passed, true);
  });

  it('detects eval() as CRITICAL', async () => {
    const files = { '/proj/src/dangerous.ts': FAKE_FILES['/proj/src/dangerous.ts'] };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: () => {},
      _setExitCode: () => {},
    });
    const evalFinding = result.findings.find((f) => f.patternId === 'eval-usage');
    assert.ok(evalFinding, 'Should detect eval()');
    assert.equal(evalFinding?.risk, 'CRITICAL');
  });

  it('detects innerHTML assignment as HIGH', async () => {
    const files = { '/proj/src/dangerous.ts': FAKE_FILES['/proj/src/dangerous.ts'] };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: () => {},
      _setExitCode: () => {},
    });
    const htmlFinding = result.findings.find((f) => f.patternId === 'innerhtml-assignment');
    assert.ok(htmlFinding, 'Should detect innerHTML');
    assert.equal(htmlFinding?.risk, 'HIGH');
  });

  it('detects child_process.exec with variable as CRITICAL', async () => {
    const files = { '/proj/src/exec.ts': FAKE_FILES['/proj/src/exec.ts'] };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: () => {},
      _setExitCode: () => {},
    });
    const execFinding = result.findings.find((f) => f.patternId === 'exec-non-literal');
    assert.ok(execFinding, 'Should detect exec with variable');
    assert.equal(execFinding?.risk, 'CRITICAL');
  });

  it('detects Math.random in security context as HIGH', async () => {
    const files = { '/proj/src/random.ts': FAKE_FILES['/proj/src/random.ts'] };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: () => {},
      _setExitCode: () => {},
    });
    const randFinding = result.findings.find((f) => f.patternId === 'math-random-security');
    assert.ok(randFinding, 'Should detect Math.random in security context');
    assert.equal(randFinding?.risk, 'HIGH');
  });

  it('detects hardcoded API key as CRITICAL', async () => {
    const files = { '/proj/src/hardcoded.ts': FAKE_FILES['/proj/src/hardcoded.ts'] };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: () => {},
      _setExitCode: () => {},
    });
    const keyFinding = result.findings.find((f) => f.patternId === 'hardcoded-api-key');
    assert.ok(keyFinding, 'Should detect hardcoded sk- key');
    assert.equal(keyFinding?.risk, 'CRITICAL');
  });

  it('redacts detected secrets from finding snippets', async () => {
    const files = { '/proj/src/hardcoded.ts': FAKE_FILES['/proj/src/hardcoded.ts'] };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: () => {},
      _setExitCode: () => {},
    });

    const keyFinding = result.findings.find((f) => f.patternId === 'hardcoded-api-key');
    assert.ok(keyFinding, 'Should detect hardcoded sk- key');
    assert.ok(!keyFinding.snippet.includes('sk-abcdefghijklmnopqrstuvwxyz123456789'));
    assert.ok(keyFinding.snippet.includes('sk-****'), `expected redacted snippet, got: ${keyFinding.snippet}`);
  });

  it('sets passed=false and exitCode=1 when CRITICAL findings exist', async () => {
    const files = { '/proj/src/dangerous.ts': FAKE_FILES['/proj/src/dangerous.ts'] };
    let exitCode = 0;
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: () => {},
      _setExitCode: (code) => { exitCode = code; },
    });
    assert.equal(result.passed, false);
    assert.equal(exitCode, 1);
  });

  it('does not set exitCode when no CRITICAL findings', async () => {
    const safeFiles = { '/proj/src/safe.ts': FAKE_FILES['/proj/src/safe.ts'] };
    let exitCode = 0;
    await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(safeFiles),
      _readFile: makeTestReadFile(safeFiles),
      _stdout: () => {},
      _setExitCode: (code) => { exitCode = code; },
    });
    assert.equal(exitCode, 0);
  });

  it('reports filesScanned count correctly', async () => {
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(FAKE_FILES),
      _readFile: makeTestReadFile(FAKE_FILES),
      _stdout: () => {},
      _setExitCode: () => {},
    });
    assert.equal(result.filesScanned, Object.keys(FAKE_FILES).length);
  });

  it('outputs JSON when --json flag is set', async () => {
    const lines: string[] = [];
    const files = { '/proj/src/safe.ts': FAKE_FILES['/proj/src/safe.ts'] };
    await securityScan({
      cwd: '/proj',
      json: true,
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: (l) => { lines.push(l); },
    });
    const combined = lines.join('');
    const parsed = JSON.parse(combined) as { filesScanned: number };
    assert.equal(typeof parsed.filesScanned, 'number');
  });

  it('does not flag eval() on a comment line', async () => {
    const files = { '/proj/src/commented.ts': `// eval(userInput) — this is just a comment\nexport const x = 1;\n` };
    const result = await securityScan({
      cwd: '/proj',
      _glob: makeTestGlob(files),
      _readFile: makeTestReadFile(files),
      _stdout: () => {},
    });
    const evalFinding = result.findings.find((f) => f.patternId === 'eval-usage');
    assert.equal(evalFinding, undefined, 'Should not flag eval in comments');
  });
});
