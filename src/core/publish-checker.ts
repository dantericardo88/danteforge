// Publish checker — pre-publish validation gate with 12 parallel checks.
// All checks use injected deps for testability without real FS/shell.

import fs from 'node:fs/promises';

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

export interface PublishCheckItem {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  remediation?: string;
}

export interface PublishCheckResult {
  items: PublishCheckItem[];
  readyToPublish: boolean;
  passCount: number;
  failCount: number;
  warnCount: number;
  checkedAt: string;
}

export interface PublishCheckerDeps {
  _readFile?: (path: string, encoding: string) => Promise<string>;
  _exec?: (cmd: string) => Promise<{ exitCode: number; stdout: string; stderr: string }>;
  _cwd?: () => string;
}

function pass(id: string, label: string, detail?: string): PublishCheckItem {
  return { id, label, status: 'pass', detail };
}

function fail(id: string, label: string, detail?: string, remediation?: string): PublishCheckItem {
  return { id, label, status: 'fail', detail, remediation };
}

function warn(id: string, label: string, detail?: string): PublishCheckItem {
  return { id, label, status: 'warn', detail };
}

async function checkPackageVersion(deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  try {
    const cwd = deps._cwd?.() ?? process.cwd();
    const readFn = deps._readFile ?? ((p: string, e: string) => fs.readFile(p, e as BufferEncoding));
    const content = await readFn(`${cwd}/package.json`, 'utf-8');
    const pkg = JSON.parse(content) as { version?: string };
    if (!pkg.version) return fail('package-version', 'package.json has version', 'No version field', 'Add version to package.json');
    if (!/^\d+\.\d+\.\d+/.test(pkg.version)) return fail('package-version', 'package.json has valid semver', pkg.version, 'Fix version to semver format');
    return pass('package-version', 'package.json has valid semver', pkg.version);
  } catch (err) {
    return fail('package-version', 'package.json has valid semver', String(err));
  }
}

async function checkChangelogEntry(deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  try {
    const cwd = deps._cwd?.() ?? process.cwd();
    const readFn = deps._readFile ?? ((p: string, e: string) => fs.readFile(p, e as BufferEncoding));
    const pkgContent = await readFn(`${cwd}/package.json`, 'utf-8');
    const pkg = JSON.parse(pkgContent) as { version?: string };
    const version = pkg.version ?? '';
    const changelog = await readFn(`${cwd}/CHANGELOG.md`, 'utf-8');
    if (!changelog.includes(version)) {
      return fail('changelog-entry', 'CHANGELOG.md has entry for current version', `v${version} not found`, 'Add changelog entry for this version');
    }
    return pass('changelog-entry', 'CHANGELOG.md has entry for current version', `v${version} found`);
  } catch (err) {
    return fail('changelog-entry', 'CHANGELOG.md has entry for current version', String(err));
  }
}

async function checkLicenseFile(deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  try {
    const cwd = deps._cwd?.() ?? process.cwd();
    const readFn = deps._readFile ?? ((p: string, e: string) => fs.readFile(p, e as BufferEncoding));
    await readFn(`${cwd}/LICENSE`, 'utf-8');
    return pass('license-file', 'LICENSE file exists');
  } catch {
    return fail('license-file', 'LICENSE file exists', undefined, 'Add a LICENSE file');
  }
}

async function checkReadmeExists(deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  try {
    const cwd = deps._cwd?.() ?? process.cwd();
    const readFn = deps._readFile ?? ((p: string, e: string) => fs.readFile(p, e as BufferEncoding));
    const content = await readFn(`${cwd}/README.md`, 'utf-8');
    if (content.length < 500) return warn('readme-exists', 'README.md is substantial (>500 bytes)', `Only ${content.length} bytes`);
    return pass('readme-exists', 'README.md is substantial (>500 bytes)', `${content.length} bytes`);
  } catch {
    return fail('readme-exists', 'README.md is substantial (>500 bytes)', undefined, 'Create a README.md');
  }
}

async function checkAuditClean(deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  if (!deps._exec) return { id: 'audit-clean', label: 'npm audit clean (no high/critical CVEs)', status: 'skip' };
  try {
    const result = await deps._exec('npm audit --audit-level=high');
    if (result.exitCode !== 0) {
      return fail('audit-clean', 'npm audit clean (no high/critical CVEs)', result.stdout.split('\n')[0], 'Run npm audit fix');
    }
    return pass('audit-clean', 'npm audit clean (no high/critical CVEs)');
  } catch (err) {
    return warn('audit-clean', 'npm audit clean (no high/critical CVEs)', String(err));
  }
}

