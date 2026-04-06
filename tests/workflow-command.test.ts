import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { workflow, PIPELINE_STAGES } from '../src/cli/commands/workflow.js';

describe('workflow command', () => {
  it('lists all pipeline stages', async () => {
    assert.ok(PIPELINE_STAGES.length >= 10);
    assert.ok(PIPELINE_STAGES.some(s => s.label === 'forge'));
    assert.ok(PIPELINE_STAGES.some(s => s.label === 'verify'));
  });

  it('runs without error when state is initialized', async () => {
    await workflow({
      _loadState: async () => ({ workflowStage: 'initialized' } as any),
    });
  });

  it('runs without error when state cannot be loaded', async () => {
    await workflow({
      _loadState: async () => { throw new Error('no state'); },
    });
  });
});
