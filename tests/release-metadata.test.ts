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

  it('keeps root and VS Code lockfiles aligned with the current package versions', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
    const vscodePkg = JSON.parse(await fs.readFile('vscode-extension/package.json', 'utf8')) as { version: string };
    const rootLock = JSON.parse(await fs.readFile('package-lock.json', 'utf8')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };
    const vscodeLock = JSON.parse(await fs.readFile('vscode-extension/package-lock.json', 'utf8')) as {
      version?: string;
      packages?: Record<string, { version?: string }>;
    };

    assert.strictEqual(rootLock.version, rootPkg.version, 'package-lock.json top-level version must match package.json');
    assert.strictEqual(rootLock.packages?.['']?.version, rootPkg.version, 'package-lock.json root package entry must match package.json');
    assert.strictEqual(vscodeLock.version, vscodePkg.version, 'vscode-extension/package-lock.json top-level version must match vscode-extension/package.json');
    assert.strictEqual(vscodeLock.packages?.['']?.version, vscodePkg.version, 'vscode-extension/package-lock.json root package entry must match vscode-extension/package.json');
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

  it('uses the current package version in operator-facing runtime surfaces', async () => {
    const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8')) as { version: string };
    const version = rootPkg.version;
    const versionEscaped = version.replace(/\./g, '\\.');

    const mcpServer = await fs.readFile('src/core/mcp-server.ts', 'utf8');
    const autoforgeCommand = await fs.readFile('src/cli/commands/autoforge.ts', 'utf8');

    assert.match(mcpServer, new RegExp(`version: '${versionEscaped}'`));
    assert.match(autoforgeCommand, new RegExp(`DanteForge v${versionEscaped}`));
  });

  it('advertises autoforge and awesome-scan in the session-start hook', async () => {
    const hook = await fs.readFile('hooks/session-start.mjs', 'utf8');
    assert.match(hook, /\/autoforge/);
    assert.match(hook, /\/awesome-scan/);
  });
});
