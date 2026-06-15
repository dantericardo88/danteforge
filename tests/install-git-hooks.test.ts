import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { installLocHook } from '../src/core/install-git-hooks.js';

// ── Injection-seam helpers ───────────────────────────────────────────────────

function makeMemFs(files: Record<string, string> = {}) {
  const store: Record<string, string> = { ...files };
  const dirs = new Set<string>();

  return {
    store,
    dirs,
    _exists: async (p: string) => p in store || dirs.has(p),
    _readFile: async (p: string) => {
      if (!(p in store)) throw new Error(`ENOENT: ${p}`);
      return store[p];
    },
    _writeFile: async (p: string, content: string, _mode: number) => {
      store[p] = content;
    },
    _mkdir: async (p: string) => {
      dirs.add(p);
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('installLocHook', () => {
  it('creates a new pre-commit hook when none exists', async () => {
    const cwd = '/fake';
    const hooksDir = path.join(cwd, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'pre-commit');
    const mem = makeMemFs();
    mem.dirs.add(hooksDir);

    const result = await installLocHook(cwd, {
      _exists: mem._exists,
      _readFile: mem._readFile,
      _writeFile: mem._writeFile,
      _mkdir: mem._mkdir,
    });

    assert.equal(result.installed, true);
    assert.equal(result.updated, false);
    assert.equal(result.skipped, false);

    assert.ok(mem.store[hookPath], 'hook file should be written');
    assert.ok(mem.store[hookPath].startsWith('#!/bin/sh'), 'should start with shebang');
    assert.ok(mem.store[hookPath].includes('danteforge-loc-gate-start'), 'should contain marker');
    assert.ok(mem.store[hookPath].includes('750'), 'should enforce 750-line limit');
    // CH-024: a fresh install now ALSO chains the full Pillar-2 guard script.
    assert.ok(mem.store[hookPath].includes('danteforge-guards-start'), 'should contain the guards marker');
    assert.ok(mem.store[hookPath].includes('hooks/pre-commit.mjs'), 'should invoke the full guard script');
  });

  it('CH-024: upgrades a loc-ONLY hook (dormant-defenses state) by appending the Pillar-2 guards', async () => {
    const cwd = '/fake';
    const hookPath = path.join(cwd, '.git', 'hooks', 'pre-commit');
    // The exact state this repo was in: only the LOC gate installed, all the security guards dormant.
    const locOnly = '#!/bin/sh\n# ---- danteforge-loc-gate-start ---- do not edit between markers\nnode -e ""\n# ---- danteforge-loc-gate-end ----\n';
    const mem = makeMemFs({ [hookPath]: locOnly });
    mem.dirs.add(path.join(cwd, '.git', 'hooks'));

    const result = await installLocHook(cwd, {
      _exists: mem._exists, _readFile: mem._readFile, _writeFile: mem._writeFile, _mkdir: mem._mkdir,
    });

    assert.equal(result.updated, true, 'a loc-only hook is upgraded, not skipped');
    assert.ok(mem.store[hookPath].includes('danteforge-loc-gate-start'), 'keeps the existing loc gate');
    assert.ok(mem.store[hookPath].includes('danteforge-guards-start'), 'adds the guards block');
    assert.ok(mem.store[hookPath].includes('hooks/pre-commit.mjs'), 'invokes the full guard script');
  });

  it('appends managed block to an existing hook without the marker', async () => {
    const cwd = '/fake';
    const hooksDir = path.join(cwd, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'pre-commit');
    const existing = '#!/bin/sh\necho "existing hook"\n';
    const mem = makeMemFs({ [hookPath]: existing });
    mem.dirs.add(hooksDir);

    const result = await installLocHook(cwd, {
      _exists: mem._exists,
      _readFile: mem._readFile,
      _writeFile: mem._writeFile,
      _mkdir: mem._mkdir,
    });

    assert.equal(result.installed, false);
    assert.equal(result.updated, true);
    assert.equal(result.skipped, false);

    assert.ok(mem.store[hookPath].includes('existing hook'), 'should preserve original content');
    assert.ok(mem.store[hookPath].includes('danteforge-loc-gate-start'), 'should append marker');
  });

  it('skips when the managed block is already present (idempotent)', async () => {
    const cwd = '/fake';
    const hooksDir = path.join(cwd, '.git', 'hooks');
    const hookPath = path.join(hooksDir, 'pre-commit');
    const existing = '#!/bin/sh\n# ---- danteforge-loc-gate-start ---- do not edit between markers\nnode -e ""\n# ---- danteforge-loc-gate-end ----\n# ---- danteforge-guards-start ---- do not edit between markers\nif [ -f hooks/pre-commit.mjs ]; then node hooks/pre-commit.mjs || exit 1; fi\n# ---- danteforge-guards-end ----\n';
    const mem = makeMemFs({ [hookPath]: existing });
    mem.dirs.add(hooksDir);

    const originalContent = mem.store[hookPath];
    const result = await installLocHook(cwd, {
      _exists: mem._exists,
      _readFile: mem._readFile,
      _writeFile: mem._writeFile,
      _mkdir: mem._mkdir,
    });

    assert.equal(result.installed, false);
    assert.equal(result.updated, false);
    assert.equal(result.skipped, true);
    assert.equal(mem.store[hookPath], originalContent, 'file should not be modified');
  });

  it('returns graceful failure result when .git directory is missing', async () => {
    const mem = makeMemFs();
    // No .git/hooks dir added — _exists always returns false

    const result = await installLocHook('/no-git-repo', {
      _exists: mem._exists,
      _readFile: mem._readFile,
      _writeFile: mem._writeFile,
      _mkdir: mem._mkdir,
    });

    assert.equal(result.installed, false);
    assert.equal(result.updated, false);
    assert.equal(result.skipped, false);
  });

  it('integration: creates real hook file in a tmp dir', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'df-hook-test-'));
    try {
      const hooksDir = path.join(tmpDir, '.git', 'hooks');
      await fs.mkdir(hooksDir, { recursive: true });

      const result = await installLocHook(tmpDir);

      assert.equal(result.installed, true);
      const hookPath = path.join(hooksDir, 'pre-commit');
      const content = await fs.readFile(hookPath, 'utf8');
      assert.ok(content.startsWith('#!/bin/sh'));
      assert.ok(content.includes('danteforge-loc-gate-start'));
      assert.ok(content.includes('750'));

      // Idempotency check: running again should skip
      const result2 = await installLocHook(tmpDir);
      assert.equal(result2.skipped, true);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
