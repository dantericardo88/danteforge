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
import { dispatchAgentWithRetry } from '../src/harvested/dante-agents/party-mode.js';
import type { AgentResult } from '../src/harvested/dante-agents/party-mode.js';

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

describe('dispatchAgentWithRetry _onAgentUpdate seam', () => {
  function makeSuccessDispatch(): () => Promise<AgentResult> {
    return async () => ({ agent: 'test', result: 'ok', durationMs: 1, success: true });
  }

  function makeFailDispatch(): () => Promise<AgentResult> {
    return async () => ({ agent: 'test', result: 'fail', durationMs: 1, success: false });
  }

  it('_onAgentUpdate called with "starting" before dispatch', async () => {
    const updates: Array<[string, string]> = [];
    await dispatchAgentWithRetry('my-agent', 'ctx', 'small', 'quality', {}, false, {
      _dispatchAgent: makeSuccessDispatch(),
      _onAgentUpdate: (agent, status) => updates.push([agent, status]),
    });
    assert.ok(updates.some(([a, s]) => a === 'my-agent' && s === 'starting'), 'should emit starting');
  });

  it('_onAgentUpdate called with "done" after successful dispatch', async () => {
    const updates: Array<[string, string]> = [];
    await dispatchAgentWithRetry('my-agent', 'ctx', 'small', 'quality', {}, false, {
      _dispatchAgent: makeSuccessDispatch(),
      _onAgentUpdate: (agent, status) => updates.push([agent, status]),
    });
    assert.ok(updates.some(([a, s]) => a === 'my-agent' && s === 'done'), 'should emit done on success');
  });

  it('_onAgentUpdate called with "failed" when all retries exhausted', async () => {
    const updates: Array<[string, string]> = [];
    await dispatchAgentWithRetry('my-agent', 'ctx', 'small', 'quality', {}, false, {
      _dispatchAgent: makeFailDispatch(),
      _sleep: async () => {},
      _onAgentUpdate: (agent, status) => updates.push([agent, status]),
    });
    assert.ok(updates.some(([a, s]) => a === 'my-agent' && s === 'failed'), 'should emit failed when retries exhausted');
  });

  it('completes without error when _onAgentUpdate is NOT provided (default logger fires)', async () => {
    // Default logger.info should fire instead of crashing — no optional chaining means it always calls
    const result = await dispatchAgentWithRetry('my-agent', 'ctx', 'small', 'quality', {}, false, {
      _dispatchAgent: makeSuccessDispatch(),
      // _onAgentUpdate intentionally omitted — default logger path
    });
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.agent, 'test');
  });
});
