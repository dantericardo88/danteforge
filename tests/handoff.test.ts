import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { handoff } from '../src/core/handoff.js';
import { loadMemoryStore } from '../src/core/memory-store.js';
import { loadState } from '../src/core/state.js';

const tempRoots: string[] = [];

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop();
    if (root) {
      await fs.rm(root, { recursive: true, force: true });
    }
  }
});

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-handoff-test-'));
  tempRoots.push(root);
  return root;
}

/** Write a fake artifact file into the workspace .danteforge/ directory. */
async function writeArtifact(cwd: string, filename: string, content = 'test') {
  const dir = path.join(cwd, '.danteforge');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, filename), content);
}

describe('handoff', () => {
  it('records review handoff', async () => {
    const cwd = await makeWorkspace();
    await writeArtifact(cwd, 'CURRENT_STATE.md');
    await handoff('review', { stateFile: 'TEST_STATE.md' }, { cwd });
    const state = await loadState({ cwd });
    assert.ok(state.lastHandoff.includes('review'));
  });

  it('records all handoff sources', async () => {
    const cwd = await makeWorkspace();

    await writeArtifact(cwd, 'SPEC.md');
    await handoff('spec', { constitution: 'Handoff test constitution' }, { cwd });
    let state = await loadState({ cwd });
    assert.ok(state.lastHandoff.includes('spec'));

    // forge and party have no artifact requirement (execution steps)
    await handoff('forge', {}, { cwd });
    state = await loadState({ cwd });
    assert.ok(state.lastHandoff.includes('forge'));

    await handoff('party', {}, { cwd });
    state = await loadState({ cwd });
    assert.ok(state.lastHandoff.includes('party'));

    // ux-refine has no artifact requirement
    await handoff('ux-refine', {}, { cwd });
    state = await loadState({ cwd });
    assert.ok(state.lastHandoff.includes('ux-refine'));
  });

  it('spec handoff sets constitution on state', async () => {
    const cwd = await makeWorkspace();
    const marker = `constitution-${Date.now()}`;
    await writeArtifact(cwd, 'SPEC.md');
    await handoff('spec', { constitution: marker }, { cwd });
    const state = await loadState({ cwd });
    assert.strictEqual(state.constitution, marker);
  });

  it('records a decision memory entry for handoffs', async () => {
    const cwd = await makeWorkspace();
    await writeArtifact(cwd, 'CURRENT_STATE.md');

    await handoff('review', { stateFile: 'CURRENT_STATE.md' }, { cwd });

    const store = await loadMemoryStore(cwd);
    assert.ok(store.entries.some(entry => entry.category === 'decision'));
    assert.ok(store.entries.some(entry => /review/i.test(entry.summary)));
  });

  it('blocks handoff when expected artifact is missing', async () => {
    const cwd = await makeWorkspace();
    // Do NOT write CONSTITUTION.md — handoff should fail
    await assert.rejects(
      () => handoff('constitution', { constitution: 'test' }, { cwd }),
      (err: Error) => {
        assert.ok(err.message.includes('CONSTITUTION.md'));
        assert.ok(err.message.includes('does not exist on disk'));
        return true;
      },
    );
  });

  it('blocks spec handoff when SPEC.md is missing', async () => {
    const cwd = await makeWorkspace();
    await assert.rejects(
      () => handoff('spec', { constitution: 'test' }, { cwd }),
      (err: Error) => {
        assert.ok(err.message.includes('SPEC.md'));
        return true;
      },
    );
  });

  it('blocks review handoff when CURRENT_STATE.md is missing', async () => {
    const cwd = await makeWorkspace();
    await assert.rejects(
      () => handoff('review', { stateFile: 'CURRENT_STATE.md' }, { cwd }),
      (err: Error) => {
        assert.ok(err.message.includes('CURRENT_STATE.md'));
        return true;
      },
    );
  });

  it('allows forge handoff without artifact (execution step)', async () => {
    const cwd = await makeWorkspace();
    // forge has no artifact requirement — should pass even with empty workspace
    await handoff('forge', {}, { cwd });
    const state = await loadState({ cwd });
    assert.strictEqual(state.workflowStage, 'forge');
  });

  it('blocks design handoff when DESIGN.op is missing', async () => {
    const cwd = await makeWorkspace();
    await assert.rejects(
      () => handoff('design', { designFile: 'DESIGN.op' }, { cwd }),
      (err: Error) => {
        assert.ok(err.message.includes('DESIGN.op'));
        return true;
      },
    );
  });

  it('allows design handoff when DESIGN.op exists', async () => {
    const cwd = await makeWorkspace();
    await writeArtifact(cwd, 'DESIGN.op', '{"nodes":[],"document":{}}');
    await handoff('design', { designFile: 'DESIGN.op' }, { cwd });
    const state = await loadState({ cwd });
    assert.strictEqual(state.workflowStage, 'design');
    assert.strictEqual(state.designEnabled, true);
  });
});
