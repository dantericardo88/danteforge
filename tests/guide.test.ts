import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runGuide } from '../src/cli/commands/guide.js';

const FORGE_STATE = `project: my-app\nworkflowStage: forge\ncurrentPhase: 2\n`;
const SPECIFY_STATE = `project: new-thing\nworkflowStage: specify\ncurrentPhase: 1\n`;

describe('danteforge guide', () => {
  it('T1: generates GUIDE.md content and returns written=true', async () => {
    let written = '';
    const result = await runGuide({
      _loadState: async () => FORGE_STATE,
      _readGoal: async () => null,
      _readScore: async () => 7.2,
      _writeGuide: async (content) => { written = content; },
    });
    assert.strictEqual(result.written, true);
    assert.ok(written.length > 0, 'guide content must not be empty');
  });

  it('T2: includes current stage and score in output', async () => {
    let written = '';
    await runGuide({
      _loadState: async () => FORGE_STATE,
      _readGoal: async () => null,
      _readScore: async () => 7.2,
      _writeGuide: async (content) => { written = content; },
    });
    assert.ok(written.includes('forge'), 'must include stage');
    assert.ok(written.includes('7.2'), 'must include score');
  });

  it('T3: includes personalized next action based on stage', async () => {
    let written = '';
    await runGuide({
      _loadState: async () => FORGE_STATE,
      _readGoal: async () => null,
      _readScore: async () => null,
      _writeGuide: async (content) => { written = content; },
    });
    assert.ok(written.includes('/forge'), 'forge stage must suggest /forge');
    assert.ok(written.includes('phase 2'), 'must mention current phase');
  });

  it('T4: writes to the expected .danteforge/GUIDE.md path', async () => {
    const result = await runGuide({
      cwd: '/tmp/test-guide-project',
      _loadState: async () => FORGE_STATE,
      _readGoal: async () => null,
      _readScore: async () => null,
      _writeGuide: async () => {},
    });
    assert.ok(result.guidePath.endsWith('GUIDE.md'), 'guide path must end with GUIDE.md');
    assert.ok(result.guidePath.includes('.danteforge'), 'guide path must be in .danteforge/');
  });

  it('T5: handles uninitialized project gracefully (null state)', async () => {
    let written = '';
    const result = await runGuide({
      _loadState: async () => null,
      _readGoal: async () => null,
      _readScore: async () => null,
      _writeGuide: async (content) => { written = content; },
    });
    assert.strictEqual(result.written, true);
    assert.ok(written.length > 0, 'must still generate content');
    assert.ok(written.includes('DanteForge'), 'must include DanteForge branding');
  });

  it('T6: handles missing score gracefully — does not throw', async () => {
    let written = '';
    await assert.doesNotReject(async () => {
      await runGuide({
        _loadState: async () => SPECIFY_STATE,
        _readGoal: async () => '9/10 quality',
        _readScore: async () => null,
        _writeGuide: async (content) => { written = content; },
      });
    });
    assert.ok(written.includes('not yet measured'), 'must handle null score gracefully');
  });
});
