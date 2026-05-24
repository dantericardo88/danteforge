// Security Red-Team Court — tests
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runSecurityCourt } from '../src/matrix/courts/security-red-team.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeReadFile(files: Record<string, string>) {
  return async (p: string) => {
    const content = files[p];
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  };
}

function makeExists(files: Record<string, string>) {
  return async (p: string) => p in files;
}

function makeOpts(files: Record<string, string>) {
  return { _readFile: makeReadFile(files), _exists: makeExists(files) };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('runSecurityCourt', () => {
  it('returns allow_merge when no violations found', async () => {
    const files = { '/proj/src/clean.ts': 'export function greet(name: string) { return `Hello ${name}`; }' };
    const result = await runSecurityCourt(['/proj/src/clean.ts'], '/proj', makeOpts(files));
    assert.equal(result.recommendation, 'allow_merge');
    assert.equal(result.criticalCount, 0);
    assert.equal(result.filesChecked, 1);
  });

  it('detects eval() as CRITICAL and blocks merge', async () => {
    const files = { '/proj/src/bad.ts': 'const x = eval(userInput);' };
    const result = await runSecurityCourt(['/proj/src/bad.ts'], '/proj', makeOpts(files));
    assert.equal(result.recommendation, 'block_merge');
    assert.equal(result.criticalCount, 1);
    assert.ok(result.findings[0].patternId === 'eval-injection');
    assert.ok(result.blockedBy.length > 0);
  });

  it('detects hardcoded secret as CRITICAL', async () => {
    const files = { '/proj/src/auth.ts': 'const password = "mySecretPassword123";' };
    const result = await runSecurityCourt(['/proj/src/auth.ts'], '/proj', makeOpts(files));
    assert.equal(result.recommendation, 'block_merge');
    assert.ok(result.findings.some(f => f.patternId === 'hardcoded-secret'));
  });

  it('detects SQL concatenation as CRITICAL', async () => {
    const files = { '/proj/src/db.ts': 'const q = "SELECT * FROM users WHERE id = " + req.params.id;' };
    const result = await runSecurityCourt(['/proj/src/db.ts'], '/proj', makeOpts(files));
    assert.ok(result.findings.some(f => f.patternId === 'sql-concatenation'));
    assert.equal(result.criticalCount, 1);
  });

  it('detects CORS wildcard as HIGH but does not block merge', async () => {
    const files = { '/proj/src/server.ts': "app.use(cors({ origin: '*' }));" };
    const result = await runSecurityCourt(['/proj/src/server.ts'], '/proj', makeOpts(files));
    assert.equal(result.recommendation, 'allow_merge');
    assert.equal(result.highCount, 1);
    assert.ok(result.findings.some(f => f.patternId === 'cors-wildcard'));
  });

  it('detects sensitive data in console.log as HIGH', async () => {
    const files = { '/proj/src/login.ts': 'console.log("User password:", user.password);' };
    const result = await runSecurityCourt(['/proj/src/login.ts'], '/proj', makeOpts(files));
    assert.ok(result.findings.some(f => f.patternId === 'sensitive-data-logged'));
    assert.equal(result.highCount, 1);
  });

  it('detects SSRF as CRITICAL', async () => {
    const files = { '/proj/src/proxy.ts': 'const data = await fetch(req.query.url);' };
    const result = await runSecurityCourt(['/proj/src/proxy.ts'], '/proj', makeOpts(files));
    assert.ok(result.findings.some(f => f.patternId === 'ssrf-unvalidated-url'));
    assert.equal(result.criticalCount, 1);
  });

  it('skips comment lines — no false positives from commented-out eval()', async () => {
    const files = { '/proj/src/safe.ts': '// const x = eval(userInput); // do not use this' };
    const result = await runSecurityCourt(['/proj/src/safe.ts'], '/proj', makeOpts(files));
    assert.equal(result.recommendation, 'allow_merge');
    assert.equal(result.criticalCount, 0);
  });

  it('skips files not in filesChanged', async () => {
    const files = {
      '/proj/src/bad.ts': 'eval(x)',
      '/proj/src/other.ts': 'console.log("hello")',
    };
    // Only scan other.ts — bad.ts should not be checked
    const result = await runSecurityCourt(['/proj/src/other.ts'], '/proj', makeOpts(files));
    assert.equal(result.criticalCount, 0);
    assert.equal(result.filesChecked, 1);
  });

  it('skips non-.ts files (dist, .d.ts, node_modules)', async () => {
    const files = { '/proj/dist/index.js': 'eval(x)', '/proj/src/index.d.ts': 'eval(x)' };
    const result = await runSecurityCourt(
      ['/proj/dist/index.js', '/proj/src/index.d.ts'],
      '/proj',
      makeOpts(files),
    );
    assert.equal(result.filesChecked, 0);
    assert.equal(result.criticalCount, 0);
  });

  it('handles unreadable files gracefully', async () => {
    const opts = { _readFile: async () => { throw new Error('ENOENT'); }, _exists: async () => true };
    const result = await runSecurityCourt(['/proj/src/missing.ts'], '/proj', opts);
    assert.equal(result.recommendation, 'allow_merge');
    assert.equal(result.criticalCount, 0);
  });
});