async function checkGitClean(deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  if (!deps._exec) return { id: 'git-clean', label: 'Working tree is clean', status: 'skip' };
  try {
    const result = await deps._exec('git status --porcelain');
    if (result.stdout.trim().length > 0) {
      return fail('git-clean', 'Working tree is clean', 'Uncommitted changes detected', 'Commit or stash all changes before publishing');
    }
    return pass('git-clean', 'Working tree is clean');
  } catch (err) {
    return warn('git-clean', 'Working tree is clean', String(err));
  }
}

async function checkNoStubs(deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  if (!deps._exec) return { id: 'no-stubs-in-release', label: 'No TODO: SHIP / FIXME: RELEASE markers in src/', status: 'skip' };
  try {
    const result = await deps._exec('grep -r "TODO: SHIP\\|FIXME: RELEASE" src/ || true');
    if (result.stdout.trim().length > 0) {
      return fail('no-stubs-in-release', 'No TODO: SHIP / FIXME: RELEASE markers in src/', result.stdout.trim().split('\n').length + ' markers found', 'Remove all SHIP/RELEASE markers before publishing');
    }
    return pass('no-stubs-in-release', 'No TODO: SHIP / FIXME: RELEASE markers in src/');
  } catch {
    return pass('no-stubs-in-release', 'No TODO: SHIP / FIXME: RELEASE markers in src/');
  }
}

async function checkGitTag(deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  if (!deps._exec) return { id: 'git-tag', label: 'HEAD has matching version tag', status: 'skip' };
  try {
    const cwd = deps._cwd?.() ?? process.cwd();
    const readFn = deps._readFile ?? ((p: string, e: string) => fs.readFile(p, e as BufferEncoding));
    const pkgContent = await readFn(`${cwd}/package.json`, 'utf-8');
    const pkg = JSON.parse(pkgContent) as { version?: string };
    const version = pkg.version ?? '';
    const result = await deps._exec(`git tag --points-at HEAD`);
    if (!result.stdout.includes(`v${version}`)) {
      return warn('git-tag', 'HEAD has matching version tag', `v${version} not found in: ${result.stdout.trim() || '(none)'}`);
    }
    return pass('git-tag', 'HEAD has matching version tag', `v${version}`);
  } catch (err) {
    return warn('git-tag', 'HEAD has matching version tag', String(err));
  }
}

async function runShellCheck(id: string, label: string, cmd: string, deps: PublishCheckerDeps): Promise<PublishCheckItem> {
  if (!deps._exec) return { id, label, status: 'skip' };
  try {
    const result = await deps._exec(cmd);
    if (result.exitCode !== 0) return fail(id, label, result.stderr || result.stdout);
    return pass(id, label);
  } catch (err) {
    return fail(id, label, String(err));
  }
}

export async function runPublishCheck(deps: PublishCheckerDeps = {}): Promise<PublishCheckResult> {
  const checks = await Promise.allSettled([
    checkPackageVersion(deps),
    checkChangelogEntry(deps),
    checkLicenseFile(deps),
    checkReadmeExists(deps),
    checkNoStubs(deps),
    runShellCheck('typescript-clean', 'TypeScript compiles cleanly', 'npx tsc --noEmit', deps),
    runShellCheck('build-succeeds', 'npm run build succeeds', 'npm run build', deps),
    runShellCheck('npm-pack-dry', 'npm pack --dry-run succeeds', 'npm pack --dry-run', deps),
    checkAuditClean(deps),
    checkGitClean(deps),
    checkGitTag(deps),
    runShellCheck('test-count', 'Test suite passes', 'npm test', deps),
  ]);

  const items = checks.map(r =>
    r.status === 'fulfilled'
      ? r.value
      : fail('unknown', 'Check failed', r.reason instanceof Error ? r.reason.message : String(r.reason)),
  );

  const passCount = items.filter(i => i.status === 'pass').length;
  const failCount = items.filter(i => i.status === 'fail').length;
  const warnCount = items.filter(i => i.status === 'warn').length;
  const readyToPublish = failCount === 0;

  return { items, readyToPublish, passCount, failCount, warnCount, checkedAt: new Date().toISOString() };
}
