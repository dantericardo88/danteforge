import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runPMAgent } from '../src/harvested/dante-agents/agents/pm.js';
import { runArchitectAgent } from '../src/harvested/dante-agents/agents/architect.js';
import { runDevAgent } from '../src/harvested/dante-agents/agents/dev.js';
import { runUXAgent } from '../src/harvested/dante-agents/agents/ux.js';
import { runScrumMasterAgent } from '../src/harvested/dante-agents/agents/scrum-master.js';

const originalHome = process.env.DANTEFORGE_HOME;
const tempDirs: string[] = [];

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.DANTEFORGE_HOME;
  } else {
    process.env.DANTEFORGE_HOME = originalHome;
  }

  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true });
    }
  }
});

async function configureOfflineHome() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-party-agent-test-'));
  tempDirs.push(tempRoot);
  process.env.DANTEFORGE_HOME = tempRoot;

  const configDir = path.join(tempRoot, '.danteforge');
  await fs.mkdir(configDir, { recursive: true });
  await fs.writeFile(
    path.join(configDir, 'config.yaml'),
    [
      'defaultProvider: openai',
      'ollamaModel: llama3',
      'providers: {}',
    ].join('\n'),
    'utf8',
  );
}

describe('party agents offline behavior', () => {
  it('fails closed for PM, Architect, Dev, UX, and Scrum Master when no live provider is configured', async () => {
    await configureOfflineHome();

    await assert.rejects(() => runPMAgent('Test context', 'small'), /verified live LLM provider/i);
    await assert.rejects(() => runArchitectAgent('Test context', 'small'), /verified live LLM provider/i);
    await assert.rejects(() => runDevAgent('Test context', 'quality'), /verified live LLM provider/i);
    await assert.rejects(() => runUXAgent('Test context', 'small'), /verified live LLM provider/i);
    await assert.rejects(() => runScrumMasterAgent('Test context', 'small'), /verified live LLM provider/i);
  });
});
