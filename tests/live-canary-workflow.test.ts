import { describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';

describe('live canary workflow', () => {
  it('defines a manual and scheduled live verification workflow', async () => {
    const workflow = await fs.readFile('.github/workflows/live-canary.yml', 'utf8');

    assert.match(workflow, /workflow_dispatch/);
    assert.match(workflow, /schedule:/);
    assert.match(workflow, /verify:live/);
    assert.match(workflow, /check:cli-smoke/);
    assert.match(workflow, /FIGMA_MCP_URL/);
    assert.match(workflow, /DANTEFORGE_LIVE_PROVIDERS/);
  });
});
