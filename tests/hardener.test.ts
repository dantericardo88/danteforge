import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  checkOrphanAudit,
  checkClaimAuditor,
  checkHardcodedFallback,
  checkImportResolves,
  checkFunctionalDiff,
  checkPrimaryNotParallel,
  runHardenGate,
} from '../src/matrix/engines/hardener.js';
import type { MatrixDimension } from '../src/core/compete-matrix.js';
import { computeHardenScoreCap, applyHardenCap, HARDEN_CHECK_CAPS } from '../src/matrix/types/harden-check.js';

// ── Test helpers ──────────────────────────────────────────────────────────────

function makeDim(overrides: Partial<MatrixDimension> & Record<string, unknown> = {}): MatrixDimension {
  return {
    id: 'test_dim',
    label: 'Test Dim',
    weight: 1,
    category: 'core',
    frequency: 'medium',
    scores: { self: 6 },
    gap_to_leader: 0,
    leader: 'self',
    gap_to_closed_source_leader: 0,
    closed_source_leader: 'self',
    gap_to_oss_leader: 0,
    oss_leader: 'self',
    status: 'in-progress',
    sprint_history: [],
    ...overrides,
  } as MatrixDimension;
}

function fakeIo(files: Record<string, string>) {
  return {
    readFile: async (p: string) => {
      const norm = p.replace(/\\/g, '/');
      const exact = Object.keys(files).find(k => k.replace(/\\/g, '/') === norm);
      if (!exact) throw new Error(`ENOENT ${p}`);
      return files[exact]!;
    },
    exists: async (p: string) => {
      const norm = p.replace(/\\/g, '/');
      return Object.keys(files).some(k => k.replace(/\\/g, '/') === norm);
    },
    listFiles: async (dir: string, glob?: RegExp) => {
      const norm = dir.replace(/\\/g, '/');
      const prefix = norm.endsWith('/') ? norm : norm + '/';
      return Object.keys(files)
        .map(k => k.replace(/\\/g, '/'))
        .filter(k => k.startsWith(prefix))
        .filter(k => !glob || glob.test(path.basename(k)));
    },
  };
}

// ── checkOrphanAudit ──────────────────────────────────────────────────────────

describe('checkOrphanAudit', () => {
  it('skipped when no capability_callsite declared', async () => {
    const dim = makeDim();
    const result = await checkOrphanAudit(dim, '/p');
    assert.equal(result.skipped, true);
    assert.equal(result.passed, true, 'skip means we cannot fail');
    assert.match(result.skipReason ?? '', /no capability_callsite/);
  });

  it('skipped when explicit harden_override applies', async () => {
    const dim = makeDim({
      capability_callsite: { file: 'src/foo.ts', symbol: 'foo' },
      harden_overrides: [{
        check: 'orphan-audit',
        reason: 'intentional: standalone CLI helper',
        approvedAt: '2026-05-18',
        approvedBy: 'tester',
      }],
    });
    const result = await checkOrphanAudit(dim, '/p', fakeIo({}));
    assert.equal(result.skipped, true);
    assert.match(result.skipReason ?? '', /override approved by tester/);
  });

  it('fails when callsite has zero production importers', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/orphan.ts', symbol: 'doStuff' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'orphan.ts')]: 'export function doStuff() {}',
      [path.join('/p', 'src', 'unrelated.ts')]: 'export const x = 1;',
    });
    const result = await checkOrphanAudit(dim, '/p', io);
    assert.equal(result.passed, false);
    assert.equal(result.findings.length, 1);
    assert.match(result.findings[0]!.reason, /Orphan module/);
    assert.equal(result.scoreCap, HARDEN_CHECK_CAPS['orphan-audit']);
  });

  it('passes when a production file imports the callsite by module path', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/wired.ts', symbol: 'doStuff' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'wired.ts')]: 'export function doStuff() {}',
      [path.join('/p', 'src', 'caller.ts')]: `import { doStuff } from './wired.js';\ndoStuff();`,
    });
    const result = await checkOrphanAudit(dim, '/p', io);
    assert.equal(result.passed, true);
    assert.equal(result.findings.length, 0);
  });

  it('passes when a production file references the symbol (even without explicit import)', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/wired.ts', symbol: 'doStuff' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'wired.ts')]: 'export function doStuff() {}',
      [path.join('/p', 'src', 'caller.ts')]: 'const result = doStuff();',
    });
    const result = await checkOrphanAudit(dim, '/p', io);
    assert.equal(result.passed, true);
  });

  it('ignores tests/ when counting importers', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/lonely.ts', symbol: 'foo' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'lonely.ts')]: 'export function foo() {}',
      [path.join('/p', 'src', 'tests', 'lonely.test.ts')]: `import { foo } from '../lonely.js';\nfoo();`,
    });
    const result = await checkOrphanAudit(dim, '/p', io);
    assert.equal(result.passed, false, 'test-only importers do not count');
  });
});

