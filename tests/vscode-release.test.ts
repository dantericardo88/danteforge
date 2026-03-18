import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('VS Code extension release readiness', () => {
  it('defines packaging scripts for the extension', async () => {
    const pkg = JSON.parse(await fs.readFile('vscode-extension/package.json', 'utf8')) as {
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
      activationEvents?: string[];
      contributes?: {
        commands?: Array<{ command?: string }>;
      };
    };

    assert.match(pkg.scripts?.verify ?? '', /package:vsix/);
    assert.match(pkg.scripts?.['package:vsix'] ?? '', /vsce package/);
    assert.match(pkg.scripts?.['publish:vsce'] ?? '', /vsce publish/);
    assert.match(pkg.scripts?.['publish:ovsx'] ?? '', /ovsx publish/);
    assert.ok(pkg.devDependencies?.['@vscode/vsce']);
    assert.ok(pkg.devDependencies?.ovsx);
    assert.ok(pkg.activationEvents?.includes('onCommand:danteforge.setup'));
    assert.ok(pkg.contributes?.commands?.some(command => command.command === 'danteforge.setup'));
  });

  it('release workflow packages the VS Code extension artifact', async () => {
    const workflow = await fs.readFile('.github/workflows/release.yml', 'utf8');

    assert.match(workflow, /npm --prefix vscode-extension run package:vsix/);
    assert.match(workflow, /upload-artifact/);
    assert.match(workflow, /OVSX_PAT/);
  });

  it('release workflow also runs package audits before publish', async () => {
    const workflow = await fs.readFile('.github/workflows/release.yml', 'utf8');

    assert.match(workflow, /npm audit --omit=dev/);
    assert.match(workflow, /npm --prefix vscode-extension audit --omit=dev/);
  });
});
