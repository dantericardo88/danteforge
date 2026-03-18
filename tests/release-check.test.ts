import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('release check scripts', () => {
  it('uses non-strict hygiene in release:check', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const releaseCheck = pkg.scripts?.['release:check'] ?? '';

    assert.match(releaseCheck, /check:repo-hygiene/);
    assert.doesNotMatch(releaseCheck, /check:repo-hygiene:strict/);
  });

  it('provides a strict release check variant', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const strictReleaseCheck = pkg.scripts?.['release:check:strict'] ?? '';
    const strictScript = await fs.readFile('scripts/check-release-strict.mjs', 'utf8');

    assert.match(strictReleaseCheck, /check-release-strict\.mjs/);
    assert.match(strictScript, /check:repo-hygiene:strict/);
    assert.match(strictScript, /verify:all/);
    assert.match(strictScript, /pack:dry-run/);
    assert.match(strictScript, /check:third-party-notices/);
  });

  it('provides a simulated fresh-checkout release gate', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const simulatedFreshCheck = pkg.scripts?.['release:check:simulated-fresh'] ?? '';

    assert.match(simulatedFreshCheck, /check-release-simulated-fresh\.mjs/);
  });

  it('provides an install smoke gate for packed CLI verification', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const installSmokeCheck = pkg.scripts?.['release:check:install-smoke'] ?? '';
    const releaseCheck = pkg.scripts?.['release:check'] ?? '';

    assert.match(installSmokeCheck, /check-package-install-smoke\.mjs/);
    assert.match(releaseCheck, /release:check:install-smoke/);
  });

  it('provides a built-cli smoke gate and runs it in release checks', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const cliSmokeCheck = pkg.scripts?.['check:cli-smoke'] ?? '';
    const releaseCheck = pkg.scripts?.['release:check'] ?? '';
    const strictScript = await fs.readFile('scripts/check-release-strict.mjs', 'utf8');

    assert.match(cliSmokeCheck, /check-cli-smoke\.mjs/);
    assert.match(releaseCheck, /check:cli-smoke/);
    assert.match(strictScript, /check:cli-smoke/);
  });

  it('runs an explicit anti-stub gate as part of npm run verify', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    assert.match(pkg.scripts?.['check:anti-stub'] ?? '', /check-anti-stub\.mjs/);
    assert.match(pkg.scripts?.verify ?? '', /check:anti-stub/);
  });

  it('keeps a postinstall hook for guidance without coupling assistant setup to package install', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const postinstall = pkg.scripts?.postinstall ?? '';

    assert.match(postinstall, /postinstall/);
    const script = await fs.readFile('lib/postinstall.js', 'utf8');
    assert.match(script, /setup assistants/);
    assert.doesNotMatch(script, /syncSkills\(/);
  });

  it('defines live verification and GA release scripts', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    assert.match(pkg.scripts?.['verify:live'] ?? '', /check/i);
    assert.match(pkg.scripts?.['release:ga'] ?? '', /verify:live/);
  });

  it('ships the live verification script and keeps install smoke focused on explicit assistant setup', async () => {
    const liveScript = await fs.readFile('scripts/check-live-integrations.mjs', 'utf8');
    const installSmoke = await fs.readFile('scripts/check-package-install-smoke.mjs', 'utf8');
    const simulatedFresh = await fs.readFile('scripts/check-release-simulated-fresh.mjs', 'utf8');
    const releaseUtils = await fs.readFile('scripts/release-check-utils.mjs', 'utf8');

    assert.match(liveScript, /provider/i);
    assert.match(liveScript, /figma/i);
    assert.match(installSmoke, /'setup', 'assistants'/);
    assert.match(installSmoke, /'--assistants', 'cursor'/);
    assert.doesNotMatch(installSmoke, /did not sync Codex skills/i);
    assert.match(simulatedFresh, /createReleaseSandbox/);
    assert.match(releaseUtils, /DANTEFORGE_HOME/);
  });

  it('ships and validates plugin manifests as part of release checks', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      files?: string[];
      scripts?: Record<string, string>;
    };
    const strictScript = await fs.readFile('scripts/check-release-strict.mjs', 'utf8');

    assert.ok(pkg.files?.includes('.claude-plugin'));
    assert.match(pkg.scripts?.['check:plugin-manifests'] ?? '', /check-plugin-manifests\.mjs/);
    assert.match(pkg.scripts?.['release:check'] ?? '', /check:plugin-manifests/);
    assert.match(strictScript, /check:plugin-manifests/);
  });

  it('keeps the VS Code extension version aligned with the root package', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
    const extensionPkg = JSON.parse(await fs.readFile('vscode-extension/package.json', 'utf8')) as { version: string };

    assert.strictEqual(extensionPkg.version, rootPkg.version);
  });
});
