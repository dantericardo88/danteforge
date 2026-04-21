import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { wikiStatusCommand } from '../src/cli/commands/wiki-status.js';
import type { WikiHealth } from '../src/core/wiki-schema.js';

function makeHealth(overrides: Partial<WikiHealth> = {}): WikiHealth {
  return {
    pageCount: 42,
    linkDensity: 2.5,
    orphanRatio: 0.03,
    stalenessScore: 0.05,
    lintPassRate: 0.98,
    lastLint: new Date().toISOString(),
    anomalyCount: 0,
    ...overrides,
  };
}

describe('wikiStatusCommand', () => {
  it('completes without throwing when wiki is healthy', async () => {
    await assert.doesNotReject(() =>
      wikiStatusCommand({ _getHealth: async () => makeHealth() })
    );
  });

  it('completes without throwing when wiki is null (not initialized)', async () => {
    await assert.doesNotReject(() =>
      wikiStatusCommand({ _getHealth: async () => null })
    );
  });

  it('calls _getHealth with cwd option', async () => {
    let capturedOpts: any = null;
    await wikiStatusCommand({
      cwd: '/tmp/test-project',
      _getHealth: async (opts) => { capturedOpts = opts; return null; },
    });
    assert.equal(capturedOpts?.cwd, '/tmp/test-project');
  });

  it('handles wiki with anomalies', async () => {
    await assert.doesNotReject(() =>
      wikiStatusCommand({
        _getHealth: async () => makeHealth({ anomalyCount: 5 }),
      })
    );
  });

  it('handles json output mode without throwing', async () => {
    await assert.doesNotReject(() =>
      wikiStatusCommand({
        json: true,
        _getHealth: async () => makeHealth(),
      })
    );
  });

  it('handles health with never linted (lastLint null)', async () => {
    await assert.doesNotReject(() =>
      wikiStatusCommand({
        _getHealth: async () => makeHealth({ lastLint: undefined }),
      })
    );
  });
});
