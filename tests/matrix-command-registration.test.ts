import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const cliDir = join(import.meta.dirname, '..', 'src', 'cli');

// Scan all of src/cli recursively from a STABLE root (import.meta.dirname, not process.cwd()): the matrix
// command group moved from register-late-commands.ts to register-compete-cmds.ts + commands/, which broke the
// old single-file + cwd-relative assertion. The honest invariant is "the matrix group + actions are registered
// SOMEWHERE in src/cli", not "in this exact file".
const allCliSrc = readdirSync(cliDir, { recursive: true })
  .filter((f): f is string => typeof f === 'string' && f.endsWith('.ts'))
  .map(f => readFileSync(join(cliDir, f), 'utf8'))
  .join('\n');

describe('matrix command registration', () => {
  it('registers the Matrix Development command group and actions', () => {
    assert.match(allCliSrc, /\.command\('matrix'\)/);
    for (const action of ['status', 'claim', 'propose', 'merge', 'ascend']) {
      assert.match(allCliSrc, new RegExp(`action === '${action}'`));
    }
  });
});
