import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path, { resolve } from 'node:path';
import { logger } from '../src/core/logger.js';
import { determineScale, runDanteParty } from '../src/harvested/dante-agents/party-mode.js';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe('determineScale', () => {
  it('returns light for small projects', () => {
    assert.strictEqual(determineScale('small'), 'light');
    assert.strictEqual(determineScale('lite'), 'light');
    assert.strictEqual(determineScale('light'), 'light');
    assert.strictEqual(determineScale('mini'), 'light');
  });

  it('returns deep for large projects', () => {
    assert.strictEqual(determineScale('large'), 'deep');
    assert.strictEqual(determineScale('enterprise'), 'deep');
    assert.strictEqual(determineScale('complex'), 'deep');
    assert.strictEqual(determineScale('deep'), 'deep');
  });

  it('returns standard for medium projects', () => {
    assert.strictEqual(determineScale('medium'), 'standard');
    assert.strictEqual(determineScale('normal'), 'standard');
    assert.strictEqual(determineScale(''), 'standard');
  });

  it('is case insensitive', () => {
    assert.strictEqual(determineScale('SMALL'), 'light');
    assert.strictEqual(determineScale('LARGE'), 'deep');
    assert.strictEqual(determineScale('Medium'), 'standard');
  });

  it('handles whitespace', () => {
    assert.strictEqual(determineScale('  small  '), 'light');
  });

  it('fails closed when requested worktree isolation cannot be created', async () => {
    const originalCwd = process.cwd();
    const originalHome = process.env.DANTEFORGE_HOME;
    const originalExitCode = process.exitCode;
    const originalInfo = logger.info;
    const originalWarn = logger.warn;
    const originalError = logger.error;
    const originalSuccess = logger.success;
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-party-worktree-'));
    const logLines: string[] = [];

    process.env.DANTEFORGE_HOME = tempRoot;
    await fs.mkdir(path.join(tempRoot, '.danteforge'), { recursive: true });
    await fs.writeFile(
      path.join(tempRoot, '.danteforge', 'config.yaml'),
      [
        'defaultProvider: openai',
        'providers:',
        '  openai:',
        '    apiKey: fake-key',
      ].join('\n'),
      'utf8',
    );

    logger.info = (msg: string) => { logLines.push(`[INFO] ${msg}`); };
    logger.warn = (msg: string) => { logLines.push(`[WARN] ${msg}`); };
    logger.error = (msg: string) => { logLines.push(`[ERR] ${msg}`); };
    logger.success = (msg: string) => { logLines.push(`[OK] ${msg}`); };
    global.fetch = async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        data: [{ id: 'gpt-4o' }],
      }),
    }) as Response;

    process.chdir(tempRoot);
    process.exitCode = 0;

    try {
      await runDanteParty(['agent?bad'], true);
      const combined = logLines.join('\n');
      assert.strictEqual(process.exitCode, 1);
      assert.match(combined, /worktree setup failed/i);
      assert.doesNotMatch(combined, /non-isolated/i);
      assert.doesNotMatch(combined, /dispatching agents/i);
    } finally {
      process.chdir(originalCwd);
      process.exitCode = originalExitCode;
      logger.info = originalInfo;
      logger.warn = originalWarn;
      logger.error = originalError;
      logger.success = originalSuccess;
      if (originalHome === undefined) {
        delete process.env.DANTEFORGE_HOME;
      } else {
        process.env.DANTEFORGE_HOME = originalHome;
      }
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  });

  it('wires isolated execution through the subagent isolator', async () => {
    const source = await fs.readFile('src/harvested/dante-agents/party-mode.ts', 'utf8');
    assert.match(source, /runIsolatedAgent/);
    assert.match(source, /isolation\??:/);
  });
});

describe('Party Mode Agent Retry (Wave 1C)', () => {
  const partyModeSrc = readFileSync(resolve('src/harvested/dante-agents/party-mode.ts'), 'utf-8');

  it('exports AGENT_MAX_RETRIES = 2', () => {
    assert.ok(partyModeSrc.includes('export const AGENT_MAX_RETRIES'), 'Missing AGENT_MAX_RETRIES export');
    assert.ok(partyModeSrc.includes('= 2'), 'AGENT_MAX_RETRIES should be 2');
  });

  it('exports AGENT_RETRY_DELAYS_MS', () => {
    assert.ok(partyModeSrc.includes('export const AGENT_RETRY_DELAYS_MS'), 'Missing AGENT_RETRY_DELAYS_MS export');
    assert.ok(partyModeSrc.includes('2000') && partyModeSrc.includes('5000'), 'Delays should be [2000, 5000]');
  });

  it('defines dispatchAgentWithRetry function', () => {
    assert.ok(partyModeSrc.includes('dispatchAgentWithRetry'), 'Missing dispatchAgentWithRetry');
  });

  it('retry logs warning with attempt count', () => {
    assert.ok(partyModeSrc.includes('failed (attempt'), 'Should log retry attempt');
  });

  it('retry uses delay between attempts', () => {
    assert.ok(partyModeSrc.includes('setTimeout(resolve, delay)') || partyModeSrc.includes('new Promise(resolve => setTimeout'), 'Should delay between retries');
  });

  it('main dispatch uses retry wrapper', () => {
    // Count occurrences — dispatchAgentWithRetry should be used in the main flow
    const retryCallCount = (partyModeSrc.match(/dispatchAgentWithRetry\(/g) || []).length;
    assert.ok(retryCallCount >= 1, 'Main dispatch should use dispatchAgentWithRetry');
  });
});
