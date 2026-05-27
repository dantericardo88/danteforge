import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startProgress, withProgress } from '../src/core/progress-indicator.js';

function makeCollector(): { chunks: string[]; output: () => string; write: (msg: string) => void } {
  const chunks: string[] = [];
  return {
    chunks,
    output: () => chunks.join(''),
    write: (msg: string) => chunks.push(msg),
  };
}

describe('startProgress (non-TTY)', () => {
  it('prints a deterministic progress line when created', () => {
    const col = makeCollector();
    startProgress('Building', { _writeFn: col.write, _isTTY: false, _now: () => 1_000 });
    assert.equal(col.output(), '[progress] Building\n');
  });

  it('update() prints a progress line', () => {
    const col = makeCollector();
    const handle = startProgress('Compiling', { _writeFn: col.write, _isTTY: false, _now: () => 1_000 });
    handle.update('processing files');
    assert.equal(col.output(), '[progress] Compiling\n[progress] processing files\n');
  });

  it('done() prints a completion line', () => {
    const col = makeCollector();
    const handle = startProgress('Installing', { _writeFn: col.write, _isTTY: false, _now: () => 1_000 });
    handle.done('all packages installed');
    assert.equal(col.output(), '[progress] Installing\n[done] all packages installed (0s)\n');
  });

  it('fail() prints a failure line', () => {
    const col = makeCollector();
    const handle = startProgress('Linting', { _writeFn: col.write, _isTTY: false, _now: () => 1_000 });
    handle.fail('syntax error on line 42');
    assert.equal(col.output(), '[progress] Linting\n[failed] syntax error on line 42 (0s)\n');
  });

  it('does not write additional lines after done() is called', () => {
    const col = makeCollector();
    const handle = startProgress('Deploying', { _writeFn: col.write, _isTTY: false });
    handle.done();
    const countBeforeExtra = col.chunks.length;
    handle.update('this should be ignored');
    handle.done('again should also be ignored');
    assert.equal(col.chunks.length, countBeforeExtra, 'no extra lines after done()');
  });

  it('does not write additional lines after fail() is called', () => {
    const col = makeCollector();
    const handle = startProgress('Testing', { _writeFn: col.write, _isTTY: false });
    handle.fail('test suite crashed');
    const countBeforeFail = col.chunks.length;
    handle.update('ignored');
    handle.fail('double-fail ignored');
    assert.equal(col.chunks.length, countBeforeFail, 'no extra lines after fail()');
  });

  it('supports explicit succeed() without double-emitting from withProgress', async () => {
    const col = makeCollector();
    const result = await withProgress('explicit succeed', async (handle) => {
      handle.succeed('all done');
      return 'ok';
    }, { _writeFn: col.write, _isTTY: false, _now: () => 1_000 });
    assert.equal(result, 'ok');
    assert.equal(col.output(), '[progress] explicit succeed\n[done] all done (0s)\n');
  });

  it('does not emit a second terminal event after explicit failure', async () => {
    const col = makeCollector();
    await assert.rejects(
      () => withProgress('explicit fail', async (handle) => {
        handle.fail('already failed');
        throw new Error('boom');
      }, { _writeFn: col.write, _isTTY: false, _now: () => 1_000 }),
      /boom/,
    );
    assert.equal(col.output(), '[progress] explicit fail\n[failed] already failed (0s)\n');
  });

  it('sanitizes control characters from rendered labels', () => {
    const col = makeCollector();
    const handle = startProgress('Start\n\x1b[31mred', {
      _isTTY: false,
      _writeFn: col.write,
      _now: () => 1_000,
    });
    handle.update('Next\rline');
    handle.fail();
    assert.equal(col.output(), '[progress] Start red\n[progress] Next line\n[failed] Next line (0s)\n');
  });

  it('truncates TTY render lines to the configured terminal width', () => {
    const col = makeCollector();
    const handle = startProgress('A very long operation label that should not wrap', {
      mode: 'spinner',
      _isTTY: true,
      _columns: 28,
      _writeFn: col.write,
      _now: () => 1_000,
      _setInterval: () => ({}) as NodeJS.Timeout,
      _clearInterval: () => {},
    });
    handle.stop();

    const firstLine = col.output().split('\r')[1] ?? '';
    assert.ok(firstLine.length <= 28, `line was ${firstLine.length} chars: ${firstLine}`);
  });
});

describe('withProgress', () => {
  it('returns the value resolved by the wrapped function', async () => {
    const col = makeCollector();
    const result = await withProgress(
      'Computing',
      async (_handle) => 42,
      { _writeFn: col.write, _isTTY: false },
    );
    assert.equal(result, 42);
  });

  it('marks done automatically when the function resolves', async () => {
    const col = makeCollector();
    await withProgress(
      'Syncing',
      async (_handle) => 'ok',
      { _writeFn: col.write, _isTTY: false },
    );
    assert.ok(
      col.output().includes('[done] Syncing'),
      'should have completion line after resolve',
    );
  });

  it('marks fail and re-throws when the function rejects', async () => {
    const col = makeCollector();
    await assert.rejects(
      () =>
        withProgress(
          'Deploying',
          async (_handle) => {
            throw new Error('network error');
          },
          { _writeFn: col.write, _isTTY: false },
        ),
      /network error/,
    );
    assert.ok(
      col.output().includes('[failed] network error'),
      'should have failure line after rejection',
    );
  });

  it('passes the handle to the wrapped function for intermediate updates', async () => {
    const col = makeCollector();
    await withProgress(
      'Bundling',
      async (handle) => {
        handle.update('step 1');
        handle.update('step 2');
        return 'done';
      },
      { _writeFn: col.write, _isTTY: false },
    );
    const updateLines = col.chunks.filter((l) => l.startsWith('[progress] step'));
    assert.equal(updateLines.length, 2, 'expected 2 update lines');
  });
});

describe('canonical progress wiring', () => {
  it('uses progress-indicator as the single production command progress surface', () => {
    const commandsDir = path.resolve('src/cli/commands');
    const offenders: string[] = [];
    for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.ts')) continue;
      const filePath = path.join(commandsDir, entry.name);
      const content = fs.readFileSync(filePath, 'utf8');
      if (content.includes('../../core/ux-progress.js')) {
        offenders.push(path.relative(process.cwd(), filePath));
      }
    }
    assert.deepEqual(offenders, []);
  });
});
