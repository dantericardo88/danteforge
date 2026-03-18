import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('release metadata', () => {
  it('keeps the root package and VS Code extension versions in sync and valid', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version?: string };
    const vscodePkg = JSON.parse(await fs.readFile('vscode-extension/package.json', 'utf8')) as { version?: string };

    // Both versions must be truthy semver strings
    assert.ok(rootPkg.version, 'root package.json must have a version');
    assert.ok(vscodePkg.version, 'vscode-extension package.json must have a version');
    assert.ok(rootPkg.version.includes('.'), 'root version must be a valid semver string');
    assert.ok(vscodePkg.version.includes('.'), 'vscode version must be a valid semver string');

    // They must match each other
    assert.strictEqual(rootPkg.version, vscodePkg.version, 'root and vscode-extension versions must match');
  });

  it('stamps generated artifacts with the current package version', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
    const version = rootPkg.version;

    const promptBuilder = await fs.readFile('src/core/prompt-builder.ts', 'utf8');
    const codec = await fs.readFile('src/harvested/openpencil/op-codec.ts', 'utf8');
    const renderer = await fs.readFile('src/harvested/openpencil/headless-renderer.ts', 'utf8');

    const versionEscaped = version.replace(/\./g, '\\.');
    assert.match(promptBuilder, new RegExp(`danteforge/${versionEscaped}`));
    assert.match(codec, new RegExp(`danteforge/${versionEscaped}`));
    assert.match(renderer, new RegExp(`DanteForge v${versionEscaped}`));
  });

  it('advertises autoforge and awesome-scan in the session-start hook', async () => {
    const hook = await fs.readFile('hooks/session-start.mjs', 'utf8');
    assert.match(hook, /\/autoforge/);
    assert.match(hook, /\/awesome-scan/);
  });
});
