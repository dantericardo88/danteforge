import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import {
  runDesignAgent,
  DESIGN_AGENT_PROMPT,
} from '../src/harvested/dante-agents/agents/design.js';
import { configureOfflineHome, restoreOfflineHome } from './helpers/offline-home.js';

const originalHome = process.env.DANTEFORGE_HOME;
const tempDirs: string[] = [];

beforeEach(async () => {
  await configureOfflineHome(tempDirs);
});

afterEach(async () => {
  restoreOfflineHome(originalHome);

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

describe('Design Agent exports', () => {
  it('runDesignAgent is exported as a function', () => {
    assert.strictEqual(typeof runDesignAgent, 'function');
  });

  it('DESIGN_AGENT_PROMPT is exported as a string', () => {
    assert.strictEqual(typeof DESIGN_AGENT_PROMPT, 'string');
    assert.ok(DESIGN_AGENT_PROMPT.length > 0);
  });
});

describe('DESIGN_AGENT_PROMPT content', () => {
  it('contains Design Generation section', () => {
    assert.ok(DESIGN_AGENT_PROMPT.includes('Design Generation'));
  });

  it('contains Token Extraction section', () => {
    assert.ok(DESIGN_AGENT_PROMPT.includes('Design Token Extraction'));
  });

  it('contains Visual Consistency section', () => {
    assert.ok(DESIGN_AGENT_PROMPT.includes('Visual Consistency'));
  });
});

describe('runDesignAgent offline behavior', () => {
  it('fails closed in offline mode', async () => {
    await assert.rejects(
      () => runDesignAgent('Test context', 'small'),
      /verified live LLM provider/i,
    );
  });
});
