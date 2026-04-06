// Help engine tests — context-aware workflow suggestions
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { getContextualHelp } from '../src/harvested/dante-agents/help-engine.js';

const tempDirs: string[] = [];

async function makeStateDir(stage: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-help-'));
  tempDirs.push(dir);
  const dfDir = path.join(dir, '.danteforge');
  await fs.mkdir(dfDir, { recursive: true });
  const state = {
    project: 'help-test',
    created: new Date().toISOString(),
    workflowStage: stage,
    currentPhase: 'phase-2',
    lastHandoff: 'none',
    profile: 'balanced',
    tasks: {},
    gateResults: {},
    auditLog: [],
  };
  await fs.writeFile(path.join(dfDir, 'STATE.yaml'), yaml.stringify(state));
  return dir;
}

describe('help-engine — getContextualHelp', () => {
  after(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('returns suggestion for initialized stage', async () => {
    const dir = await makeStateDir('initialized');
    const help = await getContextualHelp(undefined, { cwd: dir });
    assert.ok(help.includes('review') || help.includes('constitution'));
  });

  it('returns suggestion for constitution stage', async () => {
    const dir = await makeStateDir('constitution');
    const help = await getContextualHelp(undefined, { cwd: dir });
    assert.ok(help.includes('specify'));
  });

  it('returns suggestion for forge stage', async () => {
    const dir = await makeStateDir('forge');
    const help = await getContextualHelp(undefined, { cwd: dir });
    assert.ok(help.includes('verify'));
  });

  it('returns suggestion for verify stage', async () => {
    const dir = await makeStateDir('verify');
    const help = await getContextualHelp(undefined, { cwd: dir });
    assert.ok(help.includes('synthesize'));
  });

  it('with query parameter returns stage and phase info', async () => {
    const dir = await makeStateDir('plan');
    const help = await getContextualHelp('how do I proceed?', { cwd: dir });
    assert.ok(help.includes('plan'));
    assert.ok(help.includes('phase'));
  });

  it('falls back to initialized suggestion for unknown/missing stage', async () => {
    const dir = await makeStateDir('initialized');
    const help = await getContextualHelp(undefined, { cwd: dir });
    assert.equal(typeof help, 'string');
    assert.ok(help.length > 0);
  });
});

describe('help-engine — cwd injection', () => {
  after(async () => {
    for (const dir of tempDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('accepts cwd option to load state from different directory', async () => {
    const dir = await makeStateDir('tasks');
    const help = await getContextualHelp(undefined, { cwd: dir });
    assert.ok(help.includes('forge'), 'tasks stage should suggest forge');
  });

  it('with query and cwd returns correct stage info', async () => {
    const dir = await makeStateDir('design');
    const help = await getContextualHelp('next step?', { cwd: dir });
    assert.ok(help.includes('design'));
  });
});