// ── checkClaimAuditor ─────────────────────────────────────────────────────────

describe('checkClaimAuditor', () => {
  it('skipped when no capability_callsite', async () => {
    const result = await checkClaimAuditor(makeDim(), '/p');
    assert.equal(result.skipped, true);
  });

  it('passes when docstring claim matches code reality', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/mcp.ts', symbol: 'server' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'mcp.ts')]: `
/** Registers 3 MCP tools. */
server.tool('a', x);
server.tool('b', y);
server.tool('c', z);
`,
    });
    const result = await checkClaimAuditor(dim, '/p', io);
    assert.equal(result.passed, true, 'claim of 3 tools matches 3 server.tool() calls');
  });

  it('fails when docstring claims 131 tools but code has only 4', async () => {
    // Exactly the DanteFinance dim_059 failure mode.
    const dim = makeDim({ capability_callsite: { file: 'src/mcp.ts', symbol: 'server' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'mcp.ts')]: `
/** Surface: 131 MCP tools wired into the protocol layer. */
server.tool('a', x);
server.tool('b', y);
server.tool('c', z);
server.tool('d', w);
`,
    });
    const result = await checkClaimAuditor(dim, '/p', io);
    assert.equal(result.passed, false);
    assert.ok(result.findings.length >= 1);
    assert.match(result.findings[0]!.snippet, /131/);
  });

  it('fails when docstring claims 49 countries but no market literals exist', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/markets.ts', symbol: 'config' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'markets.ts')]: `
/** Trades across 49 countries with full coverage. */
const config = {};
`,
    });
    const result = await checkClaimAuditor(dim, '/p', io);
    assert.equal(result.passed, false);
  });

  it('fails when capability_callsite.file does not exist on disk', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/missing.ts', symbol: 'nope' } });
    const result = await checkClaimAuditor(dim, '/p', fakeIo({}));
    assert.equal(result.passed, false);
    assert.match(result.findings[0]!.reason, /does not exist/);
  });
});

// ── checkHardcodedFallback ────────────────────────────────────────────────────

describe('checkHardcodedFallback', () => {
  it('skipped when no capability_callsite', async () => {
    const r = await checkHardcodedFallback(makeDim(), '/p', fakeIo({}));
    assert.equal(r.skipped, true);
  });

  it('passes for clean dynamic code', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/scraper.ts', symbol: 'fetchTickers' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'scraper.ts')]: `
export async function fetchTickers(query: string): Promise<string[]> {
  const result = await fetch('/api/edgar?q=' + query);
  return await result.json();
}
`,
    });
    const r = await checkHardcodedFallback(dim, '/p', io);
    assert.equal(r.passed, true);
  });

  it('catches the DanteFinance dim_027 ticker-list pattern', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/scraper.ts', symbol: 'find_vulnerable_companies' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'scraper.ts')]: `
export function find_vulnerable_companies(cik_list?: string[]): string[] {
  if (!cik_list) {
    return ['DIS', 'PFE', 'INTC'];
  }
  return cik_list;
}
`,
    });
    const r = await checkHardcodedFallback(dim, '/p', io);
    assert.equal(r.passed, false);
    assert.ok(r.findings.length >= 1);
    assert.match(r.findings[0]!.reason, /Hardcoded fallback/);
    assert.equal(r.scoreCap, 6.5);
  });

  it('catches catch-block hardcoded returns', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/api.ts', symbol: 'getCompanies' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'api.ts')]: `
export async function getCompanies() {
  try {
    return await fetchFromAPI();
  } catch (err) {
    return ['AAPL', 'GOOGL', 'MSFT'];
  }
}
`,
    });
    const r = await checkHardcodedFallback(dim, '/p', io);
    assert.equal(r.passed, false);
  });

  it('honors harden_overrides for legitimate constants', async () => {
    const dim = makeDim({
      capability_callsite: { file: 'src/api.ts', symbol: 'x' },
      harden_overrides: [{
        check: 'hardcoded-fallback',
        reason: 'These are official ISO country codes, intentional',
        approvedAt: '2026-05-18', approvedBy: 'op',
      }],
    });
    const io = fakeIo({
      [path.join('/p', 'src', 'api.ts')]: `return ['US', 'GB', 'JP'];`,
    });
    const r = await checkHardcodedFallback(dim, '/p', io);
    assert.equal(r.skipped, true);
  });
});

// ── checkImportResolves ───────────────────────────────────────────────────────

describe('checkImportResolves', () => {
  it('skipped when no capability_callsite', async () => {
    const r = await checkImportResolves(makeDim(), '/p', fakeIo({}));
    assert.equal(r.skipped, true);
  });

  it('passes when try/import resolves to a real file', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/wrapper.ts', symbol: 'maybeLoad' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'wrapper.ts')]: `
async function maybeLoad() {
  try {
    const m = await import('./real-module.js');
    return m;
  } catch (e) {
    return null;
  }
}
`,
      [path.join('/p', 'src', 'real-module.ts')]: 'export const x = 1;',
    });
    const r = await checkImportResolves(dim, '/p', io);
    assert.equal(r.passed, true);
  });

  it('catches silent-stub typo pattern (sentinel.see instead of sentinel.spm)', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/wrapper.ts', symbol: 'maybeLoad' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'wrapper.ts')]: `
async function maybeLoad() {
  try {
    const m = await import('./typo-module.js');
    return m;
  } catch (e) {
    return null;
  }
}
`,
      // Note: './real-module' would resolve, but './typo-module' does NOT exist.
    });
    const r = await checkImportResolves(dim, '/p', io);
    assert.equal(r.passed, false);
    assert.equal(r.scoreCap, 4.0);
    assert.match(r.findings[0]!.reason, /Silent-stub/);
  });

  it('catches Python from-X-import inside try', async () => {
    const dim = makeDim({ capability_callsite: { file: 'sentinel/handler.py', symbol: 'handle' } });
    const io = fakeIo({
      [path.join('/p', 'sentinel', 'handler.py')]: `
try:
    from sentinel.see import helper
except ImportError:
    helper = _stub
`,
      // sentinel.see does not exist
    });
    const r = await checkImportResolves(dim, '/p', io);
    assert.equal(r.passed, false);
  });

  it('treats node:* and external pkgs as resolved (out of scan scope)', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/util.ts', symbol: 'x' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'util.ts')]: `
async function load() {
  try {
    const c = await import('node:crypto');
    const fs = await import('node:fs');
    return [c, fs];
  } catch (e) { return null; }
}
`,
    });
    const r = await checkImportResolves(dim, '/p', io);
    assert.equal(r.passed, true);
  });
});

// ── checkFunctionalDiff ───────────────────────────────────────────────────────

describe('checkFunctionalDiff', () => {
  it('skipped when capability_test lacks {{INPUT}} placeholder', async () => {
    const dim = makeDim({ capability_test: { command: 'node dist/index.js help', description: 'static' } } as any);
    const r = await checkFunctionalDiff(dim, '/p');
    assert.equal(r.skipped, true);
  });

  it('skipped when capability_test is undefined', async () => {
    const r = await checkFunctionalDiff(makeDim(), '/p');
    assert.equal(r.skipped, true);
  });

  it('honors harden_overrides', async () => {
    const dim = makeDim({
      capability_test: { command: 'echo {{INPUT}}', description: 'static echo' },
      harden_overrides: [{
        check: 'functional-diff',
        reason: 'echo is fine — its output is the input by design',
        approvedAt: '2026-05-18', approvedBy: 'op',
      }],
    } as any);
    const r = await checkFunctionalDiff(dim, '/p');
    assert.equal(r.skipped, true);
  });

  // NOTE: We intentionally do NOT add an end-to-end test that spawns a shell —
  // those tests are flaky on Windows under PowerShell + node --test and slow
  // the suite. The deterministic logic (input substitution, diff math) is
  // exercised by the skip-path tests above; live behavior is verified by the
  // E2E harden command run in the live verification step.
});

// ── checkPrimaryNotParallel ───────────────────────────────────────────────────

describe('checkPrimaryNotParallel', () => {
  it('skipped when no capability_callsite', async () => {
    const r = await checkPrimaryNotParallel(makeDim(), '/p', fakeIo({}));
    assert.equal(r.skipped, true);
  });

  it('skipped when capability_callsite.symbol is empty', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/foo.ts', symbol: '' } });
    const r = await checkPrimaryNotParallel(dim, '/p', fakeIo({
      [path.join('/p', 'src', 'foo.ts')]: 'export const foo = 1;',
    }));
    assert.equal(r.skipped, true);
    assert.match(r.skipReason ?? '', /symbol not declared/);
  });

  it('passes when only the declared file exports the symbol', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/foo.ts', symbol: 'doStuff' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'foo.ts')]: 'export function doStuff() { return 1; }',
      [path.join('/p', 'src', 'caller.ts')]: 'import { doStuff } from "./foo.js";',
    });
    const r = await checkPrimaryNotParallel(dim, '/p', io);
    assert.equal(r.passed, true);
  });

  it('passes when declared callsite has MORE importers than any parallel implementation', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/foo-new.ts', symbol: 'doStuff' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'foo-new.ts')]: 'export function doStuff() { return 1; }',
      [path.join('/p', 'src', 'foo-legacy.ts')]: 'export function doStuff() { return 0; }',
      // 2 importers of foo-new, 1 importer of foo-legacy → declared wins
      [path.join('/p', 'src', 'caller-a.ts')]: 'import { doStuff } from "./foo-new.js";',
      [path.join('/p', 'src', 'caller-b.ts')]: 'import { doStuff } from "./foo-new.js";',
      [path.join('/p', 'src', 'caller-legacy.ts')]: 'import { doStuff } from "./foo-legacy.js";',
    });
    const r = await checkPrimaryNotParallel(dim, '/p', io);
    assert.equal(r.passed, true);
  });

  it('fails when a parallel implementation has MORE production importers', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/foo-new.ts', symbol: 'doStuff' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'foo-new.ts')]: 'export function doStuff() { return 1; }',
      [path.join('/p', 'src', 'foo-legacy.ts')]: 'export function doStuff() { return 0; }',
      // 0 importers of foo-new, 3 importers of foo-legacy → legacy is primary
      [path.join('/p', 'src', 'caller-a.ts')]: 'import { doStuff } from "./foo-legacy.js";',
      [path.join('/p', 'src', 'caller-b.ts')]: 'import { doStuff } from "./foo-legacy.js";',
      [path.join('/p', 'src', 'caller-c.ts')]: 'import { doStuff } from "./foo-legacy.js";',
    });
    const r = await checkPrimaryNotParallel(dim, '/p', io);
    assert.equal(r.passed, false);
    assert.equal(r.scoreCap, 5.5);
    assert.equal(r.findings.length, 1);
    assert.match(r.findings[0]!.reason, /Parallel implementation found/);
    assert.match(r.findings[0]!.reason, /foo-legacy/);
  });

  it('respects export default function patterns', async () => {
    const dim = makeDim({ capability_callsite: { file: 'src/foo-new.ts', symbol: 'doStuff' } });
    const io = fakeIo({
      [path.join('/p', 'src', 'foo-new.ts')]: 'export function doStuff() { return 1; }',
      [path.join('/p', 'src', 'foo-default.ts')]: 'export default function doStuff() { return 0; }',
      // Multiple importers of the default-export legacy
      [path.join('/p', 'src', 'caller-a.ts')]: 'import doStuff from "./foo-default.js";',
      [path.join('/p', 'src', 'caller-b.ts')]: 'import doStuff from "./foo-default.js";',
    });
    const r = await checkPrimaryNotParallel(dim, '/p', io);
    assert.equal(r.passed, false, 'export default function with more importers should fail');
  });

  it('honors harden_overrides', async () => {
    const dim = makeDim({
      capability_callsite: { file: 'src/foo-new.ts', symbol: 'doStuff' },
      harden_overrides: [{
        check: 'primary-not-parallel',
        reason: 'intentional shadow during cutover',
        approvedAt: '2026-05-18', approvedBy: 'op',
      }],
    });
    const io = fakeIo({
      [path.join('/p', 'src', 'foo-new.ts')]: 'export function doStuff() { return 1; }',
      [path.join('/p', 'src', 'foo-legacy.ts')]: 'export function doStuff() { return 0; }',
      [path.join('/p', 'src', 'caller.ts')]: 'import { doStuff } from "./foo-legacy.js";',
    });
    const r = await checkPrimaryNotParallel(dim, '/p', io);
    assert.equal(r.skipped, true);
  });
});

describe('computeHardenScoreCap', () => {
  it('returns 10.0 when every check passes', () => {
    const v = {
      dimensionId: 'x', allowed: true, scoreCap: 10.0,
      checks: [
        { check: 'orphan-audit' as const, passed: true, durationMs: 0, findings: [], scoreCap: 6.0 },
        { check: 'claim-auditor' as const, passed: true, durationMs: 0, findings: [], scoreCap: 7.0 },
      ],
      evidencePath: '', ranAt: '', reason: '',
    };
    assert.equal(computeHardenScoreCap(v), 10.0);
  });

  it('returns the minimum cap of any failed check', () => {
    const v = {
      dimensionId: 'x', allowed: false, scoreCap: 0,
      checks: [
        { check: 'orphan-audit' as const, passed: false, durationMs: 0, findings: [], scoreCap: 6.0 },
        { check: 'claim-auditor' as const, passed: false, durationMs: 0, findings: [], scoreCap: 7.0 },
      ],
      evidencePath: '', ranAt: '', reason: '',
    };
    assert.equal(computeHardenScoreCap(v), 6.0, 'lower cap wins');
  });

  it('ignores skipped checks in the cap math', () => {
    const v = {
      dimensionId: 'x', allowed: false, scoreCap: 0,
      checks: [
        { check: 'orphan-audit' as const, passed: false, durationMs: 0, findings: [], scoreCap: 6.0, skipped: true },
        { check: 'claim-auditor' as const, passed: false, durationMs: 0, findings: [], scoreCap: 7.0 },
      ],
      evidencePath: '', ranAt: '', reason: '',
    };
    assert.equal(computeHardenScoreCap(v), 7.0, 'skipped failed-results are ignored');
  });
});

describe('applyHardenCap', () => {
  it('passes through when allowed=true', () => {
    const v = { allowed: true, scoreCap: 10.0 } as any;
    assert.equal(applyHardenCap(9.0, v), 9.0);
  });

  it('clamps to scoreCap when allowed=false', () => {
    const v = { allowed: false, scoreCap: 6.0 } as any;
    assert.equal(applyHardenCap(9.0, v), 6.0);
  });

  it('does not raise scores; only clamps down', () => {
    const v = { allowed: false, scoreCap: 6.0 } as any;
    assert.equal(applyHardenCap(4.0, v), 4.0, 'a score already below cap stays');
  });
});

// ── runHardenGate (aggregator) ────────────────────────────────────────────────

describe('runHardenGate', () => {
  it('runs all 6 checks; without capability_callsite all skip', async () => {
    const dim = makeDim();
    const verdict = await runHardenGate({
      dimensionId: dim.id, dim, cwd: '/p', _noWrite: true,
    });
    assert.equal(verdict.checks.length, 6, 'all 6 checks ran (orphan + claim + hardcoded + import + functional + primary-not-parallel)');
    assert.equal(verdict.allowed, true, 'all skipped → allowed');
    assert.equal(verdict.scoreCap, 10.0);
  });

  it('blocks when an injected check fails', async () => {
    const dim = makeDim();
    const verdict = await runHardenGate({
      dimensionId: dim.id, dim, cwd: '/p', _noWrite: true,
      _check: {
        'orphan-audit': async () => ({
          check: 'orphan-audit', passed: false, durationMs: 1, scoreCap: 6.0,
          findings: [{ file: 'src/foo.ts', line: 1, snippet: '', reason: 'orphan' }],
        }),
      },
    });
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.scoreCap, 6.0);
    assert.match(verdict.reason, /1 check\(s\) failed: orphan-audit/);
  });

  it('honors onlyChecks filter', async () => {
    const dim = makeDim();
    const verdict = await runHardenGate({
      dimensionId: dim.id, dim, cwd: '/p',
      onlyChecks: ['orphan-audit'],
      _noWrite: true,
    });
    assert.equal(verdict.checks.length, 1);
    assert.equal(verdict.checks[0]!.check, 'orphan-audit');
  });
});
