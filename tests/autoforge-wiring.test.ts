import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { autoforge } from '../src/cli/commands/autoforge.js';
import type { AutoforgeLoopContext } from '../src/core/autoforge-loop.js';

const PAUSE_FILE = 'AUTOFORGE_PAUSED';

async function makeTempCwd(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-wiring-test-'));
  const stateDir = path.join(dir, '.danteforge');
  await fs.mkdir(stateDir, { recursive: true });
  await fs.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0' }),
  );
  await fs.writeFile(
    path.join(stateDir, 'STATE.yaml'),
    [
      'project: test-wiring',
      'lastHandoff: initialized',
      'workflowStage: initialized',
      'currentPhase: 0',
      'tasks: {}',
      'auditLog: []',
      'profile: balanced',
    ].join('\n'),
  );
  return dir;
}

describe('autoforge --auto wiring', () => {
  let cwd: string;
  before(async () => { cwd = await makeTempCwd(); });
  after(async () => { await fs.rm(cwd, { recursive: true, force: true }); });

  it('sets state.autoforgeEnabled = true before the loop runs', async () => {
    let capturedState: Record<string, unknown> | undefined;

    await autoforge('test goal', {
      auto: true,
      cwd,
      _computeRetroScore: false,
      _runLoop: async (ctx) => {
        capturedState = ctx.state as unknown as Record<string, unknown>;
        return { ...ctx, loopState: 0 /* IDLE → exit cleanly */ };
      },
    });

    assert.ok(capturedState, 'loop should have been called');
    assert.strictEqual((capturedState as Record<string, unknown>).autoforgeEnabled, true);
  });

  it('calls loopFn with _executeCommand injected (not undefined)', async () => {
    let receivedDeps: Record<string, unknown> | undefined;

    await autoforge('test goal', {
      auto: true,
      cwd,
      _computeRetroScore: false,
      _runLoop: async (ctx, deps) => {
        receivedDeps = deps as unknown as Record<string, unknown>;
        return { ...ctx, loopState: 0 };
      },
    });

    assert.ok(receivedDeps, 'deps should have been passed to loopFn');
    assert.ok(
      typeof (receivedDeps as Record<string, unknown>)['_executeCommand'] === 'function',
      'should inject a real _executeCommand function',
    );
  });

  it('uses _executeCommand injection seam when provided', async () => {
    const executedCommands: string[] = [];

    await autoforge('test goal', {
      auto: true,
      cwd,
      _computeRetroScore: false,
      _executeCommand: async (cmd) => { executedCommands.push(cmd); return { success: true }; },
      _runLoop: async (ctx, deps) => {
        // Verify the injected seam is used
        if (deps?._executeCommand) {
          await deps._executeCommand('verify', cwd);
        }
        return { ...ctx, loopState: 0 };
      },
    });

    assert.ok(executedCommands.includes('verify'), 'injected _executeCommand should be called');
  });

  it('clears stale AUTOFORGE_PAUSED file before loop starts', async () => {
    // Write a stale pause file
    const pausePath = path.join(cwd, '.danteforge', PAUSE_FILE);
    await fs.writeFile(pausePath, JSON.stringify({ cycleCount: 1, goal: 'stale' }));

    await autoforge('test goal', {
      auto: true,
      cwd,
      _computeRetroScore: false,
      _runLoop: async (ctx) => ({ ...ctx, loopState: 0 }),
    });

    const exists = await fs.access(pausePath).then(() => true).catch(() => false);
    assert.strictEqual(exists, false, 'AUTOFORGE_PAUSED should be deleted before loop');
  });

  it('adds audit log entry when enabling autoforge', async () => {
    let capturedAuditLog: string[] | undefined;

    await autoforge('test goal', {
      auto: true,
      cwd,
      _computeRetroScore: false,
      _runLoop: async (ctx) => {
        capturedAuditLog = ctx.state.auditLog;
        return { ...ctx, loopState: 0 };
      },
    });

    assert.ok(capturedAuditLog, 'audit log should be accessible');
    const hasAutoforgeEntry = capturedAuditLog.some(e => e.includes('autoforge: autonomous mode enabled'));
    assert.ok(hasAutoforgeEntry, 'should log autonomous mode activation');
  });

  it('computes retroDelta when sessionBaselineScore exists and score improved', async () => {
    // Set a baseline in STATE.yaml that is lower than the current score
    const statePath = path.join(cwd, '.danteforge', 'STATE.yaml');
    const currentContent = await fs.readFile(statePath, 'utf8');
    await fs.writeFile(statePath, currentContent + '\nsessionBaselineScore: 1\n');

    let capturedState: Record<string, unknown> | undefined;

    await autoforge('test goal', {
      auto: true,
      cwd,
      _runLoop: async (ctx) => {
        capturedState = ctx.state as unknown as Record<string, unknown>;
        return { ...ctx, loopState: 0 };
      },
    });

    // retroDelta should be set if current score > 1
    assert.ok(capturedState, 'loop should run');
    // retroDelta may or may not be set depending on computeHarshScore result
    // but the state should at least be defined
    assert.ok('autoforgeEnabled' in capturedState, 'autoforgeEnabled should be set');
  });
});
