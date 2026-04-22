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
    assert.match(script, /danteforge init/);
    assert.doesNotMatch(script, /syncSkills\(/);
  });

  it('defines live verification and GA release scripts', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    assert.match(pkg.scripts?.['verify:live'] ?? '', /check/i);
    assert.match(pkg.scripts?.['release:proof'] ?? '', /check-release-proof\.mjs/);
    assert.match(pkg.scripts?.['release:ga'] ?? '', /verify:live/);
  });

  it('defines SBOM scripts for the release proof chain', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const releaseProofScript = await fs.readFile('scripts/check-release-proof.mjs', 'utf8');

    assert.match(pkg.scripts?.['sbom:generate'] ?? '', /generate-sbom\.mjs/);
    assert.match(pkg.scripts?.['sbom:validate'] ?? '', /validate-sbom\.mjs/);
    assert.match(releaseProofScript, /sbom:generate/);
    assert.match(releaseProofScript, /sbom:validate/);
  });

  it('pins production dependency floors that satisfy the release audit gate', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
      overrides?: Record<string, string>;
    };

    assert.strictEqual(pkg.dependencies?.yaml, '^2.8.3');
    assert.strictEqual(pkg.overrides?.hono, '^4.12.14');
    assert.strictEqual(pkg.overrides?.['@hono/node-server'], '^1.19.14');
  });

  it('pins root dev-tool dependency floors that satisfy audit-safe packaging', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      overrides?: Record<string, string | Record<string, string>>;
    };

    assert.strictEqual(pkg.overrides?.picomatch, '^4.0.4');
    assert.deepStrictEqual(pkg.overrides?.['minimatch@^3.1.2'], {
      'brace-expansion': '^1.1.14',
    });
    assert.deepStrictEqual(pkg.overrides?.['minimatch@^9.0.4'], {
      'brace-expansion': '^2.1.0',
    });
    assert.deepStrictEqual(pkg.overrides?.['minimatch@^10.2.2'], {
      'brace-expansion': '^5.0.5',
    });
  });

  it('keeps SBOM generation non-interactive for fresh-checkout release proof runs', async () => {
    const sbomScript = await fs.readFile('scripts/generate-sbom.mjs', 'utf8');

    assert.match(
      sbomScript,
      /--yes|npm_config_yes/i,
      'SBOM generation must avoid interactive npx install prompts in release sandboxes',
    );
  });

  it('routes npm test through the quiet test-suite wrapper', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const testRunner = await fs.readFile('scripts/run-test-suite.mjs', 'utf8').catch(() => '');

    assert.match(pkg.scripts?.test ?? '', /run-test-suite\.mjs/);
    assert.match(testRunner, /tsx/);
    assert.match(testRunner, /tests\/\*\*\/\*\.test\.ts/);
    assert.match(testRunner, /INFO|WARN|OK/);
  });

  it('keeps the public build pure while exposing an explicit build-proof wrapper', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const buildRunner = await fs.readFile('scripts/run-build.mjs', 'utf8').catch(() => '');

    assert.strictEqual(pkg.scripts?.build, 'tsup');
    assert.match(pkg.scripts?.['build:receipt'] ?? '', /run-build\.mjs/);
    assert.match(buildRunner, /tsup/);
    assert.match(buildRunner, /command-check/i);
  });

  it('gives shared tsx CLI test runs a cold-start-safe default timeout', async () => {
    const cliRunner = await fs.readFile('tests/helpers/cli-runner.ts', 'utf8');

    assert.match(
      cliRunner,
      /timeout:\s*options\?\.timeout\s*\?\?\s*(1[2-9]\d{4}|[2-9]\d{5,})/,
      'Fresh-checkout release proof runs need a default CLI helper timeout above 60s',
    );
  });

  it('provides explicit sync scripts for workflow surfaces and the readiness guide', async () => {
    const pkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };

    assert.match(pkg.scripts?.['sync:workflow-surfaces'] ?? '', /sync-workflow-surfaces\.ts/);
    assert.match(pkg.scripts?.['sync:readiness-doc'] ?? '', /sync-operational-readiness\.ts/);
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
    assert.match(installSmoke, /danteforge-cli/);
    assert.match(installSmoke, /doctor-live = "npx danteforge doctor --live"/);
    assert.match(installSmoke, /df-verify = "npx danteforge verify"/);
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

  it('pins VS Code extension packaging dependencies to audit-safe floors', async () => {
    const extensionPkg = JSON.parse(await fs.readFile('vscode-extension/package.json', 'utf8')) as {
      overrides?: Record<string, string | Record<string, string>>;
    };

    assert.strictEqual(extensionPkg.overrides?.undici, '^7.24.4');
    assert.strictEqual(extensionPkg.overrides?.['follow-redirects'], '^1.16.0');
    assert.strictEqual(extensionPkg.overrides?.lodash, '^4.18.1');
    assert.deepStrictEqual(extensionPkg.overrides?.['minimatch@^3.0.3'], {
      'brace-expansion': '^1.1.14',
    });
    assert.deepStrictEqual(extensionPkg.overrides?.['minimatch@^10.1.1'], {
      'brace-expansion': '^5.0.5',
    });
  });

  it('hard-gates publish behind release-proof and live-proof jobs', async () => {
    const releaseWorkflow = await fs.readFile('.github/workflows/release.yml', 'utf8');

    assert.match(releaseWorkflow, /release-proof:/);
    assert.match(releaseWorkflow, /live-proof:/);
    assert.match(releaseWorkflow, /publish:/);
    assert.match(releaseWorkflow, /needs:\s*\[release-proof,\s*live-proof\]/);
  });

  it('uploads receipt artifacts from release and live proof workflows', async () => {
    const releaseWorkflow = await fs.readFile('.github/workflows/release.yml', 'utf8');
    const liveWorkflow = await fs.readFile('.github/workflows/live-canary.yml', 'utf8');

    assert.match(releaseWorkflow, /\.danteforge\/evidence\/release\/latest\.json/);
    assert.match(releaseWorkflow, /\.danteforge\/evidence\/live\/latest\.json/);
    assert.match(releaseWorkflow, /danteforge-vscode-vsix/);
    assert.match(liveWorkflow, /\.danteforge\/evidence\/live\/latest\.json/);
  });
});
