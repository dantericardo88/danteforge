import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('CI golden paths', () => {
  it('defines a dedicated cross-platform local-only CLI golden path', async () => {
    const workflow = await fs.readFile('.github/workflows/ci.yml', 'utf8');

    assert.match(workflow, /local-cli-golden-path:/);
    assert.match(workflow, /os:\s*\[ubuntu-latest,\s*windows-latest,\s*macos-latest\]/);
    assert.match(workflow, /runs-on:\s*\$\{\{\s*matrix\.os\s*\}\}/);
    assert.match(workflow, /npm run build/);
    assert.match(workflow, /npm run check:cli-smoke/);
    assert.match(workflow, /npm run release:check:install-smoke/);
  });

  it('keeps the launch-supported surfaces explicit across CI workflows', async () => {
    const ciWorkflow = await fs.readFile('.github/workflows/ci.yml', 'utf8');
    const liveWorkflow = await fs.readFile('.github/workflows/live-canary.yml', 'utf8');

    assert.match(ciWorkflow, /VS Code extension|vscode-extension/i);
    assert.match(ciWorkflow, /local-only CLI/i);
    assert.match(liveWorkflow, /verify:live/);
  });
});
