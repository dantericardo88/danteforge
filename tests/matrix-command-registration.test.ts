import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = process.cwd();

describe('matrix command registration', () => {
  it('registers the Matrix Development command group and actions', () => {
    const src = readFileSync(join(repoRoot, 'src', 'cli', 'register-late-commands.ts'), 'utf8');

    assert.match(src, /\.command\('matrix'\)/);
    for (const action of ['status', 'claim', 'propose', 'merge', 'ascend']) {
      assert.match(src, new RegExp(`action === '${action}'`));
    }
  });
});
