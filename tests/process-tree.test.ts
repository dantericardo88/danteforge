import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { killTree, trackChild, untrackChild } from '../src/core/process-tree.js';

describe('process-tree — no orphans / zombies', () => {
  test('killTree(undefined) and untrack of unknown pid are safe no-ops', () => {
    assert.doesNotThrow(() => killTree(undefined));
    assert.doesNotThrow(() => untrackChild(undefined));
    assert.doesNotThrow(() => untrackChild(999999999));
  });

  test('killTree terminates a live child process', async () => {
    // A child that would otherwise run ~60s. killTree must end it well before that.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      stdio: 'ignore', windowsHide: true, detached: process.platform !== 'win32',
    });
    trackChild(child.pid);
    const exited = new Promise<number | null>((resolve) => child.on('exit', (code) => resolve(code)));

    // Give it a moment to actually start, then tree-kill it.
    await new Promise(r => setTimeout(r, 200));
    killTree(child.pid);

    // It must exit promptly (well under the 60s it was scheduled to live).
    const result = await Promise.race([
      exited.then(() => 'exited' as const),
      new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 8000)),
    ]);
    untrackChild(child.pid);
    if (result === 'timeout') { try { child.kill('SIGKILL'); } catch { /* */ } }
    assert.equal(result, 'exited', 'killTree must terminate the child (no lingering zombie)');
  });
});
