import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { recordLesson } from '../src/cli/commands/lessons.js';
import { loadMemoryStore } from '../src/core/memory-store.js';

describe('lessons command integration', () => {
  let originalCwd: string;
  let tmpDir: string;

  beforeEach(async () => {
    originalCwd = process.cwd();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'danteforge-lessons-command-'));
    process.chdir(tmpDir);
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('records a correction memory entry when a lesson is added', async () => {
    await recordLesson(
      'Workflow',
      'Forgot to validate design artifacts before forge',
      'Run design lint before forge for UI-heavy work',
      'user correction',
    );

    const store = await loadMemoryStore(tmpDir);
    assert.ok(store.entries.some(entry => entry.category === 'correction'));
    assert.ok(store.entries.some(entry => /Run design lint before forge/i.test(entry.summary) || /Run design lint before forge/i.test(entry.detail)));
  });
});
